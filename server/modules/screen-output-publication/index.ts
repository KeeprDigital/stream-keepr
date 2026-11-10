import type { HearingScreen, OutputChange, OutputChangeKind, ScreenHearsContext } from '~~/shared/screenOutputInterest';
import type { MessagePayload, MessageType } from '~~/shared/types/messages';
import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { featureMatches, screens } from '~~/server/db/schema';
import { publishFailureFields } from '~~/server/utils/realtimePublishFailure';
import { screenOutputFeatureMatchSlotId } from '~~/server/utils/screenOutputSelection';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { OUTPUT_CHANGE_KINDS, outputChangeOf, screenHears, seatedSlotOf } from '~~/shared/screenOutputInterest';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';

/**
 * What each Screen's own channel is told of a change announced on its Event's.
 *
 * A Screen message carries nothing its Screen's own `/api/screen-output/**`
 * read does not answer. The messages of one Screen (its Card, its Broadcast
 * Graphics Live Session, the Feature Match Session of the Slot it shows) go to
 * it unchanged; every other change reaches a Screen only as a notice naming the
 * kinds of Output Change its mode shows, for its output to re-read.
 *
 * Which Screens show a change is `shared/screenOutputInterest.ts`'s to say,
 * asked after the write committed, so a Screen is judged on its mode and
 * configuration as they now stand. Nothing here ever fails the write.
 */

/** One Event message, as it was published on the Event channel. */
export type EventMessage = {
	[T in MessageType]: { type: T; payload: MessagePayload<T> };
}[MessageType];

/** One message for a Screen's channel. */
export type ScreenChannelMessage = EventMessage & { originConnectionId?: string };

/** The messages one Screen's channel is to receive, in order. */
export interface ScreenChannelDelivery {
	screenId: number;
	messages: ScreenChannelMessage[];
}

/** A Screen whose channel refused its messages, and the provider's account of why. */
export interface ScreenChannelFailure {
	screenId: number;
	error: unknown;
}

/** The port to the Screen channels: publishes each delivery, and answers the ones refused. */
export type PublishToScreenChannels = (
	eventId: number,
	deliveries: readonly ScreenChannelDelivery[],
) => Promise<ScreenChannelFailure[]>;

interface HeardMessage {
	message: EventMessage;
	originConnectionId?: string;
}

interface OutputChangeRun {
	byEvent: Map<number, { heard: HeardMessage[]; publish: PublishToScreenChannels }>;
}

const currentRun = new AsyncLocalStorage<OutputChangeRun>();

/**
 * The modes whose declared follows read their config. Only their Screens'
 * configuration is loaded: a Broadcast Graphics or Background Screen's holds
 * its Authored Stack, hundreds of kilobytes no follow reads.
 */
const CONFIG_READING_MODES = SCREEN_MODE_VALUES.filter(mode =>
	Object.values(SCREEN_MODES[mode].outputFollows).some(follow => typeof follow === 'function'));

/** D1 binds at most a hundred parameters a statement; past this the Slot read is skipped, and every Player is heard. */
const MAX_SEATED_SLOTS_READ = 90;

interface JudgedScreen {
	hearing: HearingScreen;
	/** The Feature Match Slot its Screen Output may read, whose Session messages may reach it whole. */
	shownSlotId: number | null;
}

/** One narrow read: each Screen's id, current mode, and that mode's saved config where a follow reads it. */
async function readScreens(eventId: number): Promise<JudgedScreen[]> {
	const rows = await db
		.select({
			id: screens.id,
			mode: screens.currentMode,
			config: sql<string | null>`case when ${inArray(screens.currentMode, CONFIG_READING_MODES)} then json_extract(${screens.modeConfigs}, '$."' || ${screens.currentMode} || '"') end`,
		})
		.from(screens)
		.where(eq(screens.eventId, eventId));

	return rows.map(({ id, mode, config }) => {
		const modeConfigs = (config
			? {
					[mode]: JSON.parse(config),
				}
			: null) as ModeConfigsMap | null;
		return {
			hearing: {
				id,
				mode,
				config: resolveScreenModeConfig(modeConfigs, mode),
			},
			shownSlotId: screenOutputFeatureMatchSlotId({ currentMode: mode, modeConfigs }),
		};
	});
}

const SEATED_KINDS = ['player', 'playerDeck'] as const satisfies readonly OutputChangeKind[];

/**
 * Who the Slots seat that narrow some Screen's hearing of a Player or deck
 * change: one read, made only when such a change names its Players and some
 * Screen is narrowed by a Slot.
 */
async function readSeatedPlayers(
	eventId: number,
	judged: readonly JudgedScreen[],
	changes: readonly OutputChange[],
): Promise<Map<number, number[]>> {
	const seated = new Map<number, number[]>();
	const kinds = SEATED_KINDS.filter(kind => changes.some(change => change.kind === kind && change.playerIds !== undefined));
	const slotIds = [
		...new Set(kinds.flatMap(kind => judged.flatMap(({ hearing }) => seatedSlotOf(hearing, kind) ?? []))),
	];
	if (slotIds.length === 0 || slotIds.length > MAX_SEATED_SLOTS_READ)
		return seated;

	const slots = await db
		.select({ id: featureMatches.id, player1Id: featureMatches.player1Id, player2Id: featureMatches.player2Id })
		.from(featureMatches)
		.where(and(eq(featureMatches.eventId, eventId), inArray(featureMatches.id, slotIds)));
	for (const slot of slots)
		seated.set(slot.id, [slot.player1Id, slot.player2Id].filter(id => id != null));
	return seated;
}

/** What `screenHears` needs beside the Screen for one kind: the Slot narrowing it, and who it seats. A Slot not read admits every Player. */
function hearingContext(hearing: HearingScreen, kind: OutputChangeKind, seated: ReadonlyMap<number, number[]>): ScreenHearsContext {
	const slotId = seatedSlotOf(hearing, kind);
	const playerIds = slotId === null
		? undefined
		: seated.get(slotId);
	return playerIds === undefined
		? {}
		: {
				slot: { id: slotId!, playerIds },
			};
}

/** What one Screen's channel is to receive for a run, as it accumulates. */
interface ScreenTelling {
	forwarded: ScreenChannelMessage[];
	eventContext: boolean;
	causes: Set<OutputChangeKind>;
}

/** The kinds whose one message names its Screen and goes to it with no read: a Take must not wait on one (ADR-0004). */
function namesItsScreenUnread(type: MessageType, change: OutputChange): change is OutputChange & { screenId: number } {
	return change.screenId !== undefined
		&& (change.kind === 'broadcastGraphicsLiveSession' || type === 'screen:updated' || type === 'screen:deleted');
}

/**
 * Decide what each Screen channel receives for the messages one change
 * published: its own messages in order, then at most one notice that its Event
 * context changed, then at most one naming every kind of change its mode shows.
 */
async function decideDeliveries(eventId: number, heard: readonly HeardMessage[]): Promise<ScreenChannelDelivery[]> {
	const changed = heard.flatMap(({ message, originConnectionId }) =>
		outputChangeOf(message.type, message.payload as never).map(change => ({ message, originConnectionId, change })));
	// A new Screen has no output to tell.
	const shown = changed.filter(({ message }) => message.type !== 'screen:created');
	if (shown.length === 0)
		return [];

	const tellings = new Map<number, ScreenTelling>();
	const telling = (screenId: number) => {
		let entry = tellings.get(screenId);
		if (!entry) {
			entry = {
				forwarded: [],
				eventContext: false,
				causes: new Set(),
			};
			tellings.set(screenId, entry);
		}
		return entry;
	};

	const needsScreens = shown.some(({ message, change }) => !namesItsScreenUnread(message.type, change));
	const judged = needsScreens
		? await readScreens(eventId)
		: [];
	const seated = judged.length > 0
		? await readSeatedPlayers(eventId, judged, shown.map(({ change }) => change))
		: new Map<number, number[]>();

	for (const { message, originConnectionId, change } of shown) {
		if (namesItsScreenUnread(message.type, change)) {
			telling(change.screenId).forwarded.push(change.kind === 'screen'
				? {
						type: message.type,
						payload: { screenId: change.screenId },
					} as ScreenChannelMessage
				: { ...message, originConnectionId });
			continue;
		}

		for (const { hearing, shownSlotId } of judged) {
			if (change.kind === 'event' || change.kind === 'theme') {
				telling(hearing.id).eventContext = true;
				continue;
			}
			if (!screenHears(hearing, change, hearingContext(hearing, change.kind, seated)))
				continue;
			// A payload reaches a Screen only where its own read answers the same: the Card
			// while in Card Spotlight, the Session of the Slot it shows.
			if (change.kind === 'screenCard') {
				if (hearing.mode === 'card')
					telling(hearing.id).forwarded.push({ ...message, originConnectionId });
			}
			else if (change.kind === 'featureMatchSession' && shownSlotId !== null && change.slotIds?.includes(shownSlotId)) {
				telling(hearing.id).forwarded.push({ ...message, originConnectionId });
			}
			else {
				telling(hearing.id).causes.add(change.kind);
			}
		}
	}

	return [...tellings].map(([screenId, { forwarded, eventContext, causes }]) => ({
		screenId,
		messages: [
			...forwarded,
			...(eventContext
				? [
						{ type: 'output:eventContextChanged', payload: {} } as const,
					]
				: []),
			...(causes.size > 0
				? [
						{
							type: 'output:modeDataChanged',
							payload: {
								screenId,
								causes: OUTPUT_CHANGE_KINDS.filter(kind => causes.has(kind)),
							},
						} as const,
					]
				: []),
		],
	}));
}

async function attempt(
	eventId: number,
	deliveries: readonly ScreenChannelDelivery[],
	publish: PublishToScreenChannels,
): Promise<ScreenChannelFailure[]> {
	try {
		return await publish(eventId, deliveries);
	}
	catch (error) {
		return deliveries.map(({ screenId }) => ({ screenId, error }));
	}
}

/**
 * Publish to the Screen channels, retrying the refused ones once.
 *
 * A second refusal is logged and left: the forwarded messages are sequenced or
 * revisioned and the notices idempotent, so a duplicate is safe and a loss is
 * what an output's Reconnect Resync and slow re-read already recover from.
 */
async function deliver(eventId: number, deliveries: readonly ScreenChannelDelivery[], publish: PublishToScreenChannels): Promise<void> {
	if (deliveries.length === 0)
		return;
	let failures = await attempt(eventId, deliveries, publish);
	if (failures.length > 0) {
		const refused = new Set(failures.map(failure => failure.screenId));
		failures = await attempt(eventId, deliveries.filter(delivery => refused.has(delivery.screenId)), publish);
	}
	for (const { screenId, error } of failures) {
		console.error(JSON.stringify({
			message: 'realtime_publish_failed',
			eventId,
			screenId,
			messageTypes: deliveries.find(delivery => delivery.screenId === screenId)?.messages.map(message => message.type) ?? [],
			...publishFailureFields(error),
		}));
	}
}

async function tellScreens(eventId: number, heard: readonly HeardMessage[], publish: PublishToScreenChannels): Promise<void> {
	try {
		await deliver(eventId, await decideDeliveries(eventId, heard), publish);
	}
	catch (error) {
		// The write committed and its Event message went out: failing to work out
		// who else to tell must not turn that into a failure inviting a retry.
		console.error(JSON.stringify({
			message: 'screen_output_publication_failed',
			eventId,
			messageTypes: heard.map(({ message }) => message.type),
			...publishFailureFields(error),
		}));
	}
}

/**
 * Tell the Screens of one message just published on their Event's channel.
 * Inside `asOneOutputChange` it is held and told with the rest of the run,
 * unless it is a Broadcast Graphics Live Session's. Never throws.
 */
export async function publishToScreenOutputs(
	eventId: number,
	message: EventMessage,
	originConnectionId: string | undefined,
	publish: PublishToScreenChannels,
): Promise<void> {
	const run = currentRun.getStore();
	// A Live Session message is never held: it is sequenced by itself, and a run must not delay playout.
	if (!run || message.type.startsWith('broadcastGraphicsLiveSession:')) {
		await tellScreens(eventId, [
			{ message, originConnectionId },
		], publish);
		return;
	}
	let held = run.byEvent.get(eventId);
	if (!held) {
		held = { heard: [], publish };
		run.byEvent.set(eventId, held);
	}
	held.heard.push({ message, originConnectionId });
}

/**
 * Publish everything `work` announces as one change to the Screens: each Event
 * message goes out on the Event channel as it is published, and once `work`
 * settles each Screen is told once, with every cause it shows. A run inside a
 * run joins it.
 */
export async function asOneOutputChange<T>(work: () => Promise<T>): Promise<T> {
	if (currentRun.getStore())
		return await work();

	const run: OutputChangeRun = {
		byEvent: new Map(),
	};
	try {
		return await currentRun.run(run, work);
	}
	finally {
		// What was announced before a failure announced a committed write all the same.
		for (const [eventId, { heard, publish }] of run.byEvent)
			await tellScreens(eventId, heard, publish);
	}
}

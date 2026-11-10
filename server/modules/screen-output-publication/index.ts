import type { HearingScreen, OutputChange, OutputChangeKind, ScreenHearsContext } from '~~/shared/screenOutputInterest';
import type { MessagePayload, MessageType } from '~~/shared/types/messages';
import type { ModeConfigsMap } from '~~/shared/types/screenConfig';
import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { featureMatches, matches, rounds, screens } from '~~/server/db/schema';
import { publishFailureFields } from '~~/server/utils/realtimePublishFailure';
import { screenOutputFeatureMatchSlotId } from '~~/server/utils/screenOutputSelection';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { OUTPUT_CHANGE_KINDS, outputChangeOf, screenHears, slotNarrowingOf } from '~~/shared/screenOutputInterest';
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
 *
 * A payload forwarded whole is published before the write answers: a Take, a
 * Card or a score must not wait (ADR-0004). A telling of notices alone is
 * finished after the answer where the request can take it (`AfterAnswer`),
 * one telling at a time, so a request's notices keep the order of its writes.
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

/**
 * The request a write was made in, where it can finish work after answering:
 * the Worker's `waitUntil`. A write with none, as a scheduled tick's, waits.
 */
export interface AfterAnswer {
	/** The request itself: what its tellings are kept in order by. */
	request: object;
	waitUntil: (work: Promise<unknown>) => void;
}

interface HeardMessage {
	message: EventMessage;
	originConnectionId?: string;
}

interface OutputChangeRun {
	byEvent: Map<number, { heard: HeardMessage[]; publish: PublishToScreenChannels; afterAnswer?: AfterAnswer }>;
}

const currentRun = new AsyncLocalStorage<OutputChangeRun>();

/**
 * The modes whose declared follows read their config. Only their Screens'
 * configuration is loaded: a Broadcast Graphics or Background Screen's holds
 * its Authored Stack, hundreds of kilobytes no follow reads.
 */
const CONFIG_READING_MODES = SCREEN_MODE_VALUES.filter(mode =>
	Object.values(SCREEN_MODES[mode].outputFollows).some(follow => typeof follow === 'function'));

/** D1 binds at most a hundred parameters a statement; past this the Slot read is skipped, and every change a Slot would narrow is heard. */
const MAX_SLOTS_READ = 90;

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

type ReadSlot = NonNullable<ScreenHearsContext['slot']>;

/**
 * The Slots whose rows narrow some Screen's hearing of these changes, as they
 * stand after the write: who each seats, and the Match it follows with that
 * Match's Round and Phase. One read, made only when a change names an id some
 * Screen's Slot can rule out.
 */
async function readSlots(
	eventId: number,
	judged: readonly JudgedScreen[],
	changes: readonly OutputChange[],
): Promise<Map<number, ReadSlot>> {
	const read = new Map<number, ReadSlot>();
	const slotIds = [
		...new Set(changes.flatMap(change => judged.flatMap(({ hearing }) => slotNarrowingOf(hearing, change) ?? []))),
	];
	if (slotIds.length === 0 || slotIds.length > MAX_SLOTS_READ)
		return read;

	const slots = await db
		.select({
			id: featureMatches.id,
			player1Id: featureMatches.player1Id,
			player2Id: featureMatches.player2Id,
			matchId: featureMatches.matchId,
			roundId: matches.roundId,
			phaseId: rounds.phaseId,
		})
		.from(featureMatches)
		.leftJoin(matches, eq(matches.id, featureMatches.matchId))
		.leftJoin(rounds, eq(rounds.id, matches.roundId))
		.where(and(eq(featureMatches.eventId, eventId), inArray(featureMatches.id, slotIds)));
	for (const { id, player1Id, player2Id, matchId, roundId, phaseId } of slots) {
		read.set(id, {
			id,
			playerIds: [player1Id, player2Id].filter(playerId => playerId != null),
			// A Match whose Round or Phase the read could not name is left untold.
			...(matchId === null
				? { match: null }
				: roundId !== null && phaseId !== null && {
					match: { id: matchId, roundId, phaseId },
				}),
		});
	}
	return read;
}

/** What `screenHears` needs beside the Screen for one change: the Slot narrowing it, as read. A Slot not read admits every id. */
function hearingContext(hearing: HearingScreen, change: OutputChange, slots: ReadonlyMap<number, ReadSlot>): ScreenHearsContext {
	const slotId = slotNarrowingOf(hearing, change);
	const slot = slotId === null
		? undefined
		: slots.get(slotId);
	return slot
		? { slot }
		: {};
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
	const slots = judged.length > 0
		? await readSlots(eventId, judged, shown.map(({ change }) => change))
		: new Map<number, ReadSlot>();

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
			if (!screenHears(hearing, change, hearingContext(hearing, change, slots)))
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

/** The kinds whose message may reach a Screen whole, payload and all. */
const FORWARDED_WHOLE = ['broadcastGraphicsLiveSession', 'screenCard', 'featureMatchSession'] as const satisfies readonly OutputChangeKind[];

/** Whether any of these messages may reach a Screen whole: a Take, a Card or a score, which the write's answer waits for. */
function forwardsPayload(heard: readonly HeardMessage[]): boolean {
	return heard.some(({ message }) => outputChangeOf(message.type, message.payload as never)
		.some(change => (FORWARDED_WHOLE as readonly OutputChangeKind[]).includes(change.kind)));
}

/** Each request's tellings still to finish, one behind the other. */
const finishing = new WeakMap<object, Promise<void>>();

/**
 * Tell the Screens, before the write answers or after it. Notices alone are
 * idempotent and carry nothing, so where the request can finish work after its
 * answer they are told behind its earlier tellings, and the write does not wait.
 */
async function tellScreensInTime(
	eventId: number,
	heard: readonly HeardMessage[],
	publish: PublishToScreenChannels,
	afterAnswer: AfterAnswer | undefined,
): Promise<void> {
	if (!afterAnswer || forwardsPayload(heard)) {
		await tellScreens(eventId, heard, publish);
		return;
	}
	// `tellScreens` never rejects, so neither does the chain handed over.
	const telling = (finishing.get(afterAnswer.request) ?? Promise.resolve()).then(async () => await tellScreens(eventId, heard, publish));
	finishing.set(afterAnswer.request, telling);
	try {
		afterAnswer.waitUntil(telling);
	}
	catch {
		// The request cannot take it: the write waits, as with no request.
		await telling;
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
	afterAnswer?: AfterAnswer,
): Promise<void> {
	const run = currentRun.getStore();
	// A Live Session message is never held: it is sequenced by itself, and a run must not delay playout.
	if (!run || message.type.startsWith('broadcastGraphicsLiveSession:')) {
		await tellScreensInTime(eventId, [
			{ message, originConnectionId },
		], publish, afterAnswer);
		return;
	}
	let held = run.byEvent.get(eventId);
	if (!held) {
		held = { heard: [], publish, afterAnswer };
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
		for (const [eventId, { heard, publish, afterAnswer }] of run.byEvent)
			await tellScreensInTime(eventId, heard, publish, afterAnswer);
	}
}

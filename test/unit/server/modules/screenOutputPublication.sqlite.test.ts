import type { EventDataMessage } from '~~/server/modules/event-data-publication/messages';
import type { OutputChangeKind } from '~~/shared/screenOutputInterest';
import type { ScreenMode } from '~~/shared/types/enums';
import type { MessageType } from '~~/shared/types/messages';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { eventRealtimeChannel, screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { deferred } from '~~/test/helpers/deferred';
import { eventMessageSamples } from '~~/test/helpers/eventMessageSamples';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// What each Screen's own channel is sent beside the Event channel's messages:
// its Screen's messages unchanged, and a notice of each change its mode shows.
// Driven through the real publish functions; only the Ably client is faked.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const { publishMessage, publishMessageStrict } = await import('~~/server/utils/ably');
const { asOneOutputChange } = await import('~~/server/modules/screen-output-publication');

let screenSeq = 0;
async function stageEvent() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning();
	return event!;
}

async function stageScreen<M extends ScreenMode>(eventId: number, mode: M, config?: Partial<ModeConfigTypeMap[M]>) {
	screenSeq += 1;
	const [screen] = await db.insert(schema.screens)
		.values({
			eventId,
			name: `Screen ${screenSeq}`,
			slug: `screen-${screenSeq}`,
			currentMode: mode,
			modeConfigs: config && { [mode]: config },
			assetCapabilitySeed: `seed-${screenSeq}`,
			assetCapabilityDigest: `digest-${screenSeq}`,
		})
		.returning({ id: schema.screens.id });
	return screen!.id;
}

const event = await stageEvent();
const eventId = event.id;
const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss' }).returning();
const [round, otherRound] = await db.insert(schema.rounds).values([
	{
		eventId,
		phaseId: phase!.id,
		name: 'Round 1',
		roundNumber: 1,
	},
	{
		eventId,
		phaseId: phase!.id,
		name: 'Round 2',
		roundNumber: 2,
	},
]).returning();
const [seated, opponent, unseated] = await db.insert(schema.players).values([
	{ eventId, name: 'Seated' },
	{ eventId, name: 'Opponent' },
	{ eventId, name: 'Unseated' },
]).returning();
const [slot, otherSlot] = await db.insert(schema.featureMatches).values([
	{
		eventId,
		tableNumber: 1,
		player1Id: seated!.id,
		player2Id: opponent!.id,
	},
	{ eventId, tableNumber: 2, player1Id: unseated!.id },
]).returning();

const SCREENS = {
	standings: await stageScreen(eventId, 'standings', { roundId: round!.id }),
	overlay: await stageScreen(eventId, 'feature-match-overlay', { featureMatchId: slot!.id }),
	otherOverlay: await stageScreen(eventId, 'feature-match-overlay', { featureMatchId: otherSlot!.id }),
	controls: await stageScreen(eventId, 'feature-match', { featureMatchId: slot!.id }),
	headToHead: await stageScreen(eventId, 'head-to-head', { playerSource: 'featureMatchSlot', featureMatchId: slot!.id }),
	card: await stageScreen(eventId, 'card'),
	graphics: await stageScreen(eventId, 'broadcast-graphics'),
	background: await stageScreen(eventId, 'background'),
};
type ScreenName = keyof typeof SCREENS;
const SCREEN_NAMES = Object.keys(SCREENS) as ScreenName[];

const SAMPLES = eventMessageSamples({
	screenId: SCREENS.card,
	playerId: seated!.id,
	opponentId: opponent!.id,
	phaseId: phase!.id,
	roundId: round!.id,
	matchId: 1,
	slotId: slot!.id,
	playerListId: 1,
	talentId: 1,
	archetypeId: 1,
	broadcastDeckListId: 1,
});

/** One Event message: its sample, or the same message naming something else. */
function message<K extends MessageType>(type: K, payload: object = SAMPLES[type]): EventDataMessage {
	return { type, payload } as EventDataMessage;
}

type Heard = [type: string, payload: object];
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function forwarded({ type, payload }: EventDataMessage): Heard {
	return [
		type,
		wire(payload),
	];
}
const contextChanged: Heard = ['output:eventContextChanged', {}];
function changed(screen: ScreenName, ...causes: OutputChangeKind[]): Heard {
	return [
		'output:modeDataChanged',
		{ screenId: SCREENS[screen], causes },
	];
}
function everyScreen(heard: (screen: ScreenName) => Heard[]) {
	return Object.fromEntries(SCREEN_NAMES.map(screen => [
		screen,
		heard(screen),
	]));
}

/** What each Screen channel of `forEvent` received, by Screen name where it has one; a silent Screen is left out. */
function heardByScreens(forEvent = eventId) {
	const heard: Record<string, Heard[]> = {};
	for (const { channel, type, payload } of ably.published) {
		if (!channel.startsWith(`screen:${forEvent}:`))
			continue;
		const name = SCREEN_NAMES.find(screen => screenRealtimeChannel(eventId, SCREENS[screen]) === channel) ?? channel;
		(heard[name] ??= []).push([type, payload]);
	}
	return heard;
}

function heardByEvent(forEvent = eventId): Heard[] {
	return ably.on(eventRealtimeChannel(forEvent)).map(({ type, payload }) => [type, payload]);
}

async function announce(messages: readonly EventDataMessage[], forEvent = eventId) {
	for (const { type, payload } of messages)
		await publishMessage(forEvent, type, payload as never);
}

beforeEach(() => ably.reset());
afterEach(() => vi.restoreAllMocks());
afterAll(async () => await harness.close());

const sessionEvent = message('featureMatchSession:eventApplied');
const cardUpdated = message('card:updated');
const cardCleared = message('card:cleared');
const commandApplied = message('broadcastGraphicsLiveSession:commandApplied', { screenId: SCREENS.graphics, sequence: 4 });
const epochEnded = message('broadcastGraphicsLiveSession:epochEnded', { screenId: SCREENS.graphics, sessionId: 9 });

interface Case {
	name: string;
	messages: EventDataMessage[];
	/** Published as one change, as a write announcing several messages does. */
	run?: true;
	screens: Partial<Record<ScreenName | string, Heard[]>>;
}

describe('what a Screen\'s channel is sent', () => {
	// The Event channel receives every message as before, in order; each Screen
	// channel receives exactly what its Screen shows, and nothing else.
	it.each<Case>([
		{
			name: 'a Feature Match Session event goes whole to a Screen showing that Slot, and as a cause to one that follows it without reading it',
			messages: [sessionEvent],
			screens: {
				overlay: [
					forwarded(sessionEvent),
				],
				controls: [
					forwarded(sessionEvent),
				],
				headToHead: [
					changed('headToHead', 'featureMatchSession'),
				],
			},
		},
		{
			name: 'a Card goes to its Screen while that Screen is in Card Spotlight',
			messages: [cardUpdated, cardCleared],
			screens: {
				card: [
					forwarded(cardUpdated),
					forwarded(cardCleared),
				],
			},
		},
		{
			name: 'a Card of a Screen in another mode reaches no Screen',
			messages: [
				message('card:updated', { card: null, screenId: SCREENS.standings, revision: 1 }),
				message('card:cleared', { screenId: SCREENS.standings, revision: 2 }),
			],
			screens: {},
		},
		{
			name: 'a Live Session message goes to its own Screen alone, as it was published',
			messages: [commandApplied, epochEnded],
			screens: {
				graphics: [
					forwarded(commandApplied),
					forwarded(epochEnded),
				],
			},
		},
		{
			name: 'an Event change tells every Screen its Event context changed',
			messages: [
				message('event:updated'),
			],
			screens: everyScreen(() => [contextChanged]),
		},
		{
			name: 'a Theme change tells every Screen its Event context changed',
			messages: [
				message('theme:updated'),
			],
			screens: everyScreen(() => [contextChanged]),
		},
		{
			name: 'a Screen change names the Screen to that Screen alone',
			messages: [
				message('screen:updated', { screenId: SCREENS.overlay }),
				message('screen:deleted', { screenId: SCREENS.overlay }),
			],
			screens: {
				overlay: [
					[
						'screen:updated',
						{ screenId: SCREENS.overlay },
					],
					[
						'screen:deleted',
						{ screenId: SCREENS.overlay },
					],
				],
			},
		},
		{
			name: 'a deleted Screen is still told it is gone',
			messages: [
				message('screen:deleted', { screenId: 999_999 }),
			],
			screens: {
				[screenRealtimeChannel(eventId, 999_999)]: [
					[
						'screen:deleted',
						{ screenId: 999_999 },
					],
				],
			},
		},
		{
			name: 'a new Screen has no output to tell',
			messages: [
				message('screen:created', { screenId: SCREENS.overlay }),
			],
			screens: {},
		},
		{
			name: 'a Round change reaches the Standings fixed at that Round and the modes that follow every Round',
			messages: [
				message('round:updated'),
			],
			screens: {
				standings: [
					changed('standings', 'round'),
				],
				overlay: [
					changed('overlay', 'round'),
				],
				otherOverlay: [
					changed('otherOverlay', 'round'),
				],
				headToHead: [
					changed('headToHead', 'round'),
				],
			},
		},
		{
			name: 'a change to another Round does not reach the Standings fixed at one',
			messages: [
				message('round:updated', {
					round: { id: otherRound!.id },
				}),
			],
			screens: {
				overlay: [
					changed('overlay', 'round'),
				],
				otherOverlay: [
					changed('otherOverlay', 'round'),
				],
				headToHead: [
					changed('headToHead', 'round'),
				],
			},
		},
		{
			name: 'a Player change reaches the Screens whose Slot seats that Player',
			messages: [
				message('player:updated'),
			],
			screens: {
				standings: [
					changed('standings', 'player'),
				],
				overlay: [
					changed('overlay', 'player'),
				],
				controls: [
					changed('controls', 'player'),
				],
				headToHead: [
					changed('headToHead', 'player'),
				],
			},
		},
		{
			name: 'a Player change does not reach a Screen whose Slot seats others',
			messages: [
				message('player:updated', {
					player: { id: unseated!.id },
				}),
			],
			screens: {
				standings: [
					changed('standings', 'player'),
				],
				otherOverlay: [
					changed('otherOverlay', 'player'),
				],
			},
		},
		{
			name: 'a deck projection change reaches the Screens whose Slot seats one of the Players it names',
			messages: [
				message('player:deckProjectionsChanged', {
					playerIds: [unseated!.id, seated!.id],
				}),
			],
			screens: {
				standings: [
					changed('standings', 'player'),
				],
				overlay: [
					changed('overlay', 'player'),
				],
				otherOverlay: [
					changed('otherOverlay', 'player'),
				],
				controls: [
					changed('controls', 'player'),
				],
				headToHead: [
					changed('headToHead', 'player'),
				],
			},
		},
		{
			name: 'a deck projection change does not reach a Screen whose Slot seats none of its Players',
			messages: [
				message('player:deckProjectionsChanged', {
					playerIds: [unseated!.id],
				}),
			],
			screens: {
				standings: [
					changed('standings', 'player'),
				],
				otherOverlay: [
					changed('otherOverlay', 'player'),
				],
			},
		},
		{
			name: 'a deck projection change naming no Player reaches every Screen showing Players',
			messages: [
				message('player:deckProjectionsChanged', { playerIds: null }),
			],
			screens: {
				standings: [
					changed('standings', 'player'),
				],
				overlay: [
					changed('overlay', 'player'),
				],
				otherOverlay: [
					changed('otherOverlay', 'player'),
				],
				controls: [
					changed('controls', 'player'),
				],
				headToHead: [
					changed('headToHead', 'player'),
				],
			},
		},
		{
			name: 'a seated Player\'s deck change reaches the control Screen of their Slot, which no Slot message announces',
			messages: [
				message('playerDeck:cardsResolved'),
			],
			screens: {
				overlay: [
					changed('overlay', 'playerDeck'),
				],
				controls: [
					changed('controls', 'playerDeck'),
				],
				headToHead: [
					changed('headToHead', 'playerDeck'),
				],
			},
		},
		{
			name: 'an unseated Player\'s deck change does not reach a control Screen',
			messages: [
				message('playerDeck:cardsResolved', {
					deckIds: [],
					playerIds: [unseated!.id],
				}),
			],
			screens: {
				otherOverlay: [
					changed('otherOverlay', 'playerDeck'),
				],
				headToHead: [
					changed('headToHead', 'playerDeck'),
				],
			},
		},
		{
			name: 'a Slot change is a cause, never a payload',
			messages: [
				message('featureMatch:updated'),
			],
			screens: {
				overlay: [
					changed('overlay', 'featureMatchSlot'),
				],
				controls: [
					changed('controls', 'featureMatchSlot'),
				],
				headToHead: [
					changed('headToHead', 'featureMatchSlot'),
				],
			},
		},
		{
			name: 'a run tells each Screen once, with every cause it shows',
			run: true,
			messages: [
				message('player:updated', {
					player: { id: unseated!.id },
				}),
				message('player:updated'),
				message('featureMatchAssignment:updated'),
				message('round:updated'),
			],
			screens: {
				standings: [
					changed('standings', 'player', 'round'),
				],
				overlay: [
					changed('overlay', 'player', 'round'),
				],
				otherOverlay: [
					changed('otherOverlay', 'player', 'round'),
				],
				controls: [
					changed('controls', 'player'),
				],
				headToHead: [
					changed('headToHead', 'player', 'round'),
				],
			},
		},
		{
			name: 'a run keeps a Screen\'s own messages whole, ahead of one notice of each kind',
			run: true,
			messages: [
				sessionEvent,
				message('featureMatch:updated'),
				message('event:updated'),
				message('theme:updated'),
			],
			screens: {
				...everyScreen(() => [contextChanged]),
				overlay: [
					forwarded(sessionEvent),
					contextChanged,
					changed('overlay', 'featureMatchSlot'),
				],
				controls: [
					forwarded(sessionEvent),
					contextChanged,
					changed('controls', 'featureMatchSlot'),
				],
				headToHead: [
					contextChanged,
					changed('headToHead', 'featureMatchSlot', 'featureMatchSession'),
				],
			},
		},
	])('$name', async ({ messages, run, screens }) => {
		if (run)
			await asOneOutputChange(async () => await announce(messages));
		else
			await announce(messages);

		expect(heardByEvent()).toEqual(messages.map(forwarded));
		expect(heardByScreens()).toEqual(screens);
	});

	// A message no Screen shows costs no read's worth of publishing: nothing is sent at all.
	it('sends no Screen request for a message no output shows', async () => {
		await announce([
			message('featureMatchAssignment:updated'),
		]);

		expect(ably.batches).toEqual([]);
	});

	// One request carries every Screen's messages, whatever the Event's Screen count.
	it('tells every Screen in one request', async () => {
		await announce([
			message('event:updated'),
		]);

		expect(ably.batches).toHaveLength(1);
		expect(ably.batches[0]).toHaveLength(SCREEN_NAMES.length);
	});

	// A Take must not wait on the rest of a run (ADR-0004): its Screen has it at once.
	it('sends a Live Session message at once inside a run', async () => {
		let heardInsideRun: Heard[] = [];

		await asOneOutputChange(async () => {
			await announce([
				message('round:updated'),
				commandApplied,
			]);
			heardInsideRun = heardByScreens().graphics ?? [];
		});

		expect(heardInsideRun).toEqual([
			forwarded(commandApplied),
		]);
		expect(heardByScreens().standings).toEqual([
			changed('standings', 'round'),
		]);
	});

	// Interest is read after the write committed: the Screen's selection now decides.
	it('judges a Screen that changed mode in the write on its new mode', async () => {
		const other = await stageEvent();
		const screenId = await stageScreen(other.id, 'background');
		const standingsSynced = message('melee:roundStandingsSynced');

		await announce([standingsSynced], other.id);
		expect(heardByScreens(other.id)).toEqual({});

		await db.update(schema.screens).set({ currentMode: 'standings' }).where(eq(schema.screens.id, screenId));
		await announce([standingsSynced], other.id);

		expect(heardByScreens(other.id)).toEqual({
			[screenRealtimeChannel(other.id, screenId)]: [
				[
					'output:modeDataChanged',
					{
						screenId,
						causes: ['roundStandings'],
					},
				],
			],
		});
		expect(heardByEvent(other.id)).toEqual([
			forwarded(standingsSynced),
			forwarded(standingsSynced),
		]);
	});

	it('sends nothing to the channel of a Screen that is gone, or for an Event with no Screens', async () => {
		const other = await stageEvent();
		const screenId = await stageScreen(other.id, 'card');
		await db.delete(schema.screens).where(eq(schema.screens.id, screenId));

		await announce([
			message('card:updated', { card: null, screenId, revision: 1 }),
			message('event:updated'),
			message('player:updated'),
		], other.id);

		expect(heardByScreens(other.id)).toEqual({});
		expect(ably.batches).toEqual([]);
		expect(heardByEvent(other.id)).toHaveLength(3);
	});
});

describe('what a Feature Match Overlay is told of Matches, Rounds and Phases', async () => {
	// Its own Event: an Overlay whose Slot follows a Match, one whose Slot
	// follows none, and a Head-to-Head of the first Slot, which narrows by neither.
	const other = await stageEvent();
	const [swiss, topCut] = await db.insert(schema.phases).values([
		{ eventId: other.id, name: 'Swiss' },
		{ eventId: other.id, name: 'Top 8' },
	]).returning();
	const [itsRound, anotherRound] = await db.insert(schema.rounds).values([
		{
			eventId: other.id,
			phaseId: swiss!.id,
			name: 'Round 1',
			roundNumber: 1,
		},
		{
			eventId: other.id,
			phaseId: topCut!.id,
			name: 'Quarterfinals',
			roundNumber: 2,
		},
	]).returning();
	const [followed, anotherMatch] = await db.insert(schema.matches).values([
		{ eventId: other.id, roundId: itsRound!.id },
		{ eventId: other.id, roundId: anotherRound!.id },
	]).returning();
	const [following, idle] = await db.insert(schema.featureMatches).values([
		{ eventId: other.id, tableNumber: 1, matchId: followed!.id },
		{ eventId: other.id, tableNumber: 2 },
	]).returning();
	const overlays = {
		following: await stageScreen(other.id, 'feature-match-overlay', { featureMatchId: following!.id }),
		idle: await stageScreen(other.id, 'feature-match-overlay', { featureMatchId: idle!.id }),
		headToHead: await stageScreen(other.id, 'head-to-head', { playerSource: 'featureMatchSlot', featureMatchId: following!.id }),
	};
	type Told = keyof typeof overlays;
	const TOLD = Object.keys(overlays) as Told[];

	/** What each of these Screens' channels received, by name; a silent Screen is left out. */
	function heardByOverlays() {
		const heard = heardByScreens(other.id);
		return Object.fromEntries(TOLD.flatMap((screen) => {
			const messages = heard[screenRealtimeChannel(other.id, overlays[screen])];
			return messages
				? [
						[screen, messages],
					]
				: [];
		}));
	}
	function toldOf(kind: OutputChangeKind, screens: Told[]) {
		return Object.fromEntries(screens.map(screen => [
			screen,
			[
				[
					'output:modeDataChanged',
					{
						screenId: overlays[screen],
						causes: [kind],
					},
				],
			],
		]));
	}

	// An Overlay hears the one Match its Slot follows, and that Match's Round
	// and Phase. A change naming no Match may have taken its Match away.
	// One pair per id the Slot's row supplies; the narrowing's cases are `screenOutputInterest.test.ts`'s.
	it.each<{ name: string; type: MessageType; payload: object; kind: OutputChangeKind; told: Told[] }>([
		{
			name: 'the Match its Slot follows',
			type: 'match:updated',
			payload: {
				match: { id: followed!.id, roundId: itsRound!.id },
			},
			kind: 'match',
			told: ['following', 'headToHead'],
		},
		{
			name: 'another Match',
			type: 'match:updated',
			payload: {
				match: { id: anotherMatch!.id, roundId: anotherRound!.id },
			},
			kind: 'match',
			told: ['headToHead'],
		},
		{
			name: 'a deleted Match, which names none',
			type: 'match:deleted',
			payload: { matchId: anotherMatch!.id },
			kind: 'match',
			told: ['following', 'idle', 'headToHead'],
		},
		{
			name: 'its Match\'s Round',
			type: 'round:updated',
			payload: {
				round: { id: itsRound!.id },
			},
			kind: 'round',
			told: ['following', 'idle', 'headToHead'],
		},
		{
			name: 'another Round, which only a Slot following no Match may have lost',
			type: 'round:updated',
			payload: {
				round: { id: anotherRound!.id },
			},
			kind: 'round',
			told: ['idle', 'headToHead'],
		},
		{
			name: 'its Match\'s Phase',
			type: 'phase:updated',
			payload: {
				phase: { id: swiss!.id },
			},
			kind: 'phase',
			told: ['following', 'idle', 'headToHead'],
		},
		{
			name: 'another Phase, which only a Slot following no Match may have lost',
			type: 'phase:updated',
			payload: {
				phase: { id: topCut!.id },
			},
			kind: 'phase',
			told: ['idle', 'headToHead'],
		},
	])('$name', async ({ type, payload, kind, told }) => {
		await announce([
			message(type, payload),
		], other.id);

		expect(heardByOverlays()).toEqual(toldOf(kind, told));
	});

	// Interest is read after the write committed: the Slot as it now stands
	// names the Match, and a write moving the Slot announces the Slot.
	it('judges a Slot re-pointed in the write on the Match it follows now', async () => {
		const moved = await stageEvent();
		const [movedPhase] = await db.insert(schema.phases).values({ eventId: moved.id, name: 'Swiss' }).returning();
		const [movedRound] = await db.insert(schema.rounds).values({
			eventId: moved.id,
			phaseId: movedPhase!.id,
			name: 'Round 1',
			roundNumber: 1,
		}).returning();
		const [before, after] = await db.insert(schema.matches).values([
			{ eventId: moved.id, roundId: movedRound!.id },
			{ eventId: moved.id, roundId: movedRound!.id },
		]).returning();
		const [movedSlot] = await db.insert(schema.featureMatches).values({ eventId: moved.id, tableNumber: 1, matchId: before!.id }).returning();
		const screenId = await stageScreen(moved.id, 'feature-match-overlay', { featureMatchId: movedSlot!.id });
		const told = (...causes: OutputChangeKind[]) => ({
			[screenRealtimeChannel(moved.id, screenId)]: [
				[
					'output:modeDataChanged',
					{ screenId, causes },
				],
			],
		});
		const updated = (matchId: number) => message('match:updated', {
			match: { id: matchId, roundId: movedRound!.id },
		});

		await db.update(schema.featureMatches).set({ matchId: after!.id }).where(eq(schema.featureMatches.id, movedSlot!.id));
		await announce([
			updated(before!.id),
		], moved.id);
		expect(heardByScreens(moved.id)).toEqual({});

		await asOneOutputChange(async () => await announce([
			updated(before!.id),
			message('featureMatch:updated', {
				featureMatch: { id: movedSlot!.id },
			}),
		], moved.id));
		expect(heardByScreens(moved.id)).toEqual(told('featureMatchSlot'));

		ably.reset();
		await announce([
			updated(after!.id),
		], moved.id);
		expect(heardByScreens(moved.id)).toEqual(told('match'));
	});
});

describe('a write made in a request', () => {
	const roundUpdated = message('round:updated');
	const playerUpdated = message('player:updated');

	/** A request as the Worker gives one: what `useEvent` answers, and the work it was asked to finish after answering. */
	function inRequest(waitUntil?: (work: Promise<unknown>) => void) {
		const finishing: Promise<unknown>[] = [];
		const request = {
			context: {
				cloudflare: {
					context: {
						waitUntil: waitUntil ?? ((work: Promise<unknown>) => finishing.push(work)),
					},
				},
			},
		};
		vi.stubGlobal('useEvent', () => request);
		return finishing;
	}
	afterEach(() => vi.unstubAllGlobals());
	/** Lets everything already able to run, run: a held publish stays held. */
	const turn = async () => await new Promise<void>(resolve => setImmediate(resolve));

	// Only a notice waits for nothing it carries: a payload forwarded whole is
	// a Take, a Card or a score, which its Screen must have when the write answers.
	it.each<{ name: string; request: boolean; write: () => Promise<unknown>; answersFirst: boolean }>([
		{
			name: 'answers before a slow Screen publish settles, for a notice',
			request: true,
			write: async () => await publishMessage(eventId, roundUpdated.type, roundUpdated.payload as never),
			answersFirst: true,
		},
		{
			name: 'answers before a slow Screen publish settles, for a strict publish',
			request: true,
			write: async () => await publishMessageStrict(eventId, 'round:updated', roundUpdated.payload as never),
			answersFirst: true,
		},
		{
			name: 'answers before a slow Screen publish settles, for a run of notices',
			request: true,
			write: async () => await asOneOutputChange(async () => await announce([roundUpdated, playerUpdated])),
			answersFirst: true,
		},
		{
			name: 'waits for the Screen publish with no request, as a scheduled tick has none',
			request: false,
			write: async () => await publishMessage(eventId, roundUpdated.type, roundUpdated.payload as never),
			answersFirst: false,
		},
		{
			name: 'waits for the Screen publish of a Live Session message',
			request: true,
			write: async () => await announce([commandApplied]),
			answersFirst: false,
		},
		{
			name: 'waits for the Screen publish of a Card',
			request: true,
			write: async () => await announce([cardUpdated]),
			answersFirst: false,
		},
		{
			name: 'waits for the Screen publish of a Feature Match Session event',
			request: true,
			write: async () => await announce([sessionEvent]),
			answersFirst: false,
		},
		{
			name: 'waits for the Screen publish of a run forwarding a payload',
			request: true,
			write: async () => await asOneOutputChange(async () => await announce([roundUpdated, sessionEvent])),
			answersFirst: false,
		},
	])('$name', async ({ request, write, answersFirst }) => {
		const finishing = request
			? inRequest()
			: [];
		const release = deferred();
		ably.holdNextBatch(release.promise);
		const asked = ably.nextBatchAsked();
		const answered = vi.fn();

		const writing = write().then(answered);
		await asked;
		await turn();
		const answeredFirst = answered.mock.calls.length === 1;
		const heardWhileHeld = heardByScreens();
		release.resolve();
		await writing;
		await Promise.all(finishing);

		expect(answeredFirst).toBe(answersFirst);
		expect(finishing).toHaveLength(answersFirst ? 1 : 0);
		expect(heardWhileHeld).toEqual({});
		expect(Object.keys(heardByScreens())).not.toEqual([]);
	});

	// Two writes of one request reach a Screen in the order they were made,
	// however slow the first one's publish.
	it('keeps one request\'s notices in order', async () => {
		const finishing = inRequest();
		const release = deferred();
		ably.holdNextBatch(release.promise);
		const asked = ably.nextBatchAsked();

		const writing = announce([roundUpdated, playerUpdated]);
		await asked;
		await turn();
		release.resolve();
		await writing;
		await Promise.all(finishing);

		expect(finishing).toHaveLength(2);
		expect(heardByScreens().standings).toEqual([
			changed('standings', 'round'),
			changed('standings', 'player'),
		]);
	});

	// Finished after the answer, a refused publish is logged as before, and the
	// work handed to the request never rejects.
	it('logs a publish refused after the answer, and rejects nothing', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const finishing = inRequest();
		ably.refuseBatches(2);

		await publishMessage(eventId, roundUpdated.type, roundUpdated.payload as never);

		await expect(Promise.all(finishing)).resolves.toHaveLength(1);
		expect(heardByScreens()).toEqual({});
		expect(errors.mock.calls.map(([line]) => JSON.parse(line as string))).toEqual(
			([
				'standings',
				'overlay',
				'otherOverlay',
				'headToHead',
			] as const).map(screen => expect.objectContaining({
				message: 'realtime_publish_failed',
				eventId,
				screenId: SCREENS[screen],
				messageTypes: ['output:modeDataChanged'],
				statusCode: 500,
			})),
		);
	});

	// A request that cannot take the work leaves the write waiting for it, as with none.
	it('waits for the Screen publish when the request refuses the work', async () => {
		const finishing = inRequest(() => {
			throw new Error('Illegal invocation');
		});

		await publishMessage(eventId, roundUpdated.type, roundUpdated.payload as never);

		expect(finishing).toEqual([]);
		expect(heardByScreens().standings).toEqual([
			changed('standings', 'round'),
		]);
	});
});

describe('a Screen channel publish that fails', () => {
	const roundUpdated = message('round:updated');
	const overlayChannel = screenRealtimeChannel(eventId, SCREENS.overlay);
	const told = [
		changed('standings', 'round'),
	];
	const toldOverlay = [
		changed('overlay', 'round'),
	];

	// The write has committed and the Event channel has its message: a Screen
	// channel's failure is retried once for that channel alone, then logged.
	it.each([
		{
			name: 'is retried once for the failed channel alone',
			arrange: () => ably.refuse(overlayChannel, 1),
			retried: [overlayChannel],
			overlay: toldOverlay,
			logged: 0,
		},
		{
			name: 'is logged and swallowed when the retry fails too',
			arrange: () => ably.refuse(overlayChannel),
			retried: [overlayChannel],
			overlay: undefined,
			logged: 1,
		},
		{
			name: 'is retried once for every channel when the whole request failed',
			arrange: () => ably.refuseBatches(1),
			retried: null,
			overlay: toldOverlay,
			logged: 0,
		},
	])('$name', async ({ arrange, retried, overlay, logged }) => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		arrange();

		await expect(publishMessage(eventId, roundUpdated.type, roundUpdated.payload as never)).resolves.toBeUndefined();

		expect(heardByEvent()).toEqual([
			forwarded(roundUpdated),
		]);
		expect(ably.batches).toHaveLength(2);
		expect(ably.batches[1]).toEqual(retried ?? ably.batches[0]);
		expect(heardByScreens().standings).toEqual(told);
		expect(heardByScreens().overlay).toEqual(overlay);
		expect(errors.mock.calls.map(([line]) => JSON.parse(line as string))).toEqual(Array.from({ length: logged }, () =>
			expect.objectContaining({
				message: 'realtime_publish_failed',
				eventId,
				screenId: SCREENS.overlay,
				messageTypes: ['output:modeDataChanged'],
				statusCode: 500,
			})));
	});

	it('does not fail a strict publish, whose Event message has landed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		ably.refuseBatches(2);

		await expect(publishMessageStrict(eventId, 'round:updated', roundUpdated.payload as never)).resolves.toBeUndefined();

		expect(heardByEvent()).toEqual([
			forwarded(roundUpdated),
		]);
		expect(heardByScreens()).toEqual({});
	});

	// The two channels fail apart: a refused Event publish keeps its own
	// semantics, and the Screens are still told of the committed write.
	it.each([
		{ name: 'publishMessage swallows', publish: publishMessage, rejects: false },
		{ name: 'publishMessageStrict rejects', publish: publishMessageStrict, rejects: true },
	])('still tells the Screens when the Event publish is refused, which $name', async ({ publish, rejects }) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		ably.refuse(eventRealtimeChannel(eventId), 1);

		const outcome = await publish(eventId, 'round:updated', roundUpdated.payload as never).then(() => 'resolved', () => 'rejected');

		expect(outcome).toBe(rejects ? 'rejected' : 'resolved');
		expect(heardByEvent()).toEqual([]);
		expect(heardByScreens().standings).toEqual(told);
	});
});

describe('every publish site reaches the Screen channels', () => {
	const hears = (screen: ScreenName) => ably.on(screenRealtimeChannel(eventId, SCREENS[screen])).map(({ type }) => type);

	// One row per family of publish site: each announces through the two publish
	// functions, so its Screens hear it without the site doing anything.
	it.each<{ family: string; act: () => Promise<unknown>; screen: ScreenName; heard: string[] }>([
		{
			family: 'Event Data publication, one change',
			act: async () => (await import('~~/server/modules/event-data-publication')).eventDataPublicationModule().roundUpdated({ eventId, entity: round! }),
			screen: 'standings',
			heard: ['output:modeDataChanged'],
		},
		{
			family: 'Event Data publication, a run of changes as one',
			act: async () => (await import('~~/server/modules/event-data-publication')).eventDataPublicationModule().playersUpdated({
				eventId,
				entities: [seated!, opponent!, unseated!],
			}),
			screen: 'standings',
			heard: ['output:modeDataChanged'],
		},
		{
			family: 'Event Data publication, many Players in one message',
			act: async () => (await import('~~/server/modules/event-data-publication')).eventDataPublicationModule().playerDeckProjectionsChanged({
				eventId,
				playerIds: [seated!.id, opponent!.id, unseated!.id],
			}),
			screen: 'standings',
			heard: ['output:modeDataChanged'],
		},
		{
			family: 'Event Data publication, a sync',
			act: async () => (await import('~~/server/modules/event-data-publication')).eventDataPublicationModule().meleeRoundStandingsSynced({ eventId, roundId: round!.id }),
			screen: 'standings',
			heard: ['output:modeDataChanged'],
		},
		{
			family: 'Screen runtime publication',
			act: async () => (await import('~~/server/modules/screen-runtime-publication')).screenRuntimePublicationModule().cardCleared({ eventId, screenId: SCREENS.card, revision: 3 }),
			screen: 'card',
			heard: ['card:cleared'],
		},
		{
			family: 'the Broadcast Graphics Live Session service',
			act: async () => {
				const liveSessions = (await import('~~/server/services/broadcastGraphicsState')).broadcastGraphicsStateService();
				await liveSessions.ensureActiveSession(SCREENS.graphics, eventId);
				await liveSessions.resetSessionForScreen(SCREENS.graphics, eventId);
			},
			screen: 'graphics',
			heard: ['broadcastGraphicsLiveSession:epochEnded'],
		},
		{
			family: 'the Feature Match Session service',
			act: async () => (await import('~~/server/services/featureMatchState')).featureMatchStateService().createSessionForSlot(slot!.id, eventId),
			screen: 'overlay',
			heard: ['featureMatchSession:eventApplied'],
		},
		{
			family: 'the Theme library',
			act: async () => {
				const themes = (await import('~~/server/modules/theme-library')).themeLibraryModule();
				const theme = await themes.create('Theme');
				await db.update(schema.events).set({ themeId: theme.id }).where(eq(schema.events.id, eventId));
				await themes.setToken({
					themeId: theme.id,
					token: 'accent',
					value: '#ff0000',
					graphicsAssets: () => ({}) as never,
				});
			},
			screen: 'background',
			heard: ['output:eventContextChanged'],
		},
	])('$family', async ({ act, screen, heard }) => {
		await act();

		expect(hears(screen)).toEqual(heard);
	});
});

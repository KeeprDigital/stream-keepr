import type { H3Event } from 'h3';
import type { ScreenMode } from '~~/shared/types/enums';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Screen Output reads what its Screen publishes with its Screen Output Asset
// Capability alone (#604): each read answers from that Screen's saved configuration,
// and refuses everything else with the one 404.

const signingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	getOriginConnectionId: () => undefined,
}));

/** Whether the request carries a Session, as an operator's embed does. */
let signedIn = false;
vi.doMock('~~/server/utils/auth', () => ({
	requireUserId: async () => 'user-1',
	optionalUserSession: async () => signedIn
		? {
				user: { id: 'user-1' },
				session: { id: 'session-1' },
			}
		: null,
}));

interface StubEvent {
	params: Record<string, string>;
	query: Record<string, string>;
	headers: Record<string, string>;
	responseHeaders: Record<string, unknown>;
}
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('useRuntimeConfig', () => ({ screenOutputCapabilitySigningKey: signingKey }));
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('getValidatedQuery', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.query));
vi.stubGlobal('getRequestHeader', (event: StubEvent, name: string) => event.headers[name]);
vi.stubGlobal('setResponseHeader', (event: StubEvent, name: string, value: unknown) => {
	event.responseHeaders[name] = value;
});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<any>;
async function handler(module: Promise<{ default: unknown }>): Promise<Handler> {
	return (await module).default as Handler;
}

const read = {
	screen: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/index.get')),
	event: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/event.get')),
	card: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/card.get')),
	liveSession: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/broadcast-graphics/live-session.get')),
	standings: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/standings.get')),
	metagame: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/metagame.get')),
	topCards: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/top-cards.get')),
	archetypeSpotlight: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/archetype-spotlight.get')),
	broadcastDeckList: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/broadcast-deck-list.get')),
	slot: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/feature-match-slots/[slotId].get')),
	slotDeckList: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/feature-match-slots/[slotId]/deck-lists/[deckListId].get')),
	playerDecks: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/players/[playerId]/decks.get')),
	opPlayerDeckList: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/players/[playerId]/deck-list.get')),
	playerHistory: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/player-history.get')),
	pairings: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/pairings.get')),
	roundClock: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/round-clock.get')),
	headToHead: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/head-to-head.get')),
	talent: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/talent.get')),
	topCut: await handler(import('~~/server/api/screen-output/events/[id]/screens/[screenId]/top-cut.get')),
};
const regenerateCapability = await handler(import('~~/server/api/events/[id]/screens/[screenId]/asset-capability.post'));
const operatorLiveSession = await handler(import('~~/server/api/events/[id]/screens/[screenId]/broadcast-graphics/live-session.get'));
const { createScreenOutputAssetCapabilityManager } = await import('~~/server/modules/screen-output-assets/manager');
const { screenService } = await import('~~/server/services/screen');
const { featureMatchDeckListService } = await import('~~/server/services/featureMatchDeckList');

const manager = createScreenOutputAssetCapabilityManager({
	signingKey,
	screens: screenService(),
});

const NOT_FOUND = {
	statusCode: 404,
	statusMessage: 'Not Found',
	message: 'Not found',
	data: undefined,
};

/** A Card as a Card Spotlight Screen stores it. */
const CARD = {
	savedAt: Date.UTC(2026, 10, 12),
	id: 'output-card',
	name: 'Lightning Bolt',
	set: 'lea',
	layout: 'normal',
	imageData: {
		front: { small: 'https://example.com/s.jpg', normal: 'https://example.com/n.jpg' },
		back: null,
	},
	orientationData: {
		flipable: false,
		turnable: false,
		rotateable: false,
		counterRotateable: false,
	},
	displayData: {
		flipped: false,
		rotated: false,
		counterRotated: false,
		turnedOver: false,
	},
};

const ids = {
	event: 0,
	otherEvent: 0,
	opEvent: 0,
	alice: 0,
	bob: 0,
	carol: 0,
	opPlayer: 0,
	archetype: 0,
	watchlist: 0,
	swiss: 0,
	roundOne: 0,
	roundTwo: 0,
	earlierMatch: 0,
	upcomingMatch: 0,
	topCut: 0,
	semifinals: 0,
	semifinal: 0,
	shownSlot: 0,
	hiddenSlot: 0,
	slotDeckList: 0,
	broadcastDeckList: 0,
	host: 0,
	caster: 0,
};

/** A Screen with the capability its outputs hold now, and the one they held before it was regenerated. */
interface Staged { id: number; eventId: number; capability: string; revoked: string }
let neighbour: Staged;
let screenSeq = 0;

function operatorRequest(screen: { id: number; eventId: number }): H3Event {
	return stubH3Event({
		params: {
			id: String(screen.eventId),
			screenId: String(screen.id),
		},
		headers: {},
		responseHeaders: {},
	});
}

async function stageScreen(
	mode: ScreenMode,
	modeConfigs: Record<string, unknown> = {},
	columns: Record<string, unknown> = {},
	eventId = ids.event,
): Promise<Staged> {
	screenSeq += 1;
	const former = await manager.prepare();
	const [row] = await db.insert(schema.screens)
		.values({
			eventId,
			name: `Output ${screenSeq}`,
			slug: `output-${screenSeq}`,
			currentMode: mode,
			modeConfigs,
			...columns,
			...former.persisted,
		} as never)
		.returning({ id: schema.screens.id });
	const screen = { id: row!.id, eventId };
	const { assetCapability } = await regenerateCapability(operatorRequest(screen));
	return { ...screen, capability: assetCapability, revoked: former.capability };
}

/** A Screen in `mode`, holding `config` as that mode's saved configuration. */
async function showing(mode: ScreenMode, config: Record<string, unknown> = {}, columns: Record<string, unknown> = {}) {
	return await stageScreen(mode, { [mode]: config }, columns);
}

interface Presented {
	/** The bearer presented; a Screen's own current capability unless said otherwise. */
	credential?: string | null;
	params?: Record<string, number>;
	eventId?: number;
}

function outputRequest(screen: Staged, presented: Presented = {}): StubEvent {
	const credential = presented.credential === undefined
		? screen.capability
		: presented.credential;
	return {
		params: {
			id: String(presented.eventId ?? screen.eventId),
			screenId: String(screen.id),
			...Object.fromEntries(Object.entries(presented.params ?? {}).map(([name, value]) => [
				name,
				String(value),
			])),
		},
		query: {},
		headers: credential
			? { authorization: `Bearer ${credential}` }
			: {},
		responseHeaders: {},
	};
}

async function asOutput(route: Handler, screen: Staged, presented: Presented = {}) {
	return await route(stubH3Event({
		...outputRequest(screen, presented),
	}));
}

async function refusal(route: Handler, screen: Staged, presented: Presented = {}) {
	const { statusCode, statusMessage, message, data } = await refusalFrom(asOutput(route, screen, presented)) as {
		statusCode?: number;
		statusMessage?: string;
		message?: string;
		data?: unknown;
	};
	return {
		statusCode,
		statusMessage,
		message,
		data,
	};
}

beforeAll(async () => {
	const [event, otherEvent, opEvent] = await db.insert(schema.events).values([
		{
			name: 'Screen Output Reads',
			game: 'mtg',
			featureMatchOrientation: 'vertical',
			description: 'Operator notes',
			displayRecordSeparator: '/',
			meleeEventId: 'melee-event-1',
			lastSyncError: 'Melee refused the sync',
			broadcastDeckListsEnabled: true,
		},
		{ name: 'Other Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		{ name: 'One Piece Event', game: 'op', featureMatchOrientation: 'horizontal' },
	] as never).returning({ id: schema.events.id });
	ids.event = event!.id;
	ids.otherEvent = otherEvent!.id;
	ids.opEvent = opEvent!.id;
	const eventId = ids.event;

	const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: 'Mono Red' }).returning({ id: schema.archetypes.id });
	ids.archetype = archetype!.id;
	const [alice, bob, carol] = await db.insert(schema.players).values([
		{ eventId, name: 'Alice', archetypeId: ids.archetype },
		{ eventId, name: 'Bob' },
		{ eventId, name: 'Carol' },
	]).returning({ id: schema.players.id });
	ids.alice = alice!.id;
	ids.bob = bob!.id;
	ids.carol = carol!.id;
	const [opPlayer] = await db.insert(schema.players).values({ eventId: ids.opEvent, name: 'Dee' }).returning({ id: schema.players.id });
	ids.opPlayer = opPlayer!.id;

	const [watchlist] = await db.insert(schema.playerLists).values({ eventId, name: 'Watch' }).returning({ id: schema.playerLists.id });
	ids.watchlist = watchlist!.id;
	await db.insert(schema.playerListMembers).values({ listId: ids.watchlist, playerId: ids.bob });

	const [swiss, topCut] = await db.insert(schema.phases).values([
		{ eventId, name: 'Swiss', sortOrder: 0 },
		{ eventId, name: 'Top 4', sortOrder: 1 },
	]).returning({ id: schema.phases.id });
	ids.swiss = swiss!.id;
	ids.topCut = topCut!.id;
	const [roundOne, roundTwo, semifinals] = await db.insert(schema.rounds).values([
		{
			eventId,
			phaseId: ids.swiss,
			name: 'Round 1',
			roundNumber: 1,
			durationMinutes: 50,
		},
		{
			eventId,
			phaseId: ids.swiss,
			name: 'Round 2',
			roundNumber: 2,
		},
		{
			eventId,
			phaseId: ids.topCut,
			name: 'Semifinals',
			roundNumber: 1,
		},
	]).returning({ id: schema.rounds.id });
	ids.roundOne = roundOne!.id;
	ids.roundTwo = roundTwo!.id;
	ids.semifinals = semifinals!.id;

	// Bob beat Alice 2–1 in Round 1; they meet again, unreported, at table 7 of Round 2.
	const [earlier, upcoming, semifinal] = await db.insert(schema.matches).values([
		{
			eventId,
			roundId: ids.roundOne,
			tableNumber: 3,
			player1Id: ids.bob,
			player2Id: ids.alice,
			hasResult: true,
			player1GameWins: 2,
			player2GameWins: 1,
		},
		{
			eventId,
			roundId: ids.roundTwo,
			tableNumber: 7,
			player1Id: ids.alice,
			player2Id: ids.bob,
		},
		{
			eventId,
			roundId: ids.semifinals,
			tableNumber: 1,
			player1Data: { name: 'First Seed' },
			player2Data: { name: 'Fourth Seed' },
			sortOrder: 0,
		},
		{
			eventId,
			roundId: ids.semifinals,
			tableNumber: 2,
			player1Data: { name: 'Second Seed' },
			player2Data: { name: 'Third Seed' },
			sortOrder: 1,
		},
	] as never).returning({ id: schema.matches.id });
	ids.earlierMatch = earlier!.id;
	ids.upcomingMatch = upcoming!.id;
	ids.semifinal = semifinal!.id;
	await db.insert(schema.playerRoundStandings).values([
		{
			eventId,
			roundId: ids.roundOne,
			playerId: ids.bob,
			wins: 1,
			losses: 0,
			draws: 0,
			position: 1,
			points: 3,
		},
		{
			eventId,
			roundId: ids.roundOne,
			playerId: ids.alice,
			wins: 0,
			losses: 1,
			draws: 0,
			position: 2,
			points: 0,
		},
	]);

	// The shown Slot seats Alice and Bob for their Round 2 Match; the hidden one seats nobody.
	const [shownSlot, hiddenSlot] = await db.insert(schema.featureMatchSlots).values([
		{
			eventId,
			matchId: ids.upcomingMatch,
			player1Id: ids.alice,
			player2Id: ids.bob,
		},
		{ eventId, sortOrder: 1 },
	]).returning({ id: schema.featureMatchSlots.id });
	ids.shownSlot = shownSlot!.id;
	ids.hiddenSlot = hiddenSlot!.id;
	ids.slotDeckList = await featureMatchDeckListService().create(eventId, ids.shownSlot, '1 OP01-001', {
		entries: [
			{ number: 'OP01-001', quantity: 1, card: null },
		],
		leaderNumber: null,
		mainboardCount: 1,
		warnings: [],
	});

	const [broadcastDeckList] = await db.insert(schema.broadcastDeckLists)
		.values({
			eventId,
			name: 'Finalist',
			normalizedName: 'finalist',
			sourceText: '4 Lightning Bolt',
		})
		.returning({ id: schema.broadcastDeckLists.id });
	ids.broadcastDeckList = broadcastDeckList!.id;

	const [host, caster] = await db.insert(schema.eventTalents).values([
		{
			eventId,
			name: 'Talent Host',
			role: 'Host',
			twitchHandle: 'host',
			xHandle: 'host_x',
			blueskyHandle: 'host.bsky.social',
		},
		{ eventId, name: 'Talent Caster', youtubeHandle: 'caster' },
	]).returning({ id: schema.eventTalents.id });
	ids.host = host!.id;
	ids.caster = caster!.id;

	neighbour = await stageScreen('background');
});

beforeEach(() => {
	signedIn = false;
});

afterAll(async () => await harness.close());

describe('admitting a Screen Output read', () => {
	it.each<[string, () => Presented]>([
		[
			'no credential',
			() => ({ credential: null }),
		],
		[
			'a bearer that is not a capability',
			() => ({ credential: 'not a capability' }),
		],
		[
			'another Screen\'s capability',
			() => ({ credential: neighbour.capability }),
		],
		[
			'its capability under another Event',
			() => ({ eventId: ids.otherEvent }),
		],
	])('refuses %s with the one 404, naming nothing', async (_what, presented) => {
		const screen = await showing('background');

		const refused = await refusal(read.event, screen, presented());

		expect(refused).toEqual(NOT_FOUND);
	});

	it('stops answering a capability once it is regenerated, and answers the new one', async () => {
		const screen = await showing('background');
		await expect(asOutput(read.screen, screen)).resolves.toMatchObject({ id: screen.id });

		const { assetCapability } = await regenerateCapability(operatorRequest(screen));

		expect(await refusal(read.screen, screen)).toEqual(NOT_FOUND);
		await expect(asOutput(read.screen, screen, { credential: assetCapability })).resolves.toMatchObject({ id: screen.id });
	});

	it('must not be stored by anything between the output and here', async () => {
		const request = outputRequest(await showing('background'));

		await read.event(stubH3Event({ ...request }));

		expect(request.responseHeaders).toEqual({ 'cache-control': 'private, no-store' });
	});

	// An operator's embed holds a Session and no capability; it reaches what the Event's private reads reach.
	it.each<[string, () => Promise<unknown>, () => object]>([
		[
			'a Feature Match Slot its Screen has not saved',
			async () => await asOutput(read.slot, await showing('feature-match-overlay'), {
				credential: null,
				params: { slotId: ids.hiddenSlot },
			}),
			() => ({
				slot: { id: ids.hiddenSlot },
				match: null,
			}),
		],
		[
			'a mode\'s data while its Screen is in another mode',
			async () => await asOutput(read.pairings, await stageScreen('background', {
				pairings: { roundId: ids.roundTwo },
			}), { credential: null }),
			() => ({
				round: { id: ids.roundTwo },
			}),
		],
		[
			'a Player its Screen does not show',
			async () => await asOutput(read.playerDecks, await showing('deck'), {
				credential: null,
				params: { playerId: ids.carol },
			}),
			() => ({
				player: { id: ids.carol },
			}),
		],
	])('admits a Session to %s', async (_what, readAsOperator, answer) => {
		signedIn = true;

		await expect(readAsOperator()).resolves.toMatchObject(answer());
	});
});

interface OutputRead {
	name: string;
	route: Handler;
	mode: ScreenMode;
	config?: () => Record<string, unknown>;
	columns?: Record<string, unknown>;
	params?: () => Record<string, number>;
	eventId?: () => number;
	/** A mode's data: published only while the Screen is in that mode. */
	modeData?: true;
}

const READS: OutputRead[] = [
	{ name: 'the Screen', route: read.screen, mode: 'background' },
	{ name: 'the Event context', route: read.event, mode: 'background' },
	{
		name: 'the Card of Card Spotlight',
		route: read.card,
		mode: 'card',
		columns: { activeCard: CARD, activeCardVersion: 3 },
		modeData: true,
	},
	{
		name: 'the Broadcast Graphics Live Session',
		route: read.liveSession,
		mode: 'broadcast-graphics',
		modeData: true,
	},
	{
		name: 'Standings',
		route: read.standings,
		mode: 'standings',
		modeData: true,
	},
	{
		name: 'Metagame',
		route: read.metagame,
		mode: 'metagame',
		modeData: true,
	},
	{
		name: 'Most Played Cards',
		route: read.topCards,
		mode: 'top-cards',
		modeData: true,
	},
	{
		name: 'Archetype Spotlight',
		route: read.archetypeSpotlight,
		mode: 'archetype-spotlight',
		config: () => ({ archetypeId: ids.archetype }),
		modeData: true,
	},
	{
		name: 'the Broadcast Deck List of Deck List',
		route: read.broadcastDeckList,
		mode: 'deck',
		config: () => ({
			deckSource: { type: 'broadcast', broadcastDeckListId: ids.broadcastDeckList },
		}),
		modeData: true,
	},
	{
		name: 'the Feature Match Slot it shows',
		route: read.slot,
		mode: 'feature-match',
		config: () => ({ featureMatchId: ids.shownSlot }),
		params: () => ({ slotId: ids.shownSlot }),
	},
	{
		name: 'a Feature Match Deck List of the Slot it shows',
		route: read.slotDeckList,
		mode: 'deck',
		config: () => ({
			deckSource: { type: 'featureMatchSlot', slotId: ids.shownSlot, side: 'player1' },
		}),
		params: () => ({ slotId: ids.shownSlot, deckListId: ids.slotDeckList }),
	},
	{
		name: 'the decks of a Player it shows',
		route: read.playerDecks,
		mode: 'deck',
		config: () => ({
			deckSource: { type: 'player', playerId: ids.alice },
		}),
		params: () => ({ playerId: ids.alice }),
	},
	{
		name: 'the Deck List of a One Piece Card Game Player it shows',
		route: read.opPlayerDeckList,
		mode: 'deck',
		config: () => ({
			deckSource: { type: 'player', playerId: ids.opPlayer },
		}),
		params: () => ({ playerId: ids.opPlayer }),
		eventId: () => ids.opEvent,
	},
	{
		name: 'Player History',
		route: read.playerHistory,
		mode: 'player-history',
		config: () => ({ playerId: ids.alice }),
		modeData: true,
	},
	{
		name: 'Pairings',
		route: read.pairings,
		mode: 'pairings',
		config: () => ({ roundId: ids.roundTwo }),
		modeData: true,
	},
	{
		name: 'Round Clock',
		route: read.roundClock,
		mode: 'round-clock',
		config: () => ({ roundId: ids.roundOne }),
		modeData: true,
	},
	{
		name: 'Head-to-Head',
		route: read.headToHead,
		mode: 'head-to-head',
		config: () => ({ playerSource: 'featureMatchSlot', featureMatchId: ids.shownSlot }),
		modeData: true,
	},
	{
		name: 'Talent',
		route: read.talent,
		mode: 'talent',
		config: () => ({
			selection: 'lineup',
			talentIds: [ids.host],
		}),
		modeData: true,
	},
	{
		name: 'Top Cut Bracket',
		route: read.topCut,
		mode: 'top-cut',
		config: () => ({ phaseId: ids.topCut }),
		modeData: true,
	},
];

describe('every Screen Output read', () => {
	it.each(READS)('$name answers its Screen\'s capability, and refuses another Screen\'s, a regenerated one and none', async (output) => {
		const screen = await stageScreen(output.mode, { [output.mode]: output.config?.() ?? {} }, output.columns, output.eventId?.());
		const params = output.params?.();

		await expect(asOutput(output.route, screen, { params })).resolves.toBeDefined();
		for (const credential of [neighbour.capability, screen.revoked, null])
			expect(await refusal(output.route, screen, { params, credential })).toEqual(NOT_FOUND);
	});

	// The configuration stays saved, but a Screen in another mode no longer publishes it.
	it.each(READS.filter(output => output.modeData))('$name is published only while its Screen is in that mode', async (output) => {
		const parked = await stageScreen('background', { [output.mode]: output.config?.() ?? {} }, output.columns);

		expect(await refusal(output.route, parked)).toEqual(NOT_FOUND);
	});
});

describe('the Event context', () => {
	it('answers the fields an output renders and nothing operator-only', async () => {
		const answer = await asOutput(read.event, await showing('background'));

		expect(answer).toMatchObject({
			id: ids.event,
			name: 'Screen Output Reads',
			game: 'mtg',
			featureMatchOrientation: 'vertical',
			displayRecordSeparator: '/',
			theme: null,
		});
		for (const operatorOnly of [
			'meleeConfigured',
			'meleeEventId',
			'lastSyncError',
			'lastPlayersSyncedAt',
			'talents',
			'description',
		])
			expect(answer).not.toHaveProperty(operatorOnly);
		expect(JSON.stringify(answer)).not.toMatch(/Operator notes|melee-event-1|Melee refused/);
	});
});

describe('the Screen', () => {
	it('answers the Screen as it stands, without what its capability is checked against', async () => {
		const screen = await showing('player-history', { playerId: ids.alice });

		const answer = await asOutput(read.screen, screen);

		expect(answer).toMatchObject({
			id: screen.id,
			currentMode: 'player-history',
			modeConfigs: {
				'player-history': { playerId: ids.alice },
			},
		});
		expect(JSON.stringify(answer)).not.toMatch(/assetCapability/);
	});
});

describe('a Screen\'s own live state', () => {
	it('reads the Card on a Card Spotlight Screen with the revision it was read at', async () => {
		const screen = await showing('card', {}, { activeCard: CARD, activeCardVersion: 3 });

		await expect(asOutput(read.card, screen)).resolves.toEqual({
			card: expect.objectContaining({ id: 'output-card', name: 'Lightning Bolt' }),
			revision: 3,
		});
	});

	it('reads the Broadcast Graphics Live Session snapshot its operator reads', async () => {
		const screen = await showing('broadcast-graphics');
		const operator = await operatorLiveSession(operatorRequest(screen));

		const answer = await asOutput(read.liveSession, screen);

		expect(answer).toMatchObject({
			id: expect.any(Number),
			sequence: expect.any(Number),
		});
		expect(answer).toEqual(operator);
	});
});

describe('standings', () => {
	it('reads the whole roster and nothing else while its configuration names nothing', async () => {
		const answer = await asOutput(read.standings, await showing('standings', { viewMode: 'all' }));

		expect(answer.players.map((player: { id: number }) => player.id)).toEqual(expect.arrayContaining([ids.alice, ids.bob, ids.carol]));
		expect(answer).toMatchObject({
			round: null,
			roundStandings: null,
			watchlist: null,
			previousRoundPositions: null,
		});
	});

	it('reads the fixed Round with its Round Standings, and the watchlist it filters to', async () => {
		const answer = await asOutput(read.standings, await showing('standings', {
			viewMode: 'watchlist',
			playerListId: ids.watchlist,
			roundId: ids.roundOne,
		}));

		expect(answer).toMatchObject({
			round: { id: ids.roundOne, name: 'Round 1' },
			watchlist: {
				name: 'Watch',
				playerIds: [ids.bob],
			},
		});
		expect(answer.roundStandings).toEqual(expect.arrayContaining([
			{
				playerId: ids.bob,
				wins: 1,
				losses: 0,
				draws: 0,
				position: 1,
				points: 3,
			},
		]));
	});

	it.each<[string, () => Record<string, unknown>]>([
		[
			'its watchlist\'s list has since been deleted',
			() => ({ viewMode: 'watchlist', playerListId: 999_999 }),
		],
		[
			'it names a list but shows every Player',
			() => ({ viewMode: 'all', playerListId: ids.watchlist }),
		],
	])('reads no watchlist, rather than refusing, when %s', async (_when, config) => {
		const answer = await asOutput(read.standings, await showing('standings', config()));

		expect(answer.watchlist).toBeNull();
	});

	// The previous Round's positions are read only while the Position Change column shows (#755).
	it.each([
		[true, 'the previous Round\'s positions'],
		[false, 'none'],
	])('with its Position Change column visible: %s, reads %s', async (visible) => {
		const answer = await asOutput(read.standings, await showing('standings', {
			viewMode: 'all',
			roundId: ids.roundTwo,
			columns: [
				{ key: 'name', visible: true },
				{ key: 'positionChange', visible },
			],
		}));

		expect(answer.previousRoundPositions).toEqual(visible
			? {
					roundId: ids.roundOne,
					positions: [
						{ playerId: ids.bob, position: 1 },
						{ playerId: ids.alice, position: 2 },
					],
				}
			: null);
	});
});

describe('metagame, Most Played Cards and Archetype Spotlight', () => {
	it.each([
		[
			'archetype',
			{ viewMode: 'archetype', scope: 'all' },
			[
				expect.objectContaining({ name: 'Mono Red' }),
			],
		],
		[
			'cards',
			{ viewMode: 'cards', limit: 7 },
			[],
		],
	])('reads the %s breakdown the saved Metagame view renders', async (viewMode, config, entries) => {
		const answer = await asOutput(read.metagame, await showing('metagame', config));

		expect(answer).toMatchObject({
			viewMode,
			breakdown: { scope: 'all', entries },
		});
	});

	it('reads the card breakdown the saved Most Played Cards configuration renders', async () => {
		const answer = await asOutput(read.topCards, await showing('top-cards', { scope: 'all', limit: 5 }));

		expect(answer).toMatchObject({ scope: 'all', entries: [] });
	});

	it('reads the Archetype the saved Archetype Spotlight configuration names', async () => {
		const answer = await asOutput(read.archetypeSpotlight, await showing('archetype-spotlight', { archetypeId: ids.archetype }));

		expect(answer).toMatchObject({
			archetype: { id: ids.archetype, name: 'Mono Red' },
			pilots: [
				{ id: ids.alice, name: 'Alice' },
			],
		});
	});
});

describe('feature Match Slots and the Players a Screen shows', () => {
	it.each(['feature-match', 'feature-match-overlay'] as const)('reads the Slot a %s Screen shows, with the Match, Round and Phase it follows', async (mode) => {
		const screen = await showing(mode, { featureMatchId: ids.shownSlot });

		const answer = await asOutput(read.slot, screen, {
			params: { slotId: ids.shownSlot },
		});

		expect(answer).toMatchObject({
			slot: { id: ids.shownSlot, player1Id: ids.alice, player2Id: ids.bob },
			match: { id: ids.upcomingMatch },
			round: { id: ids.roundTwo, name: 'Round 2' },
			phase: { id: ids.swiss, name: 'Swiss' },
		});
	});

	it('reads a Slot following no Match with none', async () => {
		const screen = await showing('feature-match', { featureMatchId: ids.hiddenSlot });

		await expect(asOutput(read.slot, screen, {
			params: { slotId: ids.hiddenSlot },
		})).resolves.toMatchObject({
			slot: { id: ids.hiddenSlot },
			match: null,
			round: null,
			phase: null,
		});
	});

	it('reads the decks of a Player the shown Slot seats', async () => {
		const screen = await showing('feature-match', { featureMatchId: ids.shownSlot });

		await expect(asOutput(read.playerDecks, screen, {
			params: { playerId: ids.bob },
		})).resolves.toMatchObject({
			player: { id: ids.bob, name: 'Bob' },
			decks: { decks: [] },
		});
	});

	it('reads the decks of the Player a Deck List Screen selects', async () => {
		const screen = await showing('deck', {
			deckSource: { type: 'player', playerId: ids.alice },
		});

		await expect(asOutput(read.playerDecks, screen, {
			params: { playerId: ids.alice },
		})).resolves.toMatchObject({
			player: { id: ids.alice, name: 'Alice' },
		});
	});

	it.each<[string, Handler, () => Promise<Staged>, () => Record<string, number>]>([
		[
			'a Slot the Screen does not show',
			read.slot,
			async () => await showing('feature-match', { featureMatchId: ids.shownSlot }),
			() => ({ slotId: ids.hiddenSlot }),
		],
		[
			'a Slot the Event does not hold',
			read.slot,
			async () => await showing('feature-match', { featureMatchId: 999_999 }),
			() => ({ slotId: 999_999 }),
		],
		[
			'a Player the shown Slot does not seat',
			read.playerDecks,
			async () => await showing('feature-match', { featureMatchId: ids.shownSlot }),
			() => ({ playerId: ids.carol }),
		],
		[
			'a Player while the Deck List Screen selects none',
			read.playerDecks,
			async () => await showing('deck'),
			() => ({ playerId: ids.alice }),
		],
		[
			'a Player the Deck List Screen does not select',
			read.playerDecks,
			async () => await showing('deck', {
				deckSource: { type: 'player', playerId: ids.alice },
			}),
			() => ({ playerId: ids.bob }),
		],
	])('reaches nothing else: %s', async (_what, route, stage, params) => {
		expect(await refusal(route, await stage(), {
			params: params(),
		})).toEqual(NOT_FOUND);
	});
});

describe('a Deck List Screen showing a Broadcast Deck List', () => {
	it('reads the list its saved Deck Source names', async () => {
		const screen = await showing('deck', {
			deckSource: { type: 'broadcast', broadcastDeckListId: ids.broadcastDeckList },
		});

		await expect(asOutput(read.broadcastDeckList, screen)).resolves.toMatchObject({
			id: ids.broadcastDeckList,
			name: 'Finalist',
		});
	});
});

describe('a mode reading what its saved configuration names', () => {
	it('reads the history of the Player a Player History Screen names', async () => {
		const answer = await asOutput(read.playerHistory, await showing('player-history', { playerId: ids.alice }));

		expect(answer.player).toMatchObject({ id: ids.alice, name: 'Alice' });
		expect(answer.history).toEqual([
			expect.objectContaining({ id: ids.earlierMatch, roundName: 'Round 1', opponentName: 'Bob' }),
			expect.objectContaining({ id: ids.upcomingMatch, roundName: 'Round 2', opponentName: 'Bob' }),
		]);
	});

	it('reads the Matches of the Round a Pairings Screen names', async () => {
		const answer = await asOutput(read.pairings, await showing('pairings', { roundId: ids.roundTwo }));

		expect(answer.round).toMatchObject({ id: ids.roundTwo, name: 'Round 2' });
		expect(answer.matches).toEqual([
			expect.objectContaining({
				matchId: ids.upcomingMatch,
				tableNumber: 7,
				player1: { id: ids.alice, name: 'Alice' },
				player2: { id: ids.bob, name: 'Bob' },
				hasResult: false,
			}),
		]);
	});

	it('reads the Round a Round Clock Screen picks, with its timing', async () => {
		await expect(asOutput(read.roundClock, await showing('round-clock', { roundId: ids.roundOne }))).resolves.toEqual({
			round: {
				id: ids.roundOne,
				name: 'Round 1',
				startedAt: null,
				durationMinutes: 50,
			},
		});
	});

	it('reads the two Players a Head-to-Head Screen\'s Feature Match Slot seats, with their earlier Matches', async () => {
		const answer = await asOutput(read.headToHead, await showing('head-to-head', {
			playerSource: 'featureMatchSlot',
			featureMatchId: ids.shownSlot,
		}));

		expect(answer.player1).toMatchObject({ id: ids.alice, name: 'Alice' });
		expect(answer.player2).toMatchObject({ id: ids.bob, name: 'Bob' });
		expect(answer.earlierMatches).toEqual([
			expect.objectContaining({
				matchId: ids.earlierMatch,
				roundName: 'Round 1',
				outcome: 'player2',
				gameScore: '1–2',
			}),
		]);
	});

	// A Talent since deleted leaves the lineup; each Social Profile shows only on a chosen network.
	it('reads a Talent Screen\'s lineup in its order, with each role and the Social Profiles on the networks it shows', async () => {
		const answer = await asOutput(read.talent, await showing('talent', {
			selection: 'lineup',
			talentIds: [ids.caster, 999_999, ids.host],
			socialNetworks: ['bluesky', 'twitch'],
		}));

		expect(answer).toEqual({
			talents: [
				{
					id: ids.caster,
					name: 'Talent Caster',
					role: null,
					photo: null,
					socialProfiles: [],
				},
				{
					id: ids.host,
					name: 'Talent Host',
					role: 'Host',
					photo: null,
					socialProfiles: [
						{
							network: 'twitch',
							networkLabel: 'Twitch',
							handle: 'host',
							profileUrl: 'https://www.twitch.tv/host',
						},
						{
							network: 'bluesky',
							networkLabel: 'Bluesky',
							handle: 'host.bsky.social',
							profileUrl: 'https://bsky.app/profile/host.bsky.social',
						},
					],
				},
			],
		});
	});

	// Seeds are carried only while the Screen shows them (#759): the saved configuration reaches the bracket.
	it('reads the bracket of the Phase a Top Cut Bracket Screen names, as its configuration shows it', async () => {
		const answer = await asOutput(read.topCut, await showing('top-cut', { phaseId: ids.topCut, showSeeds: true }));

		expect(answer.phase).toMatchObject({ id: ids.topCut, name: 'Top 4' });
		expect(answer.bracket.columns.map((column: { roundId: number | null; name: string; positions: unknown[] }) => [column.roundId, column.name, column.positions.length])).toEqual([
			[ids.semifinals, 'Semifinals', 2],
			[null, 'Final', 1],
		]);
		expect(answer.bracket.columns[0].positions[0]).toMatchObject({
			matchId: ids.semifinal,
			entrants: [
				{ playerId: null, name: 'First Seed', seed: null },
				{ playerId: null, name: 'Fourth Seed', seed: null },
			],
			status: 'unreported',
		});
	});

	it.each<[string, Handler, ScreenMode, unknown]>([
		[
			'a Round Clock Screen picking no Round, before any is paired',
			read.roundClock,
			'round-clock',
			{ round: null },
		],
		[
			'a Top Cut Bracket Screen naming no Phase',
			read.topCut,
			'top-cut',
			{
				phase: null,
				bracket: { size: 0, columns: [], champion: null },
			},
		],
		[
			'a Head-to-Head Screen naming no Players',
			read.headToHead,
			'head-to-head',
			{ player1: null, player2: null, earlierMatches: [] },
		],
		[
			'a Talent Screen naming no Talent',
			read.talent,
			'talent',
			{ talents: [] },
		],
	])('answers empty, rather than refusing, for %s', async (_what, route, mode, empty) => {
		await expect(asOutput(route, await showing(mode))).resolves.toEqual(empty);
	});

	it.each<[string, Handler, ScreenMode, Record<string, unknown>]>([
		[
			'a Player History Screen naming no Player',
			read.playerHistory,
			'player-history',
			{},
		],
		[
			'a Player History Screen naming a Player the Event does not hold',
			read.playerHistory,
			'player-history',
			{ playerId: 999_999 },
		],
		[
			'a Pairings Screen naming no Round',
			read.pairings,
			'pairings',
			{},
		],
		[
			'a Pairings Screen naming a Round the Event does not hold',
			read.pairings,
			'pairings',
			{ roundId: 999_999 },
		],
		[
			'an Archetype Spotlight Screen naming no Archetype',
			read.archetypeSpotlight,
			'archetype-spotlight',
			{},
		],
		[
			'a Deck List Screen whose Deck Source is not a Broadcast Deck List',
			read.broadcastDeckList,
			'deck',
			{},
		],
	])('publishes nothing for %s', async (_what, route, mode, config) => {
		expect(await refusal(route, await showing(mode, config))).toEqual(NOT_FOUND);
	});
});

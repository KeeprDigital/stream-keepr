import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { nextTick } from 'vue';
import { createMockEvent, createWireMockEvent, createWireMockPlayer } from '~~/test/helpers/fixtures';
import { settleUntilStill } from '~~/test/helpers/settle';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';
import { tryUseRealtime } from '~/composables/core/useRealtime';
import { usePlayerDeckCache } from '~/composables/data/usePlayerDeckCache';
import { eventDataResync } from '~/modules/event-data/resync';

/*
 * What the Realtime Event Session re-reads once its client has fallen behind,
 * and what its Event-wide messages do: the app's own session, the real handlers
 * and stores, over a faked network and a stand-in transport.
 */

const { mockFetch, mockNavigateTo } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	mockNavigateTo: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('navigateTo', () => mockNavigateTo);

// The session the app starts as this file boots runs against this transport.
vi.mock('~/composables/core/useRealtime', async () => {
	const { reactive } = await import('vue');
	const { createContinuitySignal } = await import('~~/test/helpers/realtime-mock');
	const continuity = createContinuitySignal();
	const transport = reactive({
		connectionId: 'test-connection-id',
		connectionState: 'connected',
		isConnected: true,
		error: null,
		tokenError: null as Error | null,
		/** The Event room the session is in, or `null` while it is in none. */
		room: null as string | null,
		setRoom: (room: string | null) => {
			transport.room = room;
		},
		onRoom: () => {},
		offRoom: () => {},
		onChannel: () => () => {},
		onContinuityLost: continuity.onContinuityLost,
		onceAttached: () => () => {},
		watchPresence: () => () => {},
		/** Signal a channel attached again having lost continuity. */
		reattach: continuity.reattach,
	});
	return {
		useRealtime: () => transport,
		tryUseRealtime: () => transport,
	};
});

const { deliver } = realtimeHandlersFor();

const EVENT_ID = 1;
const ROUND_ID = 5;
const PLAYER_ID = 2;
const ROOM = `event:${EVENT_ID}`;

/** The stand-in transport, with a hand to signal what the real one would. */
function transport() {
	return tryUseRealtime() as unknown as {
		connectionState: string;
		tokenError: Error | null;
		room: string | null;
		reattach: (channel: string) => void;
	};
}

/** What the server answers for Event 1, by path under the Event. */
const answers: Record<string, unknown> = {
	'players': [
		createWireMockPlayer({ id: PLAYER_ID, eventId: EVENT_ID }),
	],
	[`players/${PLAYER_ID}/decks`]: {
		decks: [
			{ id: 10, playerId: PLAYER_ID, isPrimary: true },
		],
		selectedDeckId: 10,
	},
	'feature-match-assignments': { featureMatchAssignments: [] },
	'broadcast-deck-lists': { broadcastDeckLists: [] },
};

/** Each read made since the client was staged, as its path under the Event and any Round it names. */
let reads: string[] = [];

/** Everything a resync re-reads for the client `stage` sets up. */
const HELD = ['broadcast-deck-lists', `feature-match-assignments?roundId=${ROUND_ID}`, 'players'];

type Client = 'an operator' | 'a Screen Output';

/**
 * A client of Event 1 holding all a resync re-reads: a consumed Round's
 * Assignments, the Broadcast Deck Lists, consumed Players and a cached Deck List.
 */
async function stage(client: Client) {
	resetAllEventStores();
	const eventStore = useEventStore();
	if (client === 'an operator') {
		eventStore.setEvent({
			...createMockEvent({ id: EVENT_ID }),
			talents: [],
			meleeConfigured: false,
		});
	}
	else {
		eventStore.setOutputEvent(createWireMockEvent({ id: EVENT_ID }));
	}
	onTestFinished(eventDataResync.consume(['players']));
	useFeatureMatchAssignmentStore().consumeRound(EVENT_ID, ROUND_ID);
	await Promise.all([
		usePlayerStore().loadPlayersByEventId(EVENT_ID),
		useBroadcastDeckListStore().loadCollection(EVENT_ID),
		usePlayerDeckCache().fetchDecks(PLAYER_ID, EVENT_ID, '2026-01-01T00:00:00.000Z'),
	]);
	// The session follows its client's room on the next tick.
	await nextTick();
	reads = [];
	return { metagameVersion: useMetagameStore().invalidationVersion };
}

/** What was re-read, and whether the Deck List cache survived, once nothing more is read. */
async function settled() {
	await settleUntilStill(() => reads);
	return {
		reads: reads.toSorted(),
		deckListCached: usePlayerDeckCache().getCachedDeck(PLAYER_ID) !== null,
	};
}

beforeEach(async () => {
	mockFetch.mockReset().mockImplementation(async (path: string, options?: { query?: { roundId?: number } }) => {
		const resource = path.replace(`/api/events/${EVENT_ID}/`, '');
		reads.push(options?.query?.roundId
			? `${resource}?roundId=${options.query.roundId}`
			: resource);
		return answers[resource] ?? [];
	});
	// A token wait or an outage the last test left ends here, before a client is staged.
	transport().tokenError = null;
	transport().connectionState = 'connected';
	await nextTick();
});

describe('falling behind', () => {
	async function waitOnToken() {
		transport().tokenError = new Error('mint failed');
		await nextTick();
	}

	async function stopWaitingOnToken() {
		await waitOnToken();
		transport().tokenError = null;
		await nextTick();
	}

	async function loseAndRegainConnection() {
		transport().connectionState = 'suspended';
		await nextTick();
		transport().connectionState = 'connected';
		await nextTick();
	}

	// A resync re-reads in place and drops the Deck List cache, whose key a resolved
	// card does not move (#648). A Screen Output is in no room and holds none of it.
	it.each([
		{
			client: 'an operator',
			room: ROOM,
			when: 'its room reattaches having lost continuity',
			act: () => transport().reattach(ROOM),
			rereads: 'what it holds',
		},
		{
			client: 'an operator',
			room: ROOM,
			when: 'its subscriptions stop waiting on a token',
			act: stopWaitingOnToken,
			rereads: 'what it holds',
		},
		{
			client: 'an operator',
			room: ROOM,
			when: 'its subscriptions start waiting on a token',
			act: waitOnToken,
			rereads: 'nothing',
		},
		{
			client: 'a Screen Output',
			room: null,
			when: 'its subscriptions stop waiting on a token',
			act: stopWaitingOnToken,
			rereads: 'nothing',
		},
		{
			client: 'a Screen Output',
			room: null,
			when: 'its connection comes back',
			act: loseAndRegainConnection,
			rereads: 'nothing',
		},
	] as const)('$client re-reads $rereads when $when', async ({ client, room, act, rereads }) => {
		const resynced = rereads === 'what it holds';
		await stage(client);
		const joined = transport().room;

		await act();

		expect({
			room: joined,
			...await settled(),
		}).toEqual({
			room,
			reads: resynced
				? HELD
				: [],
			deckListCached: !resynced,
		});
	});
});

describe('a peer\'s message', () => {
	// An Import announces its Players and Deck Lists as a count (ADR-0074), so an
	// operator reloads the Players; a Screen Output has no Session to read them with.
	it.each([
		{
			client: 'an operator',
			reads: ['players'],
			deckListCached: false,
			metagameInvalidations: 1,
		},
		{
			client: 'a Screen Output',
			reads: [],
			deckListCached: true,
			metagameInvalidations: 0,
		},
	] as const)('tcgplus:imported makes $client re-read $reads', async ({ client, ...left }) => {
		const { metagameVersion } = await stage(client);

		deliver('tcgplus:imported', { playerCount: 2, deckCount: 2 });

		expect({
			...await settled(),
			metagameInvalidations: useMetagameStore().invalidationVersion - metagameVersion,
		}).toEqual(left);
	});

	// An Archetype rename or delete names the Players it re-projected and carries none
	// (ADR-0084), so an operator re-reads them; a Screen Output has no Session to.
	it.each([
		{
			client: 'an operator',
			named: 'its Players',
			playerIds: [PLAYER_ID, 3],
			reads: ['players'],
			deckName: 'Azorius Tempo',
		},
		{
			client: 'an operator',
			named: 'no Player',
			playerIds: null,
			reads: ['players'],
			deckName: 'Azorius Tempo',
		},
		{
			client: 'a Screen Output',
			named: 'its Players',
			playerIds: [PLAYER_ID, 3],
			reads: [],
			deckName: undefined,
		},
	] as const)('player:deckProjectionsChanged naming $named makes $client re-read $reads', async ({ client, playerIds, reads, deckName }) => {
		const { metagameVersion } = await stage(client);
		onTestFinished(() => {
			answers.players = [
				createWireMockPlayer({ id: PLAYER_ID, eventId: EVENT_ID }),
			];
		});
		answers.players = [
			createWireMockPlayer({
				id: PLAYER_ID,
				eventId: EVENT_ID,
				gameData: { type: 'mtg', deckName: 'Azorius Tempo', deckColors: 'WU' },
			}),
		];

		deliver('player:deckProjectionsChanged', {
			playerIds: playerIds && [...playerIds],
		});

		expect({
			reads: (await settled()).reads,
			deckName: (usePlayerStore().players[0]?.gameData as { deckName?: string } | null)?.deckName,
			metagameInvalidations: useMetagameStore().invalidationVersion - metagameVersion,
		}).toEqual({ reads, deckName, metagameInvalidations: 1 });
	});

	it('skips its own player:deckProjectionsChanged, whose write it already holds', async () => {
		const { metagameVersion } = await stage('an operator');

		deliver('player:deckProjectionsChanged', {
			playerIds: [PLAYER_ID],
		}, { fromSelf: true });

		expect({
			reads: (await settled()).reads,
			metagameInvalidations: useMetagameStore().invalidationVersion - metagameVersion,
		}).toEqual({ reads: [], metagameInvalidations: 0 });
	});

	it('playerDeck:cardsResolved invalidates the metagame', () => {
		const version = useMetagameStore().invalidationVersion;

		deliver('playerDeck:cardsResolved', {
			deckIds: [10],
			playerIds: [PLAYER_ID],
		});

		expect(useMetagameStore().invalidationVersion - version).toBe(1);
	});

	// Only the deletion of the Event this client is on ends its Event Lifetime.
	it.each([
		{
			deleted: 'the Event it is on',
			eventId: EVENT_ID,
			leaves: 'home, holding nothing of it',
			left: {
				event: null,
				players: [],
				room: null,
				navigations: [
					['/'],
				],
			},
		},
		{
			deleted: 'another Event',
			eventId: 2,
			leaves: 'where it was',
			left: {
				event: EVENT_ID,
				players: [PLAYER_ID],
				room: ROOM,
				navigations: [],
			},
		},
	])('event:deleted for $deleted leaves an operator $leaves', async ({ eventId, left }) => {
		await stage('an operator');

		deliver('event:deleted', { eventId }, { eventId });
		await nextTick();

		expect({
			event: useEventStore().eventId,
			players: usePlayerStore().players.map(player => player.id),
			room: transport().room,
			navigations: mockNavigateTo.mock.calls,
		}).toEqual(left);
	});

	// The gate logs a handler that throws, so the room goes on hearing.
	it('logs a message its handler throws on, and applies the next', async () => {
		await stage('an operator');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		// Names no Player for the store to match against the one it holds.
		deliver('player:updated', {} as never);
		deliver('player:deleted', { playerId: PLAYER_ID });

		expect(warn).toHaveBeenCalledWith('Failed to handle realtime message "player:updated":', expect.any(Error));
		expect(usePlayerStore().players).toEqual([]);
	});
});

import type { MessagePayload, MessageType } from '~~/shared/types/messages';
import type { FeatureMatchAssignment } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockFeatureMatchState, createMockRound } from '~~/test/helpers/fixtures';
import { settleUntilStill } from '~~/test/helpers/settle';
import { createSession, createSourceSnapshot } from '~~/test/nuxt/helpers/featureMatchStateHarness';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

/*
 * What a peer's message makes this client re-read or hold, through the real
 * Realtime Event Session handlers and stores over a faked network.
 */

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const { deliver } = realtimeHandlersFor();

const EVENT_ID = 1;
const ROUND_ID = 5;

/** Each Event Data read made, as its path under the Event and any Round it names. */
let reads: string[] = [];
let assignmentsHeld: FeatureMatchAssignment[] = [];

beforeEach(() => {
	mockFetch.mockReset().mockImplementation(async (path: string, options?: { query?: { roundId?: number } }) => {
		const resource = path.replace(`/api/events/${EVENT_ID}/`, '');
		reads.push(options?.query?.roundId
			? `${resource}?roundId=${options.query.roundId}`
			: resource);
		if (resource === 'decks')
			return { decks: [] };
		if (resource === 'feature-match-assignments')
			return { featureMatchAssignments: assignmentsHeld };
		return resource === 'rounds'
			? [
					createMockRound({ id: ROUND_ID, eventId: EVENT_ID }),
				]
			: [];
	});
});

type Sent = { [T in MessageType]: readonly [type: T, payload: MessagePayload<T>] }[MessageType];

const meleeMessages: Array<{ sent: Sent; reads: string[]; invalidatesMetagame?: true }> = [
	{
		sent: ['melee:structureSynced', {} as MessagePayload<'melee:structureSynced'>],
		reads: [
			'phases',
			'rounds',
			'feature-match-slots',
			`matches?roundId=${ROUND_ID}`,
		],
	},
	{
		sent: [
			'melee:dataReset',
			{ reason: 'disabled' },
		],
		reads: [
			'phases',
			'rounds',
			'matches',
			'players',
			'decks',
			'feature-match-slots',
		],
		invalidatesMetagame: true,
	},
	{
		sent: [
			'melee:playersSynced',
			{ playerCount: 2 },
		],
		reads: ['players', 'feature-match-slots'],
		invalidatesMetagame: true,
	},
	{
		sent: [
			'melee:featureMatchesSynced',
			{
				slotIds: [3],
			},
		],
		reads: ['feature-match-slots'],
	},
	{
		sent: [
			'melee:featureMatchesSynced',
			{ slotIds: [] },
		],
		reads: [],
	},
	{
		sent: [
			'melee:decklistsSynced',
			{ playerCount: 2, deckCount: 2 },
		],
		reads: ['players', 'decks', 'feature-match-slots'],
		invalidatesMetagame: true,
	},
	{
		sent: [
			'melee:matchResultsSynced',
			{
				roundId: ROUND_ID,
				matchIds: [7],
			},
		],
		reads: [`matches?roundId=${ROUND_ID}`],
	},
	{
		sent: [
			'melee:pairingsSynced',
			{ roundId: ROUND_ID },
		],
		reads: ['rounds', `matches?roundId=${ROUND_ID}`, 'feature-match-slots'],
	},
	{
		sent: [
			'melee:roundStandingsSynced',
			{ roundId: ROUND_ID },
		],
		reads: ['rounds'],
	},
];

describe('a Melee sync message', () => {
	/** An operator's page with one Round's Matches loaded, or a rendering of a Screen holding no Event. */
	async function stage({ operator }: { operator: boolean }) {
		const eventStore = useEventStore();
		eventStore.$reset();
		if (operator) {
			eventStore.setEvent({
				...createMockEvent({ id: EVENT_ID }),
				talents: [],
				meleeConfigured: true,
			});
		}
		useMatchStore().$reset();
		await useMatchStore().loadMatchesByRoundId(EVENT_ID, ROUND_ID);
		reads = [];
		return { metagameVersion: useMetagameStore().invalidationVersion };
	}

	async function send([type, payload]: Sent) {
		deliver(type, payload as never, { eventId: EVENT_ID });
		await settleUntilStill(() => reads);
	}

	it.each(meleeMessages)('$sent.0 $sent.1 re-reads $reads for an operator', async ({ sent, reads: expected, invalidatesMetagame }) => {
		const { metagameVersion } = await stage({ operator: true });

		await send(sent);

		expect(reads.toSorted()).toEqual(expected.toSorted());
		expect(useMetagameStore().invalidationVersion - metagameVersion).toBe(invalidatesMetagame ? 1 : 0);
	});

	// A rendering of a Screen holds no Session, so these private reads would each answer 401 (#604).
	it.each(meleeMessages)('$sent.0 $sent.1 re-reads nothing where no operator Event is held', async ({ sent }) => {
		const { metagameVersion } = await stage({ operator: false });

		await send(sent);

		expect(reads).toEqual([]);
		expect(useMetagameStore().invalidationVersion).toBe(metagameVersion);
	});
});

describe('a Feature Match message', () => {
	function assignment(overrides: Partial<FeatureMatchAssignment> = {}): FeatureMatchAssignment {
		return {
			id: 1,
			eventId: EVENT_ID,
			roundId: ROUND_ID,
			slotId: 100,
			matchId: 1000,
			note: null,
			createdAt: new Date('2026-01-01T00:00:00Z'),
			updatedAt: new Date('2026-01-01T00:00:00Z'),
			...overrides,
		};
	}

	it.each([
		{
			change: 'created',
			send: () => deliver('featureMatchAssignment:created', {
				featureMatchAssignment: assignment({ id: 2, slotId: 101, matchId: 1001 }),
			}),
			held: [
				[1, 'Camera two'],
				[2, null],
			],
			flagged: [],
		},
		{
			change: 'updated',
			send: () => deliver('featureMatchAssignment:updated', {
				featureMatchAssignment: assignment({ note: null }),
			}),
			held: [
				[1, null],
			],
			flagged: [1],
		},
		{
			change: 'deleted',
			send: () => deliver('featureMatchAssignment:deleted', { featureMatchAssignmentId: 1 }),
			held: [],
			flagged: [],
		},
	])('applies a peer\'s $change Assignment to the Round held, flagging a changed Note', async ({ send, held, flagged }) => {
		const store = useFeatureMatchAssignmentStore();
		store.$reset();
		assignmentsHeld = [
			assignment({ note: 'Camera two' }),
		];
		await store.loadAssignments(EVENT_ID, ROUND_ID);

		send();

		expect(store.assignmentsForRound(ROUND_ID).map(held => [held.id, held.note])).toEqual(held);
		expect([1, 2].filter(id => store.isRemoteChanged(id))).toEqual(flagged);
	});

	it('applies a peer\'s Session event to the Session followed', async () => {
		const store = useFeatureMatchStateStore();
		store.$reset();
		const session = createSession();
		store.cacheSession(session);

		deliver('featureMatchSession:eventApplied', {
			slotId: session.slotId,
			sessionId: session.id,
			sequence: session.sequence + 1,
			eventType: 'SetTurnNumber',
			sourceSnapshot: createSourceSnapshot(),
			currentState: createMockFeatureMatchState({ turnNumber: 9 }),
		});
		await settleUntilStill(() => store.sessionSequenceBySlotId.get(session.slotId));

		expect(store.sessionSequenceBySlotId.get(session.slotId)).toBe(session.sequence + 1);
		expect(store.featureMatchStates.get(session.slotId)?.turnNumber).toBe(9);
	});
});

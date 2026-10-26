import type { FeatureMatchSessionResponse } from '~~/shared/types/featureMatchSession';
import type { FeatureMatch } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createMockFeatureMatch, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

/*
 * Both histories of two simultaneous Feature Match Slot Promotions of one Match
 * (#574), replayed on one operator's client: its own promotion's answer and the
 * realtime announcements of both promotions arrive in either order. The Slot and
 * Feature Match stores are real; only the network is mocked. The server's side of
 * the race is pinned by the integration test.
 */

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	reorder: vi.fn(),
	promoteMatch: vi.fn(),
};
const mockAssignmentStore = {
	currentEventId: null as number | null,
	assignmentsByRound: new Map<number, unknown[]>(),
	applySavedAssignment: vi.fn(),
	currentLifetime: () => ({ stale: false, current: true }),
};

mockNuxtImport('useFeatureMatchRepository', () => () => mockRepo);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => mockAssignmentStore);
mockNuxtImport('useOverlay', () => () => ({
	create: vi.fn(),
}));
mockNuxtImport('useRealtime', () => () => createMockRealtime());
vi.mock('~/modules/feature-match-session/client', () => ({
	useFeatureMatchSessionClient: () => ({
		ensureSession: vi.fn(),
	}),
}));

const EVENT_ID = 1;
const ROUND_ID = 3;
const CONTESTED = 7;
/** This operator's Slot. */
const MINE = 1;
/** The Slot a colleague promotes the same Match into. */
const THEIRS = 2;

function session(id: number, slotId: number, matchId: number | null): FeatureMatchSessionResponse {
	return {
		id,
		eventId: EVENT_ID,
		slotId,
		status: 'active',
		sourceSnapshot: {
			eventId: EVENT_ID,
			slotId,
			matchId,
			externalId: null,
			externalSource: null,
			tableNumber: null,
			bestOf: 3,
			playerDisplayMode: 'score',
			game: 'mtg',
			defaults: toFeatureMatchDefaults(null),
			player1: { playerId: null, data: null },
			player2: { playerId: null, data: null },
			createdAt: 1000000,
		},
		currentState: createMockFeatureMatchState({ turnNumber: id }),
		sequence: 1,
		closedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};
}

function slot(id: number, matchId: number | null, sessionId: number): FeatureMatch {
	return createMockFeatureMatch({
		id,
		eventId: EVENT_ID,
		matchId,
		activeSessionId: sessionId,
		activeSession: session(sessionId, id, matchId),
	} as Partial<FeatureMatch>) as FeatureMatch;
}

function announce(featureMatch: FeatureMatch) {
	useFeatureMatchStore().applyRemoteUpdated({
		eventId: EVENT_ID,
		timestamp: Date.now(),
		featureMatch,
	});
}

function heldSlot(id: number) {
	return useFeatureMatchStore().featureMatches.find(held => held.id === id);
}

function heldSessionId(id: number) {
	return useFeatureMatchStateStore().sessionIdBySlotId.get(id);
}

function promoteMine() {
	return useFeatureMatchPromotion().promote({
		eventId: EVENT_ID,
		roundId: ROUND_ID,
		slotId: MINE,
		matchId: CONTESTED,
	});
}

describe('two simultaneous promotions of one Match, seen by the promoting operator', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mockAssignmentStore.currentEventId = EVENT_ID;
		mockAssignmentStore.assignmentsByRound = new Map([
			[ROUND_ID, []],
		]);
		useFeatureMatchStore().$reset();
		useFeatureMatchStateStore().$reset();
		mockRepo.list.mockResolvedValue([
			slot(MINE, null, 10),
			slot(THEIRS, null, 20),
		]);
		await useFeatureMatchStore().loadFeatureMatchesByEventId(EVENT_ID);
	});

	describe('the colleague\'s write is rejected', () => {
		const promoted = () => slot(MINE, CONTESTED, 21);

		it.each([
			[
				'its answer before its announcement',
				[
					() => promoteMine(),
					() => announce(promoted()),
				],
			],
			[
				'its announcement before its answer',
				[
					() => announce(promoted()),
					() => promoteMine(),
				],
			],
		] as const)('this promotion takes the Match whichever arrives first: %s', async (_, steps) => {
			mockRepo.promoteMatch.mockResolvedValue({
				promotedSlot: promoted(),
				clearedSlots: [],
				assignment: {},
			});

			for (const step of steps)
				await step();

			expect(heldSlot(MINE)).toMatchObject({ matchId: CONTESTED, activeSessionId: 21 });
			expect(heldSessionId(MINE)).toBe(21);
			expect(heldSlot(THEIRS)).toMatchObject({ matchId: null, activeSessionId: 20 });
			expect(heldSessionId(THEIRS)).toBe(20);
			expect(mockAssignmentStore.applySavedAssignment).toHaveBeenCalledOnce();
		});
	});

	describe('the colleague moves the Match off this Slot', () => {
		// This promotion committed first (Session 21); the colleague's then moved the
		// Match to their Slot (Session 22) and cleared this one with a fresh Session (23).
		const mineAnswer = () => ({
			promotedSlot: slot(MINE, CONTESTED, 21),
			clearedSlots: [],
			assignment: { slotId: MINE },
		});
		const theirsAnnounced = () => {
			announce(slot(THEIRS, CONTESTED, 22));
			announce(slot(MINE, null, 23));
		};

		it.each([
			[
				'the colleague\'s announcements before this answer',
				false,
				[
					theirsAnnounced,
					() => promoteMine(),
				],
			],
			[
				'this answer before the colleague\'s announcements',
				true,
				[
					() => promoteMine(),
					theirsAnnounced,
				],
			],
			[
				'this promotion\'s own late announcement last',
				true,
				[
					() => promoteMine(),
					theirsAnnounced,
					() => announce(slot(MINE, CONTESTED, 21)),
				],
			],
		] as const)('this Slot ends cleared on its newer Session: %s', async (_, answerCurrent, steps) => {
			mockRepo.promoteMatch.mockResolvedValue(mineAnswer());

			for (const step of steps)
				await step();

			expect(heldSlot(MINE)).toMatchObject({ matchId: null, activeSessionId: 23 });
			expect(heldSessionId(MINE)).toBe(23);
			expect(useFeatureMatchStateStore().featureMatchStates.get(MINE)?.turnNumber).toBe(23);
			expect(heldSlot(THEIRS)).toMatchObject({ matchId: CONTESTED, activeSessionId: 22 });
			expect(heldSessionId(THEIRS)).toBe(22);
			// An answer already overtaken carries an Assignment the colleague's moved on;
			// one that arrived first was current, and the colleague's own update follows.
			expect(mockAssignmentStore.applySavedAssignment).toHaveBeenCalledTimes(answerCurrent ? 1 : 0);
		});
	});
});

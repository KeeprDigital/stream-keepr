import type { FeatureMatchPromotionResponse } from '~~/shared/api';
import type { FeatureMatchSessionResponse } from '~~/shared/types/featureMatchSession';
import type { FeatureMatch } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createMockFeatureMatch, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';

/**
 * Both histories of a simultaneous Feature Match Slot Promotion race (#574), as the
 * promoting operator's client sees them, with no server: the real promotion
 * workflow and both Feature Match stores, so the promotion's answer and the other
 * promotion's realtime Slot updates meet in the Live State Follower in either order.
 *
 * Operator A promotes Match 7 into Slot 1 while operator B promotes it into Slot 2.
 */

const mockRepo = {
	list: vi.fn(),
	promoteMatch: vi.fn(),
};
const mockAssignmentStore = {
	currentEventId: 1 as number | null,
	assignmentsByRound: new Map<number, unknown[]>([[3, []]]),
	applySavedAssignment: vi.fn(),
	currentLifetime: () => ({ stale: false, current: true }),
};

mockNuxtImport('useFeatureMatchRepository', () => () => mockRepo);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => mockAssignmentStore);
mockNuxtImport('useOverlay', () => () => ({ create: vi.fn() }));
vi.mock('~/modules/feature-match-session/client', () => ({
	useFeatureMatchSessionClient: () => ({ ensureSession: vi.fn() }),
}));

const EVENT_ID = 1;
const MATCH_ID = 7;
const SLOT_A = 1;
const SLOT_B = 2;

function session(id: number, slotId: number, matchId: number | null): FeatureMatchSessionResponse {
	return {
		id,
		eventId: EVENT_ID,
		slotId,
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
		currentState: createMockFeatureMatchState(),
		sequence: 1,
		status: 'active',
		closedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};
}

function slot(id: number, matchId: number | null, sessionId: number): FeatureMatch {
	return {
		...createMockFeatureMatch({ id, matchId, activeSessionId: sessionId }),
		activeSession: session(sessionId, id, matchId),
	} as FeatureMatch;
}

describe('a simultaneous Slot Promotion race, on the promoting client', () => {
	let slots: ReturnType<typeof useFeatureMatchStore>;
	let sessions: ReturnType<typeof useFeatureMatchStateStore>;

	beforeEach(async () => {
		vi.clearAllMocks();
		slots = useFeatureMatchStore();
		sessions = useFeatureMatchStateStore();
		slots.$reset();
		sessions.$reset();
		mockRepo.list.mockResolvedValue([slot(SLOT_A, null, 600), slot(SLOT_B, null, 700)]);
		await slots.loadFeatureMatchesByEventId(EVENT_ID);
	});

	function held(slotId: number) {
		return {
			matchId: slots.featureMatches.find(featureMatch => featureMatch.id === slotId)?.matchId,
			sessionId: sessions.sessionIdBySlotId.get(slotId),
		};
	}

	/** Operator B's promotion reaching this client as realtime Slot updates. */
	function otherPromotionArrives(updated: FeatureMatch[]) {
		for (const featureMatch of updated)
			slots.applyRemoteUpdated({ eventId: EVENT_ID, timestamp: Date.now(), featureMatch });
	}

	function promoteIntoSlotA() {
		return useFeatureMatchPromotion().promote({ eventId: EVENT_ID, roundId: 3, slotId: SLOT_A, matchId: MATCH_ID });
	}

	describe('when this promotion\'s write is rejected', () => {
		it.each([
			['before', true],
			['after', false],
		])('the first Slot keeps its Session and Slot 2 takes the Match, with the other promotion arriving %s the refusal', async (_, otherFirst) => {
			const winner = [slot(SLOT_B, MATCH_ID, 701)];
			mockRepo.promoteMatch.mockRejectedValue(transportFailure({ status: 409, body: { data: { code: 'feature-match-promotion-lost-race' } } }));

			if (otherFirst)
				otherPromotionArrives(winner);
			await expect(promoteIntoSlotA()).rejects.toBeDefined();
			if (!otherFirst)
				otherPromotionArrives(winner);

			expect(held(SLOT_A)).toEqual({ matchId: null, sessionId: 600 });
			expect(held(SLOT_B)).toEqual({ matchId: MATCH_ID, sessionId: 701 });
		});
	});

	describe('when the other promotion moves the Match off after this one saved', () => {
		// This promotion gave Slot 1 Session 610 holding the Match. The other then moved
		// the Match to Slot 2 (Session 701) and cleared Slot 1 with a fresh Session 620.
		const moved = [slot(SLOT_A, null, 620), slot(SLOT_B, MATCH_ID, 701)];
		const answer: FeatureMatchPromotionResponse = {
			promotedSlot: slot(SLOT_A, MATCH_ID, 610),
			clearedSlots: [],
			assignment: { id: 9, eventId: EVENT_ID, roundId: 3, slotId: SLOT_A, matchId: MATCH_ID, note: null, createdAt: new Date(), updatedAt: new Date() },
		} as FeatureMatchPromotionResponse;

		it.each([
			['before', true],
			['after', false],
		])('the first Slot ends empty in its fresh Session, with the other promotion arriving %s this answer', async (_, otherFirst) => {
			mockRepo.promoteMatch.mockResolvedValue(answer);

			if (otherFirst)
				otherPromotionArrives(moved);
			await promoteIntoSlotA();
			if (!otherFirst)
				otherPromotionArrives(moved);

			expect(held(SLOT_A)).toEqual({ matchId: null, sessionId: 620 });
			expect(held(SLOT_B)).toEqual({ matchId: MATCH_ID, sessionId: 701 });
		});

		it('an answer the other promotion overtook does not save its Assignment either', async () => {
			mockRepo.promoteMatch.mockResolvedValue(answer);

			otherPromotionArrives(moved);
			await promoteIntoSlotA();

			expect(mockAssignmentStore.applySavedAssignment).not.toHaveBeenCalled();
		});

		it('an answer arriving first saves its Assignment', async () => {
			mockRepo.promoteMatch.mockResolvedValue(answer);

			await promoteIntoSlotA();

			expect(mockAssignmentStore.applySavedAssignment).toHaveBeenCalledWith(answer.assignment);
		});
	});
});

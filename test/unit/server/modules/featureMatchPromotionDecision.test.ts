import type { DbFeatureMatch, DbFeatureMatchAssignment, DbFeatureMatchSession } from '~~/server/db/schema';
import type { PromotionPreState } from '~~/server/modules/feature-match-promotion/decision';
import { describe, expect, it } from 'vitest';
import { decidePromotion } from '~~/server/modules/feature-match-promotion/decision';

/**
 * Every outcome of a Feature Match Slot Promotion, decided from what it read
 * before its batch and what it reads after. No mocks: the decision is a pure
 * function of those reads, so each race history is a set of rows.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z');
const EVENT = 1;
const ROUND = 3;
const MATCH_M = 7;
const MATCH_N = 8;
const SLOT_1 = 1;
const SLOT_2 = 2;

type Slot = DbFeatureMatch & { activeSession: DbFeatureMatchSession | null };

function session(id: number, slotId: number, matchId: number | null, sequence = 1): DbFeatureMatchSession {
	return {
		id,
		eventId: EVENT,
		slotId,
		status: 'active',
		sourceSnapshot: { eventId: EVENT, matchId } as DbFeatureMatchSession['sourceSnapshot'],
		currentState: {} as DbFeatureMatchSession['currentState'],
		sequence,
		closedAt: null,
		createdAt: NOW,
		updatedAt: NOW,
	};
}

function slot(id: number, matchId: number | null, activeSession: DbFeatureMatchSession | null = null): Slot {
	return {
		id,
		eventId: EVENT,
		matchId,
		externalId: null,
		externalSource: null,
		tableNumber: matchId,
		roundName: matchId == null ? null : 'Round 3',
		formatName: null,
		player1Id: null,
		player2Id: null,
		player1Data: null,
		player2Data: null,
		bestOf: 3,
		sortOrder: id,
		playerDisplayMode: 'score',
		activeSessionId: activeSession?.id ?? null,
		activeSession,
		createdAt: NOW,
		updatedAt: NOW,
	} as Slot;
}

function assignment(id: number, slotId: number, matchId: number, note: string | null = null): DbFeatureMatchAssignment {
	return { id, eventId: EVENT, roundId: ROUND, slotId, matchId, note, createdAt: NOW, updatedAt: NOW };
}

function pre(overrides: Partial<PromotionPreState> = {}): PromotionPreState {
	return { slotId: SLOT_2, matchId: MATCH_M, clearedSlotIds: [], ...overrides };
}

function types(messages: { type: string }[]) {
	return messages.map(message => message.type);
}

describe('feature Match Slot Promotion decision', () => {
	it('wins a promotion its Slot still holds, announcing its new Session, its Assignment and its Slot', () => {
		const opened = session(57, SLOT_2, MATCH_M);
		const saved = assignment(9, SLOT_2, MATCH_M);
		const promoted = slot(SLOT_2, MATCH_M, opened);

		const decision = decidePromotion(pre(), { slot: promoted, assignment: saved });
		if (decision.outcome !== 'standing')
			throw new Error(`expected a standing promotion, got ${decision.outcome}`);
		const publication = decision.describe({ slots: [slot(SLOT_1, null), promoted], assignment: saved, openedSessions: [opened] });

		expect(publication).toMatchObject({ outcome: 'won' });
		if (publication.outcome === 'failed')
			throw new Error(publication.message);
		expect(types(publication.messages)).toEqual([
			'featureMatchSession:eventApplied',
			'featureMatchAssignment:created',
			'featureMatch:updated',
		]);
		expect(publication.messages[0]!.payload).toMatchObject({ slotId: SLOT_2, sessionId: 57, sequence: 1, eventType: 'SessionStarted' });
		expect(publication.messages[1]!.payload).toMatchObject({ featureMatchAssignment: { id: 9, slotId: SLOT_2, matchId: MATCH_M } });
		expect(publication.messages[2]!.payload).toMatchObject({ featureMatch: { id: SLOT_2, matchId: MATCH_M, activeSessionId: 57 } });
		expect(publication.response).toMatchObject({
			promotedSlot: { id: SLOT_2, matchId: MATCH_M, activeSession: { id: 57 } },
			clearedSlots: [],
			assignment: { id: 9, slotId: SLOT_2 },
		});
	});

	it('loses a committed promotion whose Slot another promotion has since moved the Match off, describing nothing', () => {
		const decision = decidePromotion(pre(), {
			slot: slot(SLOT_2, null, session(60, SLOT_2, null)),
			assignment: undefined,
		});

		// Lost is a value with nothing to describe: no Assignment, no cleared Slot,
		// and none of the Sessions its commit opened reach a peer (#576, ADR-0029).
		expect(decision).toEqual({ outcome: 'lost' });
	});

	it('loses, rather than failing to save, when a later move carried the Assignment off with the Match', () => {
		const decision = decidePromotion(pre(), {
			slot: slot(SLOT_2, MATCH_N, session(61, SLOT_2, MATCH_N)),
			assignment: assignment(12, SLOT_2, MATCH_N),
		});

		expect(decision).toEqual({ outcome: 'lost' });
	});

	it('fails a promotion whose Slot cannot be read back, or whose Slot holds the Match without its Assignment', () => {
		expect(decidePromotion(pre(), { slot: undefined, assignment: undefined }))
			.toEqual({ outcome: 'failed', message: 'Failed to retrieve updated feature match slot' });
		expect(decidePromotion(pre(), { slot: slot(SLOT_2, MATCH_M), assignment: undefined }))
			.toEqual({ outcome: 'failed', message: 'Failed to save feature match assignment' });
	});

	it('wins a move, continuing the Assignment and announcing every cleared Slot with its new Session before the promoted one', () => {
		const clearedSession = session(58, SLOT_1, null);
		const promotedSession = session(59, SLOT_2, MATCH_M);
		const continued = assignment(9, SLOT_1, MATCH_M, 'Watch the sideboard');
		const moved = assignment(9, SLOT_2, MATCH_M, 'Watch the sideboard');
		const promoted = slot(SLOT_2, MATCH_M, promotedSession);

		const decision = decidePromotion(
			pre({ clearedSlotIds: [SLOT_1], continuedAssignment: continued, displacedAssignment: undefined }),
			{ slot: promoted, assignment: moved },
		);
		if (decision.outcome !== 'standing')
			throw new Error(decision.outcome);
		const publication = decision.describe({
			slots: [slot(SLOT_1, null, clearedSession), promoted],
			assignment: moved,
			openedSessions: [clearedSession, promotedSession],
		});
		if (publication.outcome === 'failed')
			throw new Error(publication.message);

		expect(publication.outcome).toBe('won');
		expect(publication.messages).toMatchObject([
			{ type: 'featureMatchSession:eventApplied', payload: { slotId: SLOT_1, sessionId: 58, eventType: 'SessionStarted' } },
			{ type: 'featureMatchSession:eventApplied', payload: { slotId: SLOT_2, sessionId: 59, eventType: 'SessionStarted' } },
			{ type: 'featureMatchAssignment:updated', payload: { featureMatchAssignment: { id: 9, slotId: SLOT_2, note: 'Watch the sideboard' } } },
			{ type: 'featureMatch:updated', payload: { featureMatch: { id: SLOT_1, matchId: null, activeSessionId: 58 } } },
			{ type: 'featureMatch:updated', payload: { featureMatch: { id: SLOT_2, matchId: MATCH_M, activeSessionId: 59 } } },
		]);
		expect(publication.messages).toHaveLength(5);
		expect(publication.response.clearedSlots).toMatchObject([{ id: SLOT_1, matchId: null }]);
	});

	it('announces the end of a different Match\'s Assignment it displaced, but not a re-promotion\'s own', () => {
		const displaced = assignment(8, SLOT_2, MATCH_N);
		const saved = assignment(9, SLOT_2, MATCH_M);
		const promoted = slot(SLOT_2, MATCH_M, session(57, SLOT_2, MATCH_M));
		const current = { slots: [promoted], assignment: saved, openedSessions: [] };

		const displacing = decidePromotion(pre({ displacedAssignment: displaced }), { slot: promoted, assignment: saved });
		if (displacing.outcome !== 'standing')
			throw new Error(displacing.outcome);
		const displacingPublication = displacing.describe(current);
		if (displacingPublication.outcome === 'failed')
			throw new Error(displacingPublication.message);
		expect(types(displacingPublication.messages)).toEqual([
			'featureMatchAssignment:created',
			'featureMatchAssignment:deleted',
			'featureMatch:updated',
		]);
		expect(displacingPublication.messages[1]!.payload).toEqual({ featureMatchAssignmentId: 8 });

		// An Assignment row the upsert kept is the promotion's own, not one it ended.
		const keeping = decidePromotion(pre({ displacedAssignment: saved, continuedAssignment: saved }), { slot: promoted, assignment: saved });
		if (keeping.outcome !== 'standing')
			throw new Error(keeping.outcome);
		const keepingPublication = keeping.describe(current);
		if (keepingPublication.outcome === 'failed')
			throw new Error(keepingPublication.message);
		expect(types(keepingPublication.messages)).toEqual(['featureMatchAssignment:updated', 'featureMatch:updated']);
	});

	it('still stands when moved off after its outcome was decided, publishing what it committed and answering as things are now', () => {
		const saved = assignment(9, SLOT_2, MATCH_M);
		const decision = decidePromotion(pre(), { slot: slot(SLOT_2, MATCH_M, session(57, SLOT_2, MATCH_M)), assignment: saved });
		if (decision.outcome !== 'standing')
			throw new Error(decision.outcome);

		// Another promotion moved the Match to Slot 1 before the later reads.
		const publication = decision.describe({
			slots: [slot(SLOT_1, MATCH_M, session(62, SLOT_1, MATCH_M)), slot(SLOT_2, null, session(63, SLOT_2, null))],
			assignment: assignment(9, SLOT_1, MATCH_M),
			openedSessions: [],
		});
		if (publication.outcome === 'failed')
			throw new Error(publication.message);

		expect(publication.outcome).toBe('won-then-moved');
		// Peers learn what this promotion committed; the move announces itself.
		expect(publication.messages).toMatchObject([
			{ type: 'featureMatchAssignment:created', payload: { featureMatchAssignment: { id: 9, slotId: SLOT_2 } } },
			{ type: 'featureMatch:updated', payload: { featureMatch: { id: SLOT_2, matchId: null, activeSessionId: 63 } } },
		]);
		// This operator's client is answered with the move, so it cannot overwrite it.
		expect(publication.response).toMatchObject({
			promotedSlot: { id: SLOT_2, matchId: null, activeSessionId: 63 },
			assignment: { id: 9, slotId: SLOT_1 },
		});
	});

	it('lets both of two promotions of one Match succeed when the later read the earlier and moved the Match on', () => {
		// A promotes M into Slot 2 and decides it stands; B, planned after A
		// committed, moves M to Slot 1, clearing Slot 2.
		const assignmentInSlot2 = assignment(9, SLOT_2, MATCH_M);
		const assignmentInSlot1 = assignment(9, SLOT_1, MATCH_M);
		const aSession = session(57, SLOT_2, MATCH_M);
		const bCleared = session(63, SLOT_2, null);
		const bPromoted = session(62, SLOT_1, MATCH_M);
		const after = [slot(SLOT_1, MATCH_M, bPromoted), slot(SLOT_2, null, bCleared)];

		const a = decidePromotion(pre({ slotId: SLOT_2 }), { slot: slot(SLOT_2, MATCH_M, aSession), assignment: assignmentInSlot2 });
		const b = decidePromotion(
			pre({ slotId: SLOT_1, clearedSlotIds: [SLOT_2], continuedAssignment: assignmentInSlot2 }),
			{ slot: after[0], assignment: assignmentInSlot1 },
		);
		if (a.outcome !== 'standing' || b.outcome !== 'standing')
			throw new Error(`${a.outcome} / ${b.outcome}`);
		const aPublication = a.describe({ slots: after, assignment: assignmentInSlot1, openedSessions: [] });
		const bPublication = b.describe({ slots: after, assignment: assignmentInSlot1, openedSessions: [bCleared, bPromoted] });
		if (aPublication.outcome === 'failed' || bPublication.outcome === 'failed')
			throw new Error('a promotion failed');

		expect(aPublication.outcome).toBe('won-then-moved');
		expect(bPublication.outcome).toBe('won');
		// Both answer the same end state: M in Slot 1, Slot 2 empty on a new Session.
		expect(aPublication.response).toMatchObject({ promotedSlot: { id: SLOT_2, matchId: null, activeSessionId: 63 }, assignment: { slotId: SLOT_1 } });
		expect(bPublication.response).toMatchObject({
			promotedSlot: { id: SLOT_1, matchId: MATCH_M, activeSessionId: 62 },
			clearedSlots: [{ id: SLOT_2, matchId: null, activeSessionId: 63 }],
			assignment: { slotId: SLOT_1 },
		});
	});

	it('skips a cleared Slot deleted since, and fails when the promoted Slot itself is gone', () => {
		const saved = assignment(9, SLOT_2, MATCH_M);
		const promoted = slot(SLOT_2, MATCH_M, session(57, SLOT_2, MATCH_M));
		const decision = decidePromotion(pre({ clearedSlotIds: [SLOT_1] }), { slot: promoted, assignment: saved });
		if (decision.outcome !== 'standing')
			throw new Error(decision.outcome);

		const withoutCleared = decision.describe({ slots: [promoted], assignment: saved, openedSessions: [] });
		if (withoutCleared.outcome === 'failed')
			throw new Error(withoutCleared.message);
		expect(withoutCleared.response.clearedSlots).toEqual([]);
		expect(types(withoutCleared.messages)).toEqual(['featureMatchAssignment:created', 'featureMatch:updated']);

		expect(decision.describe({ slots: [], assignment: saved, openedSessions: [] }))
			.toEqual({ outcome: 'failed', message: 'Failed to retrieve updated feature match slot' });
	});
});

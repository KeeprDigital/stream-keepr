import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Feature Match Slot Promotion plans from reads and then commits one batch,
 * so another promotion can commit inside that window (#605). The plan must not
 * then act on the Slots, Assignments and Sessions it read as if they had not
 * moved on.
 *
 * Run against real SQLite because the fence is in the SQL: what the batch does
 * when its observed pre-state has gone stale is the behaviour under test. The
 * interleave is deterministic — the other promotion runs whole inside this
 * one's plan-to-commit window, by way of this one's own batch call.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const publishMessage = vi.fn(async () => {});

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage,
	publishMessageStrict: publishMessage,
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

const { featureMatchPromotionModule } = await import('~~/server/modules/feature-match-promotion');
const { featureMatchService } = await import('~~/server/services/featureMatch');

afterAll(async () => {
	await harness.close();
});

/**
 * Each runs once around the next promotion batch. `beforeNextBatch` lands in
 * the plan-to-commit window: the batch call waits for it, then commits the plan
 * it was given. `afterNextBatch` lands between that commit and the promotion's
 * reads of what it committed.
 */
let beforeNextBatch: (() => Promise<unknown>) | null = null;
let afterNextBatch: (() => Promise<unknown>) | null = null;

// Patched by assignment rather than `vi.spyOn`: the suite config restores
// spies before every test, and this patch must hold for the whole file.
const realBatch = db.batch.bind(db) as (queries: unknown) => Promise<unknown>;
db.batch = (async (queries: unknown) => {
	const before = beforeNextBatch;
	const after = afterNextBatch;
	beforeNextBatch = null;
	afterNextBatch = null;
	await before?.();
	const results = await realBatch(queries);
	await after?.();
	return results;
}) as unknown as typeof db.batch;

beforeEach(() => {
	beforeNextBatch = null;
	afterNextBatch = null;
	publishMessage.mockClear();
});

interface Stage {
	eventId: number;
	roundId: number;
	matchM: number;
	matchN: number;
	slot1: number;
	slot2: number;
}

async function stageEvent(): Promise<Stage> {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Promotion Fence Open', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning();
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases)
		.values({ eventId, name: 'Swiss', sortOrder: 0 })
		.returning();
	const [round] = await db.insert(schema.rounds)
		.values({ eventId, phaseId: phase!.id, name: 'Round 1', roundNumber: 1 })
		.returning();
	const players = await db.insert(schema.players).values([
		{ eventId, name: 'Mia' },
		{ eventId, name: 'Max' },
		{ eventId, name: 'Nia' },
		{ eventId, name: 'Ned' },
	]).returning();
	const [matchM, matchN] = await db.insert(schema.matches).values([
		{ eventId, roundId: round!.id, tableNumber: 1, player1Id: players[0]!.id, player2Id: players[1]!.id, sortOrder: 0 },
		{ eventId, roundId: round!.id, tableNumber: 2, player1Id: players[2]!.id, player2Id: players[3]!.id, sortOrder: 1 },
	]).returning();

	const slots = featureMatchService();
	const slot1 = await slots.create(eventId, {});
	const slot2 = await slots.create(eventId, {});

	return {
		eventId,
		roundId: round!.id,
		matchM: matchM!.id,
		matchN: matchN!.id,
		slot1: slot1.id,
		slot2: slot2.id,
	};
}

function promote(stage: Stage, slotId: number, matchId: number) {
	return featureMatchPromotionModule().promoteMatchToSlot({ eventId: stage.eventId, slotId, matchId });
}

async function slotRow(slotId: number) {
	return await db.query.featureMatches.findFirst({ where: (slots, { eq }) => eq(slots.id, slotId) });
}

async function assignmentsOf(stage: Stage) {
	return await db.query.featureMatchAssignments.findMany({
		where: (assignments, { eq }) => eq(assignments.roundId, stage.roundId),
		orderBy: (assignments, { asc }) => asc(assignments.id),
	});
}

async function promotionState(stage: Stage) {
	return {
		slots: await db.query.featureMatches.findMany({
			where: (slots, { eq }) => eq(slots.eventId, stage.eventId),
			orderBy: (slots, { asc }) => asc(slots.id),
		}),
		assignments: await assignmentsOf(stage),
		sessions: await db.query.featureMatchSessions.findMany({
			where: (sessions, { eq }) => eq(sessions.eventId, stage.eventId),
			orderBy: (sessions, { asc }) => asc(sessions.id),
		}),
	};
}

describe('feature Match Slot Promotion against a stale plan', () => {
	it('does not let a stale move erase a different Match promoted into its source Slot meanwhile', async () => {
		const stage = await stageEvent();
		await promote(stage, stage.slot1, stage.matchM);

		// A plans M → Slot 2, remembering Slot 1 as M's duplicate to clear; B
		// promotes N into Slot 1 and commits before A's batch does.
		let promotedN: Awaited<ReturnType<typeof promote>> | undefined;
		beforeNextBatch = async () => {
			promotedN = await promote(stage, stage.slot1, stage.matchN);
		};

		await expect(promote(stage, stage.slot2, stage.matchM)).rejects.toMatchObject({ statusCode: 409 });

		const slot1 = await slotRow(stage.slot1);
		expect(slot1?.matchId).toBe(stage.matchN);
		expect(slot1?.activeSessionId).toBe(promotedN!.promotedSlot.activeSessionId);
		const session = await db.query.featureMatchSessions.findFirst({
			where: (sessions, { eq }) => eq(sessions.id, slot1!.activeSessionId!),
		});
		expect(session?.status).toBe('active');
		expect(session?.sourceSnapshot.matchId).toBe(stage.matchN);
		expect(await assignmentsOf(stage)).toEqual([
			expect.objectContaining({ id: promotedN!.assignment.id, slotId: stage.slot1, matchId: stage.matchN }),
		]);
	});

	it('rolls back every Slot, Assignment and Session write of a refused stale plan and publishes nothing', async () => {
		const stage = await stageEvent();
		await promote(stage, stage.slot1, stage.matchM);

		let afterOtherPromotion: Awaited<ReturnType<typeof promotionState>> | undefined;
		beforeNextBatch = async () => {
			await promote(stage, stage.slot1, stage.matchN);
			afterOtherPromotion = await promotionState(stage);
			publishMessage.mockClear();
		};

		await expect(promote(stage, stage.slot2, stage.matchM)).rejects.toMatchObject({ statusCode: 409 });

		expect(await promotionState(stage)).toEqual(afterOtherPromotion);
		expect(publishMessage).not.toHaveBeenCalled();
	});
});

describe('feature Match Slot Promotion histories that still resolve', () => {
	it('moves a Match serially, continuing its Assignment and clearing the source Slot with a fresh Session', async () => {
		const stage = await stageEvent();
		const first = await promote(stage, stage.slot1, stage.matchM);
		await db.update(schema.featureMatchAssignments)
			.set({ note: 'Watch the sideboard' })
			.where(eq(schema.featureMatchAssignments.id, first.assignment.id));

		const moved = await promote(stage, stage.slot2, stage.matchM);

		expect(moved.promotedSlot).toMatchObject({ id: stage.slot2, matchId: stage.matchM, tableNumber: 1, roundName: 'Round 1', formatName: null });
		expect(moved.clearedSlots).toEqual([expect.objectContaining({ id: stage.slot1, matchId: null })]);
		expect(moved.assignment).toMatchObject({ id: first.assignment.id, slotId: stage.slot2, note: 'Watch the sideboard' });

		const slot1 = await slotRow(stage.slot1);
		expect(slot1?.matchId).toBeNull();
		expect(slot1?.activeSessionId).not.toBe(first.promotedSlot.activeSessionId);
		const clearedSession = await db.query.featureMatchSessions.findFirst({
			where: (sessions, { eq }) => eq(sessions.id, slot1!.activeSessionId!),
		});
		expect(clearedSession).toMatchObject({ status: 'active', sequence: 1 });
		expect(clearedSession?.sourceSnapshot.matchId).toBeNull();
		expect(await assignmentsOf(stage)).toEqual([
			expect.objectContaining({ id: first.assignment.id, slotId: stage.slot2, matchId: stage.matchM }),
		]);
	});

	it('refuses the later commit of two simultaneous promotions of one Match that each read no duplicate', async () => {
		const stage = await stageEvent();
		const slot2Before = await slotRow(stage.slot2);

		let winner: Awaited<ReturnType<typeof promote>> | undefined;
		beforeNextBatch = async () => {
			winner = await promote(stage, stage.slot1, stage.matchM);
		};

		await expect(promote(stage, stage.slot2, stage.matchM)).rejects.toMatchObject({ statusCode: 409 });

		expect(winner?.promotedSlot).toMatchObject({ id: stage.slot1, matchId: stage.matchM });
		expect(await slotRow(stage.slot2)).toEqual(slot2Before);
		expect(await assignmentsOf(stage)).toEqual([
			expect.objectContaining({ slotId: stage.slot1, matchId: stage.matchM }),
		]);
	});

	it('refuses the later of two simultaneous promotions of one Match into one Slot, keeping the first one\'s Session', async () => {
		const stage = await stageEvent();

		// The later plan read the Slot empty, so committing it would reset the
		// Feature Match Session the first promotion opened.
		let first: Awaited<ReturnType<typeof promote>> | undefined;
		beforeNextBatch = async () => {
			first = await promote(stage, stage.slot1, stage.matchM);
		};

		await expect(promote(stage, stage.slot1, stage.matchM)).rejects.toMatchObject({ statusCode: 409 });

		const slot1 = await slotRow(stage.slot1);
		expect(slot1?.matchId).toBe(stage.matchM);
		expect(slot1?.activeSessionId).toBe(first!.promotedSlot.activeSessionId);
		expect(await assignmentsOf(stage)).toEqual([
			expect.objectContaining({ id: first!.assignment.id, slotId: stage.slot1, matchId: stage.matchM }),
		]);
	});

	it('lets a promotion that read the committed one move the Match on, answering the first as lost', async () => {
		const stage = await stageEvent();

		let mover: Awaited<ReturnType<typeof promote>> | undefined;
		afterNextBatch = async () => {
			mover = await promote(stage, stage.slot1, stage.matchM);
		};

		await expect(promote(stage, stage.slot2, stage.matchM)).rejects.toMatchObject({ statusCode: 409 });

		expect(mover?.promotedSlot).toMatchObject({ id: stage.slot1, matchId: stage.matchM });
		expect(mover?.clearedSlots).toEqual([expect.objectContaining({ id: stage.slot2, matchId: null })]);
		const slot2 = await slotRow(stage.slot2);
		expect(slot2?.matchId).toBeNull();
		const clearedSession = await db.query.featureMatchSessions.findFirst({
			where: (sessions, { eq }) => eq(sessions.id, slot2!.activeSessionId!),
		});
		expect(clearedSession).toMatchObject({ status: 'active', sequence: 1 });
		expect(clearedSession?.sourceSnapshot.matchId).toBeNull();
		expect(await assignmentsOf(stage)).toEqual([
			expect.objectContaining({ slotId: stage.slot1, matchId: stage.matchM }),
		]);
	});
});

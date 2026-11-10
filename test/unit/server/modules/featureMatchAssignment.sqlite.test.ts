import type { FeatureMatchAssignmentResponse } from '~~/shared/api';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * Every client's Assignment list follows these messages alone: a save announces
 * `created` or `updated` by whether the Match was already assigned in the Round,
 * and `deleted` for the Assignment it displaced from the Slot.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const publishMessage = vi.fn(async (..._message: unknown[]) => {});

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage,
	publishMessageStrict: publishMessage,
	publishScreenCommand: async () => {},
}));

const { featureMatchAssignmentModule } = await import('~~/server/modules/feature-match-assignment');
const { featureMatchService } = await import('~~/server/services/featureMatch');
const { matchWriteModule } = await import('~~/server/modules/match-write');

afterAll(async () => await harness.close());

const ORIGIN = 'origin-1';

type SlotKey = 'slot1' | 'slot2';
type MatchKey = 'matchM' | 'matchN';
type Placement = readonly [slot: SlotKey, match: MatchKey];

async function stageRound() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Assignment Open', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning();
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss', sortOrder: 0 }).returning();
	const [round] = await db.insert(schema.rounds)
		.values({
			eventId,
			phaseId: phase!.id,
			name: 'Round 1',
			roundNumber: 1,
		})
		.returning();
	const [matchM, matchN] = await db.insert(schema.matches).values([
		{
			eventId,
			roundId: round!.id,
			tableNumber: 1,
			sortOrder: 0,
		},
		{
			eventId,
			roundId: round!.id,
			tableNumber: 2,
			sortOrder: 1,
		},
	]).returning();
	const slots = featureMatchService();
	const slot1 = await slots.create(eventId, {});
	const slot2 = await slots.create(eventId, {});

	const stage = {
		eventId,
		roundId: round!.id,
		matchM: matchM!.id,
		matchN: matchN!.id,
		slot1: slot1.id,
		slot2: slot2.id,
	};
	async function save([slot, match]: Placement) {
		return await featureMatchAssignmentModule().save(
			eventId,
			{ roundId: stage.roundId, slotId: stage[slot], matchId: stage[match] },
			ORIGIN,
		);
	}
	return { ...stage, save };
}

/** Stages a Round holding `held`; only what is announced after that is under test. */
async function stageRoundHolding(held: readonly Placement[]) {
	const stage = await stageRound();
	const assignments: FeatureMatchAssignmentResponse[] = [];
	for (const placement of held)
		assignments.push(await stage.save(placement));
	publishMessage.mockClear();
	return { stage, held: assignments };
}

function announced(eventId: number, type: 'created' | 'updated', assignment: FeatureMatchAssignmentResponse) {
	return [
		eventId,
		`featureMatchAssignment:${type}`,
		{ featureMatchAssignment: assignment },
		ORIGIN,
	];
}

function announcedDeleted(eventId: number, assignmentId: number) {
	return [
		eventId,
		'featureMatchAssignment:deleted',
		{ featureMatchAssignmentId: assignmentId },
		ORIGIN,
	];
}

describe('a Feature Match Assignment', () => {
	it.each([
		{
			saving: 'a Match new to the Round into an empty Slot',
			held: [],
			placement: ['slot1', 'matchM'],
			announces: 'created',
			displaces: null,
		},
		{
			saving: 'the Match its Slot already holds',
			held: [
				['slot1', 'matchM'],
			],
			placement: ['slot1', 'matchM'],
			announces: 'updated',
			displaces: null,
		},
		{
			saving: 'a Match new to the Round over the one its Slot holds',
			held: [
				['slot1', 'matchM'],
			],
			placement: ['slot1', 'matchN'],
			announces: 'created',
			displaces: 0,
		},
		{
			saving: 'a Match moved onto the Slot another Match holds',
			held: [
				['slot1', 'matchM'],
				['slot2', 'matchN'],
			],
			placement: ['slot2', 'matchM'],
			announces: 'updated',
			displaces: 1,
		},
	] as const)('saving $saving announces it $announces', async ({ held: placements, placement, announces, displaces }) => {
		const { stage, held } = await stageRoundHolding(placements);

		const saved = await stage.save(placement);

		expect(saved).toMatchObject({ slotId: stage[placement[0]], matchId: stage[placement[1]] });
		expect(publishMessage.mock.calls).toEqual([
			announced(stage.eventId, announces, saved),
			...(displaces === null
				? []
				: [
						announcedDeleted(stage.eventId, held[displaces]!.id),
					]),
		]);
	});

	it('announces an edited Note as the stored Assignment', async () => {
		const { stage, held } = await stageRoundHolding([
			['slot1', 'matchM'],
		]);

		const updated = await featureMatchAssignmentModule().update(stage.eventId, held[0]!.id, { note: 'Camera two' }, ORIGIN);

		expect(updated).toMatchObject({ id: held[0]!.id, note: 'Camera two' });
		expect(publishMessage.mock.calls).toEqual([
			announced(stage.eventId, 'updated', updated),
		]);
	});

	it('announces a removed Assignment by id', async () => {
		const { stage, held } = await stageRoundHolding([
			['slot1', 'matchM'],
		]);

		await featureMatchAssignmentModule().remove(stage.eventId, held[0]!.id, ORIGIN);

		expect(publishMessage.mock.calls).toEqual([
			announcedDeleted(stage.eventId, held[0]!.id),
		]);
	});

	// Deleting a Match drops its Assignment and unlinks the Slot showing it:
	// every client is told of both, the deleting one included.
	it('announces the Assignment and the Slot a deleted Match takes with it', async () => {
		const { stage, held } = await stageRoundHolding([
			['slot1', 'matchM'],
		]);
		await db.update(schema.featureMatches).set({ matchId: stage.matchM }).where(eq(schema.featureMatches.id, stage.slot1));

		await matchWriteModule().remove({ eventId: stage.eventId, matchId: stage.matchM, originConnectionId: ORIGIN });

		expect(publishMessage.mock.calls).toEqual([
			[
				stage.eventId,
				'match:deleted',
				{ matchId: stage.matchM },
				ORIGIN,
			],
			[
				stage.eventId,
				'featureMatch:updated',
				{
					featureMatch: expect.objectContaining({ id: stage.slot1, matchId: null }),
				},
				undefined,
			],
			[
				stage.eventId,
				'featureMatchAssignment:deleted',
				{ featureMatchAssignmentId: held[0]!.id },
				undefined,
			],
		]);
	});

	it.each([
		[
			'an edit',
			async (eventId: number) => await featureMatchAssignmentModule().update(eventId, 999_999, { note: 'Ghost' }, ORIGIN),
		],
		[
			'a removal',
			async (eventId: number) => await featureMatchAssignmentModule().remove(eventId, 999_999, ORIGIN),
		],
	])('announces nothing for %s of an Assignment the Event does not hold', async (_case, act) => {
		const { stage } = await stageRoundHolding([]);

		await expect(act(stage.eventId)).rejects.toMatchObject({ statusCode: 404 });
		expect(publishMessage).not.toHaveBeenCalled();
	});
});

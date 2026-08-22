import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Cross-Event scoping proofs for the tournament-structure CRUD services (#468).
 *
 * The chainable db mock these services' unit tests run on verifies that a query
 * ran, not what its predicate was — a missing `eq(<table>.eventId, …)` still
 * passes there. These suites run the same reads against real SQL holding two
 * Events' data arranged to collide on every non-Event predicate (same external
 * ids, same round numbers, same foreign keys), so a read that loses its Event
 * scope returns the other Event's row and fails the assertion.
 *
 * Every "wrong Event" probe passes Event 1's id against Event 2's row on
 * purpose: scoped, that read finds nothing; unscoped, it finds the foreign row.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('hub:db', () => ({ db }));

const { phaseService } = await import('~~/server/services/phase');
const { roundService } = await import('~~/server/services/round');
const { matchService, buildMatchPromotionPlan } = await import('~~/server/services/match');
const { featureMatchAssignmentService } = await import('~~/server/services/featureMatchAssignment');
const { playerRoundStandingsService } = await import('~~/server/services/playerRoundStandings');

interface SeededEvent {
	eventId: number;
	phaseId: number;
	roundId: number;
	matchId: number;
	playerId: number;
	slotId: number;
	assignmentId: number;
}

async function seedEvent(name: string, sortOrder: number): Promise<SeededEvent> {
	const [event] = await db.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;

	// Identical external identities and round numbers in both Events: every
	// predicate except the Event scope matches both rows.
	const [phase] = await db.insert(schema.phases)
		.values({ eventId, name: `${name} Swiss`, sortOrder, externalId: 'phase-shared', externalSource: 'melee' })
		.returning({ id: schema.phases.id });
	const [round] = await db.insert(schema.rounds)
		.values({ eventId, phaseId: phase!.id, name: 'Round 1', roundNumber: 1, externalId: 'round-shared', externalSource: 'melee' })
		.returning({ id: schema.rounds.id });
	const [player] = await db.insert(schema.players)
		.values({ eventId, name: `${name} Player` })
		.returning({ id: schema.players.id });
	const [match] = await db.insert(schema.matches)
		.values({ eventId, roundId: round!.id, externalId: 'match-shared', externalSource: 'melee', sortOrder, player1Id: player!.id })
		.returning({ id: schema.matches.id });
	const [slot] = await db.insert(schema.featureMatches)
		.values({ eventId, externalId: 'match-shared', externalSource: 'melee' })
		.returning({ id: schema.featureMatches.id });
	const [assignment] = await db.insert(schema.featureMatchAssignments)
		.values({ eventId, roundId: round!.id, slotId: slot!.id, matchId: match!.id, note: `${name} note` })
		.returning({ id: schema.featureMatchAssignments.id });
	await db.insert(schema.playerRoundStandings)
		.values({ eventId, playerId: player!.id, roundId: round!.id, wins: sortOrder, position: 1 });

	return {
		eventId,
		phaseId: phase!.id,
		roundId: round!.id,
		matchId: match!.id,
		playerId: player!.id,
		slotId: slot!.id,
		assignmentId: assignment!.id,
	};
}

let one: SeededEvent;
let two: SeededEvent;

beforeAll(async () => {
	one = await seedEvent('Event One', 1);
	// Event 2 carries the higher sort orders, so an unscoped max() aggregate
	// answers with its values rather than Event 1's.
	two = await seedEvent('Event Two', 7);
});

afterAll(async () => await harness.close());

describe('phaseService event scoping', () => {
	it('point reads with the wrong Event find nothing', async () => {
		const service = phaseService();
		expect(await service.findById(two.phaseId, one.eventId)).toBeUndefined();
		expect(await service.exists(two.phaseId, one.eventId)).toBe(false);
	});

	it('resolves a shared external identity to the asking Event\'s row', async () => {
		const service = phaseService();
		expect((await service.findByExternalId(one.eventId, 'phase-shared', 'melee'))?.id).toBe(one.phaseId);
		expect((await service.findByExternalId(two.eventId, 'phase-shared', 'melee'))?.id).toBe(two.phaseId);
	});

	it('lists and aggregates only the asking Event', async () => {
		const service = phaseService();
		expect((await service.findByEventId(one.eventId)).map(phase => phase.id)).toEqual([one.phaseId]);
		expect(await service.getMaxSortOrder(one.eventId)).toBe(1);
	});

	it('writes with the wrong Event touch nothing', async () => {
		const service = phaseService();
		expect(await service.update(two.phaseId, one.eventId, { name: 'Hijacked' })).toBeUndefined();
		expect(await service.remove(two.phaseId, one.eventId)).toBe(false);
		expect((await phaseService().findById(two.phaseId, two.eventId))?.name).toBe('Event Two Swiss');
	});
});

describe('roundService event scoping', () => {
	it('point reads with the wrong Event find nothing', async () => {
		const service = roundService();
		expect(await service.findById(two.roundId, one.eventId)).toBeUndefined();
		expect(await service.exists(two.roundId, one.eventId)).toBe(false);
	});

	it('scopes phase-keyed reads to the Event as well as the phase', async () => {
		const service = roundService();
		expect(await service.findByPhaseId(two.phaseId, one.eventId)).toEqual([]);
	});

	it('resolves a shared external identity to the asking Event\'s row', async () => {
		const service = roundService();
		expect((await service.findByExternalId(one.eventId, 'round-shared', 'melee'))?.id).toBe(one.roundId);
		expect((await service.findByExternalId(two.eventId, 'round-shared', 'melee'))?.id).toBe(two.roundId);
	});

	it('lists only the asking Event', async () => {
		const service = roundService();
		expect((await service.findByEventId(one.eventId)).map(round => round.id)).toEqual([one.roundId]);
	});

	it('writes with the wrong Event touch nothing', async () => {
		const service = roundService();
		expect(await service.update(two.roundId, one.eventId, { name: 'Hijacked' })).toBeUndefined();
		expect(await service.remove(two.roundId, one.eventId)).toBe(false);
		expect((await roundService().findById(two.roundId, two.eventId))?.name).toBe('Round 1');
	});
});

describe('matchService event scoping', () => {
	it('point reads with the wrong Event find nothing', async () => {
		const service = matchService();
		expect(await service.findById(two.matchId, one.eventId)).toBeUndefined();
		expect(await service.exists(two.matchId, one.eventId)).toBe(false);
	});

	it('scopes round-keyed reads and aggregates to the Event', async () => {
		const service = matchService();
		expect(await service.findByRoundId(one.eventId, two.roundId)).toEqual([]);
	});

	it('lists only the asking Event', async () => {
		const service = matchService();
		expect((await service.findByEventId(one.eventId)).map(match => match.id)).toEqual([one.matchId]);
	});

	it('writes with the wrong Event touch nothing', async () => {
		const service = matchService();
		expect(await service.update(two.matchId, one.eventId, { tableNumber: 99 })).toBeUndefined();
		expect(await service.remove(two.matchId, one.eventId)).toBe(false);
		expect(await matchService().exists(two.matchId, two.eventId)).toBe(true);
	});
});

describe('buildMatchPromotionPlan event scoping', () => {
	it('never clears another Event\'s Slot holding the same external identity', async () => {
		const match = await matchService().findById(one.matchId, one.eventId);
		const slotOne = (await db.query.featureMatches.findFirst({ where: (table, { eq }) => eq(table.id, one.slotId) }))!;

		// Event 2's Slot advertises the identical externalId/externalSource pair.
		const plan = await buildMatchPromotionPlan(one.eventId, one.slotId, match!, slotOne);
		expect(plan.clearedSlots.map(slot => slot.id)).not.toContain(two.slotId);
		expect(plan.promotedSlot.id).toBe(one.slotId);
	});
});

describe('featureMatchAssignmentService event scoping', () => {
	it('point reads with the wrong Event find nothing', async () => {
		const service = featureMatchAssignmentService();
		expect(await service.findById(one.eventId, two.assignmentId)).toBeUndefined();
		expect(await service.findByRoundAndSlot(one.eventId, two.roundId, two.slotId)).toBeUndefined();
		expect(await service.findByRoundAndMatch(one.eventId, two.roundId, two.matchId)).toBeUndefined();
	});

	it('round listings stay inside the asking Event', async () => {
		const service = featureMatchAssignmentService();
		expect(await service.findByRound(one.eventId, two.roundId)).toEqual([]);
		expect((await service.findByRound(two.eventId, two.roundId)).map(assignment => assignment.id)).toEqual([two.assignmentId]);
	});

	it('writes with the wrong Event touch nothing', async () => {
		const service = featureMatchAssignmentService();
		expect(await service.update(one.eventId, two.assignmentId, { note: 'Hijacked' })).toBeUndefined();
		expect(await service.remove(one.eventId, two.assignmentId)).toBe(false);
		expect((await service.findById(two.eventId, two.assignmentId))?.note).toBe('Event Two note');
	});
});

describe('playerRoundStandingsService event scoping', () => {
	it('round standings stay inside the asking Event', async () => {
		const service = playerRoundStandingsService();
		expect(await service.findByRoundId(one.eventId, two.roundId)).toEqual([]);
		const own = await service.findByRoundId(two.eventId, two.roundId);
		expect(own.map(standing => standing.playerId)).toEqual([two.playerId]);
	});
});

import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Route guards refuse a reference into another Event as not found. Screen Mode
// references are proved per declared field in screenModeEventReferences.sqlite.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const guards = await import('~~/server/utils/routeGuards');

interface Seeded {
	eventId: number;
	phaseId: number;
	roundId: number;
	otherRoundId: number;
	matchId: number;
	slotId: number;
	playerId: number;
	listId: number;
	talentId: number;
	archetypeId: number;
}

async function seed(name: string): Promise<Seeded> {
	const [event] = await db.insert(schema.events).values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' }).returning();
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss' }).returning();
	const [round, otherRound] = await db.insert(schema.rounds)
		.values([
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
		])
		.returning();
	const [match] = await db.insert(schema.matches).values({ eventId, roundId: round!.id }).returning();
	const [slot] = await db.insert(schema.featureMatches).values({ eventId }).returning();
	const [player] = await db.insert(schema.players).values({ eventId, name: 'Player' }).returning();
	const [list] = await db.insert(schema.playerLists).values({ eventId, name: 'List' }).returning();
	const [talent] = await db.insert(schema.eventTalents).values({ eventId, name: 'Talent' }).returning();
	const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: 'Burn' }).returning();
	return {
		eventId,
		phaseId: phase!.id,
		roundId: round!.id,
		otherRoundId: otherRound!.id,
		matchId: match!.id,
		slotId: slot!.id,
		playerId: player!.id,
		listId: list!.id,
		talentId: talent!.id,
		archetypeId: archetype!.id,
	};
}

let own: Seeded;
let foreign: Seeded;

beforeAll(async () => {
	own = await seed('Own');
	foreign = await seed('Foreign');
});

afterAll(async () => await harness.close());

describe('single-reference guards', () => {
	it.each([
		['requirePhaseInEvent', 'phaseId', 'Phase not found'],
		['requireRoundInEvent', 'roundId', 'Round not found'],
		['requireMatchInEvent', 'matchId', 'Match not found'],
		['requireFeatureMatchSlotInEvent', 'slotId', 'Feature match slot not found'],
		['requirePlayerListInEvent', 'listId', 'Player list not found'],
		['requireTalentInEvent', 'talentId', 'Talent not found'],
		['requireArchetypeInEvent', 'archetypeId', 'Archetype not found'],
	] as const)('%s admits its own Event\'s %s and nothing, and refuses another Event\'s as 404', async (guard, key, message) => {
		const check = guards[guard];

		await expect(check(own.eventId, own[key])).resolves.toBeUndefined();
		await expect(check(own.eventId, null)).resolves.toBeUndefined();
		await expect(check(own.eventId, foreign[key])).rejects.toMatchObject({ statusCode: 404, message });
	});

	it('requirePlayersInEvent refuses the set when any Player is another Event\'s', async () => {
		await expect(guards.requirePlayersInEvent(own.eventId, [own.playerId, own.playerId, null])).resolves.toBeUndefined();
		await expect(guards.requirePlayersInEvent(own.eventId, [own.playerId, foreign.playerId])).rejects.toMatchObject({ statusCode: 404, message: 'Player not found' });
	});
});

describe('validateFeatureMatchReferences', () => {
	it('checks the Match and both Players', async () => {
		await expect(guards.validateFeatureMatchReferences(own.eventId, { matchId: own.matchId, player1Id: own.playerId, player2Id: null })).resolves.toBeUndefined();
		await expect(guards.validateFeatureMatchReferences(own.eventId, { matchId: foreign.matchId })).rejects.toMatchObject({ statusCode: 404 });
		await expect(guards.validateFeatureMatchReferences(own.eventId, { player2Id: foreign.playerId })).rejects.toMatchObject({ statusCode: 404 });
	});
});

describe('validateFeatureMatchAssignmentCreateReferences', () => {
	it('admits a Slot and a Match of the named Round', async () => {
		await expect(guards.validateFeatureMatchAssignmentCreateReferences(own.eventId, { roundId: own.roundId, slotId: own.slotId, matchId: own.matchId })).resolves.toBeUndefined();
	});

	it.each([
		[
			'another Event\'s Round',
			() => ({ roundId: foreign.roundId, slotId: own.slotId, matchId: own.matchId }),
			{ statusCode: 404, message: 'Round not found' },
		],
		[
			'another Event\'s Slot',
			() => ({ roundId: own.roundId, slotId: foreign.slotId, matchId: own.matchId }),
			{ statusCode: 404, message: 'Feature match slot not found' },
		],
		[
			'another Event\'s Match',
			() => ({ roundId: own.roundId, slotId: own.slotId, matchId: foreign.matchId }),
			{ statusCode: 404, message: 'Match not found' },
		],
		[
			'a Match of another Round',
			() => ({ roundId: own.otherRoundId, slotId: own.slotId, matchId: own.matchId }),
			{ statusCode: 400, message: 'Match does not belong to round' },
		],
	])('refuses %s', async (_case, input, refusal) => {
		await expect(guards.validateFeatureMatchAssignmentCreateReferences(own.eventId, input())).rejects.toMatchObject(refusal);
	});
});

import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Phase's Top Cut bracket as the Top Cut Bracket Screen Mode renders it (#752), read
 * against real SQLite so the Event scoping, the Round order and each side's
 * current Player name are the query's, not a mock's.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const { findPhaseBracket } = await import('~~/server/services/topCutBracket');

let eventId: number;
let topCutId: number;
let swissId: number;
let foreignPhaseId: number;
let quarterfinalsId: number;
let semifinalsId: number;
const playerIds: number[] = [];

beforeAll(async () => {
	const [event, otherEvent] = await db.insert(schema.events).values([
		{ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		{ name: 'Other Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
	]).returning({ id: schema.events.id });
	eventId = event!.id;

	const [swiss, topCut, foreignPhase] = await db.insert(schema.phases).values([
		{ eventId, name: 'Swiss', sortOrder: 0 },
		{ eventId, name: 'Top 8', sortOrder: 1 },
		{ eventId: otherEvent!.id, name: 'Top 8' },
	]).returning({ id: schema.phases.id });
	swissId = swiss!.id;
	topCutId = topCut!.id;
	foreignPhaseId = foreignPhase!.id;

	// Inserted out of Round order, so the order is the read's.
	const [semifinals, quarterfinals, swissRound] = await db.insert(schema.rounds).values([
		{
			eventId,
			phaseId: topCutId,
			name: 'Semifinals',
			roundNumber: 2,
		},
		{
			eventId,
			phaseId: topCutId,
			name: 'Quarterfinals',
			roundNumber: 1,
		},
		{
			eventId,
			phaseId: swissId,
			name: 'Round 1',
			roundNumber: 1,
		},
	]).returning({ id: schema.rounds.id });
	semifinalsId = semifinals!.id;
	quarterfinalsId = quarterfinals!.id;

	const [archetype] = await db.insert(schema.archetypes)
		.values({ eventId, name: 'Izzet Prowess', colors: 'UR' })
		.returning({ id: schema.archetypes.id });

	// Seed 1's Archetype is assigned; Seed 2's deck is named only by their Deck List.
	const players = await db.insert(schema.players).values(
		Array.from({ length: 8 }, (_, index) => ({
			eventId,
			name: `Seed ${index + 1}`,
			archetypeId: index === 0
				? archetype!.id
				: null,
			gameData: index === 1
				? { type: 'mtg' as const, deckName: 'Mono-Green Landfall', deckColors: 'G' }
				: null,
		})),
	).returning({ id: schema.players.id });
	playerIds.push(...players.map(row => row.id));
	const seed = (n: number) => playerIds[n - 1]!;

	await db.insert(schema.matches).values([
		{
			eventId,
			roundId: quarterfinalsId,
			tableNumber: 2,
			player1Id: seed(4),
			player2Id: seed(5),
			hasResult: true,
			player1GameWins: 0,
			player2GameWins: 2,
		},
		{
			eventId,
			roundId: quarterfinalsId,
			tableNumber: 1,
			player1Id: seed(1),
			player2Id: seed(8),
			player1Data: { name: 'Stale Seed 1' },
			hasResult: true,
			player1GameWins: 2,
			player2GameWins: 1,
		},
		{
			eventId,
			roundId: quarterfinalsId,
			tableNumber: 3,
			player1Id: seed(2),
			player2Id: seed(7),
		},
		// A side no Player of the Event holds, named only by the Match's own record.
		{
			eventId,
			roundId: quarterfinalsId,
			tableNumber: 4,
			player1Id: seed(3),
			player2Data: { name: 'Unlinked Sixth' },
		},
		{
			eventId,
			roundId: semifinalsId,
			tableNumber: 1,
			player1Id: seed(1),
			player2Id: seed(5),
		},
		{
			eventId,
			roundId: swissRound!.id,
			tableNumber: 1,
			player1Id: seed(1),
			player2Id: seed(2),
		},
	]);

	// The last Swiss Round's Round Standings seed the Top 8; Seed 8 has no position
	// there. The Top 8's own Round Standings are not seeds.
	await db.insert(schema.playerRoundStandings).values([
		...[1, 2, 3, 4, 5, 6, 7].map(n => ({
			eventId,
			roundId: swissRound!.id,
			playerId: seed(n),
			position: n,
		})),
		{
			eventId,
			roundId: swissRound!.id,
			playerId: seed(8),
			position: null,
		},
		...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
			eventId,
			roundId: quarterfinalsId,
			playerId: seed(n),
			position: 9 - n,
		})),
	]);
});

afterAll(async () => await harness.close());

describe('findPhaseBracket', () => {
	it('derives the bracket from the Phase\'s Rounds in order and their Matches, each side by its Player\'s current name', async () => {
		const result = await findPhaseBracket(eventId, topCutId);

		expect(result.phase).toMatchObject({ id: topCutId, name: 'Top 8' });
		expect(result.bracket.size).toBe(8);
		expect(result.bracket.columns.map(column => [column.roundId, column.name])).toEqual([
			[quarterfinalsId, 'Quarterfinals'],
			[semifinalsId, 'Semifinals'],
			[null, 'Final'],
		]);
		expect(result.bracket.columns.map(column => column.positions.map(position => position.entrants.map(entrant => entrant?.name ?? null)))).toEqual([
			[
				['Seed 1', 'Seed 8'],
				['Seed 4', 'Seed 5'],
				['Seed 2', 'Seed 7'],
				['Seed 3', 'Unlinked Sixth'],
			],
			[
				['Seed 1', 'Seed 5'],
				[null, null],
			],
			[
				[null, null],
			],
		]);
		expect(result.bracket.columns[0]!.positions[3]!.entrants).toEqual([
			{ playerId: playerIds[2], name: 'Seed 3' },
			{ playerId: null, name: 'Unlinked Sixth' },
		]);
		expect(result.bracket.columns[0]!.positions[0]).toMatchObject({
			status: 'reported',
			winner: 0,
			gameWins: [2, 1],
		});
	});

	it('leaves seeds and Archetypes out unless asked for', async () => {
		const result = await findPhaseBracket(eventId, topCutId);

		const entrants = result.bracket.columns[0]!.positions.flatMap(position => position.entrants);
		expect(entrants.every(entrant => entrant != null && !('seed' in entrant) && !('deck' in entrant))).toBe(true);
	});

	it('seeds each Player by their final position in the last Round Standings before the Phase', async () => {
		const result = await findPhaseBracket(eventId, topCutId, { showSeeds: true });

		expect(result.bracket.columns.map(column => column.positions.map(position => position.entrants.map(entrant => entrant?.seed ?? null)))).toEqual([
			[
				[1, null],
				[4, 5],
				[2, 7],
				[3, null],
			],
			[
				[1, 5],
				[null, null],
			],
			[
				[null, null],
			],
		]);
	});

	it('names each Player\'s Archetype from their assigned Archetype or their Deck List, blank when they have neither', async () => {
		const result = await findPhaseBracket(eventId, topCutId, { showArchetypes: true });

		expect(result.bracket.columns[0]!.positions.map(position => position.entrants.map(entrant => entrant?.deck ?? null))).toEqual([
			[
				{ name: 'Izzet Prowess', colors: 'UR' },
				null,
			],
			[null, null],
			[
				{ name: 'Mono-Green Landfall', colors: 'G' },
				null,
			],
			[null, null],
		]);
	});

	it('has no seeds for a Phase no earlier Round Standings precede', async () => {
		const result = await findPhaseBracket(eventId, swissId, { showSeeds: true });

		expect(result.bracket.columns[0]!.positions[0]!.entrants.map(entrant => entrant?.seed)).toEqual([null, null]);
	});

	it('answers no Phase and an empty bracket for a Phase outside the Event, or one that is gone', async () => {
		for (const phaseId of [foreignPhaseId, 999_999]) {
			expect(await findPhaseBracket(eventId, phaseId)).toEqual({
				phase: null,
				bracket: { size: 0, columns: [], champion: null },
			});
		}
	});
});

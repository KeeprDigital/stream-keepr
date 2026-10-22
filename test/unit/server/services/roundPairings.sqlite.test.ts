import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Round's pairings as the Pairings Screen Mode renders them (#751), read
 * against real SQLite so the Event scoping and the table order are the
 * query's, not a mock's.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const { findRoundPairings } = await import('~~/server/services/roundPairings');

let eventId: number;
let roundId: number;
let otherRoundId: number;
let foreignRoundId: number;
let alice: number;
let bob: number;
let carol: number;

beforeAll(async () => {
	const [event, otherEvent] = await db.insert(schema.events).values([
		{ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		{ name: 'Other Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
	]).returning({ id: schema.events.id });
	eventId = event!.id;

	const [phase, foreignPhase] = await db.insert(schema.phases).values([
		{ eventId, name: 'Swiss' },
		{ eventId: otherEvent!.id, name: 'Swiss' },
	]).returning({ id: schema.phases.id });
	const [round, otherRound, foreignRound] = await db.insert(schema.rounds).values([
		{ eventId, phaseId: phase!.id, name: 'Round 3', roundNumber: 3 },
		{ eventId, phaseId: phase!.id, name: 'Round 4', roundNumber: 4 },
		{ eventId: otherEvent!.id, phaseId: foreignPhase!.id, name: 'Round 3', roundNumber: 3 },
	]).returning({ id: schema.rounds.id });
	roundId = round!.id;
	otherRoundId = otherRound!.id;
	foreignRoundId = foreignRound!.id;

	const ids = await db.insert(schema.players).values([
		{ eventId, name: 'Alice' },
		{ eventId, name: 'Bob' },
		{ eventId, name: 'Carol' },
	]).returning({ id: schema.players.id });
	[alice, bob, carol] = ids.map(row => row.id) as [number, number, number];

	await db.insert(schema.matches).values([
		// Inserted out of table order, and with the bye first, so the order is the read's.
		{ eventId, roundId, tableNumber: null, player1Id: carol, player1Data: { name: 'Carol' }, isBye: true, hasResult: true, player1GameWins: 2, player2GameWins: 0, sortOrder: 0 },
		{ eventId, roundId, tableNumber: 12, player1Id: alice, player2Id: null, player1Data: { name: 'Stale Alice' }, player2Data: { name: 'Unlinked Dave' }, sortOrder: 1 },
		{ eventId, roundId, tableNumber: 2, player1Id: bob, player2Id: alice, player1Data: { name: 'Bob' }, player2Data: { name: 'Alice' }, hasResult: true, player1GameWins: 2, player2GameWins: 1, gameDraws: 1, resultString: 'Bob won 2-1-1', sortOrder: 2 },
		{ eventId, roundId: otherRoundId, tableNumber: 1, player1Id: alice, player2Id: bob, sortOrder: 0 },
	]);
});

afterAll(async () => await harness.close());

describe('findRoundPairings', () => {
	it('lists the Round\'s Matches in table order, byes after every table', async () => {
		const result = await findRoundPairings(eventId, roundId);

		expect(result?.round).toMatchObject({ id: roundId, name: 'Round 3' });
		expect(result?.pairings.map(pairing => pairing.tableNumber)).toEqual([2, 12, null]);
	});

	it('names each side by its Player, or by the Match\'s own record of a side no Player holds', async () => {
		const [table2, table12, bye] = (await findRoundPairings(eventId, roundId))!.pairings;

		expect(table2).toMatchObject({ player1: { id: bob, name: 'Bob' }, player2: { id: alice, name: 'Alice' } });
		expect(table12).toMatchObject({ player1: { id: alice, name: 'Alice' }, player2: { id: null, name: 'Unlinked Dave' } });
		expect(bye).toMatchObject({ player1: { id: carol, name: 'Carol' }, player2: null, isBye: true });
	});

	it('carries each Match\'s result, or none while it is pending', async () => {
		const [table2, table12] = (await findRoundPairings(eventId, roundId))!.pairings;

		expect(table2).toMatchObject({ hasResult: true, player1GameWins: 2, player2GameWins: 1, gameDraws: 1, resultString: 'Bob won 2-1-1' });
		expect(table12).toMatchObject({ hasResult: false, player1GameWins: null, player2GameWins: null });
	});

	it('answers nothing for a Round of another Event', async () => {
		expect(await findRoundPairings(eventId, foreignRoundId)).toBeNull();
	});

	it('answers a Round without Matches as an empty pairings list', async () => {
		const [empty] = await db.insert(schema.rounds).values({ eventId, phaseId: (await db.query.rounds.findFirst())!.phaseId, name: 'Round 5', roundNumber: 5 }).returning({ id: schema.rounds.id });
		expect((await findRoundPairings(eventId, empty!.id))?.pairings).toEqual([]);
	});
});

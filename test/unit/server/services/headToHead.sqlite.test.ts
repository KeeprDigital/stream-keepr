import type { HeadToHeadModeConfig } from '~~/shared/types/screenConfig';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Two Players as the Head-to-head Screen Mode renders them (#760), read
 * against real SQLite so the Event scoping, the Slot's current Feature Match
 * Assignment and the latest Round Standings are the queries', not a mock's.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const { findHeadToHead } = await import('~~/server/services/headToHead');

let eventId: number;
let alice: number;
let bob: number;
let carol: number;
let foreignPlayer: number;
let slotId: number;
let foreignSlotId: number;
let roundFiveMatch: number;
let roundTwoMatch: number;

function config(overrides: Partial<HeadToHeadModeConfig>): HeadToHeadModeConfig {
	return { ...getDefaultConfigForMode('head-to-head'), ...overrides };
}

beforeAll(async () => {
	const [event, otherEvent] = await db.insert(schema.events).values([
		{ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		{ name: 'Other Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
	]).returning({ id: schema.events.id });
	eventId = event!.id;

	const [swiss, topCut] = await db.insert(schema.phases).values([
		{ eventId, name: 'Swiss', sortOrder: 0 },
		{ eventId, name: 'Top 8', sortOrder: 1 },
	]).returning({ id: schema.phases.id });
	const [roundTwo, roundFive, quarterfinal] = await db.insert(schema.rounds).values([
		{ eventId, phaseId: swiss!.id, name: 'Round 2', roundNumber: 2 },
		{ eventId, phaseId: swiss!.id, name: 'Round 5', roundNumber: 5 },
		{ eventId, phaseId: topCut!.id, name: 'Quarterfinal', roundNumber: 1 },
	]).returning({ id: schema.rounds.id });

	const [boros] = await db.insert(schema.archetypes).values([
		{ eventId, name: 'Boros Energy', colors: 'RW' },
	]).returning({ id: schema.archetypes.id });

	const ids = await db.insert(schema.players).values([
		{ eventId, name: 'Alice', pronouns: 'she/her', wins: 1, losses: 0, points: 3, archetypeId: boros!.id },
		{ eventId, name: 'Bob', wins: 5, losses: 1, draws: 1, points: 16, position: 3, gameData: { type: 'mtg', deckName: 'Dimir Murktide', deckColors: 'UB' } },
		{ eventId, name: 'Carol' },
		{ eventId: otherEvent!.id, name: 'Foreign' },
	]).returning({ id: schema.players.id });
	[alice, bob, carol, foreignPlayer] = ids.map(row => row.id) as [number, number, number, number];

	// Alice's latest Round Standings are Round 5's, recorded before Round 2's.
	await db.insert(schema.playerRoundStandings).values([
		{ eventId, playerId: alice, roundId: roundFive!.id, wins: 4, losses: 1, draws: 0, points: 12, position: 5 },
		{ eventId, playerId: alice, roundId: roundTwo!.id, wins: 1, losses: 1, draws: 0, points: 3, position: 40 },
	]);

	const matchIds = await db.insert(schema.matches).values([
		{ eventId, roundId: roundFive!.id, player1Id: alice, player2Id: bob, hasResult: true, player1GameWins: 0, player2GameWins: 2 },
		{ eventId, roundId: roundTwo!.id, player1Id: bob, player2Id: alice, hasResult: true, player1GameWins: 1, player2GameWins: 2, gameDraws: 0 },
		{ eventId, roundId: roundTwo!.id, player1Id: alice, player2Id: carol, hasResult: true, player1GameWins: 2, player2GameWins: 0 },
		// The Match the Slot is following: Alice and Bob meet again.
		{ eventId, roundId: quarterfinal!.id, player1Id: alice, player2Id: bob },
	]).returning({ id: schema.matches.id });
	roundFiveMatch = matchIds[0]!.id;
	roundTwoMatch = matchIds[1]!.id;
	const quarterfinalMatch = matchIds[3]!.id;

	const [slot, foreignSlot] = await db.insert(schema.featureMatchSlots).values([
		{ eventId, matchId: quarterfinalMatch, player1Id: alice, player2Id: bob },
		{ eventId: otherEvent!.id },
	]).returning({ id: schema.featureMatchSlots.id });
	slotId = slot!.id;
	foreignSlotId = foreignSlot!.id;
});

afterAll(async () => await harness.close());

describe('findHeadToHead', () => {
	it('shows the two Players a Feature Match Slot seats, and their earlier meetings but not the Match they are about to play', async () => {
		const answer = await findHeadToHead(eventId, config({ playerSource: 'featureMatchSlot', featureMatchId: slotId }));

		expect(answer).toEqual({
			player1: { id: alice, name: 'Alice', pronouns: 'she/her', wins: 4, losses: 1, draws: 0, points: 12, position: 5, deckName: 'Boros Energy', deckColors: 'RW' },
			player2: { id: bob, name: 'Bob', pronouns: null, wins: 5, losses: 1, draws: 1, points: 16, position: 3, deckName: 'Dimir Murktide', deckColors: 'UB' },
			meetings: [
				{ matchId: roundTwoMatch, roundId: expect.any(Number), roundName: 'Round 2', roundNumber: 2, phaseName: 'Swiss', winnerId: alice, gameScore: '2-1' },
				{ matchId: roundFiveMatch, roundId: expect.any(Number), roundName: 'Round 5', roundNumber: 5, phaseName: 'Swiss', winnerId: bob, gameScore: '0-2' },
			],
		});
	});

	it('follows the Slot to the Players its current Feature Match Assignment seats', async () => {
		await db.update(schema.featureMatchSlots).set({ matchId: null, player1Id: carol, player2Id: alice }).where(eq(schema.featureMatchSlots.id, slotId));
		try {
			const answer = await findHeadToHead(eventId, config({ playerSource: 'featureMatchSlot', featureMatchId: slotId }));

			expect(answer?.player1?.name).toBe('Carol');
			expect(answer?.player2?.name).toBe('Alice');
			expect(answer?.meetings).toEqual([expect.objectContaining({ roundName: 'Round 2', winnerId: alice, gameScore: '0-2' })]);
		}
		finally {
			await db.update(schema.featureMatchSlots).set({ player1Id: alice, player2Id: bob }).where(eq(schema.featureMatchSlots.id, slotId));
		}
	});

	it('shows two Players picked directly, with every reported meeting', async () => {
		const answer = await findHeadToHead(eventId, config({ playerSource: 'players', featureMatchId: slotId, player1Id: bob, player2Id: alice }));

		expect(answer?.player1?.name).toBe('Bob');
		expect(answer?.player2?.name).toBe('Alice');
		expect(answer?.meetings.map(meeting => [meeting.roundName, meeting.gameScore])).toEqual([['Round 2', '1-2'], ['Round 5', '2-0']]);
	});

	it('leaves a side empty when no Player is picked for it, or the Slot seats none', async () => {
		expect(await findHeadToHead(eventId, config({ playerSource: 'players', player1Id: alice })))
			.toEqual({ player1: expect.objectContaining({ name: 'Alice' }), player2: null, meetings: [] });
		expect(await findHeadToHead(eventId, config({ playerSource: 'featureMatchSlot', featureMatchId: null })))
			.toEqual({ player1: null, player2: null, meetings: [] });
	});

	it('reads nothing of another Event', async () => {
		expect(await findHeadToHead(eventId, config({ playerSource: 'featureMatchSlot', featureMatchId: foreignSlotId }))).toBeNull();
		expect(await findHeadToHead(eventId, config({ playerSource: 'players', player1Id: foreignPlayer, player2Id: alice })))
			.toEqual({ player1: null, player2: expect.objectContaining({ name: 'Alice' }), meetings: [] });
	});
});

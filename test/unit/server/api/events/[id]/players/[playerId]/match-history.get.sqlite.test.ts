import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Player's Matches across the Event, each read from that Player's side, beside the
// Player as every other Player read answers them.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: { params: unknown }, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) => Object.assign(new Error(input.message), input));

type Handler = (event: H3Event) => Promise<unknown>;
const readHistory = (await import('~~/server/api/events/[id]/players/[playerId]/match-history.get')).default as unknown as Handler;
const readPlayer = (await import('~~/server/api/events/[id]/players/[playerId]/index.get')).default as unknown as Handler;

afterAll(async () => await harness.close());

async function stageEvent() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

/** A Player as Melee Sync leaves one, with the bookkeeping no Player read answers. */
async function stageImportedPlayer(eventId: number, name: string, values: Partial<typeof schema.players.$inferInsert> = {}) {
	const [player] = await db.insert(schema.players)
		.values({
			eventId,
			name,
			externalId: `melee-${name}`,
			externalSource: 'melee',
			externalStatus: 2,
			isActive: false,
			lastSeenAt: new Date('2026-07-15T00:00:00Z'),
			manuallyEditedFields: ['pronouns'],
			...values,
		})
		.returning({ id: schema.players.id });
	return player!.id;
}

function paramsOf(eventId: number, playerId: number) {
	return {
		params: {
			id: String(eventId),
			playerId: String(playerId),
		},
	};
}

describe('a Player\'s Match history', () => {
	it('answers the Player exactly as the single-Player read does, without Melee\'s bookkeeping', async () => {
		const eventId = await stageEvent();
		const playerId = await stageImportedPlayer(eventId, 'Mia');

		const { player } = await readHistory(stubH3Event(paramsOf(eventId, playerId))) as { player: Record<string, unknown> };

		expect(player).toEqual(await readPlayer(stubH3Event(paramsOf(eventId, playerId))));
		expect(player).toMatchObject({ id: playerId, externalId: 'melee-Mia' });
		for (const bookkeeping of [
			'externalStatus',
			'isActive',
			'lastSeenAt',
			'manuallyEditedFields',
		])
			expect(player).not.toHaveProperty(bookkeeping);
	});

	it('reads each Match from the Player\'s side, oldest Phase first, and names a bye for what it is', async () => {
		const eventId = await stageEvent();
		const mia = await stageImportedPlayer(eventId, 'Mia');
		const rei = await stageImportedPlayer(eventId, 'Rei', {
			gameData: { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' },
		});
		// Staged newest Phase first, so the order answered is the Phases', not the rows'.
		const [topCut, swiss] = await db.insert(schema.phases).values([
			{ eventId, name: 'Top Cut', sortOrder: 1 },
			{ eventId, name: 'Swiss', sortOrder: 0 },
		]).returning({ id: schema.phases.id });
		const [final, opening] = await db.insert(schema.rounds).values([
			{
				eventId,
				phaseId: topCut!.id,
				name: 'Final',
				roundNumber: 1,
			},
			{
				eventId,
				phaseId: swiss!.id,
				name: 'Round 1',
				roundNumber: 1,
			},
		]).returning({ id: schema.rounds.id });
		const [lost, bye] = await db.insert(schema.matches).values([
			{
				eventId,
				roundId: final!.id,
				tableNumber: 1,
				player1Id: rei,
				player2Id: mia,
				hasResult: true,
				player1GameWins: 2,
				player2GameWins: 1,
				gameDraws: 0,
			},
			{
				eventId,
				roundId: opening!.id,
				player1Id: mia,
				isBye: true,
			},
		]).returning({ id: schema.matches.id });

		const { history } = await readHistory(stubH3Event(paramsOf(eventId, mia))) as { history: unknown[] };

		expect(history).toEqual([
			{
				id: bye!.id,
				roundId: opening!.id,
				roundName: 'Round 1',
				roundNumber: 1,
				phaseName: 'Swiss',
				tableNumber: null,
				opponentId: null,
				opponentName: 'BYE',
				opponentDeckName: null,
				opponentDeckColors: null,
				outcome: 'bye',
				playerGameWins: null,
				opponentGameWins: null,
				gameDraws: null,
				hasResult: false,
			},
			{
				id: lost!.id,
				roundId: final!.id,
				roundName: 'Final',
				roundNumber: 1,
				phaseName: 'Top Cut',
				tableNumber: 1,
				opponentId: rei,
				opponentName: 'Rei',
				opponentDeckName: 'Mono Red',
				opponentDeckColors: 'R',
				outcome: 'loss',
				playerGameWins: 1,
				opponentGameWins: 2,
				gameDraws: 0,
				hasResult: true,
			},
		]);
	});

	it('answers 404 for a Player of another Event', async () => {
		const [eventId, otherEventId] = [await stageEvent(), await stageEvent()];
		const playerId = await stageImportedPlayer(otherEventId, 'Kai');

		await expect(readHistory(stubH3Event(paramsOf(eventId, playerId))))
			.rejects
			.toMatchObject({ statusCode: 404, message: 'Player not found' });
	});
});

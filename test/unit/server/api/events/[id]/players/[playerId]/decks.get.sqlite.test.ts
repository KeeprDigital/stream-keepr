import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Player decks read takes its selection from the query string, where every id
// is text. Which deck a selection picks is `playerDeck.sqlite.test.ts`'s.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

interface StubEvent { params: Record<string, string>; query: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('getValidatedQuery', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.query));
vi.stubGlobal('createError', (input: { statusCode?: number; statusMessage?: string }) => Object.assign(new Error(input.statusMessage), input));

type Handler = (event: H3Event) => Promise<{ decks: { id: number }[]; selectedDeckId: number | null }>;
const readDecks = (await import('~~/server/api/events/[id]/players/[playerId]/decks.get')).default as unknown as Handler;

/** A Player whose primary deck is the Swiss format's and whose other deck is the Finals'. */
const staged = {
	eventId: 0,
	playerId: 0,
	decklessId: 0,
	primary: 0,
	finals: 0,
	finalsPhase: 0,
	finalsRound: 0,
};

beforeAll(async () => {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [, finalsPhase] = await db.insert(schema.phases).values([
		{
			eventId,
			name: 'Swiss',
			formatExternalId: 'modern',
			sortOrder: 0,
		},
		{
			eventId,
			name: 'Finals',
			formatExternalId: 'standard',
			sortOrder: 1,
		},
	]).returning({ id: schema.phases.id });
	const [finalsRound] = await db.insert(schema.rounds)
		.values({
			eventId,
			phaseId: finalsPhase!.id,
			name: 'Final',
			roundNumber: 1,
		})
		.returning({ id: schema.rounds.id });
	const [player, deckless] = await db.insert(schema.players)
		.values([
			{ eventId, name: 'Mia' },
			{ eventId, name: 'Deckless' },
		])
		.returning({ id: schema.players.id });
	const [primary, finals] = await db.insert(schema.playerDecks).values([
		{
			eventId,
			playerId: player!.id,
			externalId: 'swiss',
			externalSource: 'melee',
			formatExternalId: 'modern',
			name: 'Burn',
			isPrimary: true,
		},
		{
			eventId,
			playerId: player!.id,
			externalId: 'finals',
			externalSource: 'melee',
			formatExternalId: 'standard',
			name: 'Control',
			isPrimary: false,
		},
	]).returning({ id: schema.playerDecks.id });
	Object.assign(staged, {
		eventId,
		playerId: player!.id,
		decklessId: deckless!.id,
		primary: primary!.id,
		finals: finals!.id,
		finalsPhase: finalsPhase!.id,
		finalsRound: finalsRound!.id,
	});
});

afterAll(async () => await harness.close());

function read(query: Record<string, string>, playerId = staged.playerId) {
	return readDecks(stubH3Event({
		params: {
			id: String(staged.eventId),
			playerId: String(playerId),
		},
		query,
	}));
}

describe('the Player decks read', () => {
	it.each<[string, () => Record<string, string>, () => number]>([
		[
			'the primary deck when the query selects nothing',
			() => ({}),
			() => staged.primary,
		],
		[
			'the deck a deckId names',
			() => ({
				deckId: String(staged.finals),
			}),
			() => staged.finals,
		],
		[
			'the deck in the format of the Phase a phaseId names',
			() => ({
				phaseId: String(staged.finalsPhase),
			}),
			() => staged.finals,
		],
		[
			'the deck in the format of the Round a roundId names',
			() => ({
				roundId: String(staged.finalsRound),
			}),
			() => staged.finals,
		],
	])('selects %s', async (_what, query, selected) => {
		const answer = await read(query());

		expect(answer.selectedDeckId).toBe(selected());
		expect(answer.decks.map(deck => deck.id).toSorted()).toEqual([staged.primary, staged.finals].toSorted());
	});

	// A selection chooses among the Player's decks; it never makes one up.
	it('answers no deck, and selects none, for a Player without decks whatever Phase is selected', async () => {
		expect(await read({
			phaseId: String(staged.finalsPhase),
		}, staged.decklessId)).toEqual({ decks: [], selectedDeckId: null });
	});

	it.each([
		['zero', '0'],
		['a fraction', '1.5'],
		['text that is no number', 'finals'],
	])('refuses a selection naming %s', async (_what, phaseId) => {
		await expect(read({ phaseId })).rejects.toMatchObject({ name: 'ZodError' });
	});

	it('answers 404 for a Player the Event does not hold', async () => {
		await expect(read({}, 999_999)).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Player not found' });
	});
});

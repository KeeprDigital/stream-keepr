import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { meleePlayer } from '~~/test/helpers/meleeFixtures';
import { createScryfallFake, FACE_NAME_COLLISIONS } from '~~/test/helpers/scryfallFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * Melee Sync's Deck List import against real SQL and the real card resolution:
 * only Melee, Scryfall's HTTP API and Ably are stood in for.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const melee = {
	fetchEvent: vi.fn(),
	fetchMergedPlayers: vi.fn(),
	fetchPlayers: vi.fn(),
};

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: () => melee,
}));
vi.doMock('~~/server/utils/ably', () => ({
	getOriginConnectionId: () => 'origin-1',
	publishMessage: vi.fn(),
	publishMessageStrict: vi.fn(),
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: vi.fn(),
}));
vi.stubGlobal('createError', (input: { statusCode: number; message?: string }) =>
	Object.assign(new Error(input.message), input));

const { meleeSyncModule } = await import('~~/server/modules/melee-sync');

afterAll(async () => await harness.close());

const { schemingSilvertongue, signInBlood } = FACE_NAME_COLLISIONS;

function deckRecord(name: string, type: string) {
	return {
		l: name,
		n: name,
		s: null,
		q: 1,
		c: 0,
		t: type,
	};
}

async function mainboardOf(eventId: number) {
	return await db.select({ name: schema.cards.name, quantity: schema.playerDeckCards.quantity })
		.from(schema.playerDeckCards)
		.innerJoin(schema.playerDecks, eq(schema.playerDecks.id, schema.playerDeckCards.deckId))
		.innerJoin(schema.cards, eq(schema.cards.id, schema.playerDeckCards.cardId))
		.where(eq(schema.playerDecks.eventId, eventId))
		.orderBy(asc(schema.playerDeckCards.sortOrder));
}

beforeEach(() => {
	vi.stubGlobal('fetch', createScryfallFake(Object.values(FACE_NAME_COLLISIONS)).fetch);
	melee.fetchEvent.mockResolvedValue({ Name: 'Melee Championship', Game: 'Magic: The Gathering', Phases: [] });
	melee.fetchMergedPlayers.mockResolvedValue([]);
});

describe('importing a Deck List holding a card and another card that has its name as a face', () => {
	// Melee lists the creature first, so its card reaches Scryfall before Sign in Blood.
	it.each([
		'Scheming Silvertongue // Sign in Blood',
		'Scheming Silvertongue',
	])('stores Sign in Blood as its own card beside "%s"', async (creature) => {
		const [event] = await db.insert(schema.events).values({
			name: 'Melee Championship',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			meleeEnabled: true,
			meleeEventId: 'melee-1',
		}).returning({ id: schema.events.id });
		melee.fetchPlayers.mockResolvedValue([
			meleePlayer(1, {
				Decklists: [
					{
						Guid: 'deck-1',
						FormatId: 'standard',
						DecklistName: 'Rakdos',
						Records: [
							deckRecord(creature, 'Creature'),
							deckRecord('Sign in Blood', 'Sorcery'),
						],
						Attributes: [],
					},
				],
			}),
		]);

		await meleeSyncModule().syncDeckLists(stubH3Event(), event!.id);

		expect(await mainboardOf(event!.id)).toEqual([
			{ name: schemingSilvertongue.name, quantity: 1 },
			{ name: signInBlood.name, quantity: 1 },
		]);
	});
});

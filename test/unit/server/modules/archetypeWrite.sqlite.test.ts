import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const publication = {
	archetypeCreated: vi.fn(async (input: { entity: unknown }) => input.entity),
	archetypeUpdated: vi.fn(async (input: { entity: unknown; keyCards: unknown }) => ({ entity: input.entity, keyCards: input.keyCards })),
	archetypeDeleted: vi.fn(),
	archetypeKeyCardsUpdated: vi.fn(),
};
const playerUpdates = {
	reconcileDeckProjections: vi.fn(),
	publishPlayerSnapshotUpdates: vi.fn(),
};

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => publication,
}));
vi.doMock('~~/server/modules/player-update', () => ({
	playerUpdateModule: () => playerUpdates,
}));
vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage), { statusCode: input.statusCode }));

const { archetypeWriteModule } = await import('~~/server/modules/archetype-write');

afterAll(async () => await harness.close());

async function createEvent(game: 'mtg' | 'op' = 'mtg') {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Archetype Open', game, featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

async function createArchetype(eventId: number, name = 'Izzet Phoenix') {
	const [archetype] = await db.insert(schema.archetypes).values({ eventId, name }).returning();
	return archetype!;
}

/** The card catalogue is global, so a name another test already added is reused. */
async function createCard(name: string, game: 'mtg' | 'op' = 'mtg') {
	await db.insert(schema.cards).values({ name, game }).onConflictDoNothing();
	const [card] = await db.select({ id: schema.cards.id }).from(schema.cards).where(and(eq(schema.cards.name, name), eq(schema.cards.game, game)));
	return card!.id;
}

let deckSequence = 0;
async function createReviewedDeck(eventId: number, archetypeId: number, isPrimary: boolean) {
	const [player] = await db.insert(schema.players).values({ eventId, name: `Player ${++deckSequence}` }).returning({ id: schema.players.id });
	const [deck] = await db.insert(schema.playerDecks).values({
		eventId,
		playerId: player!.id,
		externalId: `deck-${deckSequence}`,
		externalSource: 'melee',
		formatExternalId: 'modern',
		name: 'Deck',
		isPrimary,
		archetypeId,
		reviewedAt: new Date('2026-10-01T00:00:00.000Z'),
	}).returning();
	return { playerId: player!.id, deckId: deck!.id };
}

async function keyCardNames(archetypeId: number) {
	const rows = await db.select({ name: schema.cards.name })
		.from(schema.archetypeCards)
		.innerJoin(schema.cards, eq(schema.cards.id, schema.archetypeCards.cardId))
		.where(eq(schema.archetypeCards.archetypeId, archetypeId))
		.orderBy(schema.archetypeCards.sortOrder);
	return rows.map(row => row.name);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('deleting an Archetype', () => {
	it('clears every deck review that named it in the same commit that removes it', async () => {
		const eventId = await createEvent();
		const archetype = await createArchetype(eventId);
		const primary = await createReviewedDeck(eventId, archetype.id, true);
		const secondary = await createReviewedDeck(eventId, archetype.id, false);

		await expect(archetypeWriteModule().deleteArchetype({ eventId, archetypeId: archetype.id, originConnectionId: 'origin-1' }))
			.resolves
			.toEqual({ success: true });

		expect(await db.select().from(schema.archetypes).where(eq(schema.archetypes.id, archetype.id))).toEqual([]);
		const decks = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.eventId, eventId));
		expect(decks.map(deck => [deck.archetypeId, deck.reviewedAt])).toEqual([
			[null, null],
			[null, null],
		]);
		// A primary deck feeds the Player's projection; a secondary one only their snapshot.
		expect(playerUpdates.reconcileDeckProjections).toHaveBeenCalledWith(expect.objectContaining({
			playerIds: [primary.playerId],
		}));
		expect(playerUpdates.publishPlayerSnapshotUpdates).toHaveBeenCalledWith(expect.objectContaining({
			playerIds: [secondary.playerId],
		}));
		expect(publication.archetypeDeleted).toHaveBeenCalledWith({ eventId, id: archetype.id, originConnectionId: 'origin-1' });
	});

	it('refuses an Archetype another Event owns, leaving its reviews in place', async () => {
		const eventId = await createEvent();
		const otherEventId = await createEvent();
		const archetype = await createArchetype(otherEventId);
		await createReviewedDeck(otherEventId, archetype.id, true);

		await expect(archetypeWriteModule().deleteArchetype({ eventId, archetypeId: archetype.id }))
			.rejects
			.toMatchObject({ statusCode: 404 });

		const [deck] = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.eventId, otherEventId));
		expect(deck?.archetypeId).toBe(archetype.id);
		expect(publication.archetypeDeleted).not.toHaveBeenCalled();
	});
});

describe('updating an Archetype', () => {
	it('re-projects the decks reviewed as it and answers with its key cards', async () => {
		const eventId = await createEvent();
		const archetype = await createArchetype(eventId);
		const primary = await createReviewedDeck(eventId, archetype.id, true);
		await db.insert(schema.archetypeCards).values({ archetypeId: archetype.id, cardId: await createCard('Arclight Phoenix') });

		const result = await archetypeWriteModule().updateArchetype({
			eventId,
			archetypeId: archetype.id,
			input: { name: 'Izzet Arclight' },
		});

		expect(result).toMatchObject({
			entity: { name: 'Izzet Arclight' },
			keyCards: [
				{ name: 'Arclight Phoenix' },
			],
		});
		expect(playerUpdates.reconcileDeckProjections).toHaveBeenCalledWith(expect.objectContaining({
			playerIds: [primary.playerId],
		}));
	});

	it('refuses an Archetype the Event does not hold', async () => {
		const eventId = await createEvent();

		await expect(archetypeWriteModule().updateArchetype({
			eventId,
			archetypeId: 999_999,
			input: { name: 'Ghost' },
		}))
			.rejects
			.toMatchObject({ statusCode: 404 });
		expect(publication.archetypeUpdated).not.toHaveBeenCalled();
	});
});

describe('setting an Archetype\'s key cards', () => {
	it('resolves card names case-insensitively, keeps their order, and publishes them', async () => {
		const eventId = await createEvent();
		const archetype = await createArchetype(eventId);
		await createCard('Arclight Phoenix');
		await createCard('Thing in the Ice');

		const { keyCards } = await archetypeWriteModule().updateCards({
			eventId,
			archetypeId: archetype.id,
			input: {
				cardNames: ['thing in the ice', 'ARCLIGHT PHOENIX'],
			},
		});

		expect(keyCards.map(card => card.name)).toEqual(['Thing in the Ice', 'Arclight Phoenix']);
		expect(await keyCardNames(archetype.id)).toEqual(['Thing in the Ice', 'Arclight Phoenix']);
		expect(publication.archetypeKeyCardsUpdated).toHaveBeenCalledWith(expect.objectContaining({ archetypeId: archetype.id, keyCards }));
	});

	it('replaces the key cards with explicit card ids, and clears them with an empty list', async () => {
		const eventId = await createEvent();
		const archetype = await createArchetype(eventId);
		const phoenix = await createCard('Arclight Phoenix');
		await db.insert(schema.archetypeCards).values({ archetypeId: archetype.id, cardId: await createCard('Lightning Bolt') });

		await archetypeWriteModule().updateCards({
			eventId,
			archetypeId: archetype.id,
			input: {
				cardIds: [phoenix],
			},
		});
		expect(await keyCardNames(archetype.id)).toEqual(['Arclight Phoenix']);

		await archetypeWriteModule().updateCards({
			eventId,
			archetypeId: archetype.id,
			input: { cardIds: [] },
		});
		expect(await keyCardNames(archetype.id)).toEqual([]);
	});

	describe('refuses, leaving the key cards unchanged,', () => {
		it.each([
			[
				'an unknown card name',
				async () => ({
					cardNames: ['Nonexistent Card'],
				}),
				/Unknown MTG card/,
			],
			[
				'a name two catalogue cards share but for case',
				async () => {
					await createCard('Fire // Ice');
					await createCard('fire // ice');
					return {
						cardNames: ['FIRE // ICE'],
					};
				},
				/Ambiguous MTG card name/,
			],
			[
				'the same name twice',
				async () => {
					await createCard('Opt');
					return {
						cardNames: ['Opt', 'opt'],
					};
				},
				/Duplicate card names/,
			],
			[
				'the same card id twice',
				async () => {
					const opt = await createCard('Consider');
					return {
						cardIds: [opt, opt],
					};
				},
				/Duplicate card IDs/,
			],
			[
				'a card id from another game\'s catalogue',
				async () => ({
					cardIds: [await createCard('Luffy', 'op')],
				}),
				/do not reference MTG cards/,
			],
		])('%s', async (_label, arrange, message) => {
			const eventId = await createEvent();
			const archetype = await createArchetype(eventId);
			const kept = await createCard(`Kept ${archetype.id}`);
			await db.insert(schema.archetypeCards).values({ archetypeId: archetype.id, cardId: kept });
			const input = await arrange();

			await expect(archetypeWriteModule().updateCards({ eventId, archetypeId: archetype.id, input }))
				.rejects
				.toMatchObject({
					statusCode: 400,
					message: expect.stringMatching(message),
				});

			expect(await keyCardNames(archetype.id)).toEqual([`Kept ${archetype.id}`]);
			expect(publication.archetypeKeyCardsUpdated).not.toHaveBeenCalled();
		});
	});

	it('refuses key cards for an Event that does not play MTG', async () => {
		const eventId = await createEvent('op');
		const archetype = await createArchetype(eventId);

		await expect(archetypeWriteModule().updateCards({
			eventId,
			archetypeId: archetype.id,
			input: { cardIds: [] },
		}))
			.rejects
			.toMatchObject({ statusCode: 400, message: 'Key cards are only supported for MTG events' });
	});

	it('refuses an Archetype another Event owns', async () => {
		const eventId = await createEvent();
		const archetype = await createArchetype(await createEvent());

		await expect(archetypeWriteModule().updateCards({
			eventId,
			archetypeId: archetype.id,
			input: { cardIds: [] },
		}))
			.rejects
			.toMatchObject({ statusCode: 404 });
	});
});

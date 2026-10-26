import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const publication = {
	playerCreated: vi.fn(async (input: { entity: unknown }) => input.entity),
	playerUpdated: vi.fn(async (input: { entity: unknown }) => input.entity),
	playerDeleted: vi.fn(),
	playerDeckReviewed: vi.fn(async (input: { entity: unknown }) => input.entity),
	featureMatchSlotsUpdated: vi.fn(),
	screenUpdated: vi.fn(),
};

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => publication,
}));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: vi.fn(),
	publishMessageStrict: vi.fn(),
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: vi.fn(),
}));
vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage), { statusCode: input.statusCode }));

const { playerUpdateModule } = await import('~~/server/modules/player-update');

afterAll(async () => await harness.close());

async function createEvent() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Player Open', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

async function createArchetype(eventId: number, name: string) {
	const [archetype] = await db.insert(schema.archetypes).values({ eventId, name, colors: 'WU' }).returning();
	return archetype!;
}

async function createPlayer(eventId: number) {
	const [player] = await db.insert(schema.players).values({ eventId, name: 'Alice' }).returning();
	return player!;
}

let deckSequence = 0;
async function createDeck(eventId: number, playerId: number, overrides: Partial<typeof schema.playerDecks.$inferInsert> = {}) {
	const [deck] = await db.insert(schema.playerDecks).values({
		eventId,
		playerId,
		externalId: `deck-${++deckSequence}`,
		externalSource: 'melee',
		formatExternalId: 'modern',
		name: 'Imported Deck',
		isPrimary: true,
		...overrides,
	}).returning();
	return deck!;
}

async function readPlayer(playerId: number) {
	const [player] = await db.select().from(schema.players).where(eq(schema.players.id, playerId));
	return player;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('updating a Player', () => {
	it('keeps the reviewed primary Deck List\'s Archetype over a generic edit', async () => {
		const eventId = await createEvent();
		const reviewed = await createArchetype(eventId, 'Azorius Control');
		const player = await createPlayer(eventId);
		await createDeck(eventId, player.id, {
			archetypeId: reviewed.id,
			reviewedAt: new Date(),
		});

		await playerUpdateModule().updatePlayer({
			eventId,
			playerId: player.id,
			input: {
				gameData: { type: 'mtg', deckName: 'Manual Override', deckColors: 'R' },
			},
		});

		const stored = await readPlayer(player.id);
		expect(stored?.archetypeId).toBe(reviewed.id);
		expect(stored?.gameData).toMatchObject({ deckName: 'Azorius Control' });
		expect(publication.playerUpdated).toHaveBeenCalledWith(expect.objectContaining({
			entity: expect.objectContaining({ archetypeId: reviewed.id }),
		}));
	});

	it('takes the edit as written when no Deck List has been reviewed', async () => {
		const eventId = await createEvent();
		const player = await createPlayer(eventId);
		await createDeck(eventId, player.id);

		await playerUpdateModule().updatePlayer({
			eventId,
			playerId: player.id,
			input: { name: 'Alice Renamed' },
		});

		expect((await readPlayer(player.id))?.name).toBe('Alice Renamed');
	});

	it('refuses an Archetype from another Event, leaving the Player as it was', async () => {
		const eventId = await createEvent();
		const foreign = await createArchetype(await createEvent(), 'Foreign');
		const player = await createPlayer(eventId);

		await expect(playerUpdateModule().updatePlayer({
			eventId,
			playerId: player.id,
			input: { name: 'Changed', archetypeId: foreign.id },
		}))
			.rejects
			.toMatchObject({ statusCode: 404 });

		expect(await readPlayer(player.id)).toMatchObject({ name: 'Alice', archetypeId: null });
		expect(publication.playerUpdated).not.toHaveBeenCalled();
	});

	it('refuses to create a Player with another Event\'s Archetype', async () => {
		const eventId = await createEvent();
		const foreign = await createArchetype(await createEvent(), 'Foreign');

		await expect(playerUpdateModule().createPlayer({
			eventId,
			input: { name: 'Bob', archetypeId: foreign.id } as never,
		}))
			.rejects
			.toMatchObject({ statusCode: 404 });
		expect(await db.select().from(schema.players).where(eq(schema.players.eventId, eventId))).toEqual([]);
	});

	it('refuses a Player the Event does not hold', async () => {
		const eventId = await createEvent();
		const elsewhere = await createPlayer(await createEvent());

		await expect(playerUpdateModule().updatePlayer({
			eventId,
			playerId: elsewhere.id,
			input: { name: 'Hijack' },
		}))
			.rejects
			.toMatchObject({ statusCode: 404 });
		expect((await readPlayer(elsewhere.id))?.name).toBe('Alice');
	});

	it('announces the Feature Match Slots showing the Player', async () => {
		const eventId = await createEvent();
		const player = await createPlayer(eventId);
		const [slot] = await db.insert(schema.featureMatches).values({ eventId, tableNumber: 1, player1Id: player.id }).returning();

		await playerUpdateModule().updatePlayer({
			eventId,
			playerId: player.id,
			input: { name: 'Alice Renamed' },
			originConnectionId: 'origin-1',
		});

		expect(publication.featureMatchSlotsUpdated).toHaveBeenCalledWith({
			eventId,
			slotIds: [slot!.id],
			originConnectionId: 'origin-1',
		});
	});
});

describe('reviewing a Deck List', () => {
	it('records the Archetype on a primary Deck List and projects it onto the Player', async () => {
		const eventId = await createEvent();
		const archetype = await createArchetype(eventId, 'Azorius Control');
		const player = await createPlayer(eventId);
		const deck = await createDeck(eventId, player.id);

		const result = await playerUpdateModule().reviewPlayerDeck({
			eventId,
			playerId: player.id,
			deckId: deck.id,
			archetypeId: archetype.id,
		});

		const [stored] = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.id, deck.id));
		expect(stored?.archetypeId).toBe(archetype.id);
		expect(stored?.reviewedAt).toBeInstanceOf(Date);
		expect((await readPlayer(player.id))?.archetypeId).toBe(archetype.id);
		expect(result.player).toMatchObject({ archetypeId: archetype.id });
	});

	it('leaves the Player\'s projection alone for a secondary Deck List', async () => {
		const eventId = await createEvent();
		const archetype = await createArchetype(eventId, 'Azorius Control');
		const player = await createPlayer(eventId);
		const secondary = await createDeck(eventId, player.id, { isPrimary: false });

		const result = await playerUpdateModule().reviewPlayerDeck({
			eventId,
			playerId: player.id,
			deckId: secondary.id,
			archetypeId: archetype.id,
		});

		expect(result.player).toBeNull();
		expect((await readPlayer(player.id))?.archetypeId).toBeNull();
		expect(publication.playerUpdated).not.toHaveBeenCalled();
	});

	it.each([
		['an Archetype from another Event', 'archetype'],
		['a Deck List another Player submitted', 'deck'],
	] as const)('refuses %s', async (_label, foreign) => {
		const eventId = await createEvent();
		const player = await createPlayer(eventId);
		const archetype = await createArchetype(foreign === 'archetype'
			? await createEvent()
			: eventId, 'Elsewhere');
		const deck = await createDeck(eventId, foreign === 'deck'
			? (await createPlayer(eventId)).id
			: player.id);

		await expect(playerUpdateModule().reviewPlayerDeck({
			eventId,
			playerId: player.id,
			deckId: deck.id,
			archetypeId: archetype.id,
		}))
			.rejects
			.toMatchObject({ statusCode: 404 });

		const [stored] = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.id, deck.id));
		expect(stored?.reviewedAt).toBeNull();
	});
});

it('re-projects each Player whose reviewed primary Deck List names an edited Archetype', async () => {
	const eventId = await createEvent();
	const archetype = await createArchetype(eventId, 'Azorius Control');
	const player = await createPlayer(eventId);
	await createDeck(eventId, player.id, {
		archetypeId: archetype.id,
		reviewedAt: new Date(),
	});
	await db.update(schema.archetypes).set({ name: 'Azorius Tempo' }).where(eq(schema.archetypes.id, archetype.id));

	await playerUpdateModule().reconcileDeckProjections({
		eventId,
		playerIds: [player.id],
	});

	expect((await readPlayer(player.id))?.gameData).toMatchObject({ deckName: 'Azorius Tempo' });
	expect(publication.playerUpdated).toHaveBeenCalledWith(expect.objectContaining({
		entity: expect.objectContaining({ id: player.id }),
	}));
});

describe('deleting a Player', () => {
	// Clearing the Deck Sources that selected them is proven in deckSourceInvariants.sqlite.
	it('removes the Player and announces it', async () => {
		const eventId = await createEvent();
		const player = await createPlayer(eventId);

		await expect(playerUpdateModule().deletePlayer({ eventId, playerId: player.id, originConnectionId: 'origin-1' })).resolves.toEqual({ success: true });

		expect(await readPlayer(player.id)).toBeUndefined();
		expect(publication.playerDeleted).toHaveBeenCalledWith({ eventId, id: player.id, originConnectionId: 'origin-1' });
	});

	it('refuses a Player another Event holds', async () => {
		const eventId = await createEvent();
		const elsewhere = await createPlayer(await createEvent());

		await expect(playerUpdateModule().deletePlayer({ eventId, playerId: elsewhere.id })).rejects.toMatchObject({ statusCode: 404 });
		expect(await readPlayer(elsewhere.id)).toBeDefined();
		expect(publication.playerDeleted).not.toHaveBeenCalled();
	});
});

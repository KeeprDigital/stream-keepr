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
	screenUpdated: vi.fn(),
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

// A One Piece Archetype is derived from a Leader, never assigned (ADR-0074).
describe('on a One Piece Card Game Event', () => {
	it.each([
		[
			'creating an Archetype',
			async (eventId: number) => archetypeWriteModule().createArchetype({
				eventId,
				input: { name: 'Zoro Aggro' },
			}),
		],
		[
			'deleting an Archetype',
			async (eventId: number) => archetypeWriteModule().deleteArchetype({ eventId, archetypeId: (await createArchetype(eventId)).id }),
		],
	])('refuses %s', async (_case, act) => {
		const eventId = await createEvent('op');

		await expect(act(eventId)).rejects.toMatchObject({ statusCode: 400 });
		expect(publication.archetypeCreated).not.toHaveBeenCalled();
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

	it.each([
		['pins a chart series', null, 3, 3],
		['moves a pin', 3, 7, 7],
		['clears a pin', 3, null, null],
		[
			'keeps a pin an unrelated edit leaves out',
			3,
			undefined,
			3,
		],
	])('%s, and announces the stored Archetype', async (_case, pinned, chartSeries, stored) => {
		const eventId = await createEvent();
		const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: 'Boros Energy', chartSeries: pinned }).returning();

		await archetypeWriteModule().updateArchetype({
			eventId,
			archetypeId: archetype!.id,
			input: chartSeries === undefined
				? { name: 'Boros Energy' }
				: { chartSeries },
			originConnectionId: 'origin-1',
		});

		const [row] = await db.select().from(schema.archetypes).where(eq(schema.archetypes.id, archetype!.id));
		expect(row?.chartSeries).toBe(stored);
		expect(publication.archetypeUpdated).toHaveBeenCalledWith(expect.objectContaining({
			eventId,
			entity: expect.objectContaining({ id: archetype!.id, chartSeries: stored }),
			originConnectionId: 'origin-1',
		}));
	});

	// An emptied derived One Piece Archetype is kept once customised (ADR-0074).
	it.each([
		[
			'a rename',
			{ name: 'Zoro Aggro' },
			false,
			true,
		],
		[
			'a pin',
			{ chartSeries: 2 },
			false,
			true,
		],
		[
			'a save of the name it holds',
			{ name: 'Roronoa Zoro' },
			false,
			false,
		],
		[
			'clearing a pin it never had',
			{ chartSeries: null },
			false,
			false,
		],
		[
			'clearing a pin, once customised',
			{ chartSeries: null },
			true,
			true,
		],
	] as const)('marks it customised on %s: %s', async (_case, input, customised, expected) => {
		const eventId = await createEvent('op');
		const [archetype] = await db.insert(schema.archetypes)
			.values({
				eventId,
				name: 'Roronoa Zoro',
				leaderCardNumber: 'OP01-001',
				customised,
			})
			.returning();

		await archetypeWriteModule().updateArchetype({ eventId, archetypeId: archetype!.id, input });

		const [row] = await db.select().from(schema.archetypes).where(eq(schema.archetypes.id, archetype!.id));
		expect(row?.customised).toBe(expected);
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

// Names clash ignoring case and surrounding spaces, so a slip of the shift key makes no second Archetype.
describe('naming an Archetype as another of its Event', () => {
	it.each([
		[
			'creating it',
			async (eventId: number) => archetypeWriteModule().createArchetype({
				eventId,
				input: { name: 'izzet phoenix' },
			}),
		],
		[
			'renaming it',
			async (eventId: number) => archetypeWriteModule().updateArchetype({
				eventId,
				archetypeId: (await createArchetype(eventId, 'Burn')).id,
				input: { name: ' IZZET PHOENIX ' },
			}),
		],
	])('refuses %s, naming the Archetype that holds the name', async (_case, act) => {
		const eventId = await createEvent();
		await createArchetype(eventId, 'Izzet Phoenix');

		await expect(act(eventId)).rejects.toMatchObject({
			statusCode: 409,
			message: expect.stringContaining('Izzet Phoenix'),
		});

		const names = (await db.select().from(schema.archetypes).where(eq(schema.archetypes.eventId, eventId))).map(row => row.name);
		expect(names).not.toContain('izzet phoenix');
		expect(names).not.toContain(' IZZET PHOENIX ');
		expect(publication.archetypeCreated).not.toHaveBeenCalled();
		expect(publication.archetypeUpdated).not.toHaveBeenCalled();
	});

	it.each([
		['its own name in another case', 'izzet phoenix'],
		['a name another Event\'s Archetype holds', 'Burn'],
	])('allows a rename to %s', async (_case, name) => {
		const eventId = await createEvent();
		await createArchetype(await createEvent(), 'Burn');
		const archetype = await createArchetype(eventId, 'Izzet Phoenix');

		await expect(archetypeWriteModule().updateArchetype({
			eventId,
			archetypeId: archetype.id,
			input: { name },
		}))
			.resolves
			.toMatchObject({
				entity: { name },
			});
	});
});

describe('merging an Archetype into another', () => {
	it('moves its decks to the survivor, still reviewed, and removes it in the same commit', async () => {
		const eventId = await createEvent();
		const merged = await createArchetype(eventId, 'Burn');
		const [survivor] = await db.insert(schema.archetypes).values({
			eventId,
			name: 'Boros Burn',
			colors: 'RW',
			chartSeries: 4,
		}).returning();
		await db.insert(schema.archetypeCards).values([
			{ archetypeId: merged.id, cardId: await createCard('Goblin Guide') },
			{ archetypeId: survivor!.id, cardId: await createCard('Lightning Helix') },
		]);
		const primary = await createReviewedDeck(eventId, merged.id, true);
		const secondary = await createReviewedDeck(eventId, merged.id, false);
		await createReviewedDeck(eventId, survivor!.id, true);
		// The Player write can give a Player an Archetype with no Deck List: they move with it.
		const [deckless] = await db.insert(schema.players).values({ eventId, name: 'Deckless', archetypeId: merged.id }).returning();

		await expect(archetypeWriteModule().mergeArchetype({
			eventId,
			archetypeId: merged.id,
			intoArchetypeId: survivor!.id,
			originConnectionId: 'origin-1',
		})).resolves.toEqual({ archetypeId: survivor!.id, mergedArchetypeId: merged.id });

		const decks = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.eventId, eventId));
		expect(decks.map(deck => [deck.archetypeId, deck.reviewedAt != null])).toEqual([
			[survivor!.id, true],
			[survivor!.id, true],
			[survivor!.id, true],
		]);
		// The survivor keeps its own colours, key cards and Pinned Chart Series; the merged one's go with it.
		expect(await db.select().from(schema.archetypes).where(eq(schema.archetypes.eventId, eventId)))
			.toMatchObject([
				{
					id: survivor!.id,
					name: 'Boros Burn',
					colors: 'RW',
					chartSeries: 4,
				},
			]);
		expect(await keyCardNames(survivor!.id)).toEqual(['Lightning Helix']);
		expect(await db.select({ archetypeId: schema.players.archetypeId }).from(schema.players).where(eq(schema.players.id, deckless!.id)))
			.toEqual([
				{ archetypeId: survivor!.id },
			]);
		expect(playerUpdates.reconcileDeckProjections).toHaveBeenCalledWith(expect.objectContaining({
			playerIds: [primary.playerId],
		}));
		expect(playerUpdates.publishPlayerSnapshotUpdates).toHaveBeenCalledWith(expect.objectContaining({
			playerIds: [secondary.playerId],
		}));
		expect(publication.archetypeDeleted).toHaveBeenCalledWith({
			eventId,
			id: merged.id,
			mergedIntoArchetypeId: survivor!.id,
			originConnectionId: 'origin-1',
		});
	});

	it.each([
		[
			'into itself',
			400,
			async (eventId: number, mergedId: number) => ({ eventId, archetypeId: mergedId, intoArchetypeId: mergedId }),
		],
		[
			'into another Event\'s Archetype',
			404,
			async (eventId: number, mergedId: number) => ({
				eventId,
				archetypeId: mergedId,
				intoArchetypeId: (await createArchetype(await createEvent(), 'Elsewhere')).id,
			}),
		],
		[
			'when another Event owns it',
			404,
			async (eventId: number, mergedId: number) => ({
				eventId: await createEvent(),
				archetypeId: mergedId,
				intoArchetypeId: (await createArchetype(eventId, 'Survivor')).id,
			}),
		],
	])('refuses a merge %s, leaving its decks reviewed as it', async (_case, statusCode, params) => {
		const eventId = await createEvent();
		const merged = await createArchetype(eventId, 'Burn');
		const { deckId } = await createReviewedDeck(eventId, merged.id, true);

		await expect(archetypeWriteModule().mergeArchetype(await params(eventId, merged.id))).rejects.toMatchObject({ statusCode });

		const [deck] = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.id, deckId));
		expect(deck?.archetypeId).toBe(merged.id);
		expect(publication.archetypeDeleted).not.toHaveBeenCalled();
	});
});

describe('removing the Empty Archetypes', () => {
	it('removes each Archetype no Deck List is assigned to, and no other', async () => {
		const eventId = await createEvent();
		const otherEventId = await createEvent();
		const held = await createArchetype(eventId, 'Held by a primary deck');
		const heldBySecondary = await createArchetype(eventId, 'Held by a secondary deck');
		const empty = await createArchetype(eventId, 'Empty');
		const alsoEmpty = await createArchetype(eventId, 'Also empty');
		const elsewhere = await createArchetype(otherEventId, 'Empty elsewhere');
		await createReviewedDeck(eventId, held.id, true);
		await createReviewedDeck(eventId, heldBySecondary.id, false);
		// The Player write can give a Player an Archetype with no Deck List: the Metagame counts them as its Pilot.
		const heldByPlayer = await createArchetype(eventId, 'Held by a Player alone');
		await db.insert(schema.players).values({ eventId, name: 'Deckless', archetypeId: heldByPlayer.id });

		const result = await archetypeWriteModule().removeEmptyArchetypes({ eventId, originConnectionId: 'origin-1' });

		expect(result.archetypeIds.toSorted()).toEqual([empty.id, alsoEmpty.id]);
		const kept = await db.select({ id: schema.archetypes.id }).from(schema.archetypes);
		expect(kept.map(row => row.id)).toEqual(expect.arrayContaining([
			held.id,
			heldBySecondary.id,
			heldByPlayer.id,
			elsewhere.id,
		]));
		expect(kept.map(row => row.id)).not.toEqual(expect.arrayContaining([empty.id]));
		expect(kept.map(row => row.id)).not.toEqual(expect.arrayContaining([alsoEmpty.id]));
		expect(publication.archetypeDeleted.mock.calls.map(([input]) => input).toSorted((a, b) => a.id - b.id)).toEqual([
			{ eventId, id: empty.id, originConnectionId: 'origin-1' },
			{ eventId, id: alsoEmpty.id, originConnectionId: 'origin-1' },
		]);
	});
});

describe('on a One Piece Card Game Event, an Archetype following its Leader', () => {
	it.each([
		[
			'is not merged',
			async (eventId: number) => archetypeWriteModule().mergeArchetype({
				eventId,
				archetypeId: (await createArchetype(eventId, 'Luffy')).id,
				intoArchetypeId: (await createArchetype(eventId, 'Zoro')).id,
			}),
		],
		[
			'is not removed for being empty',
			async (eventId: number) => {
				await createArchetype(eventId, 'Luffy');
				return archetypeWriteModule().removeEmptyArchetypes({ eventId });
			},
		],
	])('%s', async (_case, act) => {
		const eventId = await createEvent('op');

		await expect(act(eventId)).rejects.toMatchObject({ statusCode: 400 });

		expect(await db.select().from(schema.archetypes).where(eq(schema.archetypes.eventId, eventId))).not.toHaveLength(0);
		expect(publication.archetypeDeleted).not.toHaveBeenCalled();
	});
});

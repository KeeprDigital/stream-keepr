import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Submitted Deck Lists over real SQL: a Melee snapshot replaces a Player's
// decks and projects the primary one onto the Player, a review survives only
// unchanged contents, and a Match or Phase picks the deck in its format.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { playerDeckService } = await import('~~/server/services/playerDeck');

let eventId: number;
let cardIds: number[];
let archetypeId: number;

beforeAll(async () => {
	const [event] = await db.insert(schema.events).values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' }).returning();
	eventId = event!.id;
	cardIds = (await db.insert(schema.cards).values([
		{ name: 'Lurrus', game: 'mtg' },
		{ name: 'Kaheera', game: 'mtg' },
	]).returning()).map(card => card.id);
	const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: 'Control', colors: 'WU' }).returning();
	archetypeId = archetype!.id;
});

afterAll(async () => await harness.close());

async function stagePlayer(gameData: Record<string, unknown> = { type: 'mtg', deckName: null, deckColors: null }) {
	const [player] = await db.insert(schema.players).values({ eventId, name: 'Player', gameData: gameData as never }).returning();
	return player!.id;
}

async function storedPlayer(playerId: number) {
	return (await db.query.players.findFirst({
		where: eq(schema.players.id, playerId),
	}))!;
}

function snapshot(playerId: number, options: { externalId?: string; format?: string; quantity?: number; sortOrder?: number; companion?: number; primary?: boolean } = {}) {
	return {
		deck: {
			eventId,
			playerId,
			externalId: options.externalId ?? `deck-${playerId}`,
			formatExternalId: options.format ?? 'modern',
			name: 'Imported Control',
			colors: 'WU',
			sortOrder: options.primary === false
				? 1
				: 0,
			isPrimary: options.primary ?? true,
		},
		cards: [
			{
				cardId: cardIds[0]!,
				quantity: options.quantity ?? 4,
				compartment: 'mainboard' as const,
				sortOrder: options.sortOrder ?? 0,
			},
		],
		unresolvedCards: [],
		importedCompanion: options.companion == null
			? { action: 'clear' as const }
			: { action: 'set' as const, cardId: options.companion },
	};
}

describe('replaceMeleeDecksForEvent', () => {
	it('stores a snapshot and projects its primary deck, then clears only the deck fields for an empty one', async () => {
		const playerId = await stagePlayer({
			type: 'mtg',
			deckName: 'Old',
			deckColors: 'R',
			customField: 'keep',
		});
		const withEverything = snapshot(playerId, { companion: cardIds[0] });
		withEverything.unresolvedCards = [
			{
				entryType: 'card',
				originalName: 'Mystery',
				normalizedOriginalName: 'mystery',
				setCode: null,
				normalizedSetCode: '',
				quantity: 1,
				compartment: 'sideboard',
				sortOrder: 1,
				cardType: null,
			},
		] as never;

		await playerDeckService().replaceMeleeDecksForEvent(eventId, [
			{
				playerId,
				snapshots: [withEverything],
			},
		]);

		const [deck] = await playerDeckService().listByPlayer(eventId, playerId);
		expect(deck).toMatchObject({ name: 'Imported Control', colors: 'WU', isPrimary: true });
		expect((await storedPlayer(playerId)).gameData).toMatchObject({ deckName: 'Imported Control', deckColors: 'WU', customField: 'keep' });
		for (const table of [schema.playerDeckCards, schema.playerDeckUnresolvedCards, schema.playerDeckCompanions])
			expect(await db.select().from(table).where(eq(table.deckId, deck!.id))).toHaveLength(1);

		await playerDeckService().replaceMeleeDecksForEvent(eventId, [
			{ playerId, snapshots: [] },
		]);

		expect(await playerDeckService().listByPlayer(eventId, playerId)).toEqual([]);
		expect(await storedPlayer(playerId)).toMatchObject({
			archetypeId: null,
			gameData: {
				type: 'mtg',
				deckName: null,
				deckColors: null,
				customField: 'keep',
			},
		});
	});

	it('keeps a review across an unchanged resubmission and drops it when the contents or companion change', async () => {
		const playerId = await stagePlayer();
		const service = playerDeckService();
		const reviewed = async () => (await service.listByPlayer(eventId, playerId))[0]!;
		const review = async () => await service.reviewDeck(eventId, playerId, (await reviewed()).id, archetypeId);

		await service.replaceMeleeDecksForEvent(eventId, [
			{
				playerId,
				snapshots: [
					snapshot(playerId, { sortOrder: 9 }),
				],
			},
		]);
		await review();

		await service.replaceMeleeDecksForEvent(eventId, [
			{
				playerId,
				snapshots: [
					snapshot(playerId),
				],
			},
		]);
		expect(await reviewed()).toMatchObject({
			archetypeId,
			reviewedAt: expect.any(Date),
		});

		await service.replaceMeleeDecksForEvent(eventId, [
			{
				playerId,
				snapshots: [
					snapshot(playerId, { quantity: 3 }),
				],
			},
		]);
		expect(await reviewed()).toMatchObject({ archetypeId: null, reviewedAt: null });
		expect(await storedPlayer(playerId)).toMatchObject({
			archetypeId: null,
			gameData: expect.objectContaining({ deckName: 'Imported Control' }),
		});

		await review();
		await service.replaceMeleeDecksForEvent(eventId, [
			{
				playerId,
				snapshots: [
					snapshot(playerId, { quantity: 3, companion: cardIds[1] }),
				],
			},
		]);
		expect(await reviewed()).toMatchObject({ archetypeId: null, reviewedAt: null });

		await review();
		await service.replaceMeleeDecksForEvent(eventId, [
			{
				playerId,
				snapshots: [
					snapshot(playerId, { quantity: 3, sortOrder: 4, companion: cardIds[1] }),
				],
			},
		]);
		expect(await reviewed()).toMatchObject({
			archetypeId,
			reviewedAt: expect.any(Date),
		});
	});
});

describe('reviewing and projecting', () => {
	it('projects a reviewed primary deck\'s Archetype onto its Player', async () => {
		const playerId = await stagePlayer();
		await playerDeckService().replaceMeleeDecksForEvent(eventId, [
			{
				playerId,
				snapshots: [
					snapshot(playerId),
				],
			},
		]);
		const [deck] = await playerDeckService().listByPlayer(eventId, playerId);

		await playerDeckService().reviewDeck(eventId, playerId, deck!.id, archetypeId);

		expect(await storedPlayer(playerId)).toMatchObject({
			archetypeId,
			gameData: expect.objectContaining({ deckName: 'Control', deckColors: 'WU' }),
		});
	});

	it('leaves an operator\'s Player edit alone while the primary deck is unreviewed', async () => {
		const playerId = await stagePlayer();
		await playerDeckService().replaceMeleeDecksForEvent(eventId, [
			{
				playerId,
				snapshots: [
					snapshot(playerId),
				],
			},
		]);
		await db.update(schema.players).set({
			gameData: { type: 'mtg', deckName: 'Manual', deckColors: 'G' },
		}).where(eq(schema.players.id, playerId));

		await expect(playerDeckService().reconcilePrimaryArchetype(eventId, playerId, { reviewedOnly: true })).resolves.toBeNull();
		expect((await storedPlayer(playerId)).gameData).toMatchObject({ deckName: 'Manual', deckColors: 'G' });
	});
});

describe('re-projecting the Players an Archetype edit reaches', () => {
	let renames = 0;
	/** Players holding a primary deck reviewed as a new Archetype, which is then renamed to `renamed`. */
	async function stageRenamed(count: number) {
		const renamed = `Renamed ${++renames}`;
		const [archetype] = await db.insert(schema.archetypes).values({ eventId, name: `Tempo ${renames}`, colors: 'UR' }).returning();
		const playerIds: number[] = [];
		for (let index = 0; index < count; index++) {
			const playerId = await stagePlayer();
			await playerDeckService().replaceMeleeDecksForEvent(eventId, [
				{
					playerId,
					snapshots: [
						snapshot(playerId),
					],
				},
			]);
			const [deck] = await playerDeckService().listByPlayer(eventId, playerId);
			await playerDeckService().reviewDeck(eventId, playerId, deck!.id, archetype!.id);
			playerIds.push(playerId);
		}
		await db.update(schema.archetypes).set({ name: renamed, colors: 'BG' }).where(eq(schema.archetypes.id, archetype!.id));
		return { playerIds, renamed };
	}

	it('projects each primary deck as reviewed or as imported, leaves a Player with no deck alone, and answers them in the order asked', async () => {
		const { playerIds: [reviewed], renamed } = await stageRenamed(1);
		const unreviewed = await stagePlayer();
		await playerDeckService().replaceMeleeDecksForEvent(eventId, [
			{
				playerId: unreviewed,
				snapshots: [
					snapshot(unreviewed),
				],
			},
		]);
		const deckless = await stagePlayer({ type: 'mtg', deckName: 'Manual', deckColors: 'G' });

		const answered = await playerDeckService().reconcilePrimaryArchetypesForPlayers(eventId, [
			deckless,
			reviewed!,
			unreviewed,
			reviewed!,
		]);

		expect(answered.map(player => player.id)).toEqual([deckless, reviewed, unreviewed]);
		const projected = await Promise.all([reviewed!, unreviewed, deckless].map(async (playerId) => {
			const { archetypeId, gameData } = await storedPlayer(playerId);
			return { archetypeId: archetypeId !== null, gameData };
		}));
		expect(projected).toEqual([
			{
				archetypeId: true,
				gameData: { type: 'mtg', deckName: renamed, deckColors: 'BG' },
			},
			{
				archetypeId: false,
				gameData: { type: 'mtg', deckName: 'Imported Control', deckColors: 'WU' },
			},
			{
				archetypeId: false,
				gameData: { type: 'mtg', deckName: 'Manual', deckColors: 'G' },
			},
		]);
		expect(answered.map(player => player.gameData)).toEqual([projected[2]!.gameData, projected[0]!.gameData, projected[1]!.gameData]);
	});

	// One bulk write: an Archetype 400 Players hold must not cost 400 updates.
	it('costs as many database round trips for many Players as for one', async () => {
		const cost = async (count: number) => {
			const { playerIds } = await stageRenamed(count);
			const before = harness.roundTrips();
			await playerDeckService().reconcilePrimaryArchetypesForPlayers(eventId, playerIds);
			return harness.roundTrips() - before;
		};
		const one = await cost(1);

		expect(await cost(6)).toBe(one);
	});

	// All or nothing: a failure partway leaves no Player on the new projection.
	it('re-projects none of them when one cannot be written', async () => {
		const { playerIds } = await stageRenamed(3);
		await harness.client.execute(`create trigger refuse_player before update on players
			when new.id = ${playerIds[2]} begin select raise(abort, 'player refused'); end`);

		await expect(playerDeckService().reconcilePrimaryArchetypesForPlayers(eventId, playerIds)).rejects.toThrow();
		await harness.client.execute('drop trigger refuse_player');

		const names = await Promise.all(playerIds.map(async playerId => (await storedPlayer(playerId)).gameData));
		expect(names.map(gameData => (gameData as { deckName: string }).deckName).every(name => name.startsWith('Tempo'))).toBe(true);
	});
});

describe('selectFromDecks', () => {
	it('takes an explicit deck only when it is the Player\'s, else the deck in the Phase\'s or Round\'s format, else the primary', async () => {
		const playerId = await stagePlayer();
		await playerDeckService().replaceMeleeDecksForEvent(eventId, [
			{
				playerId,
				snapshots: [
					snapshot(playerId),
					snapshot(playerId, { externalId: `finals-${playerId}`, format: 'standard', primary: false }),
				],
			},
		]);
		const decks = await playerDeckService().listByPlayer(eventId, playerId);
		const primary = decks.find(deck => deck.isPrimary)!;
		const finals = decks.find(deck => !deck.isPrimary)!;
		const [standard, pioneer] = await db.insert(schema.phases).values([
			{ eventId, name: 'Finals', formatExternalId: 'standard' },
			{ eventId, name: 'Side', formatExternalId: 'pioneer' },
		]).returning();
		const [pioneerRound] = await db.insert(schema.rounds).values({
			eventId,
			phaseId: pioneer!.id,
			name: 'R1',
			roundNumber: 1,
		}).returning();

		expect(await playerDeckService().selectFromDecks(eventId, decks, { deckId: finals.id })).toEqual(finals);
		expect(await playerDeckService().selectFromDecks(eventId, decks, { deckId: 999_999 })).toBeNull();
		expect(await playerDeckService().selectFromDecks(eventId, decks, { phaseId: standard!.id })).toEqual(finals);
		expect(await playerDeckService().selectFromDecks(eventId, decks, { roundId: pioneerRound!.id })).toEqual(primary);
	});
});

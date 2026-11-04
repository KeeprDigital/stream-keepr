import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { fakeOpCardBulkLookup, knownOpCard } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A One Piece Event's Metagame (ADR-0074): every Player's Deck List counts,
// participation only, under OP card rules. Deck Lists are staged through the
// real OP Deck List write; bandai-keepr is faked at its bulk lookup port.
//
//   ana (Nickname only) Zoro  4x Zoro (Character), 2x Gum-Gum (Event), 1x Sunny (Stage), 4x OP99-999 (unknown)
//   Bo                  Luffy 4x Zoro, 4x Usopp (Character)
//   Cy                  unknown Leader OP99-001, 4x Usopp
// An unlinked Feature Match Slot side holds 4x Kaido, which no Player runs.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
vi.stubGlobal('useRuntimeConfig', () => ({ bandaiKeeprApiKey: 'test-key', bandaiKeeprApiUrl: 'https://op-api.test' }));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));

const upstream = fakeOpCardBulkLookup([
	knownOpCard({
		number: 'OP01-001',
		name: 'Roronoa Zoro',
		category: 'leader',
		colors: ['Red'],
	}),
	knownOpCard({
		number: 'OP01-003',
		name: 'Monkey.D.Luffy',
		category: 'leader',
		colors: ['Red', 'Green'],
	}),
	knownOpCard({
		number: 'OP01-025',
		name: 'Roronoa Zoro',
		category: 'character',
		colors: ['Red'],
		cost: 3,
	}),
	knownOpCard({
		number: 'OP01-040',
		name: 'Usopp',
		category: 'character',
		colors: ['Green'],
		cost: 2,
	}),
	knownOpCard({
		number: 'OP01-029',
		name: 'Gum-Gum Jet Pistol',
		category: 'event',
		colors: ['Red'],
		cost: 1,
	}),
	knownOpCard({
		number: 'OP01-119',
		name: 'Thousand Sunny',
		category: 'stage',
		colors: ['Red'],
		cost: 2,
	}),
	knownOpCard({
		number: 'OP01-094',
		name: 'Kaido',
		category: 'character',
		colors: ['Purple'],
		cost: 10,
	}),
]);
vi.doMock('~~/server/utils/bandaiKeepr', async importOriginal => ({
	...await importOriginal<object>(),
	lookUpOpCards: upstream.lookUpOpCards,
}));

const { metagameReadModel } = await import('~~/server/modules/metagame/readModel');
const { opDeckListWriteModule } = await import('~~/server/modules/op-deck-list-write');

let eventId: number;
let playerListId: number;
let zoroArchetypeId: number;
const cardIds = new Map<string, number>();

beforeAll(async () => {
	const [event] = await db.insert(schema.events)
		// A points system is an MTG rule; an OP Event holding one reads no points.
		.values({
			name: 'One Piece Regional',
			game: 'op',
			featureMatchOrientation: 'horizontal',
			pointsSystem: '7ph',
		})
		.returning({ id: schema.events.id });
	eventId = event!.id;

	const [ana, bo, cy] = await db.insert(schema.players)
		.values([
			{ eventId, name: '', nickname: 'ana' },
			{ eventId, name: 'Bo', nickname: 'bo-tcg' },
			{ eventId, name: 'Cy' },
		])
		.returning();
	const write = (playerId: number, input: Parameters<ReturnType<typeof opDeckListWriteModule>['write']>[0]['input']) =>
		opDeckListWriteModule().write({
			eventId,
			owner: { kind: 'player', playerId },
			input,
			source: 'import',
		});
	await write(ana!.id, { text: '1x OP01-001\n4x OP01-025\n2x OP01-029\n1x OP01-119\n4x OP99-999' });
	await write(bo!.id, { text: '1x OP01-003\n4x OP01-025\n4x OP01-040' });
	await write(cy!.id, {
		entries: [
			{ number: 'OP99-001', quantity: 1 },
			{ number: 'OP01-040', quantity: 4 },
		],
		leaderNumber: 'OP99-001',
	});

	// Standings an OP Event has no source for: the Metagame reads none of them.
	await db.update(schema.players)
		.set({
			position: 1,
			wins: 5,
			losses: 0,
			draws: 0,
			points: 15,
		})
		.where(eq(schema.players.id, ana!.id));

	const [slot] = await db.insert(schema.featureMatches)
		.values({
			eventId,
			player1Data: { name: 'Guest' },
			player2Data: { name: 'Other' },
		})
		.returning();
	await opDeckListWriteModule().write({
		eventId,
		owner: { kind: 'slotSide', slotId: slot!.id, side: 'player1' },
		input: { text: '4x OP01-094' },
		source: 'hand',
	});

	const [list] = await db.insert(schema.playerLists)
		.values({ eventId, name: 'Ana only' })
		.returning({ id: schema.playerLists.id });
	playerListId = list!.id;
	await db.insert(schema.playerListMembers).values({ listId: playerListId, playerId: ana!.id });

	for (const card of await db.select().from(schema.cards))
		cardIds.set(card.cardNumber!, card.id);
	zoroArchetypeId = (await db.query.archetypes.findFirst({
		where: eq(schema.archetypes.leaderCardNumber, 'OP01-001'),
	}))!.id;
});

afterAll(async () => await harness.close());

const numbers = (entries: { cardNumber: string | null }[]) => entries.map(entry => entry.cardNumber).toSorted();

describe('the OP card breakdown', () => {
	it('counts only Player Deck Lists, by OP card rules: no Leader, no unknown card, no Feature Match Deck List, no points', async () => {
		const result = await metagameReadModel().getCardBreakdown(eventId, { scope: 'all' });

		expect(result.totalDecks).toBe(3);
		expect(result.entries).toEqual([
			expect.objectContaining({
				cardNumber: 'OP01-025',
				name: 'Roronoa Zoro',
				cardType: 'Character',
				colors: 'Red',
				deckCount: 2,
				totalCopies: 8,
				imageUrl: 'https://cards-img.keepr.digital/OP01-025.png',
			}),
			expect.objectContaining({
				cardNumber: 'OP01-040',
				name: 'Usopp',
				cardType: 'Character',
				deckCount: 2,
				totalCopies: 8,
			}),
			expect.objectContaining({ cardNumber: 'OP01-029', cardType: 'Event', deckCount: 1 }),
			expect.objectContaining({ cardNumber: 'OP01-119', cardType: 'Stage', deckCount: 1 }),
		]);
		for (const entry of result.entries)
			expect(entry).not.toHaveProperty('highlanderPoints');
	});

	it.each([
		[
			['Event'],
			['OP01-025', 'OP01-040', 'OP01-119'],
		],
		[
			['Character', 'Stage'],
			['OP01-029'],
		],
		// An MTG type names no OP card.
		[
			['Land'],
			[
				'OP01-025',
				'OP01-029',
				'OP01-040',
				'OP01-119',
			],
		],
	] as const)('leaves out the OP types %j', async (excludeTypes, expected) => {
		const result = await metagameReadModel().getCardBreakdown(eventId, {
			scope: 'all',
			excludeTypes: [...excludeTypes],
		});

		expect(numbers(result.entries)).toEqual(expected);
	});
});

describe('the OP Metagame Scope', () => {
	// OP scopes are every Player and a Player List: one needing standings reads every Player.
	it.each([
		[
			{ scope: 'all' },
			'all',
			3,
		],
		[
			{ scope: 'topN', topN: 1 },
			'all',
			3,
		],
		[
			{ scope: 'minPoints', minPoints: 10 },
			'all',
			3,
		],
		[
			{ scope: 'playerList', playerListId: -1 },
			'playerList',
			1,
		],
	] as const)('reads %j as %s, over %i Deck Lists', async (query, scope, totalDecks) => {
		const resolved = {
			...query,
			...(query.scope === 'playerList'
				? { playerListId }
				: {}),
		};

		const result = await metagameReadModel().getCardBreakdown(eventId, resolved);

		expect(result).toMatchObject({ scope, totalDecks });
	});
});

describe('the OP archetype breakdown', () => {
	it('counts each Leader\'s share, leaves an unknown Leader unclassified, and reads no standings even when asked', async () => {
		const result = await metagameReadModel().getArchetypeBreakdown(eventId, {
			scope: 'all',
			sortBy: 'winRate',
			conversionMetric: 'topN',
			conversionThreshold: 8,
		});

		expect(result).toMatchObject({ totalPlayers: 3, classifiedPlayers: 2 });
		expect(result.entries.map(entry => [
			entry.name,
			entry.count,
			entry.metaShare,
			entry.winRate,
			entry.avgPosition,
			entry.conversionRate,
		]).toSorted()).toEqual([
			[
				'Monkey.D.Luffy',
				1,
				50,
				null,
				null,
				null,
			],
			[
				'Roronoa Zoro',
				1,
				50,
				null,
				null,
				null,
			],
		]);
	});
});

describe('the OP archetype detail', () => {
	it('names each pilot as every surface does, and reads no standings', async () => {
		const detail = await metagameReadModel().getArchetypeDetail(eventId, {
			archetypeId: zoroArchetypeId,
			scope: 'all',
			conversionMetric: 'topN',
			conversionThreshold: 8,
		});

		expect(detail).toMatchObject({
			name: 'Roronoa Zoro',
			colors: 'Red',
			playerCount: 1,
			winRate: null,
			avgPosition: null,
			convertedCount: null,
			conversionRate: null,
		});
		expect(detail!.players).toEqual([
			expect.objectContaining({
				name: 'ana',
				position: null,
				points: null,
				wins: null,
				losses: null,
				draws: null,
			}),
		]);
		expect(numbers(detail!.cardBreakdown)).toEqual(['OP01-025', 'OP01-029', 'OP01-119']);
	});
});

describe('the OP card detail', () => {
	it('names each Player running the card as every surface does, and pairs it with no Leader', async () => {
		const detail = await metagameReadModel().getCardDetail(eventId, {
			cardId: cardIds.get('OP01-025')!,
			scope: 'all',
		});

		expect(detail!.players.map(player => [player.name, player.position, player.wins]).toSorted()).toEqual([
			['Bo', null, null],
			['ana', null, null],
		]);
		expect(detail!.card).toMatchObject({
			cardNumber: 'OP01-025',
			cardType: 'Character',
			colors: 'Red',
			scryfallId: null,
			imageUrl: 'https://cards-img.keepr.digital/OP01-025.png',
		});
		expect(numbers(detail!.coOccurrence)).toEqual(['OP01-029', 'OP01-040', 'OP01-119']);
	});
});

describe('the OP summary', () => {
	it('counts every Player, the classified ones, and every Deck List', async () => {
		const summary = await metagameReadModel().getSummary(eventId, { scope: 'all' });

		expect(summary).toMatchObject({
			totalPlayers: 3,
			classifiedPlayers: 2,
			totalDecks: 3,
			totalArchetypes: 2,
		});
		expect(summary.facts.find(fact => fact.key === 'bestMajorWinRate')).toBeUndefined();
	});
});

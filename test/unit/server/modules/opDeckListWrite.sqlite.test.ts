import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { fakeOpCardBulkLookup, knownOpCard } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The OP Deck List write (ADR-0074), for a Player: every rule behind it, at
// its seam. bandai-keepr is faked at its bulk lookup port, Ably at publish.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
const runtimeConfig = { bandaiKeeprApiKey: 'test-key', bandaiKeeprApiUrl: 'https://op-api.test' };
vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const published: Array<{ eventId: number; type: string; payload: unknown }> = [];
function record(eventId: number, type: string, payload: unknown) {
	published.push({ eventId, type, payload });
}
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async (eventId: number, type: string, payload: unknown) => record(eventId, type, payload),
	publishMessageStrict: async (eventId: number, type: string, payload: unknown) => record(eventId, type, payload),
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));

const ZORO = knownOpCard({
	number: 'OP01-001',
	name: 'Roronoa Zoro',
	category: 'leader',
	colors: ['Red'],
});
const LUFFY = knownOpCard({
	number: 'OP01-003',
	name: 'Monkey.D.Luffy',
	category: 'leader',
	colors: ['Red', 'Green'],
});
const LUFFY_BLUE = knownOpCard({
	number: 'OP05-060',
	name: 'Monkey.D.Luffy',
	category: 'leader',
	colors: ['Blue'],
});
const NAMI = knownOpCard({
	number: 'OP01-016',
	name: 'Nami',
	category: 'leader',
	colors: ['Blue'],
});
const RED = knownOpCard({
	number: 'OP01-025',
	name: 'Roronoa Zoro',
	category: 'character',
	colors: ['Red'],
	cost: 3,
});
const BLUE = knownOpCard({
	number: 'OP01-040',
	name: 'Usopp',
	category: 'character',
	colors: ['Blue'],
	cost: 2,
});
const KNOWN = [
	ZORO,
	LUFFY,
	LUFFY_BLUE,
	NAMI,
	RED,
	BLUE,
];
let upstream = fakeOpCardBulkLookup(KNOWN);
vi.doMock('~~/server/utils/bandaiKeepr', async importOriginal => ({
	...await importOriginal<object>(),
	lookUpOpCards: (...args: Parameters<typeof upstream.lookUpOpCards>) => upstream.lookUpOpCards(...args),
}));

const { opDeckListWriteModule } = await import('~~/server/modules/op-deck-list-write');
const { archetypeWriteModule } = await import('~~/server/modules/archetype-write');
const { playerUpdateModule } = await import('~~/server/modules/player-update');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');

const ZORO_DECK = '1x OP01-001 Roronoa Zoro\n4x OP01-025\n4x OP99-999';

beforeEach(async () => {
	upstream = fakeOpCardBulkLookup(KNOWN);
	published.length = 0;
	// The catalogue is global, so each test starts it empty.
	await db.delete(schema.cards);
});

afterAll(async () => {
	await harness.close();
});

async function stageEvent(game: 'op' | 'mtg' = 'op') {
	const [event] = await db.insert(schema.events)
		.values({ name: 'One Piece Regional', game, featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

async function stagePlayer(eventId: number, nickname = 'ana') {
	const [player] = await db.insert(schema.players)
		.values({ eventId, name: '', nickname })
		.returning();
	return player!;
}

type Input = Parameters<ReturnType<typeof opDeckListWriteModule>['write']>[0]['input'];

function write(eventId: number, playerId: number, input: Input, source: 'hand' | 'import' = 'hand') {
	return opDeckListWriteModule().write({
		eventId,
		owner: { kind: 'player', playerId },
		input,
		source,
	});
}

async function playerRow(playerId: number) {
	return (await db.query.players.findFirst({
		where: eq(schema.players.id, playerId),
	}))!;
}

async function eventArchetypes(eventId: number) {
	const rows = await db.select({
		name: schema.archetypes.name,
		colors: schema.archetypes.colors,
		leaderCardNumber: schema.archetypes.leaderCardNumber,
	})
		.from(schema.archetypes)
		.where(eq(schema.archetypes.eventId, eventId));
	return rows.toSorted((left, right) => left.name.localeCompare(right.name));
}

async function archetypeOf(playerId: number) {
	const player = await playerRow(playerId);
	if (player.archetypeId === null)
		return null;
	return (await db.query.archetypes.findFirst({
		where: eq(schema.archetypes.id, player.archetypeId),
	}))!;
}

async function deckRows(playerId: number) {
	return await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.playerId, playerId));
}

describe('a Player\'s Deck List', () => {
	it('is saved with each number resolved once, an unknown one kept as an Unresolved Deck Card, and reads back the same', async () => {
		const eventId = await stageEvent();
		const player = await stagePlayer(eventId);

		const { deckList } = await write(eventId, player.id, { text: `${ZORO_DECK}\n2x OP01-025` });

		expect(deckList).toMatchObject({
			playerId: player.id,
			leaderNumber: 'OP01-001',
			mainboardCount: 10,
			entries: [
				{
					number: 'OP01-001',
					quantity: 1,
					card: { name: 'Roronoa Zoro', category: 'leader' },
				},
				{
					number: 'OP01-025',
					quantity: 6,
					card: { name: 'Roronoa Zoro', category: 'character', cost: 3 },
				},
				{ number: 'OP99-999', quantity: 4, card: null },
			],
			sourceText: '1x OP01-001 Roronoa Zoro\n6x OP01-025 Roronoa Zoro\n4x OP99-999',
		});
		expect(deckList.warnings.map(warning => warning.code)).toEqual(['MAINBOARD_COUNT', 'TOO_MANY_COPIES', 'UNKNOWN_CARD']);
		expect(upstream.batches()).toEqual([
			['OP01-001', 'OP01-025', 'OP99-999'],
		]);
		expect(await opDeckListWriteModule().readPlayer({ eventId, playerId: player.id })).toEqual(deckList);
		const [unresolved] = await db.select().from(schema.playerDeckUnresolvedCards).where(eq(schema.playerDeckUnresolvedCards.deckId, deckList.id));
		expect(unresolved).toMatchObject({ originalName: 'OP99-999', quantity: 4, entryType: 'card' });
	});

	it('looks up only the numbers the catalogue lacks', async () => {
		const eventId = await stageEvent();
		const [ana, ben] = [await stagePlayer(eventId, 'ana'), await stagePlayer(eventId, 'ben')];
		await write(eventId, ana.id, { text: ZORO_DECK });

		await write(eventId, ben.id, { text: '1x OP01-001\n4x OP01-025\n4x OP01-040' });

		expect(upstream.batches()).toEqual([
			['OP01-001', 'OP01-025', 'OP99-999'],
			['OP01-040'],
		]);
	});

	it.each([
		[
			'import',
			{
				entries: [
					{ number: 'OP99-999', quantity: 4 },
				],
				leaderNumber: 'OP01-001',
			},
		],
		[
			'paste',
			{ text: '1x OP01-001\n4x OP99-999' },
		],
	] as const)('retries a number bandai-keepr did not know when an %s sees it again', async (_input, input) => {
		const eventId = await stageEvent();
		const [ana, ben] = [await stagePlayer(eventId, 'ana'), await stagePlayer(eventId, 'ben')];
		await write(eventId, ana.id, { text: ZORO_DECK });
		upstream.know(knownOpCard({
			number: 'OP99-999',
			name: 'Late Card',
			category: 'event',
			colors: ['Red'],
		}));
		upstream.reset();

		const { deckList } = await write(eventId, ben.id, input, 'import');

		expect(upstream.batches()).toEqual([
			['OP99-999'],
		]);
		expect(deckList.entries.find(entry => entry.number === 'OP99-999')?.card?.name).toBe('Late Card');
	});

	it('saves nothing when the lookup fails', async () => {
		const eventId = await stageEvent();
		const player = await stagePlayer(eventId);
		upstream.fail(Object.assign(new Error('bandai-keepr down'), { code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' }));

		await expect(write(eventId, player.id, { text: ZORO_DECK })).rejects.toMatchObject({ code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' });

		expect(await deckRows(player.id)).toEqual([]);
		expect(await playerRow(player.id)).toEqual(player);
		expect(await eventArchetypes(eventId)).toEqual([]);
		expect(published).toEqual([]);
	});

	it.each([
		['hand', true],
		['import', false],
	] as const)('written by %s is hand-edited: %s', async (source, handEdited) => {
		const eventId = await stageEvent();
		const player = await stagePlayer(eventId);

		const { deckList } = await write(eventId, player.id, { text: ZORO_DECK }, source);

		expect(deckList.handEdited).toBe(handEdited);
	});

	it('is replaced by each write under a new id, which the Player references, so readers see it change', async () => {
		const eventId = await stageEvent();
		const player = await stagePlayer(eventId);
		const first = await write(eventId, player.id, { text: ZORO_DECK });
		const before = await playerRow(player.id);

		const second = await write(eventId, player.id, { text: ZORO_DECK });

		expect(second.deckList.id).not.toBe(first.deckList.id);
		expect((await deckRows(player.id)).map(deck => deck.id)).toEqual([second.deckList.id]);
		const after = await playerRow(player.id);
		expect(after.gameData).toEqual({
			type: 'op',
			deckList: { id: second.deckList.id, mainboardCount: 8, leaderNumber: 'OP01-001' },
		});
		expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
		expect(second.player.gameData).toEqual(after.gameData);
	});

	it.each([
		[
			'a pasted Leader line, over the one picked',
			{ text: ZORO_DECK, leaderNumber: 'OP01-016' },
			'OP01-001',
			8,
		],
		[
			'the Leader picked, for a paste with none',
			{ text: '4x OP01-025', leaderNumber: 'OP01-016' },
			'OP01-016',
			4,
		],
		[
			'no Leader, for a paste with none and none picked',
			{ text: '4x OP01-025' },
			null,
			4,
		],
		[
			'the Leader an import marks, known or not',
			{
				entries: [
					{ number: 'OP01-025', quantity: 4 },
					{ number: 'OP09-001', quantity: 1 },
				],
				leaderNumber: 'OP09-001',
			},
			'OP09-001',
			4,
		],
	] as const)('takes %s as its Leader', async (_label, input, leaderNumber, mainboardCount) => {
		const eventId = await stageEvent();
		const player = await stagePlayer(eventId);

		const { deckList } = await write(eventId, player.id, input);

		expect(deckList).toMatchObject({ leaderNumber, mainboardCount });
		expect(deckList.entries.filter(entry => entry.number === leaderNumber)).toHaveLength(leaderNumber === null
			? 0
			: 1);
	});

	it.each([
		['a Magic Event', 'mtg', 404],
	] as const)('is refused on %s', async (_label, game, statusCode) => {
		const eventId = await stageEvent(game);
		const player = await stagePlayer(eventId);

		await expect(write(eventId, player.id, { text: ZORO_DECK })).rejects.toMatchObject({ statusCode });
	});

	it('is refused for another Event\'s Player', async () => {
		const eventId = await stageEvent();
		const other = await stagePlayer(await stageEvent());

		await expect(write(eventId, other.id, { text: ZORO_DECK })).rejects.toMatchObject({ statusCode: 404 });
		expect(upstream.batches()).toEqual([]);
	});
});

describe('a Player\'s Archetype', () => {
	it('is their Leader\'s, one per Leader, named and coloured by it', async () => {
		const eventId = await stageEvent();
		const [ana, ben, cal] = [await stagePlayer(eventId, 'ana'), await stagePlayer(eventId, 'ben'), await stagePlayer(eventId, 'cal')];

		await write(eventId, ana.id, { text: '1x OP01-003\n4x OP01-025' });
		await write(eventId, ben.id, { text: '1x OP01-003\n4x OP01-025' });
		await write(eventId, cal.id, { text: '1x OP01-001\n4x OP01-025' });

		expect(await eventArchetypes(eventId)).toEqual([
			{ name: 'Monkey.D.Luffy', colors: 'Red/Green', leaderCardNumber: 'OP01-003' },
			{ name: 'Roronoa Zoro', colors: 'Red', leaderCardNumber: 'OP01-001' },
		]);
		expect((await archetypeOf(ana.id))!.id).toBe((await archetypeOf(ben.id))!.id);
		const [deck] = await deckRows(ana.id);
		expect(deck!.archetypeId).toBe((await playerRow(ana.id)).archetypeId);
	});

	it('takes the card number, as does every uncustomised Archetype it clashes with, and keeps it when the clash is gone', async () => {
		const eventId = await stageEvent();
		const [ana, ben] = [await stagePlayer(eventId, 'ana'), await stagePlayer(eventId, 'ben')];
		await write(eventId, ana.id, { text: '1x OP01-003' });

		await write(eventId, ben.id, { text: '1x OP05-060' });
		await write(eventId, ben.id, { text: '1x OP01-016' });

		expect(await eventArchetypes(eventId)).toEqual([
			{ name: 'Monkey.D.Luffy (OP01-003)', colors: 'Red/Green', leaderCardNumber: 'OP01-003' },
			{ name: 'Nami', colors: 'Blue', leaderCardNumber: 'OP01-016' },
		]);
		expect(published.filter(message => message.type === 'archetype:updated').map(message => message.payload))
			.toEqual([
				{
					archetype: expect.objectContaining({ name: 'Monkey.D.Luffy (OP01-003)' }),
				},
			]);
	});

	it('leaves a customised Archetype\'s name alone in a clash', async () => {
		const eventId = await stageEvent();
		const [ana, ben] = [await stagePlayer(eventId, 'ana'), await stagePlayer(eventId, 'ben')];
		await write(eventId, ana.id, { text: '1x OP01-003' });
		await archetypeWriteModule().updateArchetype({
			eventId,
			archetypeId: (await archetypeOf(ana.id))!.id,
			input: { chartSeries: 2 },
		});

		await write(eventId, ben.id, { text: '1x OP05-060' });

		expect((await eventArchetypes(eventId)).map(archetype => archetype.name)).toEqual([
			'Monkey.D.Luffy',
			'Monkey.D.Luffy (OP05-060)',
		]);
	});

	it.each([
		['follows their new Leader', '1x OP01-016', 'Nami'],
		['is none for a Leader bandai-keepr does not know', '4x OP01-025', null],
	])('%s', async (_label, text, archetypeName) => {
		const eventId = await stageEvent();
		const player = await stagePlayer(eventId);
		await write(eventId, player.id, { text: '1x OP01-001' });

		await write(eventId, player.id, text === '4x OP01-025'
			? {
					entries: [
						{ number: 'OP09-001', quantity: 1 },
					],
					leaderNumber: 'OP09-001',
				}
			: { text });

		expect((await archetypeOf(player.id))?.name ?? null).toBe(archetypeName);
		expect((await deckRows(player.id))[0]!.archetypeId).toBe((await playerRow(player.id)).archetypeId);
	});

	const emptyings = {
		'by a new Leader': (eventId: number, playerId: number) => write(eventId, playerId, { text: '1x OP01-016' }),
		'by deleting its Player': (eventId: number, playerId: number) => playerUpdateModule().deletePlayer({ eventId, playerId }),
	};
	it.each([
		[
			'is deleted, and the Screens naming it released, when left with no Players',
			'by a new Leader',
			null,
			false,
		],
		[
			'is deleted, and the Screens naming it released, when left with no Players',
			'by deleting its Player',
			null,
			false,
		],
		[
			'is kept when an operator renamed it',
			'by a new Leader',
			{ name: 'Zoro Aggro' },
			true,
		],
		[
			'is kept when an operator renamed it',
			'by deleting its Player',
			{ name: 'Zoro Aggro' },
			true,
		],
		[
			'is kept when an operator pinned its series',
			'by a new Leader',
			{ chartSeries: 3 },
			true,
		],
	] as const)('derived and emptied, %s (%s)', async (_label, emptying, customisation, kept) => {
		const eventId = await stageEvent();
		const player = await stagePlayer(eventId);
		await write(eventId, player.id, { text: '1x OP01-001' });
		const zoro = (await archetypeOf(player.id))!;
		if (customisation)
			await archetypeWriteModule().updateArchetype({ eventId, archetypeId: zoro.id, input: customisation });
		const [screen] = await db.insert(schema.screens)
			.values({
				eventId,
				name: 'Spotlight',
				slug: 'spotlight',
				currentMode: 'archetype-spotlight',
				modeConfigs: {
					'archetype-spotlight': { archetypeId: zoro.id },
				} as never,
				assetCapabilitySeed: `seed-${eventId}`,
				assetCapabilityDigest: `digest-${eventId}`,
			})
			.returning();
		published.length = 0;

		await emptyings[emptying](eventId, player.id);

		const held = await db.query.archetypes.findFirst({
			where: eq(schema.archetypes.id, zoro.id),
		});
		expect(held !== undefined).toBe(kept);
		const types = published.map(message => message.type);
		expect(types.includes('archetype:deleted')).toBe(!kept);
		const stored = await db.query.screens.findFirst({
			where: eq(schema.screens.id, screen!.id),
		});
		expect((stored!.modeConfigs as Record<string, { archetypeId?: number }>)['archetype-spotlight']?.archetypeId)
			.toBe(kept ? zoro.id : undefined);
	});

	it('is kept while another Player holds it', async () => {
		const eventId = await stageEvent();
		const [ana, ben] = [await stagePlayer(eventId, 'ana'), await stagePlayer(eventId, 'ben')];
		await write(eventId, ana.id, { text: '1x OP01-001' });
		await write(eventId, ben.id, { text: '1x OP01-001' });

		await write(eventId, ana.id, { text: '1x OP01-016' });

		expect((await archetypeOf(ben.id))!.name).toBe('Roronoa Zoro');
	});
});

describe('a Player\'s Deck List write announces', () => {
	it('a new Archetype before the Player, then the Archetype it emptied', async () => {
		const eventId = await stageEvent();
		const player = await stagePlayer(eventId);
		await write(eventId, player.id, { text: '1x OP01-001' });
		published.length = 0;

		const { deckList } = await write(eventId, player.id, { text: '1x OP01-016' });

		expect(published.map(message => message.type)).toEqual(['archetype:created', 'player:updated', 'archetype:deleted']);
		expect(published[1]!.payload).toMatchObject({
			player: {
				id: player.id,
				gameData: {
					type: 'op',
					deckList: { id: deckList.id },
				},
			},
		});
	});

	it('to every Session showing the Player, through its corrected snapshot', async () => {
		const eventId = await stageEvent();
		const player = await stagePlayer(eventId);
		const slots = await db.insert(schema.featureMatches)
			.values([
				{
					eventId,
					player1Id: player.id,
					player1Data: { name: '', nickname: 'ana' },
					player2Data: { name: 'Ben' },
				},
				{
					eventId,
					player1Data: { name: 'Cy' },
					player2Id: player.id,
					player2Data: { name: '', nickname: 'ana' },
				},
			])
			.returning();
		const sessions = await Promise.all(slots.map(async slot =>
			(await featureMatchStateService().createSessionForSlot(slot.id, eventId))!));

		const { deckList } = await write(eventId, player.id, { text: ZORO_DECK });

		const shown = await Promise.all(sessions.map(async (session, index) => {
			const active = await db.query.featureMatchSessions.findFirst({
				where: and(eq(schema.featureMatchSessions.id, session.id), eq(schema.featureMatchSessions.status, 'active')),
			});
			return active!.sourceSnapshot[index === 0
				? 'player1'
				: 'player2'].data?.gameData;
		}));
		const expected = {
			type: 'op',
			leader: {
				number: ZORO.number,
				name: ZORO.name,
				colors: ZORO.colors,
				imageUrl: ZORO.imageUrl,
			},
			deckList: { id: deckList.id, mainboardCount: 8, leaderNumber: 'OP01-001' },
		};
		expect(shown).toEqual([expected, expected]);
		expect(published.filter(message => message.type === 'featureMatch:updated')).toHaveLength(2);
	});
});

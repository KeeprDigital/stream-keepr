import type { H3Event } from 'h3';
import type { TcgPlusExportPlayer } from '~~/test/helpers/tcgPlusExport';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { fakeOpCardBulkLookup, knownOpCard, mockOpWriteBoundaries } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { tcgPlusDeck, tcgPlusExport } from '~~/test/helpers/tcgPlusExport';

// The TCG+ Import (ADR-0074) through its preview and import routes, from
// synthetic exports. bandai-keepr is faked at its bulk lookup port, Ably at publish.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const LEADERS = [
	knownOpCard({
		number: 'OP01-001',
		name: 'Roronoa Zoro',
		category: 'leader',
		colors: ['Red'],
	}),
	knownOpCard({
		number: 'OP01-016',
		name: 'Nami',
		category: 'leader',
		colors: ['Blue'],
	}),
];
const CHARACTERS = [
	...tcgPlusDeck('OP01', 13),
	...tcgPlusDeck('OP02', 13),
].map(([number]) => knownOpCard({
	number,
	name: `Card ${number}`,
	category: 'character',
	colors: ['Red', 'Blue'],
}));
let upstream = fakeOpCardBulkLookup([
	...LEADERS,
	...CHARACTERS,
]);
const { published } = mockOpWriteBoundaries(db, () => upstream);
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: { params: unknown }, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: { body: unknown }, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) => Object.assign(new Error(input.message), input));
vi.stubGlobal('useRuntimeConfig', () => ({ bandaiKeeprApiKey: 'test-key', bandaiKeeprApiUrl: 'https://op-api.test' }));

type Handler = (event: H3Event) => Promise<any>;
const previewRoute = (await import('~~/server/api/events/[id]/tcgplus/preview.post')).default as unknown as Handler;
const importRoute = (await import('~~/server/api/events/[id]/tcgplus/import.post')).default as unknown as Handler;
const handWriteRoute = (await import('~~/server/api/events/[id]/players/[playerId]/deck-list.put')).default as unknown as Handler;
const useImportedRoute = (await import('~~/server/api/events/[id]/players/[playerId]/deck-list/use-imported.post')).default as unknown as Handler;

beforeEach(async () => {
	upstream = fakeOpCardBulkLookup([
		...LEADERS,
		...CHARACTERS,
	]);
	published.length = 0;
	await db.delete(schema.cards);
});

afterAll(async () => await harness.close());

/** A legal 50-card Zoro deck: twelve Characters at four, and two of a thirteenth. */
const ZORO_CARDS = [
	...tcgPlusDeck('OP01', 12),
	['OP01-042', 2] as const,
];
const NAMI_CARDS = [
	...tcgPlusDeck('OP02', 12),
	['OP02-042', 2] as const,
];

function zoroPlayer(memberNumber: string, nickname: string, overrides: Partial<TcgPlusExportPlayer> = {}): TcgPlusExportPlayer {
	return {
		memberNumber,
		nickname,
		leader: 'OP01-001',
		cards: ZORO_CARDS,
		...overrides,
	};
}

async function stageEvent(game: 'op' | 'mtg' = 'op') {
	const [event] = await db.insert(schema.events)
		.values({ name: 'One Piece Regional', game, featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

function preview(eventId: number, csv: string) {
	return previewRoute(stubH3Event({
		params: {
			id: String(eventId),
		},
		body: { csv },
	}));
}

function commit(eventId: number, csv: string) {
	return importRoute(stubH3Event({
		params: {
			id: String(eventId),
		},
		body: { csv },
	}));
}

function writeByHand(eventId: number, playerId: number, text: string) {
	return handWriteRoute(stubH3Event({
		params: {
			id: String(eventId),
			playerId: String(playerId),
		},
		body: { text },
	}));
}

function useImported(eventId: number, playerId: number) {
	return useImportedRoute(stubH3Event({
		params: {
			id: String(eventId),
			playerId: String(playerId),
		},
	}));
}

/** Each Player's Deck List id: a write gives a new one. */
async function eventDeckIds(eventId: number) {
	const decks = await db.select({ id: schema.playerDecks.id, playerId: schema.playerDecks.playerId })
		.from(schema.playerDecks)
		.where(eq(schema.playerDecks.eventId, eventId));
	return new Map(decks.map(deck => [deck.playerId, deck.id]));
}

async function eventPlayers(eventId: number) {
	return await db.query.players.findMany({
		where: eq(schema.players.eventId, eventId),
		orderBy: schema.players.id,
	});
}

describe('a TCG+ Import preview', () => {
	it.each([
		[
			'with a BOM and CRLF lines',
			{ bom: true, lineEnding: '\r\n' as const },
		],
		[
			'without a BOM',
			{ bom: false, lineEnding: '\n' as const },
		],
	])('reads an export %s: quoted Nicknames, member numbers kept with their zeros, the Leader anywhere, and saves no Players', async (_label, options) => {
		const eventId = await stageEvent();
		const csv = tcgPlusExport([
			zoroPlayer('0001234', 'Luffy, "Captain"'),
			zoroPlayer('0009999', 'nami', { leader: 'OP01-016', cards: NAMI_CARDS, leaderAt: 'last' }),
			zoroPlayer('42', 'zed', {
				leaderAt: 5,
				cards: [
					['OP01-030', 4, 'Just Watch Me, "Ace"!!!'],
					...ZORO_CARDS.slice(1),
				],
			}),
		], options);

		const answer = await preview(eventId, csv);

		expect(answer.added).toEqual([
			{ memberNumber: '0001234', nickname: 'Luffy, "Captain"', leaderNumber: 'OP01-001' },
			{ memberNumber: '0009999', nickname: 'nami', leaderNumber: 'OP01-016' },
			{ memberNumber: '42', nickname: 'zed', leaderNumber: 'OP01-001' },
		]);
		expect(answer.warnings.ruleBreaches).toEqual([]);
		expect(await eventPlayers(eventId)).toEqual([]);
	});

	it('counts each Leader, adds up a card exported over several printings, and warns of rule breaches and unknown cards', async () => {
		const eventId = await stageEvent();
		const csv = tcgPlusExport([
			zoroPlayer('1', 'ana', {
				splitPrintings: ['OP01-030'],
			}),
			zoroPlayer('2', 'ben'),
			zoroPlayer('3', 'cal', {
				leader: 'OP01-016',
				cards: [
					...NAMI_CARDS,
					['OP99-999', 1],
				],
			}),
			zoroPlayer('4', 'dee', {
				leader: 'OP99-001',
				cards: [
					['OP99-999', 5],
				],
			}),
		]);

		const answer = await preview(eventId, csv);

		expect(answer.leaders).toEqual([
			{
				number: 'OP01-001',
				name: 'Roronoa Zoro',
				colors: ['Red'],
				playerCount: 2,
			},
			{
				number: 'OP01-016',
				name: 'Nami',
				colors: ['Blue'],
				playerCount: 1,
			},
			{
				number: 'OP99-001',
				name: null,
				colors: [],
				playerCount: 1,
			},
		]);
		expect(answer.warnings.ruleBreaches.map((breach: any) => [
			breach.nickname,
			breach.warnings.map((warning: any) => warning.code),
		])).toEqual([
			[
				'cal',
				['MAINBOARD_COUNT'],
			],
			[
				'dee',
				['MAINBOARD_COUNT', 'TOO_MANY_COPIES'],
			],
		]);
		expect(answer.warnings.unknownCards).toEqual([
			{ number: 'OP99-999', playerCount: 2 },
			{ number: 'OP99-001', playerCount: 1 },
		]);
		expect(answer.added.map((player: any) => player.nickname)).toEqual(['ana', 'ben', 'cal', 'dee']);
	});

	it.each([
		['a file that is not a TCG+ export', 'name,deck\nana,zoro\n'],
		[
			'an export with an unreadable quantity',
			tcgPlusExport([
				zoroPlayer('1', 'ana', {
					cards: [
						['OP01-030', 0],
					],
				}),
			]),
		],
		[
			'an export with no players',
			tcgPlusExport([]),
		],
	])('refuses %s', async (_label, csv) => {
		const eventId = await stageEvent();

		await expect(preview(eventId, csv)).rejects.toMatchObject({
			statusCode: 422,
			data: { code: 'TCGPLUS_EXPORT_INVALID' },
		});
	});

	it('is refused on a Magic Event', async () => {
		const eventId = await stageEvent('mtg');

		await expect(preview(eventId, tcgPlusExport([
			zoroPlayer('1', 'ana'),
		]))).rejects.toMatchObject({ statusCode: 404 });
	});
});

describe('a TCG+ Import', () => {
	it('adds each Player by member number with their Nickname and no name, and their Deck List as imported', async () => {
		const eventId = await stageEvent();

		const answer = await commit(eventId, tcgPlusExport([
			zoroPlayer('0001234', 'ana', {
				splitPrintings: ['OP01-030'],
			}),
			zoroPlayer('0005678', 'ben', { leader: 'OP01-016', cards: NAMI_CARDS }),
		]));

		expect(answer.results).toEqual({
			created: 2,
			updated: 0,
			deactivated: 0,
			deckListsWritten: 2,
			handEditsKept: 0,
		});
		const players = await eventPlayers(eventId);
		expect(players.map(player => [
			player.externalSource,
			player.externalId,
			player.nickname,
			player.name,
			player.isActive,
		])).toEqual([
			['tcgplus', '0001234', 'ana', '', true],
			['tcgplus', '0005678', 'ben', '', true],
		]);
		const [deck] = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.playerId, players[0]!.id));
		expect(deck).toMatchObject({ leaderCardNumber: 'OP01-001', handEdited: false, name: 'Roronoa Zoro' });
		const entries = await db.select({ number: schema.cards.cardNumber, quantity: schema.playerDeckCards.quantity })
			.from(schema.playerDeckCards)
			.innerJoin(schema.cards, eq(schema.cards.id, schema.playerDeckCards.cardId))
			.where(eq(schema.playerDeckCards.deckId, deck!.id));
		expect(entries).toHaveLength(14);
		expect(entries.find(entry => entry.number === 'OP01-030')).toEqual({ number: 'OP01-030', quantity: 4 });
		expect(players[0]!.archetypeId).toBe(deck!.archetypeId);
		expect(published.map(message => message.type)).toEqual(['archetype:created', 'archetype:created', 'tcgplus:imported']);
		expect(published.at(-1)!.payload).toEqual({ playerCount: 2, deckCount: 2 });
	});

	it('on re-import refreshes Nicknames, keeps operator names, replaces only changed Deck Lists, and marks the missing inactive', async () => {
		const eventId = await stageEvent();
		await commit(eventId, tcgPlusExport([
			zoroPlayer('1', 'ana'),
			zoroPlayer('2', 'ben'),
			zoroPlayer('3', 'cal'),
		]));
		const [ana, ben, cal] = await eventPlayers(eventId);
		await db.update(schema.players).set({ name: 'Ana Lima' }).where(eq(schema.players.id, ana!.id));
		const decksBefore = await eventDeckIds(eventId);
		const csv = tcgPlusExport([
			zoroPlayer('1', 'ana_tcg'),
			zoroPlayer('2', 'ben', { leader: 'OP01-016', cards: NAMI_CARDS }),
		]);

		const previewed = await preview(eventId, csv);
		published.length = 0;
		const answer = await commit(eventId, csv);

		expect(previewed).toMatchObject({
			added: [],
			deckListChanged: [
				{ playerId: ben!.id, shownAs: 'ben', memberNumber: '2' },
			],
			deactivated: [
				{ playerId: cal!.id, shownAs: 'cal', memberNumber: '3' },
			],
		});
		expect(answer.results).toEqual({
			created: 0,
			updated: 1,
			deactivated: 1,
			deckListsWritten: 1,
			handEditsKept: 0,
		});
		expect((await eventPlayers(eventId)).map(player => [player.name, player.nickname, player.isActive])).toEqual([
			['Ana Lima', 'ana_tcg', true],
			['', 'ben', true],
			['', 'cal', false],
		]);
		const decksAfter = await eventDeckIds(eventId);
		expect([ana, ben, cal].map(player => decksAfter.get(player!.id) === decksBefore.get(player!.id))).toEqual([true, false, true]);
		expect(published.map(message => message.type)).toEqual(['archetype:created', 'tcgplus:imported']);
	});

	it('changes nothing, and announces nothing, when re-imported unchanged', async () => {
		const eventId = await stageEvent();
		const csv = tcgPlusExport([
			zoroPlayer('1', 'ana'),
		]);
		await commit(eventId, csv);
		const before = await eventPlayers(eventId);
		published.length = 0;

		const answer = await commit(eventId, csv);

		expect(answer.results).toEqual({
			created: 0,
			updated: 0,
			deactivated: 0,
			deckListsWritten: 0,
			handEditsKept: 0,
		});
		expect((await eventPlayers(eventId)).map(player => player.updatedAt)).toEqual(before.map(player => player.updatedAt));
		expect(published).toEqual([]);
	});

	it('looks up only the card numbers the catalogue lacks, an unknown one again on each import', async () => {
		const eventId = await stageEvent();
		const csv = tcgPlusExport([
			zoroPlayer('1', 'ana', {
				cards: [
					...ZORO_CARDS.slice(0, 2),
					['OP99-999', 1],
				],
			}),
		]);
		await commit(eventId, csv);
		upstream.reset();

		await commit(eventId, csv);

		expect(upstream.batches()).toEqual([
			['OP99-999'],
		]);
	});

	it('names an Unresolved Deck Card once bandai-keepr knows it', async () => {
		const eventId = await stageEvent();
		const csv = tcgPlusExport([
			zoroPlayer('1', 'ana', {
				cards: [
					['OP99-999', 1],
				],
			}),
		]);
		await commit(eventId, csv);
		upstream.know(knownOpCard({
			number: 'OP99-999',
			name: 'Late Card',
			category: 'character',
			colors: ['Red'],
		}));

		const answer = await commit(eventId, csv);

		expect(answer.results.deckListsWritten).toBe(1);
		const [ana] = await eventPlayers(eventId);
		const [deck] = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.playerId, ana!.id));
		expect(await db.select().from(schema.playerDeckUnresolvedCards).where(eq(schema.playerDeckUnresolvedCards.deckId, deck!.id))).toEqual([]);
	});

	it('keeps a hand-edited Deck List the export differs from, flagged in the preview', async () => {
		const eventId = await stageEvent();
		await commit(eventId, tcgPlusExport([
			zoroPlayer('1', 'ana'),
			zoroPlayer('2', 'ben'),
		]));
		const [ana] = await eventPlayers(eventId);
		const handEdit = await writeByHand(eventId, ana!.id, '1x OP01-016\n4x OP02-030');
		const csv = tcgPlusExport([
			zoroPlayer('1', 'ana', { cards: NAMI_CARDS }),
			zoroPlayer('2', 'ben'),
		]);

		const previewed = await preview(eventId, csv);
		const answer = await commit(eventId, csv);

		expect(previewed.deckListChanged).toEqual([]);
		expect(previewed.warnings.handEditConflicts).toEqual([
			{ playerId: ana!.id, shownAs: 'ana', memberNumber: '1' },
		]);
		expect(answer.results).toMatchObject({ deckListsWritten: 0, handEditsKept: 1 });
		const [deck] = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.playerId, ana!.id));
		expect(deck).toMatchObject({ id: handEdit.deckList.id, handEdited: true, leaderCardNumber: 'OP01-016' });
	});

	it('flags a Player added by hand whose name or Nickname matches an incoming Nickname, and merges nothing', async () => {
		const eventId = await stageEvent();
		const [byName, byNickname] = await db.insert(schema.players)
			.values([
				{ eventId, name: 'Ana', nickname: null },
				{ eventId, name: '', nickname: 'BEN ' },
				{ eventId, name: 'Cal', nickname: null },
			])
			.returning();
		const csv = tcgPlusExport([
			zoroPlayer('1', 'ana'),
			zoroPlayer('2', 'ben'),
		]);

		const previewed = await preview(eventId, csv);
		await commit(eventId, csv);

		expect(previewed.warnings.possibleDuplicates).toEqual([
			{
				playerId: byName!.id,
				shownAs: 'Ana',
				memberNumber: null,
				nickname: 'ana',
				incomingMemberNumber: '1',
			},
			{
				playerId: byNickname!.id,
				shownAs: 'BEN',
				memberNumber: null,
				nickname: 'ben',
				incomingMemberNumber: '2',
			},
		]);
		const players = await eventPlayers(eventId);
		expect(players.map(player => [player.externalSource, player.isActive, player.gameData?.type ?? null])).toEqual([
			[null, true, null],
			[null, true, null],
			[null, true, null],
			['tcgplus', true, 'op'],
			['tcgplus', true, 'op'],
		]);
	});

	it('saves nothing when the card lookup fails', async () => {
		const eventId = await stageEvent();
		upstream.fail(Object.assign(new Error('bandai-keepr down'), { code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' }));

		await expect(commit(eventId, tcgPlusExport([
			zoroPlayer('1', 'ana'),
		]))).rejects.toMatchObject({ code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' });

		expect(await eventPlayers(eventId)).toEqual([]);
		expect(await db.select().from(schema.archetypes).where(eq(schema.archetypes.eventId, eventId))).toEqual([]);
		expect(published).toEqual([]);
	});
});

describe('use imported Deck List', () => {
	it('drops a hand edit for the Deck List the last import brought, so the next import applies again', async () => {
		const eventId = await stageEvent();
		await commit(eventId, tcgPlusExport([
			zoroPlayer('1', 'ana'),
		]));
		const [ana] = await eventPlayers(eventId);
		await writeByHand(eventId, ana!.id, '1x OP01-016\n4x OP02-030');

		const answer = await useImported(eventId, ana!.id);
		await commit(eventId, tcgPlusExport([
			zoroPlayer('1', 'ana', { leader: 'OP01-016', cards: NAMI_CARDS }),
		]));

		expect(answer.deckList).toMatchObject({ handEdited: false, leaderNumber: 'OP01-001', mainboardCount: 50 });
		const [deck] = await db.select().from(schema.playerDecks).where(and(eq(schema.playerDecks.eventId, eventId), eq(schema.playerDecks.playerId, ana!.id)));
		expect(deck).toMatchObject({ handEdited: false, leaderCardNumber: 'OP01-016' });
	});

	it('is refused for a Player no import brought', async () => {
		const eventId = await stageEvent();
		const [player] = await db.insert(schema.players).values({ eventId, name: 'Ana' }).returning();

		await expect(useImported(eventId, player!.id)).rejects.toMatchObject({ statusCode: 404 });
	});
});

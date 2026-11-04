import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { fakeOpCardBulkLookup, knownOpCard, mockOpWriteBoundaries } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// OP Unresolved Deck Cards (ADR-0074): listed Event-wide by card number, retried
// through the bulk lookup, or resolved to a picked card in every Deck List holding
// them. bandai-keepr is faked at its bulk lookup port, Ably at publish.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
const runtimeConfig = { bandaiKeeprApiKey: 'test-key', bandaiKeeprApiUrl: 'https://op-api.test' };
vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const ZORO = knownOpCard({
	number: 'OP01-001',
	name: 'Roronoa Zoro',
	category: 'leader',
	colors: ['Red'],
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
/** A Leader bandai-keepr learns only after the Deck Lists holding it were written. */
const LATE_LEADER = knownOpCard({
	number: 'OP13-079',
	name: 'Imu',
	category: 'leader',
	colors: ['Black'],
});
/** A character bandai-keepr learns late. */
const LATE = knownOpCard({
	number: 'OP99-999',
	name: 'Late Card',
	category: 'event',
	colors: ['Red'],
	cost: 1,
});
let upstream = fakeOpCardBulkLookup([ZORO, RED, BLUE]);
const { published } = mockOpWriteBoundaries(db, () => upstream);

const { opDeckListWriteModule } = await import('~~/server/modules/op-deck-list-write');
const { opUnresolvedDeckCardModule } = await import('~~/server/modules/op-unresolved-deck-card');
const { featureMatchDeckListService } = await import('~~/server/services/featureMatchDeckList');

beforeEach(async () => {
	upstream = fakeOpCardBulkLookup([ZORO, RED, BLUE]);
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

async function stagePlayer(eventId: number, nickname: string, name = '') {
	const [player] = await db.insert(schema.players)
		.values({ eventId, name, nickname })
		.returning();
	return player!;
}

async function stageSlot(eventId: number, player1Name: string) {
	const [slot] = await db.insert(schema.featureMatches)
		.values({
			eventId,
			player1Data: { name: player1Name },
			player2Data: { name: 'Other' },
		})
		.returning();
	return slot!;
}

function writePlayer(eventId: number, playerId: number, text: string, source: 'hand' | 'import' = 'import', leaderNumber?: string) {
	return opDeckListWriteModule().write({
		eventId,
		owner: { kind: 'player', playerId },
		input: { text, leaderNumber },
		source,
	});
}

function pasteToSlot(eventId: number, slotId: number, text: string) {
	return opDeckListWriteModule().write({
		eventId,
		owner: { kind: 'slotSide', slotId, side: 'player1' },
		input: { text },
		source: 'hand',
	});
}

const unresolved = opUnresolvedDeckCardModule();

describe('an OP Event\'s Unresolved Deck Cards', () => {
	it('are listed by card number, Event-wide, with each Deck List holding one and its copies', async () => {
		const eventId = await stageEvent();
		const otherEventId = await stageEvent();
		const ana = await stagePlayer(eventId, 'ana');
		const ben = await stagePlayer(eventId, 'ben', 'Benjamin');
		const slot = await stageSlot(eventId, 'Cora');
		await writePlayer(eventId, ana.id, '1x OP01-001\n4x OP01-025\n4x OP99-999');
		await writePlayer(eventId, ben.id, '1x OP01-001\n2x OP99-999\n3x OP98-001');
		await pasteToSlot(eventId, slot.id, '1x OP01-001\n1x OP99-999');
		await writePlayer(otherEventId, (await stagePlayer(otherEventId, 'dan')).id, '4x OP97-001');

		const list = await unresolved.list({ eventId });

		expect(list).toEqual([
			{
				number: 'OP99-999',
				copies: 7,
				deckLists: [
					{
						holder: { kind: 'player', playerId: ana.id, name: 'ana' },
						quantity: 4,
						asLeader: false,
					},
					{
						holder: { kind: 'player', playerId: ben.id, name: 'Benjamin' },
						quantity: 2,
						asLeader: false,
					},
					{
						holder: {
							kind: 'slotSide',
							slotId: slot.id,
							side: 'player1',
							name: 'Cora',
						},
						quantity: 1,
						asLeader: false,
					},
				],
			},
			{
				number: 'OP98-001',
				copies: 3,
				deckLists: [
					{
						holder: { kind: 'player', playerId: ben.id, name: 'Benjamin' },
						quantity: 3,
						asLeader: false,
					},
				],
			},
		]);
	});
});

async function deckOf(eventId: number, playerId: number) {
	return (await opDeckListWriteModule().readPlayer({ eventId, playerId }))!;
}

async function sideDeckList(eventId: number, slotId: number) {
	const slot = (await db.query.featureMatches.findFirst({
		where: eq(schema.featureMatches.id, slotId),
	}))!;
	const reference = (slot.player1Data?.gameData as { featureMatchDeckList: { id: number } }).featureMatchDeckList;
	return (await featureMatchDeckListService().findById(reference.id, slotId, eventId))!;
}

describe('retrying an Unresolved Deck Card', () => {
	it('resolves every Player and Slot side Deck List holding it once bandai-keepr knows the card, under new ids', async () => {
		const eventId = await stageEvent();
		const ana = await stagePlayer(eventId, 'ana');
		const slot = await stageSlot(eventId, 'Cora');
		const before = await writePlayer(eventId, ana.id, '1x OP01-001\n4x OP99-999\n2x OP98-001');
		const pasted = await pasteToSlot(eventId, slot.id, '1x OP01-001\n1x OP99-999');
		upstream.know(LATE);
		upstream.reset();

		const answer = await unresolved.retry({ eventId, number: 'OP99-999' });

		expect(answer).toEqual({
			number: 'OP99-999',
			card: { number: 'OP99-999', name: 'Late Card' },
			rewritten: 2,
		});
		const deck = await deckOf(eventId, ana.id);
		expect(deck.id).not.toBe(before.deckList.id);
		expect(deck.entries.find(entry => entry.number === 'OP99-999')).toMatchObject({
			quantity: 4,
			card: { name: 'Late Card' },
		});
		const side = await sideDeckList(eventId, slot.id);
		expect(side.id).not.toBe(pasted.deckList.id);
		expect(side.entries.find(entry => entry.number === 'OP99-999')).toMatchObject({
			quantity: 1,
			card: { name: 'Late Card' },
		});
		expect((await unresolved.list({ eventId })).map(card => card.number)).toEqual(['OP98-001']);
		expect(upstream.batches()[0]).toEqual(['OP99-999']);
	});

	it('rewrites nothing while bandai-keepr still does not know the card', async () => {
		const eventId = await stageEvent();
		const ana = await stagePlayer(eventId, 'ana');
		const before = await writePlayer(eventId, ana.id, '1x OP01-001\n4x OP99-999');
		published.length = 0;

		const answer = await unresolved.retry({ eventId, number: 'OP99-999' });

		expect(answer).toEqual({ number: 'OP99-999', card: null, rewritten: 0 });
		expect((await deckOf(eventId, ana.id)).id).toBe(before.deckList.id);
		expect(published).toEqual([]);
	});

	it('saves nothing when the lookup fails', async () => {
		const eventId = await stageEvent();
		const ana = await stagePlayer(eventId, 'ana');
		const before = await writePlayer(eventId, ana.id, '1x OP01-001\n4x OP99-999');
		upstream.know(LATE);
		upstream.fail(new Error('bandai-keepr down'));

		await expect(unresolved.retry({ eventId, number: 'OP99-999' })).rejects.toThrow('bandai-keepr down');

		expect((await deckOf(eventId, ana.id)).id).toBe(before.deckList.id);
	});

	it.each([
		['hand', true],
		['import', false],
	] as const)('keeps a Deck List written by %s as hand-edited: %s', async (source, handEdited) => {
		const eventId = await stageEvent();
		const ana = await stagePlayer(eventId, 'ana');
		await writePlayer(eventId, ana.id, '1x OP01-001\n4x OP99-999', source);
		upstream.know(LATE);

		await unresolved.retry({ eventId, number: 'OP99-999' });

		expect((await deckOf(eventId, ana.id)).handEdited).toBe(handEdited);
	});
});

describe('resolving an Unresolved Deck Card to a picked card', () => {
	it('rewrites the number in every Player and Slot side Deck List in the Event holding it, adding into the picked card\'s entry', async () => {
		const eventId = await stageEvent();
		const otherEventId = await stageEvent();
		const ana = await stagePlayer(eventId, 'ana');
		const slot = await stageSlot(eventId, 'Cora');
		const dan = await stagePlayer(otherEventId, 'dan');
		await writePlayer(eventId, ana.id, '1x OP01-001\n2x OP01-025\n3x OP91-025');
		await pasteToSlot(eventId, slot.id, '1x OP01-001\n1x OP91-025');
		const untouched = await writePlayer(otherEventId, dan.id, '1x OP01-001\n3x OP91-025');

		const answer = await unresolved.resolve({ eventId, number: 'OP91-025', cardNumber: 'OP01-025' });

		expect(answer).toEqual({
			number: 'OP91-025',
			card: { number: 'OP01-025', name: 'Roronoa Zoro' },
			rewritten: 2,
		});
		expect((await deckOf(eventId, ana.id)).entries.map(({ number, quantity }) => ({ number, quantity }))).toEqual([
			{ number: 'OP01-001', quantity: 1 },
			{ number: 'OP01-025', quantity: 5 },
		]);
		expect((await sideDeckList(eventId, slot.id)).entries.map(({ number, quantity }) => ({ number, quantity }))).toEqual([
			{ number: 'OP01-001', quantity: 1 },
			{ number: 'OP01-025', quantity: 1 },
		]);
		expect(await unresolved.list({ eventId })).toEqual([]);
		expect((await deckOf(otherEventId, dan.id)).id).toBe(untouched.deckList.id);
	});

	it('gives the Players whose Leader it was their Leader\'s Archetype, announced with the Player', async () => {
		const eventId = await stageEvent();
		const ana = await stagePlayer(eventId, 'ana');
		await writePlayer(eventId, ana.id, '4x OP01-025', 'import', 'OP13-097');
		expect(await unresolved.list({ eventId })).toMatchObject([
			{
				number: 'OP13-097',
				deckLists: [
					{ asLeader: true },
				],
			},
		]);
		upstream.know(LATE_LEADER);
		published.length = 0;

		await unresolved.resolve({ eventId, number: 'OP13-097', cardNumber: 'OP13-079' });

		const player = (await db.query.players.findFirst({
			where: eq(schema.players.id, ana.id),
		}))!;
		const archetype = await db.query.archetypes.findFirst({
			where: eq(schema.archetypes.id, player.archetypeId!),
		});
		expect(archetype).toMatchObject({ name: 'Imu', leaderCardNumber: 'OP13-079' });
		expect((await deckOf(eventId, ana.id)).leaderNumber).toBe('OP13-079');
		expect(published.map(message => message.type)).toEqual(['archetype:created', 'player:updated']);
	});

	it.each([
		[
			'a card bandai-keepr does not know',
			'OP99-999',
			'OP77-777',
			400,
		],
		[
			'a number no Deck List holds',
			'OP55-555',
			'OP01-025',
			404,
		],
	])('refuses %s, writing nothing', async (_case, number, cardNumber, statusCode) => {
		const eventId = await stageEvent();
		const ana = await stagePlayer(eventId, 'ana');
		const before = await writePlayer(eventId, ana.id, '1x OP01-001\n4x OP99-999');

		await expect(unresolved.resolve({ eventId, number, cardNumber })).rejects.toMatchObject({ statusCode });

		expect((await deckOf(eventId, ana.id)).id).toBe(before.deckList.id);
	});

	it.each([
		[
			'resolve',
			(eventId: number) => unresolved.resolve({ eventId, number: 'OP99-999', cardNumber: 'OP01-025' }),
		],
		[
			'retry',
			(eventId: number) => unresolved.retry({ eventId, number: 'OP99-999' }),
		],
		[
			'list',
			(eventId: number) => unresolved.list({ eventId }),
		],
	])('is refused on a Magic: The Gathering Event: %s', async (_action, act) => {
		const eventId = await stageEvent('mtg');

		await expect(act(eventId)).rejects.toMatchObject({ statusCode: 404 });
	});
});

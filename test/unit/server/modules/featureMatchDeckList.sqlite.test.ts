import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { fakeOpCardBulkLookup, knownOpCard, mockOpWriteBoundaries } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Feature Match Deck List belongs to a Slot side (ADR-0057): it stays until replaced
// or its side is cleared, moves with its player, and a replacement reaches the Session.
// Its cards come from the card catalogue; bandai-keepr is faked at its bulk lookup port.

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
	power: 5000,
	counter: 1000,
});
const BLUE = knownOpCard({
	number: 'OP01-040',
	name: 'Usopp',
	category: 'character',
	colors: ['Blue'],
	cost: 2,
	power: 3000,
	counter: 1000,
});
const LATE = knownOpCard({
	number: 'OP99-999',
	name: 'Late Card',
	category: 'event',
	colors: ['Red'],
	cost: 1,
});
let upstream = fakeOpCardBulkLookup([ZORO, NAMI, RED, BLUE]);
mockOpWriteBoundaries(db, () => upstream);

const { featureMatchDeckListModule } = await import('~~/server/modules/feature-match-deck-list');
const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');
const { featureMatchDeckListService } = await import('~~/server/services/featureMatchDeckList');

const ZORO_DECK = '1x OP01-001 Roronoa Zoro\n4x OP01-025\n4x OP99-999';
const NAMI_DECK = '1x OP01-016\n4x OP01-040';

beforeEach(async () => {
	upstream = fakeOpCardBulkLookup([ZORO, NAMI, RED, BLUE]);
	runtimeConfig.bandaiKeeprApiKey = 'test-key';
	// The catalogue is global, so each test starts it empty.
	await db.delete(schema.cards);
});

afterAll(async () => {
	await harness.close();
});

async function stageSlot(game: 'op' | 'mtg' = 'op') {
	const [event] = await db.insert(schema.events)
		.values({ name: 'One Piece Regional', game, featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [slot] = await db.insert(schema.featureMatches)
		.values({
			eventId,
			player1Data: { name: 'Ana', pronouns: 'she/her' },
			player2Data: { name: 'Ben' },
		})
		.returning();
	const session = (await featureMatchStateService().createSessionForSlot(slot!.id, eventId))!;
	return { eventId, slotId: slot!.id, session };
}

async function slotRow(slotId: number) {
	return (await db.query.featureMatches.findFirst({
		where: eq(schema.featureMatches.id, slotId),
	}))!;
}

async function sessionSnapshot(slotId: number) {
	const slot = await slotRow(slotId);
	return (await db.query.featureMatchSessions.findFirst({
		where: eq(schema.featureMatchSessions.id, slot.activeSessionId!),
	}))!;
}

async function catalogueNumbers() {
	const rows = await db.select({ number: schema.cards.cardNumber })
		.from(schema.cards)
		.where(eq(schema.cards.game, 'op'));
	return rows.map(row => row.number).toSorted();
}

async function deckListIds(slotId: number) {
	const rows = await db.select({ id: schema.featureMatchDeckLists.id })
		.from(schema.featureMatchDeckLists)
		.where(eq(schema.featureMatchDeckLists.slotId, slotId));
	return rows.map(row => row.id);
}

function save(eventId: number, slotId: number, side: 'player1' | 'player2', text: string) {
	return featureMatchDeckListModule().save({ eventId, slotId, side, text });
}

describe('previewing a pasted Deck List', () => {
	it('resolves each card number once, keeps unknown ones as numbers, and warns', async () => {
		const { eventId } = await stageSlot();

		const answer = await featureMatchDeckListModule().preview({ eventId, text: `${ZORO_DECK}\n2x OP01-025` });

		expect(answer).toMatchObject({
			available: true,
			deckList: {
				leaderNumber: 'OP01-001',
				mainboardCount: 10,
				entries: [
					{
						number: 'OP01-001',
						quantity: 1,
						card: {
							name: 'Roronoa Zoro',
							category: 'leader',
							colors: ['Red'],
							imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
						},
					},
					{
						number: 'OP01-025',
						quantity: 6,
						card: {
							name: 'Roronoa Zoro',
							category: 'character',
							cost: 3,
							power: 5000,
							counter: 1000,
						},
					},
					{ number: 'OP99-999', quantity: 4, card: null },
				],
			},
		});
		if (!answer.available)
			throw new Error('unavailable');
		expect(answer.deckList.warnings.map(warning => warning.code)).toContain('UNKNOWN_CARD');
		expect(upstream.batches()).toEqual([
			['OP01-001', 'OP01-025', 'OP99-999'],
		]);
	});

	it('answers unavailable when no bandai-keepr is configured', async () => {
		const { eventId } = await stageSlot();
		runtimeConfig.bandaiKeeprApiKey = '';

		expect(await featureMatchDeckListModule().preview({ eventId, text: ZORO_DECK })).toEqual({ available: false });
	});

	it('is refused on a Magic Event', async () => {
		const { eventId } = await stageSlot('mtg');

		await expect(featureMatchDeckListModule().preview({ eventId, text: ZORO_DECK })).rejects.toMatchObject({ statusCode: 404 });
	});
});

describe('a pasted Deck List\'s cards', () => {
	it('are looked up only when the catalogue lacks them, all in one batch', async () => {
		const { eventId, slotId } = await stageSlot();
		await save(eventId, slotId, 'player1', ZORO_DECK);
		await featureMatchDeckListModule().preview({ eventId, text: `${NAMI_DECK}\n4x OP01-025` });
		await save(eventId, slotId, 'player2', `${NAMI_DECK}\n4x OP01-025`);

		expect(upstream.batches()).toEqual([
			['OP01-001', 'OP01-025', 'OP99-999'],
			['OP01-016', 'OP01-040'],
		]);
		expect(await catalogueNumbers()).toEqual([
			'OP01-001',
			'OP01-016',
			'OP01-025',
			'OP01-040',
		]);
	});

	it('keep an unknown number out of the catalogue, ask for it again, and show it once known', async () => {
		const { eventId, slotId } = await stageSlot();
		const first = await save(eventId, slotId, 'player1', ZORO_DECK);
		if (!first.available)
			throw new Error('unavailable');
		expect(await catalogueNumbers()).not.toContain('OP99-999');
		upstream.know(LATE);

		const second = await save(eventId, slotId, 'player2', '4x OP99-999');
		if (!second.available)
			throw new Error('unavailable');

		expect(upstream.batches()).toEqual([
			['OP01-001', 'OP01-025', 'OP99-999'],
			['OP99-999'],
		]);
		expect(second.deckList.entries).toEqual([
			{
				number: 'OP99-999',
				quantity: 4,
				card: expect.objectContaining({ name: 'Late Card', category: 'event' }),
			},
		]);
		const reread = await featureMatchDeckListModule().read({ eventId, slotId, deckListId: first.deckList.id });
		expect(reread.entries.find(entry => entry.number === 'OP99-999')?.card).toMatchObject({ name: 'Late Card' });
		expect(reread.warnings.map(warning => warning.code)).not.toContain('UNKNOWN_CARD');
	});

	it('fail the paste whole when the lookup fails', async () => {
		const { eventId, slotId } = await stageSlot();
		upstream.fail(Object.assign(new Error('bandai-keepr down'), { code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' }));

		await expect(save(eventId, slotId, 'player1', ZORO_DECK)).rejects.toMatchObject({ code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' });

		expect(await deckListIds(slotId)).toEqual([]);
		expect((await slotRow(slotId)).player1Data).toEqual({ name: 'Ana', pronouns: 'she/her' });
		expect(await catalogueNumbers()).toEqual([]);
	});

	it('are taken however many numbers the paste names', async () => {
		const { eventId, slotId } = await stageSlot();
		const numbers = Array.from({ length: 120 }, (_, index) => `OP80-${String(index).padStart(3, '0')}`);

		const answer = await save(eventId, slotId, 'player1', numbers.map(number => `1x ${number}`).join('\n'));
		if (!answer.available)
			throw new Error('unavailable');

		expect(answer.deckList.entries).toHaveLength(120);
		expect(upstream.batches()).toEqual([numbers]);
	});
});

describe('a Feature Match Deck List on a Slot side', () => {
	it('is saved despite its warnings, sets the side\'s Leader, and reaches the active Session', async () => {
		const { eventId, slotId, session } = await stageSlot();

		const answer = await save(eventId, slotId, 'player1', ZORO_DECK);
		if (!answer.available)
			throw new Error('unavailable');

		expect(answer.deckList).toMatchObject({ leaderNumber: 'OP01-001', mainboardCount: 8, sourceText: ZORO_DECK });
		const expectedGameData = {
			type: 'op',
			leader: {
				number: 'OP01-001',
				name: 'Roronoa Zoro',
				colors: ['Red'],
				imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
			},
			featureMatchDeckList: { id: answer.deckList.id, mainboardCount: 8 },
		};
		// The side references the Leader by number; reads show the catalogue's card (ADR-0074).
		expect((await slotRow(slotId)).player1Data).toEqual({
			name: 'Ana',
			pronouns: 'she/her',
			gameData: {
				...expectedGameData,
				leader: { number: 'OP01-001' },
			},
		});
		expect(answer.featureMatch.player1Data).toEqual({ name: 'Ana', pronouns: 'she/her', gameData: expectedGameData });
		const active = await sessionSnapshot(slotId);
		expect(active.id).toBe(session.id);
		expect(active.sourceSnapshot.player1.data).toMatchObject({ name: 'Ana', gameData: expectedGameData });
		expect(await featureMatchDeckListModule().read({ eventId, slotId, deckListId: answer.deckList.id }))
			.toMatchObject({ entries: answer.deckList.entries });
	});

	it('is replaced by a new paste, which reaches the Session and leaves no old list behind', async () => {
		const { eventId, slotId, session } = await stageSlot();
		const first = await save(eventId, slotId, 'player1', ZORO_DECK);
		const second = await save(eventId, slotId, 'player1', NAMI_DECK);
		if (!first.available || !second.available)
			throw new Error('unavailable');

		expect(await deckListIds(slotId)).toEqual([second.deckList.id]);
		const active = await sessionSnapshot(slotId);
		expect(active.id).toBe(session.id);
		expect(active.sourceSnapshot.player1.data?.gameData).toMatchObject({
			leader: { number: 'OP01-016' },
			featureMatchDeckList: { id: second.deckList.id, mainboardCount: 4 },
		});
	});

	it('keeps the side\'s Leader when the paste has none', async () => {
		const { eventId, slotId } = await stageSlot();
		await save(eventId, slotId, 'player1', ZORO_DECK);
		await save(eventId, slotId, 'player1', '4x OP01-040');

		expect((await slotRow(slotId)).player1Data?.gameData).toMatchObject({
			leader: { number: 'OP01-001' },
		});
	});

	it('goes with its side when the side is cleared, and stays when the other side is', async () => {
		const { eventId, slotId } = await stageSlot();
		const kept = await save(eventId, slotId, 'player1', ZORO_DECK);
		await save(eventId, slotId, 'player2', NAMI_DECK);
		if (!kept.available)
			throw new Error('unavailable');

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player2Data: null },
		});

		expect(await deckListIds(slotId)).toEqual([kept.deckList.id]);
		expect((await slotRow(slotId)).player2Data).toBeNull();
	});

	it('moves with its player on SwapPlayers, and a later replacement lands on that player', async () => {
		const { eventId, slotId, session } = await stageSlot();
		await save(eventId, slotId, 'player1', ZORO_DECK);
		await featureMatchStateService().applyCommand(session.id, eventId, {
			commandId: 'swap',
			type: 'SwapPlayers',
			payload: {},
			baseSequence: (await sessionSnapshot(slotId)).sequence,
		});

		const replaced = await save(eventId, slotId, 'player1', NAMI_DECK);
		if (!replaced.available)
			throw new Error('unavailable');

		const { player1, player2 } = (await sessionSnapshot(slotId)).sourceSnapshot;
		expect(player1.data?.name).toBe('Ben');
		expect(player2.data).toMatchObject({
			name: 'Ana',
			gameData: {
				featureMatchDeckList: { id: replaced.deckList.id, mainboardCount: 4 },
			},
		});
	});

	// Two saves of one side race: the one that started first and landed last is held by nothing.
	it('leaves no older Deck List of its Slot held by nothing', async () => {
		const { eventId, slotId } = await stageSlot();
		const raced = await featureMatchDeckListService().create(eventId, slotId, NAMI_DECK, {
			entries: [],
			leaderNumber: null,
			mainboardCount: 0,
			warnings: [],
		});
		const saved = await save(eventId, slotId, 'player1', ZORO_DECK);
		if (!saved.available)
			throw new Error('unavailable');

		expect(await deckListIds(slotId)).toEqual([saved.deckList.id]);
		expect(raced).toBeLessThan(saved.deckList.id);
	});

	it('is deleted with its Slot', async () => {
		const { eventId, slotId } = await stageSlot();
		await save(eventId, slotId, 'player1', ZORO_DECK);

		await featureMatchSlotWriteModule().remove({ eventId, slotId });

		expect(await deckListIds(slotId)).toEqual([]);
		expect(await db.select().from(schema.featureMatchDeckListEntries).innerJoin(schema.featureMatchDeckLists, eq(schema.featureMatchDeckLists.id, schema.featureMatchDeckListEntries.deckListId)).where(eq(schema.featureMatchDeckLists.slotId, slotId))).toEqual([]);
	});

	it.each([
		['keeps it when the save omits it', 'omitted', 'own'],
		['drops it when the save names none', 'dropped', null],
		['keeps it when the save names another Slot\'s', 'other', 'own'],
		['keeps it when the save names a replaced one, as a stale form would', 'missing', 'own'],
		['takes its Mainboard count from the Deck List', 'miscounted', 'own'],
	] as const)('a setup save of its side %s', async (_label, kind, expected) => {
		const { eventId, slotId } = await stageSlot();
		const other = await stageSlot();
		const own = await save(eventId, slotId, 'player1', ZORO_DECK);
		const foreign = await save(other.eventId, other.slotId, 'player1', NAMI_DECK);
		if (!own.available || !foreign.available)
			throw new Error('unavailable');
		const reference = {
			omitted: undefined,
			dropped: null,
			other: { id: foreign.deckList.id, mainboardCount: 4 },
			missing: { id: 999_999, mainboardCount: 4 },
			miscounted: { id: own.deckList.id, mainboardCount: 50 },
		}[kind];

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: {
					name: 'Ana',
					gameData: { type: 'op', featureMatchDeckList: reference },
				},
			},
		});

		const held = expected === 'own'
			? { id: own.deckList.id, mainboardCount: 8 }
			: null;
		expect((await slotRow(slotId)).player1Data?.gameData).toEqual({ type: 'op', featureMatchDeckList: held });
		expect(await deckListIds(slotId)).toEqual(held
			? [held.id]
			: []);
		expect(await deckListIds(other.slotId)).toEqual([foreign.deckList.id]);
	});

	it.each([
		[
			'the other side names it',
			{ player2Data: 'copy' },
		],
		[
			'both sides name it',
			{ player1Data: 'own', player2Data: 'copy' },
		],
		[
			'both sides name it, the holder second',
			{ player2Data: 'copy', player1Data: 'own' },
		],
	] as const)('stays with the side that held it when %s', async (_label, sides) => {
		const { eventId, slotId } = await stageSlot();
		const own = await save(eventId, slotId, 'player1', ZORO_DECK);
		if (!own.available)
			throw new Error('unavailable');
		const { player1Data } = await slotRow(slotId);
		const input = Object.fromEntries(Object.entries(sides).map(([key, which]) => [
			key,
			which === 'own'
				? player1Data
				: { ...player1Data, name: 'Ben' },
		]));

		await featureMatchSlotWriteModule().updateSetup({ eventId, slotId, input });

		const after = await slotRow(slotId);
		expect(after.player1Data?.gameData).toMatchObject({
			featureMatchDeckList: { id: own.deckList.id },
		});
		expect(after.player2Data?.gameData).toMatchObject({ featureMatchDeckList: null });
		expect(await deckListIds(slotId)).toEqual([own.deckList.id]);
	});

	it('answers unavailable and stores nothing when no bandai-keepr is configured', async () => {
		const { eventId, slotId } = await stageSlot();
		runtimeConfig.bandaiKeeprApiKey = '';

		expect(await save(eventId, slotId, 'player1', ZORO_DECK)).toEqual({ available: false });
		expect(await deckListIds(slotId)).toEqual([]);
	});

	it('is refused for a Slot of another Event', async () => {
		const { slotId } = await stageSlot();
		const other = await stageSlot();

		await expect(save(other.eventId, slotId, 'player1', ZORO_DECK)).rejects.toMatchObject({ statusCode: 404 });
		expect(await db.select().from(schema.featureMatchDeckLists).where(and(eq(schema.featureMatchDeckLists.slotId, slotId)))).toEqual([]);
	});

	// A linked side shows its Player's Deck List, which is edited as the Player's (ADR-0074).
	it('is refused for a side linked to a Player, which holds none of its own', async () => {
		const { eventId, slotId } = await stageSlot();
		const [player] = await db.insert(schema.players).values({ eventId, name: 'Ana' }).returning();
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player1Id: player!.id },
		});

		await expect(save(eventId, slotId, 'player1', ZORO_DECK)).rejects.toMatchObject({ statusCode: 409 });
		expect(await deckListIds(slotId)).toEqual([]);
		expect(upstream.batches()).toEqual([]);
	});
});

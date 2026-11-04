import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { LUFFY, NAMI, opLeaderCatalogueRow, ZORO } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Slot setup edit to a seated Player's identity is a Player write (ADR-0045).
 *
 * The setup form edits the Slot's player snapshot, and Reverse Sync rebuilds
 * that snapshot from the Player after every Player write and Melee Sync. An
 * identity edit kept only on the Slot was therefore lost to the next round
 * sync; it now lands on the Player, so every Slot and the next sync agree.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

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

const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchPromotionModule } = await import('~~/server/modules/feature-match-promotion');
const { featureMatchService } = await import('~~/server/services/featureMatch');
const { playerFeatureMatchSyncService } = await import('~~/server/services/playerFeatureMatchSync');
const { playerUpdateModule } = await import('~~/server/modules/player-update');
const { opDeckListWriteModule } = await import('~~/server/modules/op-deck-list-write');
const { featureMatchDeckListService } = await import('~~/server/services/featureMatchDeckList');

afterAll(async () => {
	await harness.close();
});

async function stageFeaturedMatch() {
	const [event] = await db.insert(schema.events)
		.values({
			name: 'Slot setup edits',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			lgsEnabled: true,
		})
		.returning();
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss', sortOrder: 0 }).returning();
	const [round] = await db.insert(schema.rounds)
		.values({
			eventId,
			phaseId: phase!.id,
			name: 'Round 1',
			roundNumber: 1,
		})
		.returning();
	const [player1, player2] = await db.insert(schema.players)
		.values([
			{ eventId, name: 'Mia', wins: 2 },
			{ eventId, name: 'Rei', lgs: 'The Battered Sleeve' },
		])
		.returning();
	const [match] = await db.insert(schema.matches)
		.values({
			eventId,
			roundId: round!.id,
			tableNumber: 1,
			sortOrder: 0,
			player1Id: player1!.id,
			player2Id: player2!.id,
		})
		.returning();
	const slot = await featureMatchService().create(eventId, {});
	await featureMatchPromotionModule().promoteMatchToSlot({ eventId, slotId: slot.id, matchId: match!.id });
	const promoted = await featureMatchService().findById(slot.id, eventId);
	return {
		eventId,
		slotId: slot.id,
		player1Id: player1!.id,
		player2Id: player2!.id,
		player1Data: promoted!.player1Data!,
		player2Data: promoted!.player2Data!,
	};
}

async function playerById(id: number) {
	return await db.query.players.findFirst({
		where: eq(schema.players.id, id),
	});
}

async function slotById(id: number, eventId: number) {
	return await featureMatchService().findById(id, eventId);
}

async function activeSourceSnapshot(slotId: number, eventId: number) {
	const slot = await slotById(slotId, eventId);
	const session = await db.query.featureMatchSessions.findFirst({
		where: eq(schema.featureMatchSessions.id, slot!.activeSessionId!),
	});
	return session!.sourceSnapshot;
}

describe('a Slot setup edit to a seated Player', () => {
	it('keeps an LGS set in setup through a round sync, because the Player holds it', async () => {
		const { eventId, slotId, player1Id, player2Id, player1Data } = await stageFeaturedMatch();

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: { ...player1Data, lgs: 'Northgate Games' },
			},
		});
		expect((await playerById(player1Id))?.lgs).toBe('Northgate Games');

		// What a round "Sync Matches" does once its Player reconcile commits.
		await playerFeatureMatchSyncService().syncMatchesFromPlayersAfterCommit(eventId, [player1Id, player2Id]);

		expect((await slotById(slotId, eventId))?.player1Data?.lgs).toBe('Northgate Games');
		expect((await activeSourceSnapshot(slotId, eventId)).player1.data?.lgs).toBe('Northgate Games');
	});

	it('writes name and pronouns to the Player and to every other Slot seating them', async () => {
		const { eventId, slotId, player1Id, player1Data } = await stageFeaturedMatch();
		const other = await featureMatchService().create(eventId, {});
		await featureMatchService().update(other.id, eventId, { player1Id });

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: { ...player1Data, name: 'Mia K.', pronouns: 'she/her' },
			},
		});

		expect(await playerById(player1Id)).toMatchObject({ name: 'Mia K.', pronouns: 'she/her' });
		expect((await slotById(other.id, eventId))?.player1Data).toMatchObject({ name: 'Mia K.', pronouns: 'she/her' });
	});

	it('writes the Player a setup edit seats, not the one it replaces', async () => {
		const { eventId, slotId, player1Id } = await stageFeaturedMatch();
		const [kai] = await db.insert(schema.players).values({ eventId, name: 'Kai' }).returning();

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Id: kai!.id,
				player1Data: { name: 'Kai', pronouns: 'they/them' },
			},
		});

		expect((await playerById(kai!.id))?.pronouns).toBe('they/them');
		expect((await playerById(player1Id))?.pronouns).toBeNull();
	});

	it('clears the Player\'s LGS when setup clears it', async () => {
		const { eventId, slotId, player2Id, player2Data } = await stageFeaturedMatch();
		expect(player2Data.lgs).toBe('The Battered Sleeve');

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player2Data: { ...player2Data, lgs: null },
			},
		});

		expect((await playerById(player2Id))?.lgs).toBeNull();
		expect((await slotById(slotId, eventId))?.player2Data?.lgs).toBeNull();
	});

	it('keeps a record edited in the same save on the Slot only', async () => {
		const { eventId, slotId, player1Id, player1Data } = await stageFeaturedMatch();

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: { ...player1Data, lgs: 'Northgate Games', wins: 5 },
			},
		});

		expect(await playerById(player1Id)).toMatchObject({ lgs: 'Northgate Games', wins: 2 });
		expect((await slotById(slotId, eventId))?.player1Data).toMatchObject({ lgs: 'Northgate Games', wins: 5 });
	});

	it('writes no Player for a side no Player is seated in', async () => {
		const { eventId } = await stageFeaturedMatch();
		const unseated = await featureMatchService().create(eventId, {});
		const before = await db.query.players.findMany({
			where: eq(schema.players.eventId, eventId),
		});

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId: unseated.id,
			input: {
				player1Data: { name: 'Walk-in', lgs: 'Northgate Games' },
			},
		});

		expect(await db.query.players.findMany({
			where: eq(schema.players.eventId, eventId),
		})).toEqual(before);
		expect((await slotById(unseated.id, eventId))?.player1Data).toMatchObject({ name: 'Walk-in', lgs: 'Northgate Games' });
	});
});

/** A One Piece Card Game Event's Slot with an unlinked side holding its own Leader, and a Player to link into it. */
async function stageOpSlot(player: { name: string; nickname: string | null }) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'OP Regionals', game: 'op', featureMatchOrientation: 'horizontal' })
		.returning();
	const eventId = event!.id;
	const [seated] = await db.insert(schema.players).values({ eventId, ...player }).returning();
	// Every Leader is catalogued already, so no Deck List write looks one up (ADR-0074).
	await db.insert(schema.cards).values([LUFFY, ZORO, NAMI].map(opLeaderCatalogueRow)).onConflictDoNothing();
	const slot = await featureMatchService().create(eventId, {});
	const sideData = {
		name: '',
		gameData: { type: 'op' as const, leader: LUFFY },
	};
	return {
		eventId,
		slotId: slot.id,
		playerId: seated!.id,
		sideData,
	};
}

function writePlayerDeckList(eventId: number, playerId: number, text: string) {
	return opDeckListWriteModule().write({
		eventId,
		owner: { kind: 'player', playerId },
		input: { text },
		source: 'hand',
	});
}

describe('linking a One Piece Card Game Player into a Slot side', () => {
	it('seats the Player, shown by their Nickname, through a Player write', async () => {
		const { eventId, slotId, playerId, sideData } = await stageOpSlot({ name: '', nickname: 'linlin_88' });

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Id: playerId,
				player1Data: { ...sideData, nickname: 'linlin_88' },
			},
		});
		await playerUpdateModule().updatePlayer({
			eventId,
			playerId,
			input: { pronouns: 'she/her' },
		});

		const slot = await slotById(slotId, eventId);
		expect(slot?.player1Id).toBe(playerId);
		expect(slot?.player1Data).toMatchObject({
			name: '',
			nickname: 'linlin_88',
			pronouns: 'she/her',
		});
	});

	it('shows the Player\'s Leader and Deck List, and releases the Feature Match Deck List the side held', async () => {
		const { eventId, slotId, playerId } = await stageOpSlot({ name: '', nickname: 'linlin_88' });
		const { deckList: pasted } = await opDeckListWriteModule().write({
			eventId,
			owner: { kind: 'slotSide', slotId, side: 'player1' },
			input: { text: '1x OP01-003' },
			source: 'hand',
		});
		const { deckList } = await writePlayerDeckList(eventId, playerId, '1x OP01-001');
		const unlinked = await slotById(slotId, eventId);

		// The form sends the side as it held it: its own Leader and Feature Match Deck List.
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player1Id: playerId, player1Data: unlinked!.player1Data },
		});

		expect((await slotById(slotId, eventId))?.player1Data?.gameData).toEqual({
			type: 'op',
			leader: ZORO,
			deckList: { id: deckList.id, mainboardCount: 0, leaderNumber: ZORO.number },
		});
		expect(await featureMatchDeckListService().findById(pasted.id, slotId, eventId)).toBeNull();
	});

	it.each([
		{ edit: 'a Player Deck List write', save: false },
		{ edit: 'a Player Deck List write, then a setup save from a form holding the side as it was', save: true },
	])('shows the Player\'s new Leader after $edit', async ({ save }) => {
		const { eventId, slotId, playerId, sideData } = await stageOpSlot({ name: '', nickname: 'linlin_88' });
		await writePlayerDeckList(eventId, playerId, '1x OP01-001');
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player1Id: playerId, player1Data: sideData },
		});
		const formSide = (await slotById(slotId, eventId))!.player1Data;

		const { deckList } = await writePlayerDeckList(eventId, playerId, '1x OP01-016');
		if (save) {
			await featureMatchSlotWriteModule().updateSetup({
				eventId,
				slotId,
				input: {
					player1Data: { ...formSide, pronouns: 'she/her' },
				},
			});
		}

		const expected = {
			type: 'op',
			leader: NAMI,
			deckList: { id: deckList.id, mainboardCount: 0, leaderNumber: NAMI.number },
		};
		expect((await slotById(slotId, eventId))?.player1Data?.gameData).toEqual(expected);
		expect((await activeSourceSnapshot(slotId, eventId)).player1.data?.gameData).toEqual(expected);
	});

	it('leaves an unlinked side the Leader it showed, and none of the Player\'s Deck List', async () => {
		const { eventId, slotId, playerId, sideData } = await stageOpSlot({ name: '', nickname: 'linlin_88' });
		await writePlayerDeckList(eventId, playerId, '1x OP01-001');
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player1Id: playerId, player1Data: sideData },
		});
		const formSide = (await slotById(slotId, eventId))!.player1Data;

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player1Id: null, player1Data: formSide },
		});

		expect((await slotById(slotId, eventId))?.player1Data?.gameData).toEqual({ type: 'op', leader: ZORO });
	});

	// A cleared name is a Player write only where a Nickname is there to fall back to.
	it.each([
		{
			held: { name: '', nickname: 'linlin_88' },
			edited: 'Big Mom',
			stored: 'Big Mom',
		},
		{
			held: { name: 'Big Mom', nickname: 'linlin_88' },
			edited: '',
			stored: '',
		},
		{
			held: { name: 'Big Mom', nickname: null },
			edited: '',
			stored: 'Big Mom',
		},
	])('writes a setup name of $edited to a linked Player holding $held', async ({ held, edited, stored }) => {
		const { eventId, slotId, playerId, sideData } = await stageOpSlot(held);
		await featureMatchService().update(slotId, eventId, {
			player1Id: playerId,
			player1Data: {
				...sideData,
				...held,
			},
		});

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: { ...sideData, nickname: held.nickname, name: edited },
			},
		});

		expect((await playerById(playerId))?.name).toBe(stored);
	});
});

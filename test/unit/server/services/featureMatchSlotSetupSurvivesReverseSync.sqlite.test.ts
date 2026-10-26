import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
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

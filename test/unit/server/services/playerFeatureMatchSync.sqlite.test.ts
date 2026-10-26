import type { PlayerSlotData } from '~~/shared/api';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Player → Slot reverse sync over real SQL: which deck a Slot side shows after a
// Player changes, and that a Session correction failing leaves the Slot rows
// for the next pass.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

/** Thrown by the next Session correction instead of applying it. */
let failNextCorrection: unknown;

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));
vi.doMock('~~/server/services/featureMatchState', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~~/server/services/featureMatchState')>();
	return {
		...actual,
		featureMatchStateService: () => {
			const service = actual.featureMatchStateService();
			return {
				...service,
				applyCommandToActiveSession: async (...args: Parameters<typeof service.applyCommandToActiveSession>) => {
					const failure = failNextCorrection;
					failNextCorrection = undefined;
					if (failure)
						throw failure;
					return await service.applyCommandToActiveSession(...args);
				},
			};
		},
	};
});

const { playerFeatureMatchSyncService } = await import('~~/server/services/playerFeatureMatchSync');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');

beforeEach(() => {
	failNextCorrection = undefined;
});

afterAll(async () => await harness.close());

interface StagedDeck {
	id?: number;
	formatExternalId: string;
	name: string;
	colors?: string;
	isPrimary?: boolean;
	sortOrder?: number;
	archetype?: { name: string; colors: string };
}

/** An Event with a Standard Match, one Player per entry, and their decks. */
async function stage(playersDecks: StagedDeck[][]) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss', formatExternalId: 'standard' }).returning();
	const [round] = await db.insert(schema.rounds).values({
		eventId,
		phaseId: phase!.id,
		name: 'Round 1',
		roundNumber: 1,
	}).returning();
	const [match] = await db.insert(schema.matches).values({ eventId, roundId: round!.id }).returning();

	const playerIds: number[] = [];
	const deckIds: number[][] = [];
	for (const [index, decks] of playersDecks.entries()) {
		const [player] = await db.insert(schema.players)
			.values({
				eventId,
				name: `Player ${index + 1}`,
				gameData: { type: 'mtg', deckName: 'Primary Import', deckColors: 'R' },
			})
			.returning();
		playerIds.push(player!.id);
		const ids: number[] = [];
		for (const [sortOrder, deck] of decks.entries()) {
			const [archetype] = deck.archetype
				? await db.insert(schema.archetypes).values({ eventId, ...deck.archetype }).returning()
				: [];
			const [row] = await db.insert(schema.playerDecks).values({
				...(deck.id === undefined
					? {}
					: { id: deck.id }),
				eventId,
				playerId: player!.id,
				externalId: `${eventId}-${index}-${sortOrder}`,
				externalSource: 'melee',
				formatExternalId: deck.formatExternalId,
				name: deck.name,
				colors: deck.colors ?? '',
				isPrimary: deck.isPrimary ?? false,
				sortOrder: deck.sortOrder ?? sortOrder,
				archetypeId: archetype?.id ?? null,
				reviewedAt: archetype
					? new Date('2026-07-15T00:00:00Z')
					: null,
			}).returning();
			ids.push(row!.id);
		}
		deckIds.push(ids);
	}
	return {
		eventId,
		matchId: match!.id,
		playerIds,
		deckIds,
	};
}

async function stageSlot(eventId: number, values: Partial<typeof schema.featureMatches.$inferInsert>) {
	const [slot] = await db.insert(schema.featureMatches).values({ eventId, ...values }).returning();
	return slot!;
}

async function storedSlot(id: number) {
	return (await db.query.featureMatches.findFirst({
		where: eq(schema.featureMatches.id, id),
	}))!;
}

describe('which deck a Slot side shows after its Player changes', () => {
	it('takes the reviewed deck in the Match\'s format over the primary import', async () => {
		const { eventId, matchId, playerIds } = await stage([
			[
				{
					formatExternalId: 'modern',
					name: 'Primary Import',
					colors: 'R',
					isPrimary: true,
				},
				{
					formatExternalId: 'standard',
					name: 'Secondary Import',
					colors: 'U',
					archetype: { name: 'Reviewed Control', colors: 'WU' },
				},
			],
		]);
		const slot = await stageSlot(eventId, { matchId, player1Id: playerIds[0] });

		await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [playerIds[0]!]);

		expect((await storedSlot(slot.id)).player1Data).toMatchObject({
			name: 'Player 1',
			gameData: expect.objectContaining({ deckName: 'Reviewed Control', deckColors: 'WU' }),
		});
	});

	it('keeps the exact deck the Slot already names', async () => {
		const { eventId, matchId, playerIds, deckIds } = await stage([
			[
				{ formatExternalId: 'standard', name: 'First Standard', colors: 'U' },
				{ formatExternalId: 'standard', name: 'Exact Standard', colors: 'G' },
				{
					formatExternalId: 'modern',
					name: 'Primary Import',
					colors: 'R',
					isPrimary: true,
				},
			],
		]);
		const exact = deckIds[0]![1]!;
		const slot = await stageSlot(eventId, {
			matchId,
			player1Id: playerIds[0],
			player1Data: { name: 'Alice', deckId: exact },
		});

		await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [playerIds[0]!]);

		expect((await storedSlot(slot.id)).player1Data).toMatchObject({
			deckId: exact,
			gameData: expect.objectContaining({ deckName: 'Exact Standard', deckColors: 'G' }),
		});
	});

	it('keeps an explicit no-deck side without a deck', async () => {
		const { eventId, matchId, playerIds } = await stage([
			[
				{ formatExternalId: 'standard', name: 'Standard Deck' },
			],
		]);
		const noDeck: PlayerSlotData = {
			name: 'Alice',
			deckId: null,
			archetypeId: null,
			gameData: { type: 'mtg', deckName: null, deckColors: null },
		};
		const slot = await stageSlot(eventId, { matchId, player1Id: playerIds[0], player1Data: noDeck });

		await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [playerIds[0]!]);

		expect((await storedSlot(slot.id)).player1Data).toMatchObject({ deckId: null, archetypeId: null, gameData: noDeck.gameData });
	});

	it('keeps each side\'s historical deck after it leaves the import, side by side', async () => {
		const { eventId, matchId, playerIds } = await stage([
			[
				{ formatExternalId: 'standard', name: 'New Standard' },
			],
			[
				{ formatExternalId: 'standard', name: 'Other Standard' },
			],
		]);
		const alice = { type: 'mtg' as const, deckName: 'Alice Historical', deckColors: 'G' };
		const bob = { type: 'mtg' as const, deckName: 'Bob Historical', deckColors: 'W' };
		const slot = await stageSlot(eventId, {
			matchId,
			player1Id: playerIds[0],
			player1Data: {
				name: 'Alice',
				deckId: 99_001,
				archetypeId: 8,
				gameData: alice,
			},
			player2Id: playerIds[1],
			player2Data: {
				name: 'Bob',
				deckId: 99_002,
				archetypeId: 3,
				gameData: bob,
			},
		});

		await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, playerIds);

		const stored = await storedSlot(slot.id);
		expect(stored.player1Data).toMatchObject({
			name: 'Player 1',
			deckId: 99_001,
			archetypeId: 8,
			gameData: alice,
		});
		expect(stored.player2Data).toMatchObject({
			name: 'Player 2',
			deckId: 99_002,
			archetypeId: 3,
			gameData: bob,
		});
	});
});

describe('syncMatchesFromPlayers', () => {
	it('answers each changed Slot once, however often its Players are named', async () => {
		const { eventId, playerIds } = await stage([[], []]);
		const both = await stageSlot(eventId, { player1Id: playerIds[0], player2Id: playerIds[1] });
		const one = await stageSlot(eventId, { player2Id: playerIds[0] });
		await stageSlot(eventId, {});

		const updated = await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [playerIds[0]!, playerIds[1]!, playerIds[0]!]);

		expect(updated.toSorted()).toEqual([both.id, one.id].toSorted());
		expect(await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [])).toEqual([]);
	});

	it('corrects the active Session\'s snapshot alongside the Slot', async () => {
		const { eventId, playerIds } = await stage([[]]);
		const slot = await stageSlot(eventId, { player1Id: playerIds[0] });
		await featureMatchStateService().createSessionForSlot(slot.id, eventId);
		await db.update(schema.players).set({ name: 'Renamed' }).where(eq(schema.players.id, playerIds[0]!));

		await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [playerIds[0]!]);

		const session = await db.query.featureMatchSessions.findFirst({
			where: eq(schema.featureMatchSessions.slotId, slot.id),
		});
		expect(session?.sourceSnapshot.player1.data?.name).toBe('Renamed');
	});

	it('leaves a Slot whose snapshot is unchanged, and its Session, alone', async () => {
		const { eventId, playerIds } = await stage([[]]);
		const slot = await stageSlot(eventId, { player1Id: playerIds[0] });
		const session = (await featureMatchStateService().createSessionForSlot(slot.id, eventId))!;
		await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [playerIds[0]!]);
		const settled = await db.query.featureMatchSessions.findFirst({
			where: eq(schema.featureMatchSessions.id, session.id),
		});

		expect(await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [playerIds[0]!])).toEqual([]);
		expect((await db.query.featureMatchSessions.findFirst({
			where: eq(schema.featureMatchSessions.id, session.id),
		}))?.sequence).toBe(settled?.sequence);
	});

	it('leaves the Slot rows at their previous snapshot when the Session correction fails, so a retry finds the delta', async () => {
		const { eventId, playerIds } = await stage([[]]);
		const slot = await stageSlot(eventId, {
			player1Id: playerIds[0],
			player1Data: { name: 'Old Name' },
		});
		failNextCorrection = new Error('session CAS failed');

		await expect(playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [playerIds[0]!])).rejects.toThrow('session CAS failed');
		expect((await storedSlot(slot.id)).player1Data).toEqual({ name: 'Old Name' });

		expect(await playerFeatureMatchSyncService().syncMatchesFromPlayers(eventId, [playerIds[0]!])).toEqual([slot.id]);
		expect((await storedSlot(slot.id)).player1Data).toMatchObject({ name: 'Player 1' });
	});

	describe('as a post-commit follow-on', () => {
		it('absorbs a lost Session race and logs it, leaving the delta for the next pass', async () => {
			const { eventId, playerIds } = await stage([[]]);
			const slot = await stageSlot(eventId, {
				player1Id: playerIds[0],
				player1Data: { name: 'Old Name' },
			});
			failNextCorrection = Object.assign(new Error('Feature match session has advanced'), { statusCode: 409 });
			const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

			await expect(playerFeatureMatchSyncService().syncMatchesFromPlayersAfterCommit(eventId, [playerIds[0]!])).resolves.toEqual([]);

			expect(logged).toHaveBeenCalledWith(expect.stringContaining('feature_match_reverse_sync_conflict'));
			expect((await storedSlot(slot.id)).player1Data).toEqual({ name: 'Old Name' });
		});

		it('still fails on a fault, which is not a race the caller may absorb', async () => {
			const { eventId, playerIds } = await stage([[]]);
			await stageSlot(eventId, {
				player1Id: playerIds[0],
				player1Data: { name: 'Old Name' },
			});
			failNextCorrection = new Error('D1_ERROR: no such table: feature_match_sessions');

			await expect(playerFeatureMatchSyncService().syncMatchesFromPlayersAfterCommit(eventId, [playerIds[0]!])).rejects.toThrow('no such table');
		});
	});
});

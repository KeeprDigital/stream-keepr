import type { ManualPlayerSlotData } from '~~/shared/api';
import type { Variant } from '~~/shared/types/enums';
import type { Commander } from '~~/shared/types/game';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { ATRAXA, KRAUM, TYMNA } from '~~/test/helpers/commanders';
import { fakeOpCardBulkLookup, mockOpWriteBoundaries } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Commander Event's Feature Match Slot has four typed Seats, each holding one
 * or two Commanders; Seats 3 and 4 exist on no other Event (ADR-0086).
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
vi.stubGlobal('useRuntimeConfig', () => ({ bandaiKeeprApiKey: '', bandaiKeeprApiUrl: '' }));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
const { published } = mockOpWriteBoundaries(db, () => fakeOpCardBulkLookup([]));

const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchService } = await import('~~/server/services/featureMatch');

function seat(name: string, commanders: Commander[], extra: Partial<ManualPlayerSlotData> = {}): ManualPlayerSlotData {
	return {
		name,
		...extra,
		gameData: { type: 'mtg', commanders },
	};
}

beforeEach(() => {
	published.length = 0;
});

afterAll(async () => {
	await harness.close();
});

async function stageSlot(event: { game: 'mtg' | 'op'; variant: Variant | null }) {
	const [created] = await db.insert(schema.events)
		.values({ name: 'Event', featureMatchOrientation: 'horizontal', ...event })
		.returning({ id: schema.events.id });
	const eventId = created!.id;
	const slot = await featureMatchService().create(eventId, {});
	published.length = 0;
	return { eventId, slotId: slot.id };
}

const commanderSlot = () => stageSlot({ game: 'mtg', variant: 'commander' });

/** The Slot as a reload reads it. */
async function reloaded(eventId: number, slotId: number) {
	return mapFeatureMatchToResponse((await featureMatchService().findById(slotId, eventId))!);
}

describe('a Commander Slot\'s Seats', () => {
	it('stores a Seat\'s name, pronouns, LGS and Commanders, and reads them back as the chosen printings', async () => {
		const { eventId, slotId } = await commanderSlot();

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: seat('Ana', [ATRAXA]),
				player3Data: seat('Cyd', [TYMNA, KRAUM], { pronouns: 'they/them', lgs: 'Good Games' }),
			},
		});

		const slot = await reloaded(eventId, slotId);
		expect(slot.player1Data).toMatchObject({
			name: 'Ana',
			gameData: {
				commanders: [ATRAXA],
			},
		});
		expect(slot.player3Data).toMatchObject({
			name: 'Cyd',
			pronouns: 'they/them',
			lgs: 'Good Games',
			gameData: {
				type: 'mtg',
				commanders: [TYMNA, KRAUM],
			},
		});
	});

	it('names a Seat\'s deck by its Commanders and colours it by their colour identity', async () => {
		const { eventId, slotId } = await commanderSlot();

		const saved = await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player4Data: seat('Dee', [TYMNA, KRAUM]),
			},
		});

		expect(saved.player4Data?.gameData).toMatchObject({
			deckName: 'Tymna the Weaver / Kraum, Ludevic\'s Opus',
			deckColors: 'WUBR',
		});
	});

	// A Commander Event has no Players: a Seat holds no record and no typed deck name.
	it('keeps only what a typed Seat holds', async () => {
		const { eventId, slotId } = await commanderSlot();

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player2Data: {
					name: 'Ben',
					wins: 3,
					losses: 1,
					draws: 0,
					position: 2,
					points: 9,
					gameData: {
						type: 'mtg',
						deckName: 'Typed',
						deckColors: 'G',
						commanders: [],
					},
				},
			},
		});

		const [stored] = await db.select().from(schema.featureMatches).where(eq(schema.featureMatches.id, slotId));
		expect(stored!.player2Data).toEqual({ name: 'Ben' });
	});

	it('saves and reads back with Seats 2 and 4 empty', async () => {
		const { eventId, slotId } = await commanderSlot();

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: seat('Ana', [ATRAXA]),
				player2Data: null,
				player3Data: seat('Cyd', [TYMNA]),
				player4Data: null,
			},
		});

		const slot = await reloaded(eventId, slotId);
		expect([
			slot.player1Data?.name,
			slot.player2Data ?? null,
			slot.player3Data?.name,
			slot.player4Data ?? null,
		])
			.toEqual(['Ana', null, 'Cyd', null]);
	});

	it('clears a Seat that is saved empty', async () => {
		const { eventId, slotId } = await commanderSlot();
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player3Data: seat('Cyd', [TYMNA]),
			},
		});

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { player3Data: null },
		});

		expect((await reloaded(eventId, slotId)).player3Data ?? null).toBeNull();
	});
});

describe('swap Seats', () => {
	it('leaves each of the two Seats\' players in the other Seat, on the Slot itself, and announces it', async () => {
		const { eventId, slotId } = await commanderSlot();
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: seat('Ana', [ATRAXA], { pronouns: 'she/her' }),
				player2Data: seat('Ben', [KRAUM]),
				player3Data: seat('Cyd', [TYMNA, KRAUM]),
			},
		});
		published.length = 0;

		const answer = await featureMatchSlotWriteModule().swapSeats({
			eventId,
			slotId,
			seats: ['player1', 'player3'],
		});

		const [stored] = await db.select().from(schema.featureMatches).where(eq(schema.featureMatches.id, slotId));
		expect(stored!.player1Data).toMatchObject({
			name: 'Cyd',
			gameData: {
				commanders: [TYMNA, KRAUM],
			},
		});
		expect(stored!.player3Data).toMatchObject({
			name: 'Ana',
			pronouns: 'she/her',
			gameData: {
				commanders: [ATRAXA],
			},
		});
		expect(stored!.player2Data).toMatchObject({ name: 'Ben' });
		expect(answer.player1Data?.name).toBe('Cyd');
		expect(published.filter(message => message.type === 'featureMatch:updated').map(message => message.payload))
			.toEqual([
				{ featureMatch: answer },
			]);
	});

	// The Session's snapshot is corrected as a setup save corrects it, without reopening it.
	it('reaches the Slot\'s active Session', async () => {
		const { eventId, slotId } = await commanderSlot();
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: seat('Ana', [ATRAXA]),
				player2Data: seat('Ben', [KRAUM]),
			},
		});
		const before = (await reloaded(eventId, slotId)).activeSession!;

		await featureMatchSlotWriteModule().swapSeats({
			eventId,
			slotId,
			seats: ['player2', 'player1'],
		});

		const after = (await reloaded(eventId, slotId)).activeSession!;
		expect([after.id, after.sourceSnapshot.player1.data?.name, after.sourceSnapshot.player2.data?.name])
			.toEqual([before.id, 'Ben', 'Ana']);
	});

	it('moves a player into an empty Seat', async () => {
		const { eventId, slotId } = await commanderSlot();
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player2Data: seat('Ben', [KRAUM]),
			},
		});

		await featureMatchSlotWriteModule().swapSeats({
			eventId,
			slotId,
			seats: ['player2', 'player4'],
		});

		const slot = await reloaded(eventId, slotId);
		expect([slot.player2Data ?? null, slot.player4Data?.name]).toEqual([null, 'Ben']);
	});

	it.each([
		{
			refused: 'a Seat swapped with itself',
			seats: ['player2', 'player2'] as const,
			statusCode: 400,
		},
	])('refuses $refused', async ({ seats, statusCode }) => {
		const { eventId, slotId } = await commanderSlot();

		await expect(featureMatchSlotWriteModule().swapSeats({
			eventId,
			slotId,
			seats: [...seats],
		}))
			.rejects
			.toMatchObject({ statusCode });
	});
});

describe('an Event that is not a Commander Event', () => {
	const TWO_PLAYER = { game: 'mtg', variant: 'two-player' } as const;
	const ONE_PIECE = { game: 'op', variant: null } as const;

	it.each([
		{
			refused: 'a Seat 3 on a Two-Player Event',
			event: TWO_PLAYER,
			input: {
				player3Data: { name: 'Cyd' },
			},
		},
		{
			refused: 'a Seat 4 on a One Piece Card Game Event',
			event: ONE_PIECE,
			input: {
				player4Data: { name: 'Dee' },
			},
		},
		{
			refused: 'a Commander on a Two-Player Event\'s Seat',
			event: TWO_PLAYER,
			input: {
				player1Data: seat('Ana', [ATRAXA]),
			},
		},
	])('refuses $refused, storing nothing', async ({ event, input }) => {
		const { eventId, slotId } = await stageSlot(event);

		await expect(featureMatchSlotWriteModule().updateSetup({ eventId, slotId, input }))
			.rejects
			.toMatchObject({ statusCode: 400 });

		const [stored] = await db.select().from(schema.featureMatches).where(eq(schema.featureMatches.id, slotId));
		expect([stored!.player1Data, stored!.player3Data, stored!.player4Data]).toEqual([null, null, null]);
	});

	// Swap Players stays the Session's on these Events (ADR-0058).
	it('refuses Swap Seats', async () => {
		const { eventId, slotId } = await stageSlot(TWO_PLAYER);

		await expect(featureMatchSlotWriteModule().swapSeats({
			eventId,
			slotId,
			seats: ['player1', 'player2'],
		}))
			.rejects
			.toMatchObject({ statusCode: 400 });
	});

	// The Slot response and its realtime message are public contracts: no Seat 3 or 4 appears in either.
	it('answers and announces a Two-Player Slot with the fields it always had', async () => {
		const { eventId, slotId } = await stageSlot(TWO_PLAYER);

		const answer = await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player1Data: {
					name: 'Ana',
					gameData: { type: 'mtg', deckName: 'Burn', deckColors: 'R' },
				},
			},
		});

		const announced = published.find(message => message.type === 'featureMatch:updated')!.payload as { featureMatch: object };
		for (const slot of [answer, announced.featureMatch, await reloaded(eventId, slotId)]) {
			expect(Object.keys(slot)).toEqual([
				'id',
				'eventId',
				'matchId',
				'externalId',
				'externalSource',
				'tableNumber',
				'roundName',
				'formatName',
				'player1Id',
				'player2Id',
				'player1Data',
				'player2Data',
				'bestOf',
				'sortOrder',
				'playerDisplayMode',
				'activeSessionId',
				'createdAt',
				'updatedAt',
				'activeSession',
			]);
		}
		expect(answer.player1Data).toEqual({
			name: 'Ana',
			gameData: { type: 'mtg', deckName: 'Burn', deckColors: 'R' },
		});
	});
});

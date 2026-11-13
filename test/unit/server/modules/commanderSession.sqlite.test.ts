import type { ManualPlayerSlotData } from '~~/shared/api';
import type { Variant } from '~~/shared/types/enums';
import type { FeatureMatchSessionCommand } from '~~/shared/types/featureMatchSession';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { ATRAXA, KRAUM, typedSeat as seat, TYMNA } from '~~/test/helpers/commanders';
import { fakeOpCardBulkLookup, mockOpWriteBoundaries } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Commander Slot's Session plays one game across its four Seats, and follows
 * the Slot as its Seats fill, empty and change places (ADR-0087). The game's
 * rules are the reducer's; this is what only the stored Slot and Session prove.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
vi.stubGlobal('useRuntimeConfig', () => ({ bandaiKeeprApiKey: '', bandaiKeeprApiUrl: '' }));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
const { published } = mockOpWriteBoundaries(db, () => fakeOpCardBulkLookup([]));

const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchSessionModule } = await import('~~/server/modules/feature-match-session');
const { featureMatchService } = await import('~~/server/services/featureMatch');

beforeEach(() => {
	published.length = 0;
});

afterAll(async () => {
	await harness.close();
});

async function stageSlot(event: { variant: Variant; featureMatchDefaultStartingLife?: number }, seats: Record<string, ManualPlayerSlotData> = {}) {
	const [created] = await db.insert(schema.events)
		.values({
			name: 'Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			...event,
		})
		.returning({ id: schema.events.id });
	const eventId = created!.id;
	const slot = await featureMatchService().create(eventId, {});
	if (Object.keys(seats).length > 0)
		await featureMatchSlotWriteModule().updateSetup({ eventId, slotId: slot.id, input: seats });
	published.length = 0;
	return { eventId, slotId: slot.id };
}

/** Ana, Ben and Cyd in Seats 1 to 3 of a Commander Slot, Seat 4 empty. */
function commanderSlot(startingLife = 40) {
	return stageSlot({ variant: 'commander', featureMatchDefaultStartingLife: startingLife }, {
		player1Data: seat('Ana', [ATRAXA]),
		player2Data: seat('Ben', [TYMNA]),
		player3Data: seat('Cyd', [TYMNA, KRAUM]),
	});
}

/** The Slot's active Session as a reload reads it. */
async function session(eventId: number, slotId: number) {
	return mapFeatureMatchToResponse((await featureMatchService().findById(slotId, eventId))!).activeSession!;
}

/** One operator command sent to the Slot's Session, sequenced where it must be. */
async function send(eventId: number, slotId: number, command: Pick<FeatureMatchSessionCommand, 'type' | 'payload'>) {
	const active = await session(eventId, slotId);
	return featureMatchSessionModule().applyCommand(active.id, eventId, {
		commandId: `${command.type}-${active.sequence}`,
		baseSequence: active.sequence,
		...command,
	} as FeatureMatchSessionCommand);
}

const lifeOf = (state: Awaited<ReturnType<typeof session>>['currentState']) => SEAT_VALUES.map(seatKey => state[seatKey]?.lifeTotal);

describe('a Commander Slot\'s Session', () => {
	it('opens with its four Seats, each at the Event\'s starting life', async () => {
		const { eventId, slotId } = await commanderSlot(30);

		const { sourceSnapshot, currentState } = await session(eventId, slotId);

		expect(sourceSnapshot.variant).toBe('commander');
		expect(SEAT_VALUES.map(seatKey => sourceSnapshot[seatKey]?.data?.name ?? null)).toEqual(['Ana', 'Ben', 'Cyd', null]);
		expect(sourceSnapshot.player3?.data?.gameData).toMatchObject({
			commanders: [TYMNA, KRAUM],
		});
		expect(lifeOf(currentState)).toEqual([30, 30, 30, 30]);
	});

	it('takes Commander Damage and announces the life it cost', async () => {
		const { eventId, slotId } = await commanderSlot();

		await send(eventId, slotId, {
			type: 'AdjustCommanderDamage',
			payload: {
				player: 'player2',
				from: 'player1',
				commander: 1,
				delta: 5,
			},
		});

		const { currentState } = await session(eventId, slotId);
		expect(currentState.player2).toMatchObject({
			lifeTotal: 35,
			commanderDamage: [
				{ seat: 'player1', commander: 1, damage: 5 },
			],
		});
		expect(published.filter(message => message.type === 'featureMatchSession:eventApplied').map(message => message.payload))
			.toMatchObject([
				{
					eventType: 'AdjustCommanderDamage',
					currentState: {
						player2: { lifeTotal: 35 },
					},
				},
			]);
	});

	it('gives a Seat filled mid-Session the starting life, and keeps the Session', async () => {
		const { eventId, slotId } = await commanderSlot();
		await send(eventId, slotId, {
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -9 },
		});
		const before = await session(eventId, slotId);

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: {
				player4Data: seat('Dee', [ATRAXA]),
			},
		});

		const after = await session(eventId, slotId);
		expect(after.id).toBe(before.id);
		expect(after.sourceSnapshot.player4?.data?.name).toBe('Dee');
		expect(lifeOf(after.currentState)).toEqual([31, 40, 40, 40]);
	});

	it('moves each player\'s live state with them on Swap Seats, as one Session event', async () => {
		const { eventId, slotId } = await commanderSlot();
		await send(eventId, slotId, {
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -15 },
		});
		await send(eventId, slotId, {
			type: 'SetEliminated',
			payload: { player: 'player3', eliminated: true },
		});
		const before = await session(eventId, slotId);
		published.length = 0;

		const answer = await featureMatchSlotWriteModule().swapSeats({
			eventId,
			slotId,
			seats: ['player1', 'player3'],
		});

		const after = await session(eventId, slotId);
		expect([after.id, after.sequence]).toEqual([before.id, before.sequence + 1]);
		expect(SEAT_VALUES.map(seatKey => after.sourceSnapshot[seatKey]?.data?.name ?? null)).toEqual(['Cyd', 'Ben', 'Ana', null]);
		expect(lifeOf(after.currentState)).toEqual([40, 40, 25, 40]);
		expect([after.currentState.player1.eliminated, after.currentState.player3?.eliminated]).toEqual([true, false]);
		expect(answer.activeSession?.currentState).toEqual(after.currentState);
	});
});

describe('a Two-Player Slot\'s Session', () => {
	const twoPlayerSlot = () => stageSlot({ variant: 'two-player' }, {
		player1Data: { name: 'Ana' },
		player2Data: { name: 'Ben' },
	});

	// The snapshot and state are public contracts: neither gains a Seat 3 or 4 or a Variant.
	it('opens with the snapshot and state it always has', async () => {
		const { eventId, slotId } = await twoPlayerSlot();

		const { sourceSnapshot, currentState } = await session(eventId, slotId);

		expect(Object.keys(sourceSnapshot).filter(key => /^player[34]$|^variant$/.test(key))).toEqual([]);
		expect(Object.keys(currentState).sort()).toEqual([
			'activePlayer',
			'clock',
			'currentGame',
			'firstPlayer',
			'isComplete',
			'player1',
			'player2',
			'turnNumber',
		]);
		expect(Object.keys(currentState.player1).sort()).toEqual([
			'counters',
			'gameWins',
			'lifeTotal',
			'sideboardRevealed',
		]);
	});

	// The API still answers 400 to a Seat only a Commander Slot has, and the Session stays where it was.
	it('refuses a command naming Seat 3', async () => {
		const { eventId, slotId } = await twoPlayerSlot();
		const before = await session(eventId, slotId);

		await expect(send(eventId, slotId, {
			type: 'AdjustLife',
			payload: { player: 'player3', delta: -1 },
		})).rejects.toMatchObject({ statusCode: 400 });

		expect((await session(eventId, slotId)).sequence).toBe(before.sequence);
	});
});

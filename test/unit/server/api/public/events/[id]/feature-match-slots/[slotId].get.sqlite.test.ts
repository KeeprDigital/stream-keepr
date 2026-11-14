import type { FeatureMatchSessionCommand, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';
import { scryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';
import { ATRAXA, KRAUM, TYMNA, typedSeat } from '~~/test/helpers/commanders';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { fakeOpCardBulkLookup, mockOpWriteBoundaries } from '~~/test/helpers/opCards';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The public Feature Match read answers the stored Slot and its Session as one
// row of strings, and 404 for a Slot outside the Event. The row's own rules are
// `featureMatchPublicRow`'s.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

interface StubEvent { params: Record<string, string>; headers: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('setResponseHeader', (event: StubEvent, name: string, value: string) => {
	event.headers[name] = value;
});
vi.stubGlobal('createError', (input: { statusCode?: number; statusMessage?: string; message?: string }) =>
	Object.assign(new Error(input.statusMessage ?? input.message), input));
vi.stubGlobal('useRuntimeConfig', () => ({ bandaiKeeprApiKey: '', bandaiKeeprApiUrl: '' }));

mockOpWriteBoundaries(db, () => fakeOpCardBulkLookup([]));

const { default: handler } = await import('~~/server/api/public/events/[id]/feature-match-slots/[slotId].get');
const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchSessionModule } = await import('~~/server/modules/feature-match-session');
const { eventService } = await import('~~/server/services/event');
const { featureMatchService } = await import('~~/server/services/featureMatch');

const NOW = Date.UTC(2026, 9, 29, 12);
const ALICE = {
	name: 'Alice',
	wins: 4,
	losses: 1,
	draws: 0,
};
const BO = {
	name: 'Bo',
	wins: 3,
	losses: 2,
	draws: 1,
};

afterEach(() => vi.useRealTimers());
afterAll(async () => await harness.close());

/** Alice and Bo on a Two-Player Event's Slot, stored as a Slot and Session were before Commander. */
async function stage(withSession: boolean) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Regional Championship', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [slot] = await db.insert(schema.featureMatchSlots)
		.values({
			eventId,
			tableNumber: 4,
			roundName: 'Round 5',
			formatName: 'Modern',
			player1Data: ALICE,
			player2Data: BO,
		})
		.returning({ id: schema.featureMatchSlots.id });
	const slotId = slot!.id;
	if (withSession) {
		const state = createInitialFeatureMatchState(20, 'countdown', 600_000);
		state.player1.lifeTotal = 12;
		state.player1.gameWins = 1;
		state.clock = { ...state.clock, isRunning: true, lastStartedAt: NOW - 90_000 };
		const [session] = await db.insert(schema.featureMatchSessions)
			.values({
				eventId,
				slotId,
				// A Session's snapshot seats the Slot's players (ADR-0058).
				sourceSnapshot: {
					playerDisplayMode: 'score',
					player1: { playerId: null, data: ALICE },
					player2: { playerId: null, data: BO },
				} as FeatureMatchSourceSnapshot,
				currentState: state,
			})
			.returning({ id: schema.featureMatchSessions.id });
		await db.update(schema.featureMatchSlots)
			.set({ activeSessionId: session!.id })
			.where(eq(schema.featureMatchSlots.id, slotId));
	}
	return { eventId, slotId };
}

/** Ana, Ben, Cleo and Dara seated on a Commander Event's Slot by its setup save, which opens its Session. */
async function stageCommander() {
	// Created as the app creates one, so it holds a Commander Event's Match Format: 40 life, untimed.
	const { id: eventId } = await eventService().create({ name: 'Commander Night', game: 'mtg', variant: 'commander' });
	const slot = await featureMatchService().create(eventId, {});
	await featureMatchSlotWriteModule().updateSetup({
		eventId,
		slotId: slot.id,
		input: {
			player1Data: typedSeat('Ana', [ATRAXA]),
			player2Data: typedSeat('Ben', [TYMNA]),
			player3Data: typedSeat('Cleo', [TYMNA, KRAUM], { pronouns: 'she/her', lgs: 'Card Shop' }),
			player4Data: typedSeat('Dara', []),
		},
	});
	return { eventId, slotId: slot.id };
}

/** One operator command sent to the Slot's active Session. */
async function send(eventId: number, slotId: number, command: Pick<FeatureMatchSessionCommand, 'type' | 'payload'>) {
	const slot = await featureMatchService().findById(slotId, eventId);
	const active = slot!.activeSession!;
	await featureMatchSessionModule().applyCommand(active.id, eventId, {
		commandId: `${command.type}-${active.sequence}`,
		baseSequence: active.sequence,
		...command,
	} as FeatureMatchSessionCommand);
}

function read(id: number, slotId: number) {
	const event: StubEvent = {
		params: {
			id: String(id),
			slotId: String(slotId),
		},
		headers: {},
	};
	return {
		event,
		response: handler(stubH3Event({ ...event })),
	};
}

describe('the public Feature Match read', () => {
	// A vMix title binds by field name: a Two-Player row is what it was before
	// Commander, field for field and in order (ADR-0056, ADR-0087).
	it('answers a Two-Player Slot the row it always has, readable from any origin and never cached', async () => {
		vi.useFakeTimers({
			toFake: ['Date'],
			now: NOW,
		});
		const { eventId, slotId } = await stage(true);

		const { event, response } = read(eventId, slotId);
		const rows = await response;

		expect(rows).toHaveLength(1);
		expect(Object.entries(rows[0]!)).toEqual([
			['player1Name', 'Alice'],
			['player1Record', '4-1'],
			['player1Deck', ''],
			['player1DeckColors', ''],
			['player1Pronouns', ''],
			['player1Lgs', ''],
			['player1LeaderImage', ''],
			['player2Name', 'Bo'],
			['player2Record', '3-2-1'],
			['player2Deck', ''],
			['player2DeckColors', ''],
			['player2Pronouns', ''],
			['player2Lgs', ''],
			['player2LeaderImage', ''],
			['round', 'Round 5'],
			['stage', 'Round 5'],
			['table', 'Table 4'],
			['format', 'Modern'],
			['eventName', 'Regional Championship'],
			['clock', '8:30'],
			['player1Life', '12'],
			['player1GameWins', '1'],
			['player2Life', '20'],
			['player2GameWins', '0'],
			['player1Game1Win', '#FFFFFFFF'],
			['player1Game2Win', '#00000000'],
			['player2Game1Win', '#00000000'],
			['player2Game2Win', '#00000000'],
		]);
		expect(event.headers).toEqual({ 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
	});

	it('answers a Commander Slot its four Seats, and a Seat Eliminated since on the next read', async () => {
		const { eventId, slotId } = await stageCommander();

		const opened = await read(eventId, slotId).response;
		await send(eventId, slotId, {
			type: 'SetEliminated',
			payload: { player: 'player3', eliminated: true },
		});
		await send(eventId, slotId, {
			type: 'AdjustLife',
			payload: { player: 'player2', delta: -7 },
		});
		const later = await read(eventId, slotId).response;

		expect(opened).toEqual([
			{
				player1Name: 'Ana',
				player1Deck: 'Atraxa, Praetors\' Voice',
				player1DeckColors: 'WUBG',
				player1Pronouns: '',
				player1Lgs: '',
				player1Commander1Image: scryfallCardImageUrl(ATRAXA.scryfallId),
				player1Commander2Image: '',
				player2Name: 'Ben',
				player2Deck: 'Tymna the Weaver',
				player2DeckColors: 'WB',
				player2Pronouns: '',
				player2Lgs: '',
				player2Commander1Image: scryfallCardImageUrl(TYMNA.scryfallId),
				player2Commander2Image: '',
				player3Name: 'Cleo',
				player3Deck: 'Tymna the Weaver / Kraum, Ludevic\'s Opus',
				player3DeckColors: 'WUBR',
				player3Pronouns: 'she/her',
				player3Lgs: 'Card Shop',
				player3Commander1Image: scryfallCardImageUrl(TYMNA.scryfallId),
				player3Commander2Image: scryfallCardImageUrl(KRAUM.scryfallId),
				player4Name: 'Dara',
				player4Deck: '',
				player4DeckColors: '',
				player4Pronouns: '',
				player4Lgs: '',
				player4Commander1Image: '',
				player4Commander2Image: '',
				round: '',
				stage: '',
				table: '',
				format: 'Magic: The Gathering',
				eventName: 'Commander Night',
				clock: '',
				player1Life: '40',
				player1Eliminated: '#00000000',
				player2Life: '40',
				player2Eliminated: '#00000000',
				player3Life: '40',
				player3Eliminated: '#00000000',
				player4Life: '40',
				player4Eliminated: '#00000000',
			},
		]);
		expect(later).toEqual([
			{ ...opened[0], player2Life: '33', player3Eliminated: '#FFFFFFFF' },
		]);
	});

	it.each([
		{
			name: 'an Event that does not exist',
			target: async () => ({ eventId: 999_999, slotId: (await stage(false)).slotId }),
		},
		{
			name: 'a Slot of another Event',
			target: async () => ({ eventId: (await stage(false)).eventId, slotId: (await stage(false)).slotId }),
		},
	])('answers 404 for $name', async ({ target }) => {
		const { eventId, slotId } = await target();

		await expect(read(eventId, slotId).response).rejects.toMatchObject({ statusCode: 404 });
	});
});

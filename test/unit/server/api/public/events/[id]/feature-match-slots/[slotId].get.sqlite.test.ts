import type { FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The public Feature Match read answers one row of strings as the Overlay would
// show the Slot, its clock read at request time, and 404 for a Slot outside the Event.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

interface StubEvent { params: Record<string, string>; headers: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('setResponseHeader', (event: StubEvent, name: string, value: string) => {
	event.headers[name] = value;
});
vi.stubGlobal('createError', (input: { statusCode?: number; statusMessage?: string }) =>
	Object.assign(new Error(input.statusMessage), input));

vi.doMock('~~/server/db', () => ({ db }));

const { default: handler } = await import('~~/server/api/public/events/[id]/feature-match-slots/[slotId].get');

const NOW = Date.UTC(2026, 9, 29, 12);

afterEach(() => vi.useRealTimers());
afterAll(async () => await harness.close());

async function stage(withSession: boolean, player1GameWins = 1) {
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
			player1Data: {
				name: 'Alice',
				wins: 4,
				losses: 1,
				draws: 0,
			},
			player2Data: {
				name: 'Bo',
				wins: 3,
				losses: 2,
				draws: 1,
			},
		})
		.returning({ id: schema.featureMatchSlots.id });
	const slotId = slot!.id;
	if (withSession) {
		const state = createInitialFeatureMatchState(20, 'countdown', 600_000);
		state.player1.lifeTotal = 12;
		state.player1.gameWins = player1GameWins;
		state.clock = { ...state.clock, isRunning: true, lastStartedAt: NOW - 90_000 };
		const [session] = await db.insert(schema.featureMatchSessions)
			.values({
				eventId,
				slotId,
				sourceSnapshot: { playerDisplayMode: 'score' } as FeatureMatchSourceSnapshot,
				currentState: state,
			})
			.returning({ id: schema.featureMatchSessions.id });
		await db.update(schema.featureMatchSlots)
			.set({ activeSessionId: session!.id })
			.where(eq(schema.featureMatchSlots.id, slotId));
	}
	return { eventId, slotId };
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
	it.each([
		{
			name: 'its Session state, the clock as of now',
			withSession: true,
			live: {
				clock: '8:30',
				player1Life: '12',
				player1GameWins: '1',
				player2Life: '20',
				player2GameWins: '0',
				player1Game1Win: '#FFFFFFFF',
				player1Game2Win: '#00000000',
				player2Game1Win: '#00000000',
				player2Game2Win: '#00000000',
			},
		},
		{
			name: 'no Session as the Overlay does',
			withSession: false,
			live: {
				clock: '0:00',
				player1Life: '',
				player1GameWins: '0',
				player2Life: '',
				player2GameWins: '0',
				player1Game1Win: '#00000000',
				player1Game2Win: '#00000000',
				player2Game1Win: '#00000000',
				player2Game2Win: '#00000000',
			},
		},
	])('answers one row of the Slot\'s tokens and $name', async ({ withSession, live }) => {
		vi.useFakeTimers({
			toFake: ['Date'],
			now: NOW,
		});
		const { eventId, slotId } = await stage(withSession);
		const { event, response } = read(eventId, slotId);

		const rows = await response;
		expect(rows).toEqual([
			expect.objectContaining({
				player1Name: 'Alice',
				player1Record: '4-1',
				player2Name: 'Bo',
				player2Record: '3-2-1',
				player1Deck: '',
				table: 'Table 4',
				round: 'Round 5',
				format: 'Modern',
				eventName: 'Regional Championship',
				...live,
			}),
		]);
		expect(Object.values(rows[0]!).every(value => typeof value === 'string')).toBe(true);
		expect(event.headers['access-control-allow-origin']).toBe('*');
	});

	it.each([
		{ gameWins: 0, game1: '#00000000', game2: '#00000000' },
		{ gameWins: 1, game1: '#FFFFFFFF', game2: '#00000000' },
		{ gameWins: 2, game1: '#FFFFFFFF', game2: '#FFFFFFFF' },
	])('colours each game white once won, transparent before ($gameWins won)', async ({ gameWins, game1, game2 }) => {
		const { eventId, slotId } = await stage(true, gameWins);

		await expect(read(eventId, slotId).response).resolves.toEqual([
			expect.objectContaining({ player1Game1Win: game1, player1Game2Win: game2 }),
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

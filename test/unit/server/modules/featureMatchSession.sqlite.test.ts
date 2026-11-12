import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Feature Match Session module over real SQL: what a route's command and open
// answer, announce and ask of Broadcast Graphics. Faked: Ably, and the port that
// re-resolves Graphic Input Bindings. Command admission, receipts and races are
// `featureMatchState.sqlite.test.ts`'s; every other opener, `featureMatchSessionOpeners.sqlite.test.ts`'s.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

/** Each Event whose bindings were asked to re-resolve, with what its channel had been sent by then. */
const bindingsRefreshed: { eventId: number; after: string[] }[] = [];
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async (eventId: number) => {
		bindingsRefreshed.push({
			eventId,
			after: announced(eventId).map(([type]) => type),
		});
	},
}));

const { featureMatchSessionModule } = await import('~~/server/modules/feature-match-session');

/** What the Event's channel was sent, as `[type, payload]`. */
function announced(eventId: number) {
	return ably.on(eventRealtimeChannel(eventId)).map(({ type, payload }) => [type, payload] as const);
}

async function stageSlot() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const [slot] = await db.insert(schema.featureMatches)
		.values({ eventId: event!.id, tableNumber: 1 })
		.returning({ id: schema.featureMatches.id });
	return { eventId: event!.id, slotId: slot!.id };
}

beforeEach(() => {
	ably.reset();
	bindingsRefreshed.length = 0;
});
afterAll(async () => await harness.close());

describe('a Feature Match Session command', () => {
	// A binding may read a Slot's live state, and a command is the one such change Event Data publication never sees.
	it('is applied, announced under the writer\'s origin, and then catches bound Broadcast Graphics up', async () => {
		const { eventId, slotId } = await stageSlot();
		const session = (await featureMatchSessionModule().createSessionForSlot(slotId, eventId))!;
		ably.reset();
		bindingsRefreshed.length = 0;

		const result = await featureMatchSessionModule().applyCommand(session.id, eventId, {
			commandId: 'command-1',
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 18 },
			baseSequence: session.sequence,
		}, 'origin-1');

		expect(result).toMatchObject({ sessionId: session.id, sequence: session.sequence + 1, eventType: 'SetLife' });
		expect(announced(eventId)).toEqual([
			[
				'featureMatchSession:eventApplied',
				expect.objectContaining({ sessionId: session.id, eventType: 'SetLife', originConnectionId: 'origin-1' }),
			],
		]);
		expect(bindingsRefreshed).toEqual([
			{
				eventId,
				after: ['featureMatchSession:eventApplied'],
			},
		]);
	});
});

describe('opening a Feature Match Session', () => {
	it('answers no Session for a Slot the Event does not hold, announcing nothing', async () => {
		const { eventId } = await stageSlot();
		const other = await stageSlot();

		await expect(featureMatchSessionModule().createSessionForSlot(other.slotId, eventId, 'origin-1')).resolves.toBeNull();

		expect(await db.select().from(schema.featureMatchSessions).where(inArray(schema.featureMatchSessions.eventId, [eventId, other.eventId]))).toEqual([]);
		expect(ably.published).toEqual([]);
	});
});

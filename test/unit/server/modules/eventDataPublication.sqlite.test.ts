import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A batch of Feature Match Slot updates over real SQL: which Slots it announces, how
// often it reads them, and how often Graphic Input Bindings re-resolve. Faked: Ably, and
// the Broadcast Graphics Live Session port. Each message's shape is `eventDataPublication.test.ts`'s.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

/** Each Event whose Graphic Input Bindings were re-resolved, in order. */
const reResolved: number[] = [];
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: async (eventId: number) => {
		reResolved.push(eventId);
	},
}));

const { eventDataPublicationModule } = await import('~~/server/modules/event-data-publication');

const ORIGIN = 'origin-1';
let eventId: number;
/** The Event's three Slots, in order. */
let slotIds: number[];
/** A Slot of another Event. */
let foreignSlotId: number;

async function stageEventWithSlots(count: number) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const slots = await db.insert(schema.featureMatches)
		.values(Array.from({ length: count }, (_, index) => ({ eventId: event!.id, tableNumber: index + 1, sortOrder: index })))
		.returning({ id: schema.featureMatches.id });
	return {
		eventId: event!.id,
		slotIds: slots.map(slot => slot.id),
	};
}

/** What the Event's channel was sent, as `[type, Slot id, origin]`. */
function announced() {
	return ably.on(eventRealtimeChannel(eventId)).map(({ type, payload }) => [
		type,
		(payload.featureMatch as { id: number }).id,
		payload.originConnectionId,
	]);
}

/** The round trips to the database one batch makes. */
async function roundTripsFor(updated: number[]) {
	const before = harness.roundTrips();
	await eventDataPublicationModule().featureMatchSlotsUpdated({ eventId, slotIds: updated });
	return harness.roundTrips() - before;
}

beforeAll(async () => {
	({ eventId, slotIds } = await stageEventWithSlots(3));
	foreignSlotId = (await stageEventWithSlots(1)).slotIds[0]!;
});
beforeEach(() => {
	ably.reset();
	reResolved.length = 0;
});
afterAll(async () => await harness.close());

describe('a batch of Feature Match Slot updates', () => {
	it('announces each Slot the Event still holds, in the order asked, under the writer\'s origin', async () => {
		const [first, , third] = slotIds as [number, number, number];

		const answered = await eventDataPublicationModule().featureMatchSlotsUpdated({
			eventId,
			slotIds: [third, 999_999, foreignSlotId, first],
			originConnectionId: ORIGIN,
		});

		expect(answered.map(slot => slot.id)).toEqual([third, first]);
		expect(announced()).toEqual([
			['featureMatch:updated', third, ORIGIN],
			['featureMatch:updated', first, ORIGIN],
		]);
	});

	// A read per Slot would cost fifty round trips at the supported maximum.
	it('reads the Event\'s Slots once, however many it announces', async () => {
		const forOne = await roundTripsFor(slotIds.slice(0, 1));

		expect(await roundTripsFor(slotIds)).toBe(forOne);
		expect(announced()).toHaveLength(1 + slotIds.length);
	});

	it('reads and announces nothing when no Slot was affected', async () => {
		const before = harness.roundTrips();

		await expect(eventDataPublicationModule().featureMatchSlotsUpdated({ eventId, slotIds: [] })).resolves.toEqual([]);

		expect(harness.roundTrips()).toBe(before);
		expect(ably.published).toEqual([]);
		expect(reResolved).toEqual([]);
	});

	// Re-resolution is per Event, so a batch is one Event Data change to a binding.
	it('re-resolves Graphic Input Bindings once for the whole batch', async () => {
		await eventDataPublicationModule().featureMatchSlotsUpdated({ eventId, slotIds });

		expect(announced()).toHaveLength(slotIds.length);
		expect(reResolved).toEqual([eventId]);
	});
});

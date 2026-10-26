import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { chunkRowsWithinParameterBudget } from '~~/server/utils/db';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

// Opening Sessions for more than a hundred Slots stays within D1's bound-parameter limit (#728).

const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

afterAll(async () => await harness.dispose());

/** The Slot each `SessionStarted` named, in the order it was announced. */
const announcedSlotIds: number[] = [];

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async (_eventId: number, name: string, payload: { slotId: number; eventType: string }) => {
		if (name === 'featureMatchSession:eventApplied' && payload.eventType === 'SessionStarted')
			announcedSlotIds.push(payload.slotId);
	},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));

const { featureMatchStateService } = await import('~~/server/services/featureMatchState');

beforeEach(() => {
	announcedSlotIds.length = 0;
});

/**
 * An Event holding `count` Slots, none with a Session yet, in id order. Above
 * fifty the Slots outnumber the Event's own count on purpose: no product path
 * writes such an Event, and only the service under test reads these.
 */
async function eventWithSlots(count: number) {
	const [event] = await db.insert(schema.events)
		.values({
			name: `Slots ${count}`,
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			numFeatureMatches: Math.min(count, 50),
		})
		.returning();
	const rows = Array.from({ length: count }, (_, sortOrder) => ({ eventId: event!.id, sortOrder }));
	const insertSlots = (chunk: typeof rows) => db.insert(schema.featureMatches).values(chunk);
	for (const chunk of chunkRowsWithinParameterBudget(rows, insertSlots))
		await insertSlots(chunk);
	const slots = await db.query.featureMatches.findMany({
		where: eq(schema.featureMatches.eventId, event!.id),
		orderBy: [
			asc(schema.featureMatches.id),
		],
	});
	return {
		eventId: event!.id,
		slotIds: slots.map(slot => slot.id),
	};
}

async function sessionsOf(eventId: number) {
	return await db.query.featureMatchSessions.findMany({
		where: eq(schema.featureMatchSessions.eventId, eventId),
		orderBy: [
			asc(schema.featureMatchSessions.id),
		],
	});
}

async function activeSessionIdsBySlot(eventId: number) {
	const slots = await db.query.featureMatches.findMany({
		where: eq(schema.featureMatches.eventId, eventId),
		columns: { id: true, activeSessionId: true },
	});
	return new Map(slots.map(slot => [slot.id, slot.activeSessionId]));
}

/** Each Slot answers with an active Session of its own, the one the Slot links. */
async function expectEachSlotOwnsItsSession(
	eventId: number,
	slotIds: readonly number[],
	opened: Map<number, schema.DbFeatureMatchSession>,
) {
	expect([
		...opened.keys(),
	].sort((a, b) => a - b)).toEqual(slotIds);
	const linked = await activeSessionIdsBySlot(eventId);
	for (const slotId of slotIds) {
		expect(opened.get(slotId)).toMatchObject({
			slotId,
			eventId,
			status: 'active',
			sequence: 1,
		});
		expect(linked.get(slotId)).toBe(opened.get(slotId)!.id);
	}
}

describe('opening Feature Match Sessions on D1', () => {
	it.each([2, 120])('opens and announces a Session for each of %i Slots', async (count) => {
		const { eventId, slotIds } = await eventWithSlots(count);

		const opened = await featureMatchStateService().openSessionsForSlots(eventId, slotIds);

		await expectEachSlotOwnsItsSession(eventId, slotIds, opened);
		expect(await sessionsOf(eventId)).toHaveLength(count);
		expect(announcedSlotIds).toEqual(slotIds);
	});

	it.each([2, 120])('replaces the Sessions of %i Slots that already hold one', async (count) => {
		const { eventId, slotIds } = await eventWithSlots(count);
		const first = await featureMatchStateService().openSessionsForSlots(eventId, slotIds);
		announcedSlotIds.length = 0;

		const second = await featureMatchStateService().openSessionsForSlots(eventId, slotIds);

		await expectEachSlotOwnsItsSession(eventId, slotIds, second);
		for (const slotId of slotIds)
			expect(second.get(slotId)!.id).not.toBe(first.get(slotId)!.id);
		const sessions = await sessionsOf(eventId);
		expect(sessions.filter(session => session.status === 'closed').map(session => session.id))
			.toEqual(slotIds.map(slotId => first.get(slotId)!.id));
		expect(announcedSlotIds).toEqual(slotIds);
	});

	/**
	 * Slots named out of order, holding Sessions opened later half first, so
	 * neither the order asked nor the Sessions' ids follow the Slots' own.
	 */
	it.each([3, 120])('announces the Sessions of %i Slots named out of order in Slot order', async (count) => {
		const { eventId, slotIds } = await eventWithSlots(count);
		const half = Math.floor(count / 2);
		await featureMatchStateService().openSessionsForSlots(eventId, slotIds.slice(half));
		await featureMatchStateService().openSessionsForSlots(eventId, slotIds.slice(0, half));
		announcedSlotIds.length = 0;
		const reversed = [...slotIds].reverse();

		const opened = await featureMatchStateService().openSessionsForSlots(eventId, reversed);

		await expectEachSlotOwnsItsSession(eventId, slotIds, opened);
		expect(announcedSlotIds).toEqual(slotIds);
	});
});

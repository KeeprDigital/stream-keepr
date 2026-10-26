import type { BatchItem } from 'drizzle-orm/batch';
import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

/**
 * An Event's Feature Match Slot count, at the sizes an Event is permitted (#702).
 *
 * The count is one to fifty, and every Slot it adds needs its first Feature
 * Match Session. The Slot insert bound four parameters per row, so on D1 —
 * which fails a statement on its hundred-and-first parameter — twenty-five
 * Slots fitted and twenty-six did not. The libSQL harness the module's other
 * tests use accepts several hundred, so these run against a real D1 binding.
 *
 * The count is the Event's own field, written before the Slots are; so a write
 * that fails part-way must leave the count describing the Slots the Event
 * actually holds, and the Slots each holding their Session.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('readValidatedBody', async (event: { body: unknown }, parse: (body: unknown) => unknown) => parse(event.body));
vi.stubGlobal('setResponseStatus', () => {});

const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const realDb = drizzle(harness.database, { schema });

afterAll(async () => await harness.dispose());

/** A D1 batch whose SQL matches is refused once, as a failed commit would be. */
let refuseBatch: ((statements: string[]) => boolean) | null = null;

function refuseNextBatchWriting(table: string) {
	refuseBatch = statements => statements.some(statement => statement.startsWith(`insert into "${table}"`));
}

const db = new Proxy(realDb, {
	get(target, property, receiver) {
		if (property !== 'batch')
			return Reflect.get(target, property, receiver);
		return async (statements: BatchItem<'sqlite'>[]) => {
			const refuse = refuseBatch;
			if (refuse?.(statements.map(statement => (statement as unknown as { toSQL: () => { sql: string } }).toSQL().sql))) {
				refuseBatch = null;
				throw new Error('injected D1 batch failure');
			}
			return await target.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
		};
	},
});

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

const { default: createEventRoute } = await import('~~/server/api/events/index.post');
const { eventWriteModule } = await import('~~/server/modules/event-write');

beforeEach(() => {
	refuseBatch = null;
});

async function createEvent(numFeatureMatches: number) {
	return await (createEventRoute as unknown as (event: { body: unknown }) => Promise<{ id: number; numFeatureMatches: number }>)({
		body: {
			name: `Slots ${numFeatureMatches}`,
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			numFeatureMatches,
		},
	});
}

async function slotsOf(eventId: number) {
	return await realDb.query.featureMatches.findMany({
		where: eq(schema.featureMatches.eventId, eventId),
		with: { activeSession: true },
		orderBy: [
			asc(schema.featureMatches.sortOrder),
			asc(schema.featureMatches.id),
		],
	});
}

async function activeSessionsOf(eventId: number) {
	const sessions = await realDb.query.featureMatchSessions.findMany({
		where: eq(schema.featureMatchSessions.eventId, eventId),
	});
	return sessions.filter(session => session.status === 'active');
}

async function countOf(eventId: number) {
	const event = await realDb.query.events.findFirst({
		where: eq(schema.events.id, eventId),
	});
	return event?.numFeatureMatches;
}

/** Every Slot is in display order and holds one active Session of its own. */
function expectInitialisedInOrder(slots: Awaited<ReturnType<typeof slotsOf>>) {
	expect(slots.map(slot => slot.sortOrder)).toEqual(slots.map((_, index) => index));
	for (const slot of slots) {
		expect(slot.activeSession).toMatchObject({ slotId: slot.id, status: 'active', sequence: 1 });
	}
}

describe('an Event\'s Feature Match Slot count on D1', () => {
	it('creates an Event with fifty Slots, each with its first Session', async () => {
		const event = await createEvent(50);

		const slots = await slotsOf(event.id);
		expect(await countOf(event.id)).toBe(50);
		expect(slots).toHaveLength(50);
		expectInitialisedInOrder(slots);
		expect(await activeSessionsOf(event.id)).toHaveLength(50);
	});

	it('increases an Event from one Slot to fifty, keeping the first Slot and its Session', async () => {
		const event = await createEvent(1);
		const [first] = await slotsOf(event.id);

		const updated = await eventWriteModule().updateEvent({
			eventId: event.id,
			input: { numFeatureMatches: 50 },
		});

		expect(updated.numFeatureMatches).toBe(50);
		const slots = await slotsOf(event.id);
		expect(slots).toHaveLength(50);
		expectInitialisedInOrder(slots);
		expect(slots[0]).toMatchObject({ id: first!.id, activeSessionId: first!.activeSessionId });
		expect(await activeSessionsOf(event.id)).toHaveLength(50);
	});

	it('decreases an Event from fifty Slots by removing them from the end of display order', async () => {
		const event = await createEvent(50);
		const kept = (await slotsOf(event.id)).slice(0, 20).map(slot => slot.id);

		const updated = await eventWriteModule().updateEvent({
			eventId: event.id,
			input: { numFeatureMatches: 20 },
		});

		expect(updated.numFeatureMatches).toBe(20);
		expect((await slotsOf(event.id)).map(slot => slot.id)).toEqual(kept);
	});

	it('keeps ordinary small counts working', async () => {
		const event = await createEvent(2);
		await eventWriteModule().updateEvent({
			eventId: event.id,
			input: { numFeatureMatches: 3 },
		});
		expect(await slotsOf(event.id)).toHaveLength(3);

		await eventWriteModule().updateEvent({
			eventId: event.id,
			input: { numFeatureMatches: 1 },
		});
		const slots = await slotsOf(event.id);
		expect(slots).toHaveLength(1);
		expectInitialisedInOrder(slots);
		expect(await countOf(event.id)).toBe(1);
	});

	describe('a write that fails part-way', () => {
		it('leaves the count and the Slots as they were when the new Slots cannot be inserted', async () => {
			const event = await createEvent(3);
			const before = await slotsOf(event.id);
			refuseNextBatchWriting('feature_match_slots');

			await expect(eventWriteModule().updateEvent({
				eventId: event.id,
				input: { numFeatureMatches: 40 },
			}))
				.rejects
				.toThrow('injected D1 batch failure');

			expect(await countOf(event.id)).toBe(3);
			expect(await slotsOf(event.id)).toEqual(before);
		});

		it('leaves the count and the Slots as they were when the new Slots\' Sessions cannot be opened', async () => {
			const event = await createEvent(3);
			const before = await slotsOf(event.id);
			refuseNextBatchWriting('feature_match_sessions');

			await expect(eventWriteModule().updateEvent({
				eventId: event.id,
				input: { numFeatureMatches: 40 },
			}))
				.rejects
				.toThrow('injected D1 batch failure');

			expect(await countOf(event.id)).toBe(3);
			expect(await slotsOf(event.id)).toEqual(before);
			expect(await activeSessionsOf(event.id)).toHaveLength(3);
		});

		it('creates no Event when its Slots\' Sessions cannot be opened', async () => {
			const eventsBefore = await realDb.select({ id: schema.events.id }).from(schema.events);
			refuseNextBatchWriting('feature_match_sessions');

			await expect(createEvent(50)).rejects.toThrow('injected D1 batch failure');

			expect(await realDb.select({ id: schema.events.id }).from(schema.events)).toEqual(eventsBefore);
		});
	});
});

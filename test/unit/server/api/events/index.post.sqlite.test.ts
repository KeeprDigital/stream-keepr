import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// POST /api/events over real SQL: an Event is stored with its Feature Match Slots or
// not at all. The database itself refuses the Slot insert, or the Event delete undoing
// it, through a trigger; only Ably is faked.

interface StubRequest { body: unknown; status?: number }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('readValidatedBody', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('setResponseStatus', (event: StubRequest, status: number) => {
	event.status = status;
});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);

type Handler = (event: H3Event) => Promise<Record<string, unknown>>;
const createEvent = (await import('~~/server/api/events/index.post')).default as unknown as Handler;

/** A write the database can be made to refuse, by the name its refusal carries. */
const refusable = {
	slot_insert_refused: 'insert on feature_match_slots',
	event_delete_refused: 'delete on events',
} as const;

async function refuse(...writes: (keyof typeof refusable)[]) {
	for (const write of writes) {
		await harness.client.execute(`create trigger ${write} before ${refusable[write]}
			begin select raise(abort, '${write}'); end`);
	}
}

/** A database refusal's text, whether or not Drizzle wrapped it as the cause of its own error. */
function refusalText(failure: unknown) {
	const { message, cause } = failure as Error;
	return `${message} ${(cause as Error | undefined)?.message ?? ''}`;
}

async function eventsNamed(name: string) {
	return await db.select({ id: schema.events.id }).from(schema.events).where(eq(schema.events.name, name));
}

afterEach(async () => {
	for (const write of Object.keys(refusable))
		await harness.client.execute(`drop trigger if exists ${write}`);
});
afterAll(async () => await harness.close());

describe('creating an Event', () => {
	it('stores the Event with its Feature Match Slots and answers 201', async () => {
		const request = stubH3Event({
			body: { name: 'Stored', game: 'mtg', numFeatureMatches: 2 },
		});

		const answer = await createEvent(request);

		const [event] = await eventsNamed('Stored');
		expect(request).toMatchObject({ status: 201 });
		expect(answer).toMatchObject({
			id: event!.id,
			name: 'Stored',
			numFeatureMatches: 2,
			talents: [],
		});
		expect(await db.select().from(schema.featureMatches).where(eq(schema.featureMatches.eventId, event!.id))).toHaveLength(2);
	});

	// A Commander Event keeps its Variant and starts as one untimed game at 40 life (ADR-0087).
	it('stores a Commander Event with its Variant and a Commander Event\'s Match Format', async () => {
		const answer = await createEvent(stubH3Event({
			body: { name: 'Commander Night', game: 'mtg', variant: 'commander' },
		}));

		const [event] = await eventsNamed('Commander Night');
		expect(answer).toMatchObject({ id: event!.id, variant: 'commander' });
		expect(await db.query.events.findFirst({
			where: eq(schema.events.id, event!.id),
		})).toMatchObject({
			variant: 'commander',
			featureMatchDefaultStartingLife: 40,
			featureMatchDefaultClockType: 'untimed',
			featureMatchDefaultBestOf: 1,
		});
	});

	it('removes the Event it stored when its Feature Match Slots cannot be created, surfacing that failure', async () => {
		await refuse('slot_insert_refused');

		await expect(createEvent(stubH3Event({
			body: { name: 'Without Slots', game: 'mtg' },
		}))).rejects.toThrow(/slot_insert_refused/);

		expect(await eventsNamed('Without Slots')).toEqual([]);
	});

	// A thrown removal failure would replace the root cause the operator must act on.
	it('surfaces the Slot failure, carrying and logging the removal\'s, when the Event cannot be removed either', async () => {
		await refuse('slot_insert_refused', 'event_delete_refused');
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const failure = await createEvent(stubH3Event({
			body: { name: 'Left Behind', game: 'mtg' },
		})).catch((error: unknown) => error) as Error & { compensationFailure?: unknown };

		expect(refusalText(failure)).toMatch(/slot_insert_refused/);
		expect(refusalText(failure.compensationFailure)).toMatch(/event_delete_refused/);
		expect(logged).toHaveBeenCalledWith(expect.stringContaining('compensation_failed'));
		// The partial write the removal was meant to undo is still there.
		expect(await eventsNamed('Left Behind')).toHaveLength(1);
	});
});

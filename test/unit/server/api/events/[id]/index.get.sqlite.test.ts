import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// GET /api/events/:id over real SQL. The handler's own read decides the answer:
// `event-exists` middleware asked an earlier, separate query, and an Event deleted
// between the two must answer 404 rather than reach the mapper.

interface StubRequest { params: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('createError', (input: { statusCode?: number; statusMessage?: string; message?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

type Handler = (event: H3Event) => Promise<Record<string, unknown>>;
const getEvent = (await import('~~/server/api/events/[id]/index.get')).default as unknown as Handler;

function get(eventId: number) {
	return getEvent(stubH3Event({
		params: {
			id: String(eventId),
		},
	}));
}

afterAll(async () => await harness.close());

describe('one Event as the API reports it', () => {
	it('answers the Event with its Talent, reporting its Melee credentials as configured without disclosing them', async () => {
		const [event] = await db.insert(schema.events).values({
			name: 'Reported',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			meleeClientId: 'client-id',
			meleeClientSecret: 'stored-envelope',
		}).returning({ id: schema.events.id });
		await db.insert(schema.eventTalents).values({ eventId: event!.id, name: 'Cedric Phillips' });

		const answer = await get(event!.id);

		expect(answer).toMatchObject({
			id: event!.id,
			name: 'Reported',
			meleeConfigured: true,
			talents: [
				{ name: 'Cedric Phillips' },
			],
		});
		expect(JSON.stringify(answer)).not.toContain('stored-envelope');
	});

	it('answers 404 when the Event is gone by the time the handler reads it', async () => {
		await expect(get(999_999)).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Event not found' });
	});
});

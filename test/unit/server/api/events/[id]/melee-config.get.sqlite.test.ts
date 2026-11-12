import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// GET /api/events/:id/melee-config over real SQL: whether Melee credentials are
// stored, never the secret itself, and a 404 from the handler's own read of the Event.

interface StubRequest { params: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('createError', (input: { statusCode?: number; statusMessage?: string; message?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

type Handler = (event: H3Event) => Promise<Record<string, unknown>>;
const getMeleeConfig = (await import('~~/server/api/events/[id]/melee-config.get')).default as unknown as Handler;

function get(eventId: number) {
	return getMeleeConfig(stubH3Event({
		params: {
			id: String(eventId),
		},
	}));
}

afterAll(async () => await harness.close());

describe('one Event\'s Melee configuration', () => {
	it.each([
		{ stored: 'a client id and a secret', meleeClientSecret: 'stored-envelope', meleeConfigured: true },
		{ stored: 'a client id with no secret', meleeClientSecret: null, meleeConfigured: false },
	])('reports $stored as configured: $meleeConfigured, never disclosing the stored secret', async ({ meleeClientSecret, meleeConfigured }) => {
		const [event] = await db.insert(schema.events).values({
			name: 'Melee Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			meleeEnabled: true,
			meleeEventId: '123',
			meleeClientId: 'client-id',
			meleeClientSecret,
		}).returning({ id: schema.events.id });

		// Exactly these fields: the secret is not among them under any name.
		expect(await get(event!.id)).toEqual({
			meleeEnabled: true,
			meleeEventId: '123',
			meleeClientId: 'client-id',
			meleeConfigured,
		});
	});

	it('answers 404 when the Event is gone by the time the handler reads it', async () => {
		await expect(get(999_999)).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Event not found' });
	});
});

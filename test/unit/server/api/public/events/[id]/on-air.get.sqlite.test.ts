import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The public on-air read names an Event's seated commentators in slot order and
// its holding text as stored, and answers 404 for an Event that does not exist.

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

const { default: handler } = await import('~~/server/api/public/events/[id]/on-air.get');

afterAll(async () => await harness.close());

async function stage(seat: { first: boolean; second: boolean }, holdingText: string | null) {
	const [event] = await db.insert(schema.events)
		.values({
			name: 'Regional Championship',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			holdingText,
		})
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [alex, sam] = await db.insert(schema.eventTalents)
		.values([
			{ eventId, name: 'Alex' },
			{ eventId, name: 'Sam' },
		])
		.returning({ id: schema.eventTalents.id });
	await db.update(schema.events)
		.set({
			commentator1TalentId: seat.first ? alex!.id : null,
			commentator2TalentId: seat.second ? sam!.id : null,
		})
		.where(eq(schema.events.id, eventId));
	return eventId;
}

function read(id: number | string) {
	const event: StubEvent = {
		params: {
			id: String(id),
		},
		headers: {},
	};
	return {
		event,
		response: (handler as (event: StubEvent) => Promise<unknown>)(event),
	};
}

describe('the public on-air read', () => {
	it.each([
		{
			seat: { first: true, second: true },
			holdingText: 'Back after the break',
			talent: [
				{ slot: 1, name: 'Alex' },
				{ slot: 2, name: 'Sam' },
			],
		},
		{
			seat: { first: false, second: true },
			holdingText: null,
			talent: [
				{ slot: 2, name: 'Sam' },
			],
		},
		{
			seat: { first: false, second: false },
			holdingText: 'Paused',
			talent: [],
		},
	])('names the seated commentators and the holding text ($talent.length seated)', async ({ seat, holdingText, talent }) => {
		const eventId = await stage(seat, holdingText);
		const { event, response } = read(eventId);

		await expect(response).resolves.toEqual({
			eventId,
			eventName: 'Regional Championship',
			holdingText,
			talent,
		});
		expect(event.headers['access-control-allow-origin']).toBe('*');
	});

	it('answers 404 for an Event that does not exist', async () => {
		await expect(read(999_999).response).rejects.toMatchObject({ statusCode: 404 });
	});
});

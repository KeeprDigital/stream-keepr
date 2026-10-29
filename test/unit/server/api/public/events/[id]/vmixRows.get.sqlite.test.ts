import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The public vMix rows answer one row of strings, an unset value empty rather
// than null, and 404 for an Event that does not exist.

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

const { default: commentators } = await import('~~/server/api/public/events/[id]/commentators.get');
const { default: holdingText } = await import('~~/server/api/public/events/[id]/holding-text.get');

afterAll(async () => await harness.close());

async function stage(seat: { first: boolean; second: boolean }, holding: string | null) {
	const [event] = await db.insert(schema.events)
		.values({
			name: 'Regional Championship',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			holdingText: holding,
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

function read(handler: (event: ReturnType<typeof stubH3Event>) => Promise<unknown>, id: number) {
	const event: StubEvent = {
		params: {
			id: String(id),
		},
		headers: {},
	};
	return {
		event,
		response: handler(stubH3Event({ ...event })),
	};
}

describe('the public vMix rows', () => {
	it.each([
		{
			seat: { first: true, second: true },
			holding: 'Back after the break',
			rows: {
				commentators: [
					{ commentator1: 'Alex', commentator2: 'Sam' },
				],
				holdingText: [
					{ holdingText: 'Back after the break' },
				],
			},
		},
		{
			seat: { first: false, second: true },
			holding: null,
			rows: {
				commentators: [
					{ commentator1: '', commentator2: 'Sam' },
				],
				holdingText: [
					{ holdingText: '' },
				],
			},
		},
	])('answer one row per read, unset values empty ($rows.holdingText.0.holdingText)', async ({ seat, holding, rows }) => {
		const eventId = await stage(seat, holding);
		const names = read(commentators, eventId);
		const text = read(holdingText, eventId);

		await expect(names.response).resolves.toEqual(rows.commentators);
		await expect(text.response).resolves.toEqual(rows.holdingText);
		expect([names.event.headers['access-control-allow-origin'], text.event.headers['access-control-allow-origin']]).toEqual(['*', '*']);
	});

	it.each([
		{ name: 'commentators', handler: commentators },
		{ name: 'holding text', handler: holdingText },
	])('answer 404 for an Event that does not exist ($name)', async ({ handler }) => {
		await expect(read(handler, 999_999).response).rejects.toMatchObject({ statusCode: 404 });
	});
});

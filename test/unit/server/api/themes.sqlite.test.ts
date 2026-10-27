import type { H3Event } from 'h3';
import type { ThemeResponse } from '~~/shared/types/theme';
import type { ScreenOutputEvent } from '~~/shared/utils/screenOutputEvent';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Theme library over its real routes and migrations (ADR-0049): what a write stores, what
// it refuses, where it is announced, and what a Screen Output then reads.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const published: Array<{ eventId: number; type: string; data: Record<string, any> }> = [];
async function publishMessage(eventId: number, type: string, data: Record<string, any>) {
	published.push({ eventId, type, data });
}
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage,
	publishMessageStrict: publishMessage,
	getOriginConnectionId: () => undefined,
}));

interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('setResponseStatus', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

// Admission is ADR-0022's and pinned elsewhere; this suite is about what the read answers.
vi.doMock('~~/server/utils/screenOutputRead', () => ({
	requireScreenOutputRead: async (event: StubEvent) => ({
		eventId: Number(event.params.id),
	}),
	screenOutputReadNotFound: () => {
		throw new Error('not found');
	},
}));

type Handler = (event: H3Event) => Promise<any>;
const handler = (module: { default: unknown }) => module.default as Handler;
const listThemes = handler(await import('~~/server/api/themes/index.get'));
const createTheme = handler(await import('~~/server/api/themes/index.post'));
const getTheme = handler(await import('~~/server/api/themes/[themeId]/index.get'));
const renameTheme = handler(await import('~~/server/api/themes/[themeId]/index.patch'));
const deleteTheme = handler(await import('~~/server/api/themes/[themeId]/index.delete'));
const setToken = handler(await import('~~/server/api/themes/[themeId]/tokens/[token].put'));
const clearToken = handler(await import('~~/server/api/themes/[themeId]/tokens/[token].delete'));
const updateEvent = handler(await import('~~/server/api/events/[id]/index.patch'));
const readOutputEvent = handler(await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/event.get'));

function call(handler: Handler, params: Record<string, string | number>, body?: unknown) {
	return handler(stubH3Event({
		params: Object.fromEntries(Object.entries(params).map(([key, value]) => [
			key,
			String(value),
		])),
		body,
	}));
}

async function refusal(promise: Promise<unknown>) {
	return await promise.then(
		() => {
			throw new Error('The write was not refused');
		},
		(error: { statusCode?: number; message?: string; data?: unknown }) => ({
			statusCode: error.statusCode,
			message: error.message,
			data: error.data,
		}),
	);
}

const create = (name: string): Promise<ThemeResponse> => call(createTheme, {}, { name });
const set = (themeId: string, token: string, value: unknown): Promise<ThemeResponse> => call(setToken, { themeId, token }, { value });
const clear = (themeId: string, token: string): Promise<ThemeResponse> => call(clearToken, { themeId, token });
const select = (eventId: number, themeId: string | null) => call(updateEvent, { id: eventId }, { themeId });

async function createEvent(name: string): Promise<number> {
	const [event] = await db.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

async function storedTokens(themeId: string) {
	const [row] = await db.select().from(schema.themes).where(eq(schema.themes.id, themeId));
	return row?.tokens;
}

function announcedThemes() {
	return published
		.filter(message => message.type === 'theme:updated')
		.map(message => ({ eventId: message.eventId, revision: message.data.theme.revision, tokens: message.data.theme.tokens }));
}

beforeEach(() => {
	published.length = 0;
});

afterAll(async () => {
	await harness.close();
});

describe('the Theme library', () => {
	it('creates a Theme that sets no token, lists it, and renames it', async () => {
		const theme = await create('  Summer Series  ');

		expect(theme).toMatchObject({ name: 'Summer Series', tokens: {} });
		expect(await storedTokens(theme.id)).toEqual({});

		const renamed = await call(renameTheme, { themeId: theme.id }, { name: 'Winter Series' });
		expect(renamed.name).toBe('Winter Series');
		const { themes } = await call(listThemes, {});
		expect(themes.map((listed: { id: string; name: string }) => [listed.id, listed.name])).toContainEqual([theme.id, 'Winter Series']);
		expect(published).toEqual([]);
	});

	it('stores only the tokens set, keeps other writers\' tokens, and lets the last write to one token win', async () => {
		const theme = await create('Tokens');

		await set(theme.id, 'accent', '#ff0000');
		await set(theme.id, 'standings.row-divider', { token: 'accent' });
		await set(theme.id, 'accent', 'rgba(0, 0, 255, 0.5)');
		expect(await storedTokens(theme.id)).toEqual({
			'accent': 'rgba(0, 0, 255, 0.5)',
			'standings.row-divider': { token: 'accent' },
		});

		const cleared = await clear(theme.id, 'accent');
		expect(cleared.tokens).toEqual({
			'standings.row-divider': { token: 'accent' },
		});
		expect(await storedTokens(theme.id)).toEqual(cleared.tokens);
	});

	// Which values a write refuses is `parseThemeTokenWrite`'s own test; here, that the route asks it.
	it.each([
		['a colour given a number', 'accent', 12],
		[
			'an unimplemented Animation Effect',
			'animation-effect',
			{ effect: 'vanta-birds' },
		],
	])('refuses a token write the vocabulary does not allow (%s), storing and announcing nothing', async (_case, token, value) => {
		const theme = await create('Refused');

		expect(await refusal(set(theme.id, token, value))).toMatchObject({
			statusCode: 400,
			data: { code: 'invalid-value' },
		});
		expect(await storedTokens(theme.id)).toEqual({});
		expect(published).toEqual([]);
	});

	it.each([
		[
			'read',
			() => call(getTheme, { themeId: 'missing' }),
		],
		[
			'rename',
			() => call(renameTheme, { themeId: 'missing' }, { name: 'Anything' }),
		],
		[
			'set a token of',
			() => set('missing', 'accent', '#fff'),
		],
		[
			'delete',
			() => call(deleteTheme, { themeId: 'missing' }),
		],
	])('answers 404 to %s a Theme that does not exist', async (_case, attempt) => {
		expect(await refusal(attempt())).toMatchObject({ statusCode: 404 });
	});

	it('deletes a Theme no Event uses', async () => {
		const theme = await create('Unused');

		await call(deleteTheme, { themeId: theme.id });

		expect(await storedTokens(theme.id)).toBeUndefined();
	});

	it('refuses to delete a Theme Events use, naming them, until none does', async () => {
		const theme = await create('Shared');
		const regional = await createEvent('Regional');
		const open = await createEvent('Open');
		await select(regional, theme.id);
		await select(open, theme.id);

		expect(await refusal(call(deleteTheme, { themeId: theme.id }))).toMatchObject({
			statusCode: 409,
			message: expect.stringContaining('Open, Regional'),
			data: {
				code: 'THEME_IN_USE',
				events: [
					{ id: open, name: 'Open' },
					{ id: regional, name: 'Regional' },
				],
			},
		});
		expect(await storedTokens(theme.id)).toEqual({});

		await select(regional, null);
		await select(open, null);
		await call(deleteTheme, { themeId: theme.id });
		expect(await storedTokens(theme.id)).toBeUndefined();
	});
});

describe('a Theme\'s announcements', () => {
	it('announces a token write and clear on every Event using the Theme, and on no other', async () => {
		const theme = await create('Announced');
		const other = await create('Other');
		const first = await createEvent('First');
		const second = await createEvent('Second');
		const elsewhere = await createEvent('Elsewhere');
		const unthemed = await createEvent('Unthemed');
		await select(first, theme.id);
		await select(second, theme.id);
		await select(elsewhere, other.id);
		published.length = 0;

		const written = await set(theme.id, 'accent', '#123456');
		await clear(theme.id, 'accent');

		expect(announcedThemes()).toEqual([
			{
				eventId: first,
				revision: written.revision,
				tokens: { accent: '#123456' },
			},
			{
				eventId: second,
				revision: written.revision,
				tokens: { accent: '#123456' },
			},
			{ eventId: first, revision: written.revision + 1, tokens: {} },
			{ eventId: second, revision: written.revision + 1, tokens: {} },
		]);
		expect(published.map(message => message.eventId)).not.toContain(unthemed);
	});

	it('announces nothing for clearing a token the Theme does not set', async () => {
		const theme = await create('Unset');
		const event = await createEvent('Unset Event');
		await select(event, theme.id);
		published.length = 0;

		const answered = await clear(theme.id, 'accent');

		expect(answered.revision).toBe(theme.revision);
		expect(published).toEqual([]);
	});

	it('announces a Theme switch to its Event as an Event update', async () => {
		const theme = await create('Switched');
		const event = await createEvent('Switching');

		await select(event, theme.id);

		expect(published.filter(message => message.eventId === event).map(message => [message.type, message.data.event?.themeId]))
			.toEqual([
				['event:updated', theme.id],
			]);
	});

	it('refuses to select a Theme that does not exist', async () => {
		const event = await createEvent('Unknown Theme');

		expect(await refusal(select(event, 'missing'))).toMatchObject({ statusCode: 400 });
		expect(published).toEqual([]);
	});
});

describe('the Screen Output Event context', () => {
	async function outputEvent(eventId: number): Promise<ScreenOutputEvent> {
		return await call(readOutputEvent, { id: eventId, screenId: 1 });
	}

	it('carries no Theme for an Event on the Default Theme', async () => {
		const event = await createEvent('Default');

		expect(await outputEvent(event)).toMatchObject({ themeId: null, theme: null });
	});

	it('carries the selected Theme\'s stored tokens at their revision, and follows a switch back', async () => {
		const theme = await create('Selected');
		const event = await createEvent('Selecting');
		await select(event, theme.id);
		const written = await set(theme.id, 'accent', '#abcdef');

		expect(await outputEvent(event)).toMatchObject({
			themeId: theme.id,
			theme: {
				id: theme.id,
				revision: written.revision,
				tokens: { accent: '#abcdef' },
			},
		});

		await select(event, null);
		expect(await outputEvent(event)).toMatchObject({ themeId: null, theme: null });
	});
});

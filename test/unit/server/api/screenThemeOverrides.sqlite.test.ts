import type { H3Event } from 'h3';
import type { ScreenResponse } from '~~/shared/api';
import type { ScreenMode } from '~~/shared/types/enums';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Screen Theme Overrides over their real routes and migrations (ADR-0049): what a write stores,
// what it refuses, what a mode change keeps, and which Screen it announces.

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
vi.doMock('~~/server/utils/auth', () => ({
	optionalBrowserSessionId: async () => undefined,
}));

interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

// Admission is ADR-0022's and pinned elsewhere; this suite is about what the read answers.
vi.doMock('~~/server/utils/screenOutputRead', () => ({
	requireScreenOutputRead: async (event: StubEvent) => ({
		screen: await db.query.screens.findFirst({
			where: eq(schema.screens.id, Number(event.params.screenId)),
		}),
	}),
}));

type Handler = (event: H3Event) => Promise<any>;
const handler = (module: { default: unknown }) => module.default as Handler;
const patchOverrides = handler(await import('~~/server/api/events/[id]/screens/[screenId]/theme-overrides.patch'));
const updateScreen = handler(await import('~~/server/api/events/[id]/screens/[screenId]/index.patch'));
const readOutputScreen = handler(await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/index.get'));

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
		(error: { statusCode?: number; data?: { code?: string } }) => ({
			statusCode: error.statusCode,
			code: error.data?.code,
		}),
	);
}

let eventId: number;

async function createScreen(currentMode: ScreenMode, slug: string): Promise<number> {
	const [screen] = await db.insert(schema.screens)
		.values({
			eventId,
			name: slug,
			slug,
			currentMode,
			assetCapabilitySeed: `${eventId}-${slug}-seed`,
			assetCapabilityDigest: `${eventId}-${slug}-digest`,
		})
		.returning({ id: schema.screens.id });
	return screen!.id;
}

function override(screenId: number, tokens: Record<string, unknown>): Promise<ScreenResponse> {
	return call(patchOverrides, { id: eventId, screenId }, { tokens });
}

async function switchMode(screenId: number, currentMode: ScreenMode) {
	const [row] = await db.select().from(schema.screens).where(eq(schema.screens.id, screenId));
	return call(updateScreen, { id: eventId, screenId }, { currentMode, stateVersion: row!.stateVersion });
}

async function storedOverrides(screenId: number) {
	const [row] = await db.select().from(schema.screens).where(eq(schema.screens.id, screenId));
	return row?.themeOverrides;
}

function announcedScreens() {
	return published
		.filter(message => message.type === 'screen:updated')
		.map(message => message.data.screenId);
}

beforeEach(async () => {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Overrides', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
	published.length = 0;
});

afterAll(async () => {
	await harness.close();
});

describe('screen Theme Overrides', () => {
	it.each([
		['its own Mode Token, as a literal', 'standings.row-divider', '#ff0000'],
		[
			'its own Mode Token, following another Foundation Token of its type',
			'standings.row-divider',
			{ token: 'accent' },
		],
		['a Foundation Token a Mode Token\'s default names', 'divider', 'rgba(0, 0, 0, 0.5)'],
		['a Foundation Token no default names, which a Mode Token could follow', 'accent', '#00ff00'],
		[
			'a typography Foundation Token',
			'heading',
			{
				font: { kind: 'application', fontId: 'mplantin' },
				weight: 400,
				lineHeight: 1.2,
				tracking: 0,
				case: 'none',
			},
		],
	])('sets %s, stores it on that Screen alone, and announces that Screen', async (_case, token, value) => {
		await expectOverrideStored('standings', token, value);
	});

	// A graphics host's Graphic Items may bind any such Foundation Token (#831).
	it.each([
		[
			'a Broadcast Graphics Screen',
			'broadcast-graphics',
			'accent',
			'#00ff00',
		],
		[
			'a Feature Match Overlay Screen',
			'feature-match-overlay',
			'text-primary',
			'#00ff00',
		],
		[
			'a Feature Match Overlay Screen, its Frame surface',
			'feature-match-overlay',
			'feature-match-overlay.frame-surface',
			{
				fill: {
					type: 'solid',
					color: { token: 'accent' },
				},
				fillOpacity: 1,
			},
		],
	])('sets a Foundation Token a Graphic Item binds on %s', async (_case, mode, token, value) => {
		await expectOverrideStored(mode as ScreenMode, token, value);
	});

	async function expectOverrideStored(mode: ScreenMode, token: string, value: unknown) {
		const screenId = await createScreen(mode, 'main');
		const otherId = await createScreen(mode, 'side');

		const answered = await override(screenId, { [token]: value });

		expect(answered.themeOverrides).toEqual({ [token]: value });
		expect(await storedOverrides(screenId)).toEqual({ [token]: value });
		expect(await storedOverrides(otherId)).toEqual({});
		expect(announcedScreens()).toEqual([screenId]);
	}

	// `background` is consumed by the Screen host, not a Mode Token.
	const background = [
		{
			id: 'wash',
			type: 'color',
			color: '#101010',
			enabled: true,
			opacity: 1,
		},
	];
	it.each([
		[
			'the Background Screen',
			'background',
			{ background },
		],
		[
			'a mode declaring a Background Layer stack',
			'standings',
			{ background },
		],
		['a graphics host, which paints no Background Layer stack', 'broadcast-graphics', 'unconsumable-token'],
	])('answers %s overriding the background', async (_case, mode, answer) => {
		const screenId = await createScreen(mode as ScreenMode, 'main');

		const outcome = await override(screenId, { background }).then(
			screen => screen.themeOverrides,
			(error: { data?: { code?: string } }) => error.data?.code,
		);

		expect(outcome).toEqual(answer);
	});

	it('clears one override, keeping the rest, so the cleared token reads the Theme again', async () => {
		const screenId = await createScreen('standings', 'main');
		await override(screenId, { 'accent': '#00ff00', 'standings.surface': '#000000' });
		published.length = 0;

		const answered = await override(screenId, { accent: null });

		expect(answered.themeOverrides).toEqual({ 'standings.surface': '#000000' });
		expect(await storedOverrides(screenId)).toEqual({ 'standings.surface': '#000000' });
		expect(announcedScreens()).toEqual([screenId]);
	});

	it.each([
		[
			'a token of a type its mode declares none of',
			'standings',
			'inset',
			12,
			'unconsumable-token',
		],
		[
			'any token, in a mode that declares no Mode Tokens',
			'card',
			'accent',
			'#00ff00',
			'unconsumable-token',
		],
		[
			'a token no Graphic Item binds, on a graphics host',
			'broadcast-graphics',
			'inset',
			12,
			'unconsumable-token',
		],
		[
			'a clear, in a mode that cannot consume the token',
			'card',
			'standings.row-divider',
			null,
			'unconsumable-token',
		],
		[
			'a name no token has',
			'standings',
			'standings.nonsense',
			'#00ff00',
			'unknown-token',
		],
		[
			'a value of the wrong type',
			'standings',
			'standings.row-divider',
			12,
			'invalid-value',
		],
		[
			'a Mode Token following a Foundation Token of another type',
			'standings',
			'standings.row-divider',
			{ token: 'heading' },
			'invalid-value',
		],
		[
			'a Foundation Token following another',
			'standings',
			'accent',
			{ token: 'divider' },
			'invalid-value',
		],
	])('refuses %s, storing and announcing nothing', async (_case, mode, token, value, code) => {
		const screenId = await createScreen(mode as ScreenMode, 'main');

		expect(await refusal(override(screenId, { [token]: value }))).toEqual({ statusCode: 400, code });
		expect(await storedOverrides(screenId)).toEqual({});
		expect(published).toEqual([]);
	});

	it('refuses a write naming one refused token whole, so the others are not stored either', async () => {
		const screenId = await createScreen('standings', 'main');

		expect(await refusal(override(screenId, { accent: '#00ff00', inset: 12 }))).toEqual({ statusCode: 400, code: 'unconsumable-token' });
		expect(await storedOverrides(screenId)).toEqual({});
	});

	it('refuses a write naming no token, so nothing is versioned or announced', async () => {
		const screenId = await createScreen('standings', 'main');

		await expect(override(screenId, {})).rejects.toThrow();
		expect(published).toEqual([]);
	});

	it('keeps an override of a mode\'s Mode Token while the Screen shows another mode, and carries it again on return', async () => {
		const screenId = await createScreen('standings', 'main');
		await override(screenId, { 'standings.row-divider': '#ff0000' });

		await switchMode(screenId, 'card');
		expect(await storedOverrides(screenId)).toEqual({ 'standings.row-divider': '#ff0000' });
		expect(await refusal(override(screenId, { 'standings.row-divider': '#00ff00' }))).toEqual({ statusCode: 400, code: 'unconsumable-token' });

		await switchMode(screenId, 'standings');
		const read: ScreenResponse = await call(readOutputScreen, { id: eventId, screenId });
		expect(read).toMatchObject({
			currentMode: 'standings',
			themeOverrides: { 'standings.row-divider': '#ff0000' },
		});
	});

	it('is the only write that sets them: a generic Screen update naming them is refused', async () => {
		const screenId = await createScreen('standings', 'main');

		await expect(call(updateScreen, { id: eventId, screenId }, {
			themeOverrides: { accent: '#00ff00' },
			stateVersion: 0,
		})).rejects.toThrow();
		expect(await storedOverrides(screenId)).toEqual({});
	});
});

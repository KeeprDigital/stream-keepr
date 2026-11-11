import type { H3Event } from 'h3';
import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { graphicAssetReferences } from '~~/server/db/schema/graphicsAsset';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createD1ScreenOutputAssetAuthorizer } from '~~/server/modules/screen-output-assets/authorizer';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import {
	catalogueSelectability,
	createTestGraphicsLibrary,
	ingestImage,
	publishedRevision,
	seedGraphicAssetRevision,
} from '~~/test/helpers/graphicsLibrary';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Theme's and a Screen Theme Override's library content, over the real routes,
// catalogue and capability (ADR-0050): each is an ordinary Graphic Asset Reference
// that holds Retire and Trash back, naming its referrer, until the token releases it,
// and a Screen Output resolves exactly what the Screen's resolved tokens supply.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/utils/auth', () => ({
	optionalBrowserSessionId: async () => undefined,
}));

const { inspectGraphicAssetRevisions, answeredBeforeRetirement } = catalogueSelectability(harness);
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({ inspectGraphicAssetRevisions }),
}));

interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('setResponseStatus', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<any>;
const handler = (module: { default: unknown }) => module.default as Handler;
const createTheme = handler(await import('~~/server/api/themes/index.post'));
const deleteTheme = handler(await import('~~/server/api/themes/[themeId]/index.delete'));
const setToken = handler(await import('~~/server/api/themes/[themeId]/tokens/[token].put'));
const clearToken = handler(await import('~~/server/api/themes/[themeId]/tokens/[token].delete'));
const patchOverrides = handler(await import('~~/server/api/events/[id]/screens/[screenId]/theme-overrides.patch'));

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
		(error: { statusCode?: number; message?: string }) => ({ statusCode: error.statusCode, message: error.message }),
	);
}

const context = createTestGraphicsLibrary({
	catalogue: createD1GraphicsAssetCatalogue(harness.database),
	start: '2026-10-27T00:00:00.000Z',
	identityPrefix: 'theme-assets',
});
const authorizer = createD1ScreenOutputAssetAuthorizer(harness.database);

interface Revision { assetId: GraphicAssetId; revisionId: GraphicAssetRevisionId }
let images = 0;
async function ingest(): Promise<Revision> {
	return publishedRevision(await ingestImage(context, { idempotencyKey: `image-${++images}`, initiatedBy: 'author' }));
}

let face: Revision;

let logo: Revision;
let plate: Revision;
let unrelated: Revision;

beforeAll(async () => {
	face = await seedGraphicAssetRevision(harness, 'font', 'face');
});

afterAll(async () => await harness.close());

function libraryFont(revision: Revision) {
	return {
		...FOUNDATION_TOKENS.heading.default,
		font: { kind: 'asset', reference: revision },
	};
}
function libraryImageLayer(revision: Revision) {
	return [
		{
			id: 'plate',
			type: 'image',
			enabled: true,
			opacity: 1,
			fit: 'cover',
			source: { kind: 'asset', ...revision },
		},
	];
}

let themeId: string;
let eventId: number;
let screenId: number;
let digest: number;

async function createScreen(name: string, mode = 'standings') {
	const [screen] = await db.insert(schema.screens).values({
		eventId,
		name,
		slug: name,
		currentMode: mode as never,
		assetCapabilitySeed: `${name}-${++digest}-seed`,
		assetCapabilityDigest: `${name}-${digest}-digest`,
	}).returning();
	return screen!;
}

beforeEach(async () => {
	answeredBeforeRetirement.clear();
	await db.delete(graphicAssetReferences);
	logo = await ingest();
	plate = await ingest();
	unrelated = await ingest();
	digest = (digest ?? 0) + 1;
	themeId = (await call(createTheme, {}, { name: 'Brand' })).id;
	const [event] = await db.insert(schema.events)
		.values({
			name: 'Finals',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			themeId,
		})
		.returning({ id: schema.events.id });
	eventId = event!.id;
	screenId = (await createScreen('main', 'top-cut')).id;
});

/** A Theme storing the Feature Match Overlay's Frame media, as one written before a Theme held Foundation Tokens only did. */
async function storeThemeFrameMedia(revision: Revision) {
	await db.update(schema.themes)
		.set({
			tokens: {
				'feature-match-overlay.frame-media': { kind: 'image', ...revision },
			},
		})
		.where(eq(schema.themes.id, themeId));
	await db.insert(graphicAssetReferences).values({
		id: 'theme-frame-media',
		assetId: revision.assetId,
		revisionId: revision.revisionId,
		ownerKind: 'theme',
		ownerId: themeId,
		ownerSlot: 'feature-match-overlay.frame-media',
		eventId: null,
	} as never);
}

/** Overrides on the main Screen, showing `mode`. */
async function overrideOn(mode: string, tokens: Record<string, unknown>) {
	await db.update(schema.screens).set({ currentMode: mode as never }).where(eq(schema.screens.id, screenId));
	await call(patchOverrides, { id: eventId, screenId }, { tokens });
}

const retire = (revision: Revision) => context.library.retireGraphicAsset({ assetId: revision.assetId, actor: 'author' });
const trash = (revision: Revision) => context.library.trashGraphicAsset({ assetId: revision.assetId, actor: 'author' });

describe('a Graphic Asset a Theme or Screen Theme Override references', () => {
	it.each([
		[
			'the Theme\'s logo',
			'theme',
			'logo',
			() => ({ kind: 'image', ...logo }),
			() => logo,
		],
		[
			'a Theme background layer',
			'theme',
			'background',
			() => libraryImageLayer(plate),
			() => plate,
		],
		[
			'a Theme library font',
			'theme',
			'heading',
			() => libraryFont(face),
			() => face,
		],
		[
			'an override\'s Frame media',
			'screen',
			'feature-match-overlay.frame-media',
			() => ({ kind: 'image', ...plate }),
			() => plate,
		],
	])('refuses Retire and Trash while %s references it, naming the referrer', async (_case, owner, token, value, revision) => {
		if (owner === 'theme') {
			await call(setToken, { themeId, token }, {
				value: value(),
			});
		}
		else {
			await overrideOn('feature-match-overlay', { [token]: value() });
		}
		const named = owner === 'theme'
			? { kind: 'theme', id: themeId, name: 'Brand' }
			: {
					kind: 'screen',
					id: String(screenId),
					name: 'main',
				};

		for (const action of [retire, trash]) {
			expect(await action(revision())).toMatchObject({
				outcome: 'in-use',
				usage: [
					expect.objectContaining({
						owner: expect.objectContaining(named),
					}),
				],
			});
		}
	});

	it.each([
		[
			'clearing the Theme\'s token',
			async () => {
				await call(setToken, { themeId, token: 'logo' }, {
					value: { kind: 'image', ...logo },
				});
				await call(clearToken, { themeId, token: 'logo' });
			},
		],
		[
			'setting the Theme\'s token to none',
			async () => {
				await call(setToken, { themeId, token: 'logo' }, {
					value: { kind: 'image', ...logo },
				});
				await call(setToken, { themeId, token: 'logo' }, { value: null });
			},
		],
		[
			'clearing the override',
			async () => {
				await overrideOn('feature-match-overlay', { 'feature-match-overlay.frame-media': { kind: 'image', ...logo } });
				await overrideOn('feature-match-overlay', { 'feature-match-overlay.frame-media': null });
			},
		],
		[
			'deleting the Theme no Event uses',
			async () => {
				await call(setToken, { themeId, token: 'logo' }, {
					value: { kind: 'image', ...logo },
				});
				await db.update(schema.events).set({ themeId: null }).where(eq(schema.events.id, eventId));
				await call(deleteTheme, { themeId });
			},
		],
	])('releases it on %s, so it retires', async (_case, release) => {
		await release();

		expect((await retire(logo)).outcome).toBe('retired');
	});

	it('releases only the token written, keeping another token\'s reference', async () => {
		await call(setToken, { themeId, token: 'logo' }, {
			value: { kind: 'image', ...logo },
		});
		await call(setToken, { themeId, token: 'background' }, {
			value: libraryImageLayer(plate),
		});

		await call(clearToken, { themeId, token: 'background' });

		expect((await retire(plate)).outcome).toBe('retired');
		expect((await retire(logo)).outcome).toBe('in-use');
	});

	it.each([
		[
			'a retired asset',
			async () => {
				await retire(unrelated);
				return { kind: 'image', ...unrelated };
			},
		],
		[
			'a revision that does not exist',
			async () => ({ kind: 'image', assetId: logo.assetId, revisionId: 'revision-invented' }),
		],
		[
			'an image named as a silent video',
			async () => ({ kind: 'silent-video', ...logo }),
		],
	])('refuses a Theme write naming %s, storing nothing', async (_case, value) => {
		const refused = await refusal(call(setToken, { themeId, token: 'logo' }, { value: await value() }));

		expect(refused).toMatchObject({
			statusCode: 409,
			message: expect.stringContaining('logo'),
		});
		const [theme] = await db.select().from(schema.themes).where(eq(schema.themes.id, themeId));
		expect(theme!.tokens).toEqual({});
		expect(await db.select().from(graphicAssetReferences).where(eq(graphicAssetReferences.ownerKind, 'theme'))).toEqual([]);
	});

	it('refuses at the commit a Theme write whose asset was retired after the library answered', async () => {
		await retire(unrelated);
		answeredBeforeRetirement.add(unrelated.assetId);

		const refused = await refusal(call(setToken, { themeId, token: 'logo' }, {
			value: { kind: 'image', ...unrelated },
		}));

		expect(refused).toMatchObject({
			statusCode: 409,
			message: expect.stringContaining('stopped being selectable'),
		});
		const [theme] = await db.select().from(schema.themes).where(eq(schema.themes.id, themeId));
		expect(theme!.tokens).toEqual({});
		expect(await db.select().from(graphicAssetReferences).where(eq(graphicAssetReferences.ownerKind, 'theme'))).toEqual([]);
	});

	it('releases a Foundation Token\'s slots alone, never a same-named mode\'s Mode Token slots', async () => {
		await db.insert(graphicAssetReferences).values({
			id: 'background-mode-token',
			assetId: logo.assetId,
			revisionId: logo.revisionId,
			ownerKind: 'theme',
			ownerId: themeId,
			ownerSlot: 'background.plate',
			eventId: null,
		} as never);
		await call(setToken, { themeId, token: 'background' }, {
			value: libraryImageLayer(plate),
		});

		await call(clearToken, { themeId, token: 'background' });

		expect((await db.select().from(graphicAssetReferences)).map(row => row.ownerSlot)).toEqual(['background.plate']);
	});

	// A Theme stores Foundation Tokens only: a Mode Token is set per Screen.
	it('pins nothing for a Mode Token a Theme write names', async () => {
		await call(setToken, { themeId, token: 'feature-match-overlay.frame-media' }, {
			value: { kind: 'image', ...plate },
		});

		expect((await retire(plate)).outcome).toBe('retired');
	});

	it('keeps the reference of a Mode Token a Theme stored before until that token is cleared', async () => {
		await storeThemeFrameMedia(plate);
		expect((await retire(plate)).outcome).toBe('in-use');

		await call(clearToken, { themeId, token: 'feature-match-overlay.frame-media' });

		expect((await retire(plate)).outcome).toBe('retired');
	});

	it('refuses an override naming a retired asset, storing nothing', async () => {
		await retire(unrelated);

		const refused = await refusal(overrideOn('feature-match-overlay', {
			'feature-match-overlay.frame-media': { kind: 'image', ...unrelated },
		}));

		expect(refused.statusCode).toBe(409);
		const [screen] = await db.select().from(schema.screens).where(eq(schema.screens.id, screenId));
		expect(screen!.themeOverrides).toEqual({});
	});
});

describe('a Screen Output\'s capability over its Theme\'s content', () => {
	async function resolves(screen: { id: number; assetCapabilityDigest: string | null }, revision: Revision) {
		const outcome = await authorizer.authorize({
			screenId: screen.id,
			capabilityDigest: screen.assetCapabilityDigest!,
			assetId: revision.assetId,
			revisionId: revision.revisionId,
		});
		return outcome.outcome === 'authorized';
	}

	async function screenRow(id: number) {
		const [screen] = await db.select().from(schema.screens).where(eq(schema.screens.id, id));
		return screen!;
	}

	it('resolves the Theme\'s logo and font, and no unrelated asset', async () => {
		await call(setToken, { themeId, token: 'logo' }, {
			value: { kind: 'image', ...logo },
		});
		await call(setToken, { themeId, token: 'heading' }, {
			value: libraryFont(face),
		});
		const screen = await screenRow(screenId);

		expect([
			await resolves(screen, logo),
			await resolves(screen, face),
			await resolves(screen, unrelated),
		]).toEqual([true, true, false]);
	});

	it('resolves the content of an override of its mode\'s Mode Token', async () => {
		await overrideOn('feature-match-overlay', {
			'feature-match-overlay.frame-media': { kind: 'image', ...plate },
		});

		expect(await resolves(await screenRow(screenId), plate)).toBe(true);
	});

	// A Screen takes these from its Theme alone; one stored before is read by nothing.
	it.each([
		['a plain mode\'s background', 'top-cut', 'background', (revision: Revision) => libraryImageLayer(revision)],
		['a graphics host\'s logo', 'broadcast-graphics', 'logo', (revision: Revision) => ({ kind: 'image', ...revision })],
	])('resolves the Theme\'s content for %s, never a stored override of it', async (_case, mode, token, value) => {
		await call(setToken, { themeId, token }, { value: value(plate) });
		await db.update(schema.screens)
			.set({ currentMode: mode as never, themeOverrides: { [token]: value(logo) } })
			.where(eq(schema.screens.id, screenId));
		await db.insert(graphicAssetReferences).values({
			id: 'stored-foundation-override',
			assetId: logo.assetId,
			revisionId: logo.revisionId,
			ownerKind: 'screen',
			ownerId: String(screenId),
			ownerSlot: `themeOverrides.${token}`,
			eventId,
		} as never);
		const screen = await screenRow(screenId);

		expect([await resolves(screen, plate), await resolves(screen, logo)]).toEqual([true, false]);
	});

	it('resolves a dormant override of another mode\'s Mode Token only once the Screen shows that mode again', async () => {
		await overrideOn('feature-match-overlay', {
			'feature-match-overlay.frame-media': { kind: 'image', ...plate },
		});
		await db.update(schema.screens).set({ currentMode: 'card' }).where(eq(schema.screens.id, screenId));
		expect(await resolves(await screenRow(screenId), plate)).toBe(false);

		await db.update(schema.screens).set({ currentMode: 'feature-match-overlay' }).where(eq(schema.screens.id, screenId));
		expect(await resolves(await screenRow(screenId), plate)).toBe(true);
	});

	it('resolves nothing of a Mode Token its Theme stored before', async () => {
		await storeThemeFrameMedia(plate);
		await db.update(schema.screens).set({ currentMode: 'feature-match-overlay' }).where(eq(schema.screens.id, screenId));

		expect(await resolves(await screenRow(screenId), plate)).toBe(false);
	});

	it('resolves nothing of a Theme its Event does not use', async () => {
		await call(setToken, { themeId, token: 'logo' }, {
			value: { kind: 'image', ...logo },
		});
		await db.update(schema.events).set({ themeId: null }).where(eq(schema.events.id, eventId));

		expect(await resolves(await screenRow(screenId), logo)).toBe(false);
	});
});

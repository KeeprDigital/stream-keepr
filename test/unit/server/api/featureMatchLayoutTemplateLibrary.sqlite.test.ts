import type { H3Event } from 'h3';
import type { InstalledGraphicsTemplateSummary } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import * as authSchema from '~~/server/db/schema/auth';
import { BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES } from '~~/shared/builtInFeatureMatchLayoutTemplates';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Feature Match Layout Template library over real SQL: a saved layout is a copy
// out of a Screen, a placed one a copy into a Screen, and neither follows the other.
// The signed-in User and the Graphics Asset Library are stood in.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({
	db,
	schema: {
		...schema,
		...authSchema,
	},
}));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/utils/auth', () => ({
	requireUserId: async () => 'user-1',
	optionalBrowserSessionId: async () => undefined,
}));
/** What a Template Package installed, by identity: nothing unless a test adds it. */
const installed = new Map<string, InstalledGraphicsTemplateSummary>();
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		listInstalledGraphicsTemplates: async () => [],
		findInstalledGraphicsTemplate: async ({ templateId }: { templateId: string }) => installed.get(templateId),
		inspectGraphicAssetRevisions: async () => [],
	}),
}));

interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readBody', async (event: StubEvent) => event.body);
vi.stubGlobal('getRequestHeader', () => undefined);
vi.stubGlobal('getRequestWebStream', () => undefined);
vi.stubGlobal('setResponseStatus', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<any>;
const handler = (module: { default: unknown }) => module.default as Handler;
const saveTemplate = handler(await import('~~/server/api/graphics-templates/feature-match-layouts/index.post'));
const readTemplate = handler(await import('~~/server/api/graphics-templates/feature-match-layouts/[templateId]/index.get'));
const reviseTemplate = handler(await import('~~/server/api/graphics-templates/feature-match-layouts/[templateId]/index.patch'));
const placeTemplate = handler(await import('~~/server/api/events/[id]/screens/[screenId]/feature-match-overlay/layout-placements.post'));
const { broadcastGraphicTemplateService } = await import('~~/server/services/broadcastGraphicTemplate');

function call(handler: Handler, params: Record<string, string | number>, body?: unknown) {
	return handler(stubH3Event({
		params: Object.fromEntries(Object.entries(params).map(([key, value]) => [
			key,
			String(value),
		])),
		body,
	}));
}

/** A layout unlike the default in its Frame and its Source Items. */
function authoredLayout(): FeatureMatchLayoutConfig {
	const layout = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout);
	layout.frame.opacity = 0.33;
	layout.sources = [
		{
			id: 'main-source',
			label: 'Authored Main Source',
			visible: true,
			anchor: 'top-left',
			sourceRole: 'main',
			frameCutout: true,
			x: 10,
			y: 20,
			width: 800,
			height: 600,
		},
	];
	return layout;
}

interface OverlayScreen { eventId: number; screenId: number; slotId: number }

let screens = 0;

/** An Event's Screen holding `layout` and a Feature Match Slot of that Event. */
async function seedScreen(
	layout: FeatureMatchLayoutConfig,
	currentMode: 'feature-match-overlay' | 'background' = 'feature-match-overlay',
): Promise<OverlayScreen> {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Layouts', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [slot] = await db.insert(schema.featureMatches)
		.values({ eventId, tableNumber: 1 })
		.returning({ id: schema.featureMatches.id });
	const seed = ++screens;
	const [screen] = await db.insert(schema.screens)
		.values({
			eventId,
			name: `Screen ${seed}`,
			slug: `screen-${seed}`,
			currentMode,
			modeConfigs: currentMode === 'feature-match-overlay'
				? {
						'feature-match-overlay': { layout, featureMatchId: slot!.id },
					}
				: {},
			assetCapabilitySeed: `${seed}-seed`,
			assetCapabilityDigest: `${seed}-digest`,
		})
		.returning({ id: schema.screens.id });
	return { eventId, screenId: screen!.id, slotId: slot!.id };
}

async function storedModeConfigs({ screenId }: OverlayScreen) {
	const [row] = await db.select().from(schema.screens).where(eq(schema.screens.id, screenId));
	return row!.modeConfigs;
}

async function storedOverlay(screen: OverlayScreen) {
	return (await storedModeConfigs(screen))!['feature-match-overlay'] as { layout: FeatureMatchLayoutConfig; featureMatchId: number };
}

async function storedTemplate(templateId: string) {
	const [row] = await db.select().from(schema.featureMatchLayoutTemplates).where(eq(schema.featureMatchLayoutTemplates.id, templateId));
	return row!;
}

async function place(target: OverlayScreen, templateId: string) {
	return await call(placeTemplate, { id: target.eventId, screenId: target.screenId }, { templateId, stateVersion: 0 });
}

const AUTHORED = JSON.parse(JSON.stringify(authoredLayout())) as FeatureMatchLayoutConfig;
const DEFAULT = JSON.parse(JSON.stringify(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout)) as FeatureMatchLayoutConfig;

let source: OverlayScreen;
/** A Screen in another Event, holding the default layout and its own Slot. */
let target: OverlayScreen;
let templateId: string;
let saved: Record<string, any>;

beforeEach(async () => {
	installed.clear();
	source = await seedScreen(authoredLayout());
	target = await seedScreen(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout));
	saved = await call(saveTemplate, {}, {
		source: { eventId: source.eventId, screenId: source.screenId },
		name: 'Authored layout',
		description: 'Saved from the source Screen',
	});
	templateId = saved.id;
});

afterAll(async () => {
	await harness.close();
});

describe('saving a Screen\'s layout as a Feature Match Layout Template', () => {
	it('stores the layout at revision 1 and leaves the Screen as it was', async () => {
		expect(saved).toMatchObject({
			name: 'Authored layout',
			description: 'Saved from the source Screen',
			revision: 1,
			authored: true,
			sourceCount: 1,
		});
		expect(saved.document).toEqual(AUTHORED);
		expect(await storedTemplate(templateId)).toMatchObject({ revision: 1, document: AUTHORED });
		expect(await storedOverlay(source)).toEqual({ layout: AUTHORED, featureMatchId: source.slotId });
	});

	// The name check reads as the rule; equality is what catches a Slot under another key.
	it('carries no Feature Match Slot assignment into the library', async () => {
		const { document } = await call(readTemplate, { templateId });

		expect(JSON.stringify(document)).not.toContain('featureMatchId');
		expect(document).toEqual(AUTHORED);
	});

	// The author is told when a layout saved here is not offered to their Event (ADR-0087).
	it('answers whether the saved layout is four-Seat', async () => {
		const commanderTable = BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES.find(template => template.id === 'commander-table')!;
		const fourSeatSource = await seedScreen(structuredClone(commanderTable.config.layout));

		const fourSeat = await call(saveTemplate, {}, {
			source: { eventId: fourSeatSource.eventId, screenId: fourSeatSource.screenId },
		});

		expect(fourSeat.fourSeat).toBe(true);
		expect(saved).not.toHaveProperty('fourSeat');
	});
});

describe('placing a Feature Match Layout Template', () => {
	it('replaces the whole layout of a Screen in another Event, and nothing else the Screen holds', async () => {
		expect((await storedOverlay(target)).layout).toEqual(DEFAULT);

		const placed = await place(target, templateId);

		expect(placed.layout).toEqual(AUTHORED);
		expect(await storedOverlay(target)).toEqual({ layout: AUTHORED, featureMatchId: target.slotId });
	});

	it('refuses a Screen that is not a Feature Match Overlay, writing nothing to it', async () => {
		const background = await seedScreen(authoredLayout(), 'background');

		await expect(place(background, templateId)).rejects.toMatchObject({
			statusCode: 409,
			message: 'Screen is not in Feature Match Overlay mode',
		});

		expect(await storedModeConfigs(background)).toEqual({});
	});

	// A Broadcast Graphic Template is a valid identity whose document no overlay can place.
	it.each([
		{
			identity: 'a Broadcast Graphic Template saved here',
			arrange: async () => {
				const template = await broadcastGraphicTemplateService().create({
					id: crypto.randomUUID(),
					name: 'A graphic',
					description: null,
					document: { id: 'a-graphic', name: 'A graphic', items: [] },
				});
				return template.id;
			},
		},
		{
			// Its kind decides, even where its document would read as a layout.
			identity: 'a Broadcast Graphic Template a Template Package installed',
			arrange: async () => {
				const id = 'installed-graphic';
				installed.set(id, {
					id,
					kind: 'broadcast-graphic',
					name: 'An installed graphic',
					revisionNumber: 1,
					document: authoredLayout(),
					sourceTemplateIdentity: 'source-graphic',
					installedByOperationId: 'operation-1',
					installedAt: '2026-11-04T00:00:00.000Z',
				} as InstalledGraphicsTemplateSummary);
				return id;
			},
		},
	])('does not resolve $identity, to read or to place', async ({ arrange }) => {
		const graphicTemplateId = await arrange();

		await expect(call(readTemplate, { templateId: graphicTemplateId })).rejects.toMatchObject({ statusCode: 404 });
		await expect(place(target, graphicTemplateId)).rejects.toMatchObject({
			statusCode: 404,
			message: 'Feature Match Layout Template not found',
		});

		expect(await storedOverlay(target)).toEqual({ layout: DEFAULT, featureMatchId: target.slotId });
	});
});

describe('revising a Feature Match Layout Template', () => {
	function revisedLayout() {
		const revised = structuredClone(AUTHORED);
		revised.frame.opacity = 0.66;
		return revised;
	}

	it('advances the revision and leaves a layout already placed from it alone', async () => {
		await place(target, templateId);

		const revised = await call(reviseTemplate, { templateId }, {
			document: revisedLayout(),
			revision: 1,
		});

		expect(revised).toMatchObject({ id: templateId, revision: 2 });
		expect(await storedTemplate(templateId)).toMatchObject({
			revision: 2,
			document: revisedLayout(),
		});
		expect((await storedOverlay(target)).layout).toEqual(AUTHORED);
	});

	it('refuses a revision the writer did not read, naming the one it is at', async () => {
		await call(reviseTemplate, { templateId }, {
			document: revisedLayout(),
			revision: 1,
		});

		await expect(call(reviseTemplate, { templateId }, { name: 'Stale rename', revision: 1 })).rejects.toMatchObject({
			statusCode: 409,
			message: expect.stringContaining('now revision 2'),
		});

		expect(await storedTemplate(templateId)).toMatchObject({ name: 'Authored layout', revision: 2 });
	});
});

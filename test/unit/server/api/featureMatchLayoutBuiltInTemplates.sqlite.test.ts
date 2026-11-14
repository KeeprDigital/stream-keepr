import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import * as authSchema from '~~/server/db/schema/auth';
import { BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES } from '~~/shared/builtInFeatureMatchLayoutTemplates';
import { isFourSeatFeatureMatchLayout } from '~~/shared/featureMatchLayoutSeats';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// The Feature Match Layout Template library lists the built-in layouts beside the
// authored ones. A built-in is marked, places like any entry, and is never revised,
// removed or exported.

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
// The Graphics Asset Library is the object-storage boundary: it has installed
// nothing, and no layout here pins a revision.
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		listInstalledGraphicsTemplates: async () => [],
		findInstalledGraphicsTemplate: async () => undefined,
		removeInstalledGraphicsTemplate: async () => ({ outcome: 'not-found' }),
		inspectGraphicAssetRevisions: async () => [],
	}),
}));

interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readBody', async (event: StubEvent) => event.body);
vi.stubGlobal('setResponseStatus', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<any>;
const handler = (module: { default: unknown }) => module.default as Handler;
const listLibrary = handler(await import('~~/server/api/graphics-templates/feature-match-layouts/index.get'));
const readTemplate = handler(await import('~~/server/api/graphics-templates/feature-match-layouts/[templateId]/index.get'));
const reviseTemplate = handler(await import('~~/server/api/graphics-templates/feature-match-layouts/[templateId]/index.patch'));
const removeTemplate = handler(await import('~~/server/api/graphics-templates/feature-match-layouts/[templateId]/index.delete'));
const exportTemplate = handler(await import('~~/server/api/graphics-templates/feature-match-layouts/[templateId]/template-package.get'));
const placeTemplate = handler(await import('~~/server/api/events/[id]/screens/[screenId]/feature-match-overlay/layout-placements.post'));
const { featureMatchLayoutTemplateService } = await import('~~/server/services/featureMatchLayoutTemplate');

function call(handler: Handler, params: Record<string, string | number>, body?: unknown) {
	return handler(stubH3Event({
		params: Object.fromEntries(Object.entries(params).map(([key, value]) => [
			key,
			String(value),
		])),
		body,
	}));
}

const BUILT_INS = BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES.map(builtIn => ({
	id: `builtin:${builtIn.id}`,
	name: builtIn.label,
	layout: builtIn.config.layout,
}));

let eventId: number;
let screenId: number;

beforeEach(async () => {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Built-ins', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
	const [screen] = await db.insert(schema.screens)
		.values({
			eventId,
			name: 'Overlay',
			slug: `overlay-${eventId}`,
			currentMode: 'feature-match-overlay',
			assetCapabilitySeed: `${eventId}-seed`,
			assetCapabilityDigest: `${eventId}-digest`,
		})
		.returning({ id: schema.screens.id });
	screenId = screen!.id;
});

afterAll(async () => {
	await harness.close();
});

/** Make the Event the kind this layout is offered to. */
async function asEventFor(layout: Parameters<typeof isFourSeatFeatureMatchLayout>[0]) {
	await db.update(schema.events)
		.set({
			variant: isFourSeatFeatureMatchLayout(layout)
				? 'commander'
				: 'two-player',
		})
		.where(eq(schema.events.id, eventId));
}

async function listed(): Promise<Array<Record<string, unknown>>> {
	return (await call(listLibrary, {})).templates;
}

describe('the built-in Feature Match Layout Templates', () => {
	it('are listed beside an authored template, and only they are marked built-in', async () => {
		const authored = await featureMatchLayoutTemplateService().create({
			id: crypto.randomUUID(),
			name: 'Authored here',
			description: null,
			document: structuredClone(BUILT_INS[0]!.layout),
		});

		const templates = await listed();

		expect(templates.filter(template => template.builtIn).map(template => [template.id, template.name]).sort())
			.toEqual(BUILT_INS.map(builtIn => [builtIn.id, builtIn.name]).sort());
		expect(templates.find(template => template.id === authored.id)).toMatchObject({ authored: true });
		expect(templates.find(template => template.id === authored.id)?.builtIn).toBeFalsy();
		for (const template of templates.filter(template => template.builtIn))
			expect(template).toMatchObject({ authored: false, aspectRatio: 16 / 9 });
	});

	it.each(BUILT_INS)('$id reads with its layout', async ({ id, name, layout }) => {
		const template = await call(readTemplate, { templateId: id });

		expect(template).toMatchObject({
			id,
			name,
			builtIn: true,
			authored: false,
		});
		expect(template.document).toEqual(layout);
	});

	it.each(BUILT_INS)('$id replaces the Screen\'s stored layout when placed, as its own copy', async ({ id, layout }) => {
		await asEventFor(layout);
		await call(placeTemplate, { id: eventId, screenId }, { templateId: id, stateVersion: 0 });

		const [row] = await db.select().from(schema.screens).where(eq(schema.screens.id, screenId));
		const stored = row!.modeConfigs?.['feature-match-overlay'] as Record<string, unknown>;
		expect(stored.layout).toEqual(JSON.parse(JSON.stringify(layout)));
		expect(stored).not.toHaveProperty('presetId');
	});

	// A four-Seat template is a Commander Event's alone, and every other template every other Event's (ADR-0087).
	it.each([
		{ name: 'the four-Seat built-in on a Two-Player Event', id: 'builtin:commander-table', variant: 'two-player' as const },
		{ name: 'any other built-in on a Commander Event', id: 'builtin:full-table', variant: 'commander' as const },
	])('refuses to place $name, and leaves the Screen\'s layout as it was', async ({ id, variant }) => {
		await db.update(schema.events).set({ variant }).where(eq(schema.events.id, eventId));

		await expect(call(placeTemplate, { id: eventId, screenId }, { templateId: id, stateVersion: 0 }))
			.rejects
			.toMatchObject({
				statusCode: 409,
				message: expect.stringContaining('four-Seat'),
			});
		const [row] = await db.select().from(schema.screens).where(eq(schema.screens.id, screenId));
		expect(row!.modeConfigs).toBeNull();
	});

	it('marks only the four-Seat built-in as four-Seat in the listing', async () => {
		expect((await listed()).filter(template => template.fourSeat).map(template => template.id)).toEqual(['builtin:commander-table']);
	});

	it.each([
		['revised', reviseTemplate],
		['removed', removeTemplate],
		['exported in a Template Package', exportTemplate],
	])('cannot be %s', async (_case, route) => {
		for (const { id, name } of BUILT_INS) {
			await expect(call(route, { templateId: id }, { name: 'Mine now', revision: 1 }))
				.rejects
				.toMatchObject({
					statusCode: 409,
					message: expect.stringContaining(`"${name}" is built in`),
				});
		}

		expect((await listed()).filter(template => template.builtIn).map(template => template.name).sort())
			.toEqual(BUILT_INS.map(builtIn => builtIn.name).sort());
	});
});

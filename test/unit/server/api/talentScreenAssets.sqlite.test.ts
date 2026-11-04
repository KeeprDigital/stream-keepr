import type { H3Event } from 'h3';
import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createD1ScreenOutputAssetAuthorizer } from '~~/server/modules/screen-output-assets/authorizer';
import {
	catalogueSelectability,
	createTestGraphicsLibrary,
	ingestImage,
	publishedRevision,
} from '~~/test/helpers/graphicsLibrary';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Talent Screen's Screen Output resolves the photos of the Talents it shows, and
// only while it shows them with their photos (ADR-0070).

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: async () => {},
}));
const { inspectGraphicAssetRevisions } = catalogueSelectability(harness);
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({ inspectGraphicAssetRevisions }),
}));

interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));
vi.stubGlobal('setResponseStatus', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: H3Event) => Promise<any>;
const createTalent = (await import('~~/server/api/events/[id]/talents/index.post')).default as unknown as Handler;
const updateTalent = (await import('~~/server/api/events/[id]/talents/[talentId]/index.patch')).default as unknown as Handler;
const { screenService } = await import('~~/server/services/screen');

const context = createTestGraphicsLibrary({
	catalogue: createD1GraphicsAssetCatalogue(harness.database),
	start: '2026-11-04T00:00:00.000Z',
	identityPrefix: 'talent-screen',
});
const authorizer = createD1ScreenOutputAssetAuthorizer(harness.database);

interface Revision { assetId: GraphicAssetId; revisionId: GraphicAssetRevisionId }
let images = 0;
async function ingest(): Promise<Revision> {
	return publishedRevision(await ingestImage(context, { idempotencyKey: `image-${++images}`, initiatedBy: 'author' }));
}

let eventId: number;
let alicePhoto: Revision;
let bobPhoto: Revision;
let alice: number;
let bob: number;
let screens = 0;

beforeEach(async () => {
	alicePhoto = await ingest();
	bobPhoto = await ingest();
	const [event] = await db.insert(schema.events)
		.values({ name: 'Finals', game: 'op', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
	const talent = async (name: string, photo: Revision) =>
		(await createTalent(stubH3Event({
			params: {
				id: String(eventId),
			},
			body: { name, photo },
		}))).id as number;
	alice = await talent('Alice', alicePhoto);
	bob = await talent('Bob', bobPhoto);
});

afterAll(async () => await harness.close());

async function talentScreen(config: Record<string, unknown>, currentMode = 'talent') {
	const label = `talent-screen-${++screens}`;
	return await screenService().create(eventId, {
		name: label,
		slug: label,
		currentMode,
		modeConfigs: { talent: config },
	} as never, { assetCapabilitySeed: `seed-${label}`, assetCapabilityVersion: 1, assetCapabilityDigest: `digest-${label}` });
}

async function resolvable(screen: { id: number; assetCapabilityDigest: string }) {
	const outcomes = await Promise.all([alicePhoto, bobPhoto].map(revision => authorizer.authorize({
		screenId: screen.id,
		capabilityDigest: screen.assetCapabilityDigest,
		...revision,
	})));
	return {
		alice: outcomes[0]!.outcome === 'authorized',
		bob: outcomes[1]!.outcome === 'authorized',
	};
}

describe('a Talent Screen Output\'s capability over its Talents\' photos', () => {
	it.each([
		[
			'its one Talent\'s',
			() => ({
				selection: 'one',
				talentId: alice,
				talentIds: [bob],
			}),
			{ alice: true, bob: false },
		],
		[
			'each lineup Talent\'s',
			() => ({
				selection: 'lineup',
				talentId: alice,
				talentIds: [bob, alice],
			}),
			{ alice: true, bob: true },
		],
		[
			'none while photos are hidden',
			() => ({
				selection: 'lineup',
				talentIds: [alice, bob],
				showPhoto: false,
			}),
			{ alice: false, bob: false },
		],
		[
			'none while it names no Talent',
			() => ({}),
			{ alice: false, bob: false },
		],
	])('resolves %s', async (_case, config, expected) => {
		expect(await resolvable(await talentScreen(config()))).toEqual(expected);
	});

	it('resolves none once the Screen shows another mode', async () => {
		const screen = await talentScreen({ selection: 'one', talentId: alice }, 'standings');

		expect(await resolvable(screen)).toEqual({ alice: false, bob: false });
	});

	it('resolves a Talent\'s replaced photo no longer', async () => {
		const screen = await talentScreen({ selection: 'one', talentId: alice });
		const replacement = await ingest();
		await updateTalent(stubH3Event({
			params: {
				id: String(eventId),
				talentId: String(alice),
			},
			body: { photo: replacement },
		}));

		expect(await resolvable(screen)).toEqual({ alice: false, bob: false });
		expect(await authorizer.authorize({ screenId: screen.id, capabilityDigest: screen.assetCapabilityDigest, ...replacement }))
			.toMatchObject({ outcome: 'authorized' });
	});

	it('resolves no Talent photo for another Event\'s Screen naming the same ids', async () => {
		const screen = await talentScreen({
			selection: 'lineup',
			talentIds: [alice, bob],
		});
		const [other] = await db.insert(schema.events)
			.values({ name: 'Other', game: 'mtg', featureMatchOrientation: 'horizontal' })
			.returning({ id: schema.events.id });
		await db.update(schema.screens).set({ eventId: other!.id }).where(eq(schema.screens.id, screen.id));

		expect(await resolvable(screen)).toEqual({ alice: false, bob: false });
	});
});

import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import * as authSchema from '~~/server/db/schema/auth';
import {
	graphicAssetContents,
	graphicAssetRevisions,
	graphicAssets,
} from '~~/server/db/schema/graphicsAsset';
import { seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Graphics Authoring Lease holds at the commit, not only at the door (#607).
 *
 * Every write that edits a Broadcast Graphics Screen's graphics Edit workspace is
 * admitted twice: once up front, so a refused author is told before any work is
 * done, and once inside the statement that commits it. The second is what this
 * file is about. Between the two, another Session can take the lease over — and an
 * admission that was true when it was asked is then a write by somebody who no
 * longer holds the artifact. Fenced at the mutation, the write commits only while
 * no other Session holds a live lease, so a takeover that lands first wins.
 *
 * Driven against libSQL because the guarantee is a condition on a statement.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

// The lease names its holder through the auth tables, as the real `~~/server/db` does.
vi.doMock('~~/server/db', () => ({ db, schema: { ...schema, ...authSchema } }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

const { screenService } = await import('~~/server/services/screen');
const { screenWriteModule } = await import('~~/server/modules/screen-write');
const { graphicsAuthoringLeaseModule } = await import('~~/server/modules/graphics-authoring-lease');
const { screenEditWorkspaceLeaseRef } = await import('~~/server/modules/graphics-authoring-lease/screenEditWorkspace');

const HOLDER = 'session-holder';
const OTHER = 'session-other';

function graphic(id: string): BroadcastGraphicConfig {
	return { id, name: id, items: [] };
}

let eventId: number;
let screenId: number;

async function screenRow() {
	return await db.query.screens.findFirst({ where: eq(schema.screens.id, screenId) });
}

async function authoredStack(): Promise<string[]> {
	const graphics = (await screenRow())?.modeConfigs?.['broadcast-graphics']?.graphics ?? [];
	return graphics.map(entry => entry.id);
}

async function lease(sessionId: string, takeover = false) {
	await graphicsAuthoringLeaseModule().acquire({
		...screenEditWorkspaceLeaseRef(eventId, screenId),
		sessionId,
		takeover,
	});
}

function fenceFor(sessionId: string | undefined) {
	return { ...screenEditWorkspaceLeaseRef(eventId, screenId), sessionId };
}

beforeAll(async () => {
	await db.insert(graphicAssetContents).values({
		digest: 'd'.repeat(64),
		byteLength: 70,
		canonicalMime: 'image/png',
	} as never);
	await db.insert(graphicAssets).values({ id: 'asset-plate', name: 'Plate', kind: 'image' } as never);
	await db.insert(graphicAssetRevisions).values({
		id: 'revision-one',
		assetId: 'asset-plate',
		revisionNumber: 1,
		contentDigest: 'd'.repeat(64),
		compatibilityProfile: 'still-image-v1',
		technicalFacts: {},
	} as never);
});

beforeEach(async () => {
	const seeded = await seedBroadcastGraphicsScreen(db, { stack: { graphics: [graphic('authored')] } });
	eventId = seeded.eventId;
	screenId = seeded.screenId;
	await db.update(schema.screens)
		.set({ screenConfig: { width: 1920, height: 1080 } })
		.where(eq(schema.screens.id, screenId));
});

afterAll(async () => await harness.close());

describe('the commit-time lease fence', () => {
	it('refuses a Broadcast Graphics stack write by a Session that does not hold the lease', async () => {
		await lease(HOLDER);

		await expect(screenService().updateModeConfig(
			screenId,
			eventId,
			'broadcast-graphics',
			{ graphics: [graphic('intruder')] },
			0,
			fenceFor(OTHER),
		)).rejects.toMatchObject({ statusCode: 409 });

		expect(await authoredStack()).toEqual(['authored']);
		expect((await screenRow())?.stateVersion).toBe(0);
	});

	it('commits the holder\'s own fenced write', async () => {
		// The control: a fence that refused everyone would satisfy every refusal here.
		await lease(HOLDER);

		await screenService().updateModeConfig(
			screenId,
			eventId,
			'broadcast-graphics',
			{ graphics: [graphic('holder')] },
			0,
			fenceFor(HOLDER),
		);

		expect(await authoredStack()).toEqual(['holder']);
	});

	it('refuses a canvas resize by a Session that does not hold the lease', async () => {
		await lease(HOLDER);

		await expect(screenService().updateScreenConfig(
			screenId,
			eventId,
			{ width: 1600 },
			0,
			fenceFor(OTHER),
		)).rejects.toMatchObject({ statusCode: 409 });

		expect((await screenRow())?.screenConfig?.width).toBe(1920);
	});
});

/**
 * The generic Screen write serves every field a Screen has, and an Edit Screen
 * dialog sends the configuration back as it read it. So it is refused only when it
 * would actually change what the lease protects — the Broadcast Graphics stack, or
 * the canvas of a Screen in Broadcast Graphics mode — and a rename that round-trips
 * them unchanged stays open to everyone.
 */
describe('a generic Screen write while the Edit workspace is leased', () => {
	async function genericWrite(sessionId: string | undefined, input: Record<string, unknown>) {
		const current = await screenRow();
		return await screenWriteModule().updateScreen({
			eventId,
			screenId,
			input: { stateVersion: current!.stateVersion, ...input } as never,
			authoringSessionId: sessionId,
		});
	}

	it('refuses another Session\'s change to the Broadcast Graphics stack', async () => {
		await lease(HOLDER);

		await expect(genericWrite(OTHER, {
			modeConfigs: { 'broadcast-graphics': { graphics: [graphic('intruder')] } },
		})).rejects.toMatchObject({ statusCode: 409 });

		expect(await authoredStack()).toEqual(['authored']);
	});

	it('refuses another Session\'s change to the canvas', async () => {
		await lease(HOLDER);

		await expect(genericWrite(OTHER, {
			screenConfig: { width: 1600, height: 1080 },
		})).rejects.toMatchObject({ statusCode: 409 });

		expect((await screenRow())?.screenConfig?.width).toBe(1920);
	});

	it('admits another Session\'s rename that carries the protected fields back unchanged', async () => {
		await lease(HOLDER);
		const current = await screenRow();

		await genericWrite(OTHER, {
			name: 'Renamed',
			modeConfigs: current!.modeConfigs,
			screenConfig: current!.screenConfig,
		});

		expect((await screenRow())?.name).toBe('Renamed');
		expect(await authoredStack()).toEqual(['authored']);
	});

	it('admits the holder\'s change to the Broadcast Graphics stack', async () => {
		await lease(HOLDER);

		await genericWrite(HOLDER, {
			modeConfigs: { 'broadcast-graphics': { graphics: [graphic('holder')] } },
		});

		expect(await authoredStack()).toEqual(['holder']);
	});
});

/**
 * The guarantee the fence exists for, raced for real: admitted while holding the
 * lease, displaced before committing.
 *
 * The takeover is landed from inside the Graphics Asset Library question the
 * write asks between its admission and its commit — the one place an ordinary
 * authoring save waits on something else, and so the window a takeover actually
 * has. Without the fence the displaced author's save committed over whatever the
 * new holder was about to do.
 */
describe('a takeover between admission and commit', () => {
	it('refuses the displaced author\'s save', async () => {
		await lease(HOLDER);
		const plated: BroadcastGraphicConfig = {
			...graphic('plated'),
			inputs: [{
				key: 'plate',
				label: 'Plate',
				type: 'media',
				required: false,
				updatePolicy: 'live',
				default: testGraphicAssetReference('asset-plate', 'revision-one'),
				mediaKind: 'image',
			}],
		};

		let tookOver = false;
		const graphicsAssets = {
			async inspectGraphicAssetRevisions(): Promise<GraphicAssetReferenceStatus[]> {
				await lease(OTHER, true);
				tookOver = true;
				return [{ outcome: 'available', lifecycleState: 'active', kind: 'image' }];
			},
		};

		await expect(screenWriteModule().updateModeConfig({
			eventId,
			screenId,
			mode: 'broadcast-graphics',
			config: { graphics: [plated] },
			stateVersion: 0,
			graphicsAssets: () => graphicsAssets,
			authoringSessionId: HOLDER,
		})).rejects.toMatchObject({ statusCode: 409 });

		expect(tookOver).toBe(true);
		expect(await authoredStack()).toEqual(['authored']);
	});
});

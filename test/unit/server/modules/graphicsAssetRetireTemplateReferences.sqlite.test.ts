import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '~~/server/db/schema';
import { graphicAssetReferences } from '~~/server/db/schema/graphicsAsset';
import { createGraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';
/**
 * Retire is refused while a saved template references the asset (#614).
 *
 * A template keeps every reference it holds selectable on every write
 * (ADR-0034), so an asset retired under one would leave it unrevisable. Retire
 * therefore refuses while any Broadcast Graphic Template, Feature Match Layout
 * Template, or Installed Graphics Template references any revision of the asset,
 * and the refusal names them. The condition sits in the statement that retires,
 * so a template saved after anyone looked still holds it back. A Screen's
 * reference does not: a Screen keeps an unchanged retired reference resolving.
 *
 * Driven against libSQL because the guarantee is a condition on a statement.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const pixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

let nextIdentity = 0;
const library = createGraphicsAssetLibrary({
	catalogue: createD1GraphicsAssetCatalogue(harness.database),
	staging: createInMemoryStagingGraphicsObjectStore(),
	canonical: createInMemoryCanonicalGraphicsObjectStore(),
	now: () => new Date('2026-10-21T00:00:00.000Z'),
	generateIdentity: () => `retire-${++nextIdentity}`,
});

let assetId: GraphicAssetId;
let revisionId: GraphicAssetRevisionId;

async function ingestAsset(name: string) {
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: name,
		initiatedBy: 'retire-author',
		name,
		sourceFileName: 'plate.png',
		declaredMime: 'image/png',
		browserDecodeEvidence: {
			outcome: 'decoded',
			sourceDigest: createHash('sha256').update(pixelPng).digest('hex'),
			width: 1,
			height: 1,
		},
		declaredByteLength: pixelPng.byteLength,
		duplicateContentPolicy: 'create-separate',
	});
	const uploaded = await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: createBoundedByteStream(pixelPng, {
			byteLength: pixelPng.byteLength,
			maximumByteLength: pixelPng.byteLength,
		}),
	});
	return uploaded.result!;
}

async function lifecycleState(): Promise<string | undefined> {
	const assets = await library.listGraphicAssets({ lifecycleStates: ['active', 'retired', 'trashed'] });
	return assets.find(asset => asset.id === assetId)?.lifecycle.state;
}

async function reference(ownerKind: string, ownerId: string) {
	await db.insert(graphicAssetReferences).values({
		id: `${ownerKind}-${ownerId}`,
		assetId,
		revisionId,
		ownerKind,
		ownerId,
		ownerSlot: 'graphics.lower-third.items.plate.asset',
		eventId: null,
	} as never);
}

async function retire() {
	return await library.retireGraphicAsset({ assetId, actor: 'retire-author' });
}

beforeEach(async () => {
	await db.delete(graphicAssetReferences);
	await db.delete(schema.broadcastGraphicTemplates);
	({ assetId, revisionId } = await ingestAsset(`plate-${nextIdentity}`));
});

afterAll(async () => await harness.close());

describe('retiring a Graphic Asset a saved template references', () => {
	it.each([
		['a Broadcast Graphic Template', 'broadcast-graphic-template'],
		['a Feature Match Layout Template', 'feature-match-layout-template'],
		['an Installed Graphics Template', 'installed-graphics-template'],
	])('is refused while %s references it, naming the template', async (_, ownerKind) => {
		await reference(ownerKind, 'template-1');

		const outcome = await retire();

		expect(outcome).toMatchObject({
			outcome: 'in-use',
			usage: [expect.objectContaining({ owner: expect.objectContaining({ kind: ownerKind, id: 'template-1' }) })],
		});
		expect(await lifecycleState()).toBe('active');
	});

	it('names the template by the name the library shows', async () => {
		await db.insert(schema.broadcastGraphicTemplates).values({
			id: 'template-1',
			name: 'Lower third',
			description: null,
			revision: 1,
			document: { id: 'lower-third', name: 'Lower third', items: [] },
			graphicAssetReferenceVersion: 'stamp',
		} as never);
		await reference('broadcast-graphic-template', 'template-1');

		const outcome = await retire();

		expect(outcome).toMatchObject({
			outcome: 'in-use',
			usage: [expect.objectContaining({ owner: expect.objectContaining({ name: 'Lower third' }) })],
		});
	});

	it('reports only the templates holding it back, not the Screens that also reference it', async () => {
		await reference('screen', '7');
		await reference('feature-match-layout-template', 'layout-1');

		const outcome = await retire();

		expect(outcome.outcome).toBe('in-use');
		expect(outcome.outcome === 'in-use' && outcome.usage.map(item => item.owner.kind))
			.toEqual(['feature-match-layout-template']);
	});

	it('still retires an asset only a Screen references', async () => {
		await reference('screen', '7');

		expect((await retire()).outcome).toBe('retired');
		expect(await lifecycleState()).toBe('retired');
	});
});

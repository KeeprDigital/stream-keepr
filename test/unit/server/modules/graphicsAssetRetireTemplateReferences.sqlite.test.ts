import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '~~/server/db/schema';
import { graphicAssetReferences } from '~~/server/db/schema/graphicsAsset';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';

import { createTestGraphicsLibrary, ingestImage, publishedRevision } from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Retire is refused while a saved template references any revision of the asset, in the
 * retiring statement itself; a Screen's reference does not hold it back (#614, ADR-0034).
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const context = createTestGraphicsLibrary({
	catalogue: createD1GraphicsAssetCatalogue(harness.database),
	start: '2026-10-21T00:00:00.000Z',
	identityPrefix: 'retire',
});
const { library } = context;

let plates = 0;
let assetId: GraphicAssetId;
let revisionId: GraphicAssetRevisionId;

async function ingestAsset(name: string) {
	return publishedRevision(await ingestImage(context, { idempotencyKey: name, initiatedBy: 'retire-author' }));
}

async function lifecycleState(): Promise<string | undefined> {
	const assets = await library.listGraphicAssets({
		lifecycleStates: ['active', 'retired', 'trashed'],
	});
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
	({ assetId, revisionId } = await ingestAsset(`plate-${++plates}`));
});

afterAll(async () => await harness.close());

describe('retiring a Graphic Asset a saved template references', () => {
	it.each([
		['a Broadcast Graphic Template', 'broadcast-graphic-template'],
		['a Feature Match Layout Template', 'feature-match-layout-template'],
	])('is refused while %s references it, naming the template', async (_, ownerKind) => {
		await reference(ownerKind, 'template-1');

		const outcome = await retire();

		expect(outcome).toMatchObject({
			outcome: 'in-use',
			usage: [
				expect.objectContaining({
					owner: expect.objectContaining({ kind: ownerKind, id: 'template-1' }),
				}),
			],
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
			usage: [
				expect.objectContaining({
					owner: expect.objectContaining({ name: 'Lower third' }),
				}),
			],
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

	// An Installed Graphics Template is never revised and cannot be deleted, so
	// counting it would make its assets unretirable for good.
	it('still retires an asset only an Installed Graphics Template references', async () => {
		await reference('installed-graphics-template', 'installed-1');

		expect((await retire()).outcome).toBe('retired');
	});

	it('answers not-allowed, not in-use, for an asset already retired', async () => {
		expect((await retire()).outcome).toBe('retired');
		await reference('broadcast-graphic-template', 'template-1');

		await expect(retire()).rejects.toMatchObject({ code: 'graphic-asset-lifecycle-action-not-allowed' });
	});

	it('still retires an asset only a Screen references', async () => {
		await reference('screen', '7');

		expect((await retire()).outcome).toBe('retired');
		expect(await lifecycleState()).toBe('retired');
	});
});

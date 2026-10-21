import type { BroadcastGraphicConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import {
	graphicAssetContents,
	graphicAssetReferences,
	graphicAssetRevisions,
	graphicAssets,
} from '~~/server/db/schema/graphicsAsset';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A graphics Template's Graphic Asset References hold at the commit (#614).
 *
 * Every template write, for both template kinds, requires each reference to name
 * an existing revision of an active Graphic Asset whose kind fits its slot. A route
 * asks the library first, but the catalogue can change between that question and
 * the commit — an asset retired in between, a revision that never existed — so the
 * statement that writes the template carries the same rule. A refused write leaves
 * the template and its reference index exactly as they were, and an accepted one
 * indexes every reference it stores.
 *
 * Driven against libSQL because the guarantee is a condition on a statement.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const {
	BroadcastGraphicTemplateReferenceConflict,
	BroadcastGraphicTemplateRevisionConflict,
	broadcastGraphicTemplateService,
} = await import('~~/server/services/broadcastGraphicTemplate');
const {
	FeatureMatchLayoutTemplateReferenceConflict,
	FeatureMatchLayoutTemplateRevisionConflict,
	featureMatchLayoutTemplateService,
} = await import('~~/server/services/featureMatchLayoutTemplate');

const IMAGE = testGraphicAssetReference('asset-image', 'revision-image');
const RETIRING_IMAGE = testGraphicAssetReference('asset-retiring', 'revision-retiring');
const FONT = testGraphicAssetReference('asset-font', 'revision-font');
const INVENTED = testGraphicAssetReference('asset-image', 'revision-invented');

async function seedAsset(reference: GraphicAssetReference, kind: 'image' | 'font') {
	const digest = reference.revisionId.padEnd(64, '0').slice(0, 64);
	await db.insert(graphicAssetContents).values({
		digest,
		byteLength: 70,
		canonicalMime: kind === 'font' ? 'font/woff2' : 'image/png',
	} as never);
	await db.insert(graphicAssets).values({ id: reference.assetId, name: reference.assetId, kind } as never);
	await db.insert(graphicAssetRevisions).values({
		id: reference.revisionId,
		assetId: reference.assetId,
		revisionNumber: 1,
		contentDigest: digest,
		compatibilityProfile: kind === 'font' ? 'static-font-v1' : 'still-image-v1',
		technicalFacts: {},
	} as never);
}

async function retire(reference: GraphicAssetReference) {
	await db.update(graphicAssets)
		.set({ lifecycleState: 'retired' } as never)
		.where(eq(graphicAssets.id, reference.assetId));
}

function media(id: string, asset: GraphicAssetReference): MediaGraphicItemConfig {
	return {
		type: 'media',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 200,
		height: 100,
		asset,
		mediaKind: 'image',
		fit: 'cover',
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: true,
	};
}

function broadcastGraphic(...items: MediaGraphicItemConfig[]): BroadcastGraphicConfig {
	return { id: 'lower-third', name: 'Lower third', items };
}

function featureMatchLayout(backgroundImage: GraphicAssetReference, ...items: MediaGraphicItemConfig[]): FeatureMatchLayoutConfig {
	return {
		frame: { backgroundImage: { kind: 'asset', ...backgroundImage } },
		composition: { items },
	} as unknown as FeatureMatchLayoutConfig;
}

async function indexedSlots(ownerKind: string, ownerId: string): Promise<string[]> {
	const rows = await db.select().from(graphicAssetReferences);
	return rows
		.filter(row => row.ownerKind === ownerKind && row.ownerId === ownerId)
		.map(row => row.ownerSlot)
		.sort();
}

beforeAll(async () => {
	await seedAsset(IMAGE, 'image');
	await seedAsset(RETIRING_IMAGE, 'image');
	await seedAsset(FONT, 'font');
});

beforeEach(async () => {
	await db.delete(graphicAssetReferences);
	await db.delete(schema.broadcastGraphicTemplates);
	await db.delete(schema.featureMatchLayoutTemplates);
	await db.update(graphicAssets).set({ lifecycleState: 'active' } as never);
});

afterAll(async () => await harness.close());

describe('a Broadcast Graphic Template write', () => {
	const OWNER = 'broadcast-graphic-template';

	it('stores the template and indexes every reference it holds', async () => {
		await broadcastGraphicTemplateService().create({
			id: 'template',
			name: 'Lower third',
			description: null,
			document: broadcastGraphic(media('logo', IMAGE), media('badge', RETIRING_IMAGE)),
		});

		expect(await indexedSlots(OWNER, 'template')).toEqual([
			'graphics.lower-third.items.badge.asset',
			'graphics.lower-third.items.logo.asset',
		]);
	});

	it.each([
		['an asset of the wrong kind for its slot', FONT],
		['a revision that does not exist', INVENTED],
	])('refuses to create a template referencing %s, storing nothing', async (_, reference) => {
		await expect(broadcastGraphicTemplateService().create({
			id: 'template',
			name: 'Lower third',
			description: null,
			document: broadcastGraphic(media('logo', IMAGE), media('badge', reference)),
		})).rejects.toBeInstanceOf(BroadcastGraphicTemplateReferenceConflict);

		expect(await broadcastGraphicTemplateService().findById('template')).toBeUndefined();
		expect(await indexedSlots(OWNER, 'template')).toEqual([]);
	});

	it('refuses to create a template referencing a retired asset', async () => {
		await retire(RETIRING_IMAGE);

		await expect(broadcastGraphicTemplateService().create({
			id: 'template',
			name: 'Lower third',
			description: null,
			document: broadcastGraphic(media('badge', RETIRING_IMAGE)),
		})).rejects.toBeInstanceOf(BroadcastGraphicTemplateReferenceConflict);

		expect(await broadcastGraphicTemplateService().findById('template')).toBeUndefined();
	});

	it('refuses a revision once an asset it references is retired, leaving the template and its index as they were', async () => {
		const created = await broadcastGraphicTemplateService().create({
			id: 'template',
			name: 'Lower third',
			description: null,
			document: broadcastGraphic(media('logo', IMAGE), media('badge', RETIRING_IMAGE)),
		});
		// Retired between the route's question and the commit.
		await retire(RETIRING_IMAGE);

		await expect(broadcastGraphicTemplateService().update('template', {
			name: 'Renamed',
			revision: created.revision,
		})).rejects.toBeInstanceOf(BroadcastGraphicTemplateReferenceConflict);

		const stored = await broadcastGraphicTemplateService().findById('template');
		expect(stored).toMatchObject({ name: 'Lower third', revision: created.revision });
		expect(await indexedSlots(OWNER, 'template')).toEqual([
			'graphics.lower-third.items.badge.asset',
			'graphics.lower-third.items.logo.asset',
		]);
	});

	it('refuses a revision that introduces an asset of the wrong kind', async () => {
		const created = await broadcastGraphicTemplateService().create({
			id: 'template',
			name: 'Lower third',
			description: null,
			document: broadcastGraphic(media('logo', IMAGE)),
		});

		await expect(broadcastGraphicTemplateService().update('template', {
			document: broadcastGraphic(media('logo', FONT)),
			revision: created.revision,
		})).rejects.toBeInstanceOf(BroadcastGraphicTemplateReferenceConflict);

		expect((await broadcastGraphicTemplateService().findById('template'))?.document)
			.toEqual(broadcastGraphic(media('logo', IMAGE)));
		expect(await indexedSlots(OWNER, 'template')).toEqual(['graphics.lower-third.items.logo.asset']);
	});

	it('still answers a stale revision as a revision conflict', async () => {
		await broadcastGraphicTemplateService().create({
			id: 'template',
			name: 'Lower third',
			description: null,
			document: broadcastGraphic(media('logo', IMAGE)),
		});

		await expect(broadcastGraphicTemplateService().update('template', { name: 'Stale', revision: 7 }))
			.rejects
			.toBeInstanceOf(BroadcastGraphicTemplateRevisionConflict);
	});

	it('commits a revision whose references all resolve, reindexing them', async () => {
		const created = await broadcastGraphicTemplateService().create({
			id: 'template',
			name: 'Lower third',
			description: null,
			document: broadcastGraphic(media('logo', IMAGE)),
		});

		const updated = await broadcastGraphicTemplateService().update('template', {
			document: broadcastGraphic(media('badge', RETIRING_IMAGE)),
			revision: created.revision,
		});

		expect(updated?.revision).toBe(created.revision + 1);
		expect(await indexedSlots(OWNER, 'template')).toEqual(['graphics.lower-third.items.badge.asset']);
	});
});

describe('a Feature Match Layout Template write', () => {
	const OWNER = 'feature-match-layout-template';

	it('stores the template and indexes every reference it holds', async () => {
		await featureMatchLayoutTemplateService().create({
			id: 'layout',
			name: 'Layout',
			description: null,
			document: featureMatchLayout(IMAGE, media('logo', RETIRING_IMAGE)),
		});

		expect(await indexedSlots(OWNER, 'layout')).toEqual([
			'layout.composition.items.logo.asset',
			'layout.frame.backgroundImage',
		]);
	});

	it.each([
		['an asset of the wrong kind for its slot', FONT],
		['a revision that does not exist', INVENTED],
	])('refuses to create a template referencing %s, storing nothing', async (_, reference) => {
		await expect(featureMatchLayoutTemplateService().create({
			id: 'layout',
			name: 'Layout',
			description: null,
			document: featureMatchLayout(reference),
		})).rejects.toBeInstanceOf(FeatureMatchLayoutTemplateReferenceConflict);

		expect(await featureMatchLayoutTemplateService().findById('layout')).toBeUndefined();
		expect(await indexedSlots(OWNER, 'layout')).toEqual([]);
	});

	it('refuses to create a template referencing a retired asset', async () => {
		await retire(RETIRING_IMAGE);

		await expect(featureMatchLayoutTemplateService().create({
			id: 'layout',
			name: 'Layout',
			description: null,
			document: featureMatchLayout(IMAGE, media('logo', RETIRING_IMAGE)),
		})).rejects.toBeInstanceOf(FeatureMatchLayoutTemplateReferenceConflict);

		expect(await featureMatchLayoutTemplateService().findById('layout')).toBeUndefined();
	});

	it('refuses a revision that introduces an asset of the wrong kind', async () => {
		const created = await featureMatchLayoutTemplateService().create({
			id: 'layout',
			name: 'Layout',
			description: null,
			document: featureMatchLayout(IMAGE),
		});

		await expect(featureMatchLayoutTemplateService().update('layout', {
			document: featureMatchLayout(IMAGE, media('logo', FONT)),
			revision: created.revision,
		})).rejects.toBeInstanceOf(FeatureMatchLayoutTemplateReferenceConflict);

		expect((await featureMatchLayoutTemplateService().findById('layout'))?.document)
			.toEqual(featureMatchLayout(IMAGE));
		expect(await indexedSlots(OWNER, 'layout')).toEqual(['layout.frame.backgroundImage']);
	});

	it('refuses a revision once an asset it references is retired, leaving the template and its index as they were', async () => {
		const created = await featureMatchLayoutTemplateService().create({
			id: 'layout',
			name: 'Layout',
			description: null,
			document: featureMatchLayout(IMAGE, media('logo', RETIRING_IMAGE)),
		});
		await retire(RETIRING_IMAGE);

		await expect(featureMatchLayoutTemplateService().update('layout', {
			name: 'Renamed',
			revision: created.revision,
		})).rejects.toBeInstanceOf(FeatureMatchLayoutTemplateReferenceConflict);

		expect(await featureMatchLayoutTemplateService().findById('layout'))
			.toMatchObject({ name: 'Layout', revision: created.revision });
		expect(await indexedSlots(OWNER, 'layout')).toEqual([
			'layout.composition.items.logo.asset',
			'layout.frame.backgroundImage',
		]);
	});

	it('still answers a stale revision as a revision conflict', async () => {
		await featureMatchLayoutTemplateService().create({
			id: 'layout',
			name: 'Layout',
			description: null,
			document: featureMatchLayout(IMAGE),
		});

		await expect(featureMatchLayoutTemplateService().update('layout', { name: 'Stale', revision: 7 }))
			.rejects
			.toBeInstanceOf(FeatureMatchLayoutTemplateRevisionConflict);
	});
});

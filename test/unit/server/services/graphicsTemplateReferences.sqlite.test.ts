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

// A template write commits only references to existing revisions of active assets that fit
// their slots; a refused write leaves the template and its index as they were (#614).

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
		canonicalMime: kind === 'font'
			? 'font/woff2'
			: 'image/png',
	} as never);
	await db.insert(graphicAssets).values({ id: reference.assetId, name: reference.assetId, kind } as never);
	await db.insert(graphicAssetRevisions).values({
		id: reference.revisionId,
		assetId: reference.assetId,
		revisionNumber: 1,
		contentDigest: digest,
		compatibilityProfile: kind === 'font'
			? 'static-font-v1'
			: 'still-image-v1',
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
		frame: {
			backgroundImage: { kind: 'asset', ...backgroundImage },
		},
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

/** What differs between the two template kinds; every rule below holds for both. */
const KINDS = [
	{
		kind: 'Broadcast Graphic Template',
		owner: 'broadcast-graphic-template',
		service: () => broadcastGraphicTemplateService(),
		ReferenceConflict: BroadcastGraphicTemplateReferenceConflict,
		RevisionConflict: BroadcastGraphicTemplateRevisionConflict,
		document: (first: GraphicAssetReference, second?: GraphicAssetReference) =>
			broadcastGraphic(media('logo', first), ...(second
				? [
						media('badge', second),
					]
				: [])),
		slots: (count: number) => count === 1
			? ['graphics.lower-third.items.logo.asset']
			: ['graphics.lower-third.items.badge.asset', 'graphics.lower-third.items.logo.asset'],
	},
	{
		kind: 'Feature Match Layout Template',
		owner: 'feature-match-layout-template',
		service: () => featureMatchLayoutTemplateService(),
		ReferenceConflict: FeatureMatchLayoutTemplateReferenceConflict,
		RevisionConflict: FeatureMatchLayoutTemplateRevisionConflict,
		document: (first: GraphicAssetReference, second?: GraphicAssetReference) =>
			featureMatchLayout(first, ...(second
				? [
						media('logo', second),
					]
				: [])),
		slots: (count: number) => count === 1
			? ['layout.frame.backgroundImage']
			: ['layout.composition.items.logo.asset', 'layout.frame.backgroundImage'],
	},
] as const;

describe.each(KINDS)('a $kind write', ({ owner, service, ReferenceConflict, RevisionConflict, document, slots }) => {
	const create = (doc: unknown) => (service() as ReturnType<typeof broadcastGraphicTemplateService>).create({
		id: 'template',
		name: 'Template',
		description: null,
		document: doc as never,
	});
	const update = (input: Record<string, unknown>) => (service() as ReturnType<typeof broadcastGraphicTemplateService>).update('template', input as never);
	const stored = () => service().findById('template');

	it('stores the template and indexes every reference it holds', async () => {
		await create(document(IMAGE, RETIRING_IMAGE));

		expect(await indexedSlots(owner, 'template')).toEqual(slots(2));
	});

	it.each([
		[
			'an asset of the wrong kind for its slot',
			async () => FONT,
		],
		[
			'a revision that does not exist',
			async () => INVENTED,
		],
		[
			'a retired asset',
			async () => {
				await retire(RETIRING_IMAGE);
				return RETIRING_IMAGE;
			},
		],
	])('refuses to create a template referencing %s, storing nothing', async (_, reference) => {
		await expect(create(document(IMAGE, await reference()))).rejects.toBeInstanceOf(ReferenceConflict);

		expect(await stored()).toBeUndefined();
		expect(await indexedSlots(owner, 'template')).toEqual([]);
	});

	it('refuses a revision once an asset it references is retired, leaving the template and its index as they were', async () => {
		const created = await create(document(IMAGE, RETIRING_IMAGE));
		// Retired between the route's question and the commit.
		await retire(RETIRING_IMAGE);

		await expect(update({ name: 'Renamed', revision: created.revision })).rejects.toBeInstanceOf(ReferenceConflict);

		expect(await stored()).toMatchObject({ name: 'Template', revision: created.revision });
		expect(await indexedSlots(owner, 'template')).toEqual(slots(2));
	});

	it('refuses a revision that introduces an asset of the wrong kind', async () => {
		const created = await create(document(IMAGE));

		await expect(update({
			document: document(IMAGE, FONT),
			revision: created.revision,
		})).rejects.toBeInstanceOf(ReferenceConflict);

		expect((await stored())?.document).toEqual(document(IMAGE));
		expect(await indexedSlots(owner, 'template')).toEqual(slots(1));
	});

	it('still answers a stale revision as a revision conflict', async () => {
		await create(document(IMAGE));

		await expect(update({ name: 'Stale', revision: 7 })).rejects.toBeInstanceOf(RevisionConflict);
	});

	it('commits a revision whose references all resolve, reindexing them', async () => {
		const created = await create(document(IMAGE, RETIRING_IMAGE));

		const updated = await update({
			document: document(IMAGE),
			revision: created.revision,
		});

		expect(updated?.revision).toBe(created.revision + 1);
		expect(await indexedSlots(owner, 'template')).toEqual(slots(1));
	});
});

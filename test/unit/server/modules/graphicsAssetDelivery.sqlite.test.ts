import type {
	GraphicsAssetDelivery,
	GraphicsAssetDeliveryCatalogue,
	GraphicsCanonicalDisagreement,
} from '~~/server/modules/graphics-asset-library/delivery';
import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryGraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createGraphicsAssetDelivery } from '~~/server/modules/graphics-asset-library/delivery';
import { createInMemoryCanonicalGraphicsObjectStore } from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import { digestOf, pixelPng } from '~~/test/helpers/graphicsFixtures';
import {
	canonicalIdentity,
	createTestGraphicsLibrary,
	ingestImage,
	publishedRevision,
} from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

// Delivery's contract holds over both catalogue adapters: their delivery
// reads truly match, so one table runs against each.
const CATALOGUES: [string, () => GraphicsAssetDeliveryCatalogue & Parameters<typeof createTestGraphicsLibrary>[0]['catalogue']][] = [
	[
		'the in-memory catalogue',
		() => createInMemoryGraphicsAssetCatalogue(),
	],
	[
		'the D1 catalogue on SQLite',
		() => createD1GraphicsAssetCatalogue(harness.database),
	],
];

const missingRevision = 'missing-revision' as GraphicAssetRevisionId;

/** One published PNG, and a delivery built over only its catalogue and canonical store. */
async function publishedForDelivery(catalogueFactory: (typeof CATALOGUES)[number][1]) {
	const catalogue = catalogueFactory();
	const context = createTestGraphicsLibrary({ catalogue });
	const reference = publishedRevision(await ingestImage(context, { idempotencyKey: 'delivered' }));
	const thumbnail = await catalogue.findThumbnailContent(reference.assetId);
	if (!thumbnail)
		throw new Error('The published PNG has no preview');
	const reported: GraphicsCanonicalDisagreement[] = [];
	const delivery = createGraphicsAssetDelivery({
		catalogue,
		canonical: context.canonical,
		reportDisagreement: async (observed) => {
			reported.push(observed);
		},
	});
	return {
		delivery,
		canonical: context.canonical,
		reference,
		thumbnailDigest: thumbnail.digest,
		reported,
	};
}

type Published = Awaited<ReturnType<typeof publishedForDelivery>>;

/** Each delivery read over the published reference, and the disagreement it reports. */
const READS: [string, (published: Published) => Promise<unknown>, (published: Published) => GraphicsCanonicalDisagreement, (published: Published) => string][] = [
	[
		'resolving a revision',
		async ({ delivery, reference }) => await delivery.resolveGraphicAssetRevision(reference),
		({ reference }) => reference,
		() => digestOf(pixelPng),
	],
	[
		'inspecting a revision',
		async ({ delivery, reference }) => await delivery.inspectGraphicAssetRevision(reference),
		({ reference }) => reference,
		() => digestOf(pixelPng),
	],
	[
		'inspecting a revision\'s content',
		async ({ delivery, reference }) => await delivery.inspectGraphicAssetRevisionContent(reference),
		({ reference }) => reference,
		() => digestOf(pixelPng),
	],
	[
		'inspecting revisions set-wise',
		async ({ delivery, reference }) => (await delivery.inspectGraphicAssetRevisions({
			references: [reference],
		}))[0],
		() => ({
			digest: digestOf(pixelPng),
		}),
		() => digestOf(pixelPng),
	],
	[
		'resolving a preview',
		async ({ delivery, reference }) => await delivery.resolveGraphicAssetThumbnail({ assetId: reference.assetId }),
		({ thumbnailDigest }) => ({ digest: thumbnailDigest }),
		({ thumbnailDigest }) => thumbnailDigest,
	],
];

describe.each(CATALOGUES)('delivery over %s', (_name, catalogueFactory) => {
	it('serves a pinned revision\'s exact bytes and its preview', async () => {
		const { delivery, reference } = await publishedForDelivery(catalogueFactory);

		const resolved = await delivery.resolveGraphicAssetRevision(reference);
		expect(resolved).toMatchObject({ outcome: 'available', byteLength: pixelPng.byteLength, contentType: 'image/png' });
		if (resolved.outcome !== 'available')
			throw new Error('Expected the pinned revision to resolve');
		expect(new Uint8Array(await new Response(resolved.body).arrayBuffer())).toEqual(pixelPng);

		expect(await delivery.resolveGraphicAssetThumbnail({ assetId: reference.assetId }))
			.toMatchObject({ outcome: 'available', contentType: 'image/png' });
		expect(await delivery.inspectGraphicAssetRevisionContent(reference))
			.toEqual({ outcome: 'available', byteLength: pixelPng.byteLength, contentType: 'image/png' });
		expect(await delivery.inspectGraphicAssetRevision(reference))
			.toEqual({ outcome: 'available', lifecycleState: 'active', kind: 'image' });
	});

	it.each([
		[
			'resolving a revision',
			(delivery: GraphicsAssetDelivery, assetId: GraphicAssetId) => delivery.resolveGraphicAssetRevision({ assetId, revisionId: missingRevision }),
		],
		[
			'inspecting a revision',
			(delivery: GraphicsAssetDelivery, assetId: GraphicAssetId) => delivery.inspectGraphicAssetRevision({ assetId, revisionId: missingRevision }),
		],
		[
			'inspecting a revision\'s content',
			(delivery: GraphicsAssetDelivery, assetId: GraphicAssetId) => delivery.inspectGraphicAssetRevisionContent({ assetId, revisionId: missingRevision }),
		],
		[
			'resolving a preview',
			(delivery: GraphicsAssetDelivery) => delivery.resolveGraphicAssetThumbnail({ assetId: 'no-such-asset' as GraphicAssetId }),
		],
	])('answers missing, never another revision, when %s that does not exist', async (_read, read) => {
		const { delivery, reference, reported } = await publishedForDelivery(catalogueFactory);

		expect(await read(delivery, reference.assetId)).toEqual({ outcome: 'missing' });
		expect(reported).toEqual([]);
	});

	it('answers a set-wise inspection by input position', async () => {
		const { delivery, reference } = await publishedForDelivery(catalogueFactory);
		const missing = { assetId: reference.assetId, revisionId: missingRevision };

		expect(await delivery.inspectGraphicAssetRevisions({
			references: [missing, reference, reference],
		})).toEqual([
			{ outcome: 'missing' },
			{ outcome: 'available', lifecycleState: 'active', kind: 'image' },
			{ outcome: 'available', lifecycleState: 'active', kind: 'image' },
		]);
		expect(await delivery.inspectGraphicAssetRevisions({ references: [] })).toEqual([]);
	});

	// Readers feed Graphics Reconciliation every contradiction they observe.
	it.each(READS)('reports what it saw, and answers unavailable, when the byte store contradicts the catalogue on %s', async (_read, read, disagreement, digest) => {
		const published = await publishedForDelivery(catalogueFactory);
		await published.canonical.delete(canonicalIdentity(digest(published)));

		expect(await read(published)).toEqual({ outcome: 'unavailable', retryable: true });
		expect(published.reported).toEqual([
			disagreement(published),
		]);
	});

	// A store that could not answer proves nothing about the object.
	it.each(READS)('answers unavailable without reporting when the byte store cannot answer %s', async (_read, read, _disagreement, digest) => {
		const published = await publishedForDelivery(catalogueFactory);
		published.canonical.markUnavailable(canonicalIdentity(digest(published)));

		expect(await read(published)).toEqual({ outcome: 'unavailable', retryable: true });
		expect(published.reported).toEqual([]);
	});
});

describe('delivery and its collaborators', () => {
	it('keeps its answer when reporting a disagreement fails', async () => {
		const catalogue = createInMemoryGraphicsAssetCatalogue();
		const context = createTestGraphicsLibrary({ catalogue });
		const reference = publishedRevision(await ingestImage(context, { idempotencyKey: 'delivered' }));
		await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
		const delivery = createGraphicsAssetDelivery({
			catalogue,
			canonical: context.canonical,
			reportDisagreement: async () => {
				throw new Error('reconciliation is down');
			},
		});

		expect(await delivery.resolveGraphicAssetRevision(reference)).toEqual({ outcome: 'unavailable', retryable: true });
	});

	const healthOnly = {
		checkHealth: async () => ({ outcome: 'healthy' as const }),
	};

	it.each([
		[
			'catalogue',
			(_catalogue: GraphicsAssetDeliveryCatalogue) => createGraphicsAssetDelivery({
				catalogue: healthOnly,
				canonical: createInMemoryCanonicalGraphicsObjectStore(),
			}),
		],
		[
			'canonical byte store',
			(catalogue: GraphicsAssetDeliveryCatalogue) => createGraphicsAssetDelivery({ catalogue, canonical: healthOnly }),
		],
	])('is built without a usable %s, and answers retryably unavailable when read', async (_missing, build) => {
		const catalogue = createInMemoryGraphicsAssetCatalogue();
		const context = createTestGraphicsLibrary({ catalogue });
		const reference = publishedRevision(await ingestImage(context, { idempotencyKey: 'delivered' }));

		await expect(build(catalogue).resolveGraphicAssetRevision(reference)).rejects.toMatchObject({
			code: 'graphics-asset-library-unavailable',
		});
	});
});

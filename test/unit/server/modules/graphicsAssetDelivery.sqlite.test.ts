import type { GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library';
import type {
	GraphicsAssetDelivery,
	GraphicsCanonicalDisagreement,
} from '~~/server/modules/graphics-asset-library/delivery';
import type { InMemoryGraphicsCanonicalObjectStore } from '~~/server/modules/graphics-asset-library/object-store';
import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryGraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createGraphicsAssetDelivery } from '~~/server/modules/graphics-asset-library/delivery';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
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
const CATALOGUES: [string, () => GraphicsAssetCatalogue][] = [
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

/** The object's own bytes stored again without the digest metadata publication wrote beside them. */
async function stripDigestMetadata(canonical: InMemoryGraphicsCanonicalObjectStore, digest: string) {
	const identity = canonicalIdentity(digest);
	const stored = await canonical.read(identity);
	if (stored.outcome !== 'available')
		throw new Error('Expected the stored object to be readable');
	const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
	await canonical.delete(identity);
	await canonical.createImmutable({
		identity,
		bytes: createBoundedByteStream(bytes, { byteLength: bytes.byteLength, maximumByteLength: bytes.byteLength }),
		metadata: { contentType: stored.object.contentType },
	});
}

/** Ways the byte store answers while contradicting what the catalogue recorded. */
const CONTRADICTIONS: [string, (canonical: InMemoryGraphicsCanonicalObjectStore, digest: string) => Promise<unknown>][] = [
	[
		'holds no object',
		async (canonical, digest) => await canonical.delete(canonicalIdentity(digest)),
	],
	['holds the bytes without their digest metadata', stripDigestMetadata],
];

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

	it('serves exactly the byte range asked for', async () => {
		const { delivery, reference } = await publishedForDelivery(catalogueFactory);

		const resolved = await delivery.resolveGraphicAssetRevision({
			...reference,
			range: { offset: 24, length: 8 },
		});
		expect(resolved).toMatchObject({ outcome: 'available', byteLength: pixelPng.byteLength });
		if (resolved.outcome !== 'available')
			throw new Error('Expected the ranged revision to resolve');
		expect(new Uint8Array(await new Response(resolved.body).arrayBuffer())).toEqual(pixelPng.slice(24, 32));
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

	// Readers share reconciliation's definition of agreement, and feed it every
	// contradiction they observe.
	it.each(CONTRADICTIONS.flatMap(([contradiction, contradict]) =>
		READS.map(([read, ...rest]) => [
			read,
			contradiction,
			contradict,
			...rest,
		] as const),
	))('answers unavailable on %s, and reports it, when the byte store %s', async (_read, _contradiction, contradict, read, disagreement, digest) => {
		const published = await publishedForDelivery(catalogueFactory);
		await contradict(published.canonical, digest(published));

		expect(await read(published)).toEqual({ outcome: 'unavailable', retryable: true });
		expect(published.reported).toEqual([
			disagreement(published),
		]);
	});

	// #374: revisions sharing content share one canonical object.
	it('observes each distinct content once in a set-wise inspection', async () => {
		const catalogue = catalogueFactory();
		const context = createTestGraphicsLibrary({ catalogue });
		const first = publishedRevision(await ingestImage(context, { idempotencyKey: 'first' }));
		const twin = publishedRevision(await ingestImage(context, { idempotencyKey: 'twin' }));
		const readMetadata = vi.fn(context.canonical.readMetadata);
		const delivery = createGraphicsAssetDelivery({
			catalogue,
			canonical: { ...context.canonical, readMetadata },
		});

		expect(await delivery.inspectGraphicAssetRevisions({
			references: [first, twin, first],
		}))
			.toEqual(Array.from({ length: 3 }, () => ({ outcome: 'available', lifecycleState: 'active', kind: 'image' })));
		expect(readMetadata).toHaveBeenCalledTimes(1);
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
			{ catalogue: healthOnly },
		],
		[
			'canonical byte store',
			{ canonical: healthOnly },
		],
	])('is built without a usable %s, and refuses a read as the library being unavailable', async (_missing, unusable) => {
		const catalogue = createInMemoryGraphicsAssetCatalogue();
		const context = createTestGraphicsLibrary({ catalogue });
		const reference = publishedRevision(await ingestImage(context, { idempotencyKey: 'delivered' }));
		const delivery = createGraphicsAssetDelivery({ catalogue, canonical: context.canonical, ...unusable });

		await expect(delivery.resolveGraphicAssetRevision(reference)).rejects.toMatchObject({
			code: 'graphics-asset-library-unavailable',
		});
	});
});

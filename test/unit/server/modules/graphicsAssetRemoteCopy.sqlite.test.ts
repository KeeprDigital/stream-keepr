import type {
	GraphicsMultipartUploadIdentity,
	InMemoryGraphicsStagingObjectStore,
} from '~~/server/modules/graphics-asset-library/object-store';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import { graphicsObjectIdentity } from '~~/server/modules/graphics-asset-library/object-store';
import { createGraphicsRemoteSourceFetcher } from '~~/server/modules/graphics-asset-library/remote-source';
import { GRAPHICS_MULTIPART_PART_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

const SOURCE_URL = 'https://cdn.example.test/scoreboard.png';

/**
 * A source that outgrows one multipart part, so the copy takes the resumable
 * path. Shared because every test only reads it and a part is 16 MiB.
 */
const oversizedRemoteSource = (() => {
	const bytes = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 4096);
	bytes.set(transparentPixelPng, 0);
	return bytes;
})();

let harness: SqliteD1Harness;

/**
 * A remote copy against the real catalogue, so the checkpoint's SQL — taking it,
 * and clearing it by binding null — is exercised as deployed rather than through
 * the in-memory double.
 */
function createRemoteCopyLibrary() {
	const delegate = createInMemoryStagingGraphicsObjectStore();
	const uploadIds: GraphicsMultipartUploadIdentity[] = [];
	const staging: InMemoryGraphicsStagingObjectStore = {
		...delegate,
		async beginMultipart(input) {
			const started = await delegate.beginMultipart(input);
			if (started.outcome === 'started')
				uploadIds.push(started.upload.uploadId);
			return started;
		},
	};
	const catalogue = createD1GraphicsAssetCatalogue(harness.database);
	let nextIdentity = 0;
	const library = createGraphicsAssetLibrary({
		catalogue,
		staging,
		canonical: createInMemoryCanonicalGraphicsObjectStore(),
		remoteSource: createGraphicsRemoteSourceFetcher({
			resolver: {
				async resolve() {
					return { outcome: 'resolved', addresses: ['93.184.216.34'] };
				},
			},
			// No declared length, so the copy discovers it while reading.
			async fetch() {
				return new Response(oversizedRemoteSource, { status: 200 });
			},
		}),
		now: () => new Date('2026-07-30T04:00:00.000Z'),
		generateIdentity: () => `identity-${++nextIdentity}`,
	});
	return { library, catalogue, staging, uploadIds };
}

/**
 * A copy that died holding its multipart upload: the part fails and the
 * request's own abort cannot land either.
 */
async function strandRemoteCopyMultipartUpload() {
	const context = createRemoteCopyLibrary();
	const operation = await context.library.initiateRemoteGraphicAssetCopy({
		idempotencyKey: 'remote-copy-retry',
		initiatedBy: 'graphics-author-1',
		name: 'Interrupted remote source',
		sourceFileName: 'scoreboard.png',
	});
	context.staging.injectTransientFailure('multipart-upload-part');
	context.staging.injectTransientFailure('multipart-abort');
	await context.library.copyRemoteGraphicAssetSource({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		sourceUrl: SOURCE_URL,
	});
	return {
		...context,
		operation,
		identity: graphicsObjectIdentity(`ingestion/${operation.id}/source`),
	};
}

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => await harness.close());

describe('approved remote HTTPS copy against the D1 catalogue', () => {
	it('aborts the stranded upload of a previous attempt before starting another', async () => {
		const context = await strandRemoteCopyMultipartUpload();
		const [stranded] = context.uploadIds;
		await expect(context.catalogue.getGraphicAssetMultipartState(
			context.operation.id,
			context.operation.initiatedBy,
		)).resolves.toMatchObject({ uploadId: stranded });

		const retried = await context.library.copyRemoteGraphicAssetSource({
			operationId: context.operation.id,
			initiatedBy: context.operation.initiatedBy,
			sourceUrl: SOURCE_URL,
		});

		// The retry took an upload of its own, so the checkpoint could only name
		// one of the two: the first has to be reclaimed rather than forgotten.
		expect(context.uploadIds).toHaveLength(2);
		await expect(context.staging.resumeMultipart(context.identity, stranded!))
			.resolves
			.toMatchObject({ outcome: 'unavailable' });
		expect(retried).toMatchObject({
			transferredByteLength: oversizedRemoteSource.byteLength,
		});
		await expect(context.catalogue.getGraphicAssetMultipartState(
			context.operation.id,
			context.operation.initiatedBy,
		)).resolves.toBeUndefined();
	});

	it('refuses to start another upload while the stranded one cannot be aborted', async () => {
		const context = await strandRemoteCopyMultipartUpload();
		const [stranded] = context.uploadIds;

		context.staging.injectTransientFailure('multipart-abort');
		await expect(context.library.copyRemoteGraphicAssetSource({
			operationId: context.operation.id,
			initiatedBy: context.operation.initiatedBy,
			sourceUrl: SOURCE_URL,
		})).rejects.toMatchObject({ code: 'graphics-asset-library-unavailable' });

		// Nothing new was started, so the checkpoint still names the upload a
		// later sweep has to reclaim.
		expect(context.uploadIds).toHaveLength(1);
		await expect(context.staging.resumeMultipart(context.identity, stranded!))
			.resolves
			.toMatchObject({ outcome: 'resumed' });
		await expect(context.catalogue.getGraphicAssetMultipartState(
			context.operation.id,
			context.operation.initiatedBy,
		)).resolves.toMatchObject({ uploadId: stranded });
	});
});

import type {
	GraphicsObjectIdentity,
	InMemoryGraphicsStagingObjectStore,
} from '~~/server/modules/graphics-asset-library/object-store';
import type { GraphicsOperationalQueueId } from '~~/shared/utils/graphicsOperationalQueues';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	graphicsObjectIdentity,
	unavailableObjectStoreOutcome,
} from '~~/server/modules/graphics-asset-library/object-store';
import { evidenceOf } from '~~/test/helpers/graphicsEvidence';
import { digestOf, replacementPng as otherPng, pixelPng } from '~~/test/helpers/graphicsFixtures';
import { createTestGraphicsLibrary, DAY, HOUR, ingestImage, stagedSourceIdentity } from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/** A terminal operation owes the release of its staged input until the store confirms the deletes (#700). */

/** Declared as a PNG, but no decoder will accept it: a permanent rejection. */
const notAPng = Uint8Array.from({ length: 64 }, (_, index) => (index * 37) % 251);

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => await harness.close());

function createLibrary() {
	const store = createInMemoryStagingGraphicsObjectStore();
	/** Identities whose deletes the store refuses, so one release can land partway. */
	const refusedDeletes = new Set<GraphicsObjectIdentity>();
	const staging: InMemoryGraphicsStagingObjectStore = {
		...store,
		async delete(identity) {
			return refusedDeletes.has(identity)
				? unavailableObjectStoreOutcome()
				: await store.delete(identity);
		},
	};
	return {
		...createTestGraphicsLibrary({
			catalogue: createD1GraphicsAssetCatalogue(harness.database),
			staging,
			start: '2026-10-21T00:00:00.000Z',
			identityPrefix: 'terminal-release',
		}),
		refusedDeletes,
	};
}

type Context = ReturnType<typeof createLibrary>;

function ingest(context: Context, options: { idempotencyKey: string; bytes?: Uint8Array }) {
	return ingestImage(context, { initiatedBy: 'release-author', ...options });
}
const stagedSource = stagedSourceIdentity;

/** A publication that fails retryably, so its staged source stays needed. */
async function ingestRetryablyFailed(context: Context, idempotencyKey: string, bytes = pixelPng) {
	context.canonical.injectTransientFailure('create', 2);
	const failed = await ingest(context, { idempotencyKey, bytes });
	expect(failed).toMatchObject({
		stage: 'failed',
		failure: { retryable: true },
	});
	return failed;
}

async function stagedBytesOnBooks(context: Context) {
	const capacity = await context.library.getCapacity();
	return capacity.staging.usedBytes + capacity.staging.reservedBytes;
}

async function unreleasedQueue(context: Context) {
	const overview = await context.library.getOperationalQueues();
	const id: GraphicsOperationalQueueId = 'unreleased-staged-input';
	const queue = overview.queues.find(candidate => candidate.id === id);
	if (!queue)
		throw new Error('No unreleased-staged-input queue in the reading');
	return queue;
}

describe('terminal staged input release', () => {
	it('keeps a completed ingestion\'s unreleased staged input on the books and queued, then releases it on a later sweep', async () => {
		const context = createLibrary();
		context.staging.injectTransientFailure('delete', 2);
		const completed = await ingest(context, { idempotencyKey: 'completed-strand' });

		// The publication is the publication: a failed cleanup never turns it
		// into a failure or hides its result.
		expect(completed).toMatchObject({
			stage: 'completed',
			result: { outcome: 'published' },
		});
		const assetId = completed.result!.assetId;
		await expect(context.staging.readMetadata(stagedSource(completed.id)))
			.resolves
			.toMatchObject({ outcome: 'available' });
		expect(await stagedBytesOnBooks(context)).toBe(pixelPng.byteLength);
		const queue = await unreleasedQueue(context);
		expect(queue.totalCount).toBe(1);
		expect(queue.items[0]).toMatchObject({
			subject: { kind: 'graphics-ingestion-operation', id: completed.id },
			actions: ['retry-release'],
		});
		const inspection = await context.library.inspectOperationalQueueItem({
			queue: 'unreleased-staged-input',
			subjectId: completed.id,
		});
		expect(inspection.detail).toMatchObject({
			kind: 'unreleased-staged-input',
			strand: {
				operationId: completed.id,
				stage: 'completed',
				stagingBytes: pixelPng.byteLength,
			},
		});

		// Forty days on, with the store recovered, ordinary retention reclaims it.
		context.advance(40 * DAY);
		const swept = await context.library.runGraphicsRetention();
		expect(swept.strandedStagedInput).toEqual({ released: 1 });
		await expect(context.staging.readMetadata(stagedSource(completed.id)))
			.resolves
			.toMatchObject({ outcome: 'missing' });
		expect(await stagedBytesOnBooks(context)).toBe(0);
		expect((await unreleasedQueue(context)).totalCount).toBe(0);
		const [released] = await evidenceOf(context.library, {
			categories: ['staged-input-released'],
		});
		expect(released).toMatchObject({
			subject: { kind: 'graphics-ingestion-operation', id: completed.id },
			detail: { bytesFreed: pixelPng.byteLength },
		});

		// The published asset and its canonical bytes are untouched, and the
		// operation still reports exactly what it published.
		await expect(context.canonical.readMetadata(
			graphicsObjectIdentity(`sha256/${digestOf(pixelPng)}`),
		)).resolves.toMatchObject({ outcome: 'available' });
		await expect(context.library.getIngestionOperation({
			operationId: completed.id,
			initiatedBy: completed.initiatedBy,
		})).resolves.toMatchObject({
			stage: 'completed',
			result: { outcome: 'published', assetId },
		});
	});

	it('releases a completed ingestion\'s staged input at once when the deletes land', async () => {
		const context = createLibrary();
		const completed = await ingest(context, { idempotencyKey: 'completed-clean' });

		expect(completed.stage).toBe('completed');
		await expect(context.staging.readMetadata(stagedSource(completed.id)))
			.resolves
			.toMatchObject({ outcome: 'missing' });
		expect(await stagedBytesOnBooks(context)).toBe(0);
		expect((await unreleasedQueue(context)).totalCount).toBe(0);
	});

	it('keeps a cancelled ingestion\'s unreleased staged input queued until the retry action releases it', async () => {
		const context = createLibrary();
		const failed = await ingestRetryablyFailed(context, 'cancelled-strand');

		context.staging.injectTransientFailure('delete', 2);
		const cancelled = await context.library.cancelGraphicsIngestion({
			operationId: failed.id,
			initiatedBy: failed.initiatedBy,
		});
		expect(cancelled.stage).toBe('cancelled');
		await expect(context.staging.readMetadata(stagedSource(failed.id)))
			.resolves
			.toMatchObject({ outcome: 'available' });
		expect(await stagedBytesOnBooks(context)).toBe(pixelPng.byteLength);
		expect((await unreleasedQueue(context)).totalCount).toBe(1);

		// The store is still refusing: the retry reports that honestly and the
		// obligation stays exactly where it was.
		context.staging.injectTransientFailure('delete', 1);
		await expect(context.library.releaseStrandedStagedInput({
			operationId: failed.id,
			actor: 'graphics-admin',
		})).resolves.toEqual({ outcome: 'retryable-unavailable' });
		expect(await stagedBytesOnBooks(context)).toBe(pixelPng.byteLength);
		expect((await unreleasedQueue(context)).totalCount).toBe(1);

		await expect(context.library.releaseStrandedStagedInput({
			operationId: failed.id,
			actor: 'graphics-admin',
		})).resolves.toEqual({ outcome: 'completed', bytesFreed: pixelPng.byteLength });
		await expect(context.staging.readMetadata(stagedSource(failed.id)))
			.resolves
			.toMatchObject({ outcome: 'missing' });
		expect(await stagedBytesOnBooks(context)).toBe(0);
		expect((await unreleasedQueue(context)).totalCount).toBe(0);

		// Repeating the action, or the sweep, finds nothing left to release.
		await expect(context.library.releaseStrandedStagedInput({
			operationId: failed.id,
			actor: 'graphics-admin',
		})).resolves.toEqual({ outcome: 'already-in-state' });
		expect((await context.library.runGraphicsRetention()).strandedStagedInput)
			.toEqual({ released: 0 });
	});

	it('keeps a permanently rejected ingestion\'s unreleased staged input queued until retention releases it', async () => {
		const context = createLibrary();
		context.staging.injectTransientFailure('delete', 2);
		const rejected = await ingest(context, { idempotencyKey: 'rejected-strand', bytes: notAPng });

		expect(rejected).toMatchObject({
			stage: 'failed',
			failure: { code: 'validation-failed', retryable: false },
		});
		await expect(context.staging.readMetadata(stagedSource(rejected.id)))
			.resolves
			.toMatchObject({ outcome: 'available' });
		expect(await stagedBytesOnBooks(context)).toBe(notAPng.byteLength);
		expect((await unreleasedQueue(context)).totalCount).toBe(1);

		context.advance(HOUR);
		expect((await context.library.runGraphicsRetention()).strandedStagedInput)
			.toEqual({ released: 1 });
		await expect(context.staging.readMetadata(stagedSource(rejected.id)))
			.resolves
			.toMatchObject({ outcome: 'missing' });
		expect(await stagedBytesOnBooks(context)).toBe(0);
		expect((await unreleasedQueue(context)).totalCount).toBe(0);
	});

	it('keeps the obligation through a release that lands partway, and finishes it once the rest lands', async () => {
		const context = createLibrary();
		const poster = (operationId: string) =>
			graphicsObjectIdentity(`ingestion/${operationId}/video-poster`);
		// The source delete lands; the store refuses the poster's.
		context.refusedDeletes.add(poster('terminal-release-1'));
		const completed = await ingest(context, { idempotencyKey: 'partial-release' });
		expect(completed.id).toBe('terminal-release-1');

		expect(completed.stage).toBe('completed');
		await expect(context.staging.readMetadata(stagedSource(completed.id)))
			.resolves
			.toMatchObject({ outcome: 'missing' });
		// Half a release is no release: the books and the queue still hold it.
		expect(await stagedBytesOnBooks(context)).toBe(pixelPng.byteLength);
		expect((await unreleasedQueue(context)).totalCount).toBe(1);
		context.advance(HOUR);
		expect((await context.library.runGraphicsRetention()).strandedStagedInput)
			.toEqual({ released: 0 });
		expect(await stagedBytesOnBooks(context)).toBe(pixelPng.byteLength);

		// The rerun deletes what is left; the already-gone source is no failure.
		context.refusedDeletes.clear();
		context.advance(HOUR);
		expect((await context.library.runGraphicsRetention()).strandedStagedInput)
			.toEqual({ released: 1 });
		expect(await stagedBytesOnBooks(context)).toBe(0);
		expect((await unreleasedQueue(context)).totalCount).toBe(0);
	});

	it('releases only the terminal operation\'s staged input, never another operation\'s or canonical content', async () => {
		const context = createLibrary();
		// One published asset, one operation still working from its staged bytes.
		const published = await ingest(context, { idempotencyKey: 'already-published', bytes: otherPng });
		expect(published.stage).toBe('completed');
		const active = await ingestRetryablyFailed(context, 'still-active');

		context.staging.injectTransientFailure('delete', 2);
		const completed = await ingest(context, { idempotencyKey: 'completed-beside-active' });
		expect(completed.stage).toBe('completed');
		expect((await unreleasedQueue(context)).totalCount).toBe(1);

		context.advance(HOUR);
		expect((await context.library.runGraphicsRetention()).strandedStagedInput)
			.toEqual({ released: 1 });
		expect((await context.library.runGraphicsRetention()).strandedStagedInput)
			.toEqual({ released: 0 });

		// The active operation keeps its staged source and its accounting, and
		// can still finish from it.
		await expect(context.staging.readMetadata(stagedSource(active.id)))
			.resolves
			.toMatchObject({ outcome: 'available' });
		expect(await stagedBytesOnBooks(context)).toBe(pixelPng.byteLength);
		for (const bytes of [pixelPng, otherPng]) {
			await expect(context.canonical.readMetadata(
				graphicsObjectIdentity(`sha256/${digestOf(bytes)}`),
			)).resolves.toMatchObject({ outcome: 'available' });
		}
		await expect(context.library.retryGraphicsIngestion({
			operationId: active.id,
			initiatedBy: active.initiatedBy,
		})).resolves.toMatchObject({ stage: 'completed' });
		expect(await stagedBytesOnBooks(context)).toBe(0);
		expect((await unreleasedQueue(context)).totalCount).toBe(0);
	});
});

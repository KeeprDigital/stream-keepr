import type {
	GraphicsMultipartUpload,
	InMemoryGraphicsStagingObjectStore,
} from '~~/server/modules/graphics-asset-library/object-store';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createInMemoryStagingGraphicsObjectStore } from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	GraphicsObjectInputError,
	unavailableObjectStoreOutcome,
} from '~~/server/modules/graphics-asset-library/object-store';
import {
	GRAPHICS_MULTIPART_PART_BYTES,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { pngOfByteLength } from '~~/test/helpers/graphicsFixtures';
import { createTestGraphicsIngestion } from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

/** A valid PNG one byte longer than a multipart part, so it takes two parts. */
function largeValidPng() {
	return pngOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1);
}

function createIngestion(
	staging: InMemoryGraphicsStagingObjectStore = createInMemoryStagingGraphicsObjectStore(),
	catalogue = createD1GraphicsAssetCatalogue(harness.database),
) {
	return createTestGraphicsIngestion({
		catalogue,
		staging,
		identityPrefix: 'multipart-identity',
		start: '2026-07-28T01:00:00.000Z',
	}).ingestion;
}

async function initiateLargeTransfer(
	ingestion: ReturnType<typeof createIngestion>,
	idempotencyKey: string,
) {
	const operation = await ingestion.initiateGraphicsIngestion({
		idempotencyKey,
		initiatedBy: 'graphics-author-1',
		name: 'Large transfer',
		declaredByteLength: GRAPHICS_MULTIPART_PART_BYTES + 1,
	});
	await ingestion.startGraphicAssetMultipartUpload({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
	});
	return operation;
}

describe('resumable image ingestion at the Graphic Asset ingestion seam', () => {
	it('resumes from verified parts, ignores a duplicate part, and publishes through the normal pipeline', async () => {
		const bytes = largeValidPng();
		const ingestion = createIngestion();
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'large-scoreboard-logo',
			initiatedBy: 'graphics-author-1',
			name: 'Large scoreboard logo',
			declaredMime: 'image/png',
			browserDecodeEvidence: {
				outcome: 'decoded',
				sourceDigest: createHash('sha256').update(bytes).digest('hex'),
				width: 1,
				height: 1,
			},
			declaredByteLength: bytes.byteLength,
		});

		const started = await ingestion.startGraphicAssetMultipartUpload({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(started).toMatchObject({
			stage: 'transferring',
			transferredByteLength: 0,
			transfer: {
				method: 'multipart',
				partByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				maximumConcurrentParts: 3,
				partCount: 2,
				completedParts: [],
			},
		});

		const firstPartBytes = bytes.subarray(0, GRAPHICS_MULTIPART_PART_BYTES);
		const afterFirstPart = await ingestion.uploadGraphicAssetMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 1,
			bytes: createBoundedByteStream(firstPartBytes, {
				byteLength: firstPartBytes.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		});
		const reconnected = await ingestion.getIngestionOperation({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(reconnected).toEqual(afterFirstPart);
		expect(reconnected).toMatchObject({
			transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			transfer: {
				completedParts: [
					{
						partNumber: 1,
						partIdentity: `${operation.id}:1`,
						byteLength: GRAPHICS_MULTIPART_PART_BYTES,
					},
				],
			},
		});

		const duplicate = await ingestion.uploadGraphicAssetMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 1,
			bytes: createBoundedByteStream(firstPartBytes, {
				byteLength: firstPartBytes.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		});
		expect(duplicate).toEqual(afterFirstPart);

		const finalPartBytes = bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES);
		await ingestion.uploadGraphicAssetMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 2,
			bytes: createBoundedByteStream(finalPartBytes, {
				byteLength: finalPartBytes.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		});
		const completed = await ingestion.completeGraphicAssetMultipartUpload({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});

		expect(completed).toMatchObject({
			stage: 'completed',
			transferredByteLength: bytes.byteLength,
			result: { outcome: 'published' },
			report: {
				outcome: 'accepted',
				facts: {
					byteLength: bytes.byteLength,
					sha256: createHash('sha256').update(bytes).digest('hex'),
				},
			},
		});
	});

	it('retries an ambiguous part response from the last verified checkpoint', async () => {
		const delegate = createInMemoryStagingGraphicsObjectStore();
		let hideFirstSuccessfulResponse = true;
		const staging: InMemoryGraphicsStagingObjectStore = {
			...delegate,
			async uploadPart(input) {
				const result = await delegate.uploadPart(input);
				if (hideFirstSuccessfulResponse) {
					hideFirstSuccessfulResponse = false;
					return unavailableObjectStoreOutcome();
				}
				return result;
			},
		};
		const ingestion = createIngestion(staging);
		const operation = await initiateLargeTransfer(ingestion, 'ambiguous-part-response');
		const firstPart = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES);

		await expect(ingestion.uploadGraphicAssetMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 1,
			bytes: createBoundedByteStream(firstPart, {
				byteLength: firstPart.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		})).rejects.toMatchObject({ code: 'graphics-asset-library-unavailable' });
		await expect(ingestion.getIngestionOperation({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		})).resolves.toMatchObject({
			transferredByteLength: 0,
			transfer: { completedParts: [] },
		});

		const retried = await ingestion.uploadGraphicAssetMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 1,
			bytes: createBoundedByteStream(firstPart, {
				byteLength: firstPart.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		});
		expect(retried).toMatchObject({
			transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			transfer: {
				completedParts: [
					{ partNumber: 1 },
				],
			},
		});
	});

	// A part whose transfer fails gives its claim back even though a sibling
	// part moved the checkpoint meanwhile, so the client's retry is accepted.
	it.each([
		{
			failure: 'the store answers unavailable',
			fail: (): ReturnType<typeof unavailableObjectStoreOutcome> => unavailableObjectStoreOutcome(),
			refusal: { code: 'graphics-asset-library-unavailable' },
		},
		{
			failure: 'the byte stream of the part throws',
			fail: (): never => {
				throw new GraphicsObjectInputError('Byte stream length mismatch');
			},
			refusal: { message: 'Byte stream length mismatch' },
		},
	])('accepts a part again after $failure while a sibling part completed', async ({ fail, refusal }) => {
		const delegate = createInMemoryStagingGraphicsObjectStore();
		const tail = Uint8Array.of(0);
		const firstPart = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES);
		let failFirstPart = true;
		const staging: InMemoryGraphicsStagingObjectStore = {
			...delegate,
			async uploadPart(input) {
				if (input.partNumber !== 1 || !failFirstPart)
					return await delegate.uploadPart(input);
				failFirstPart = false;
				await uploadPart(2, tail);
				return fail();
			},
		};
		const ingestion = createIngestion(staging);
		const operation = await initiateLargeTransfer(ingestion, 'failed-part-beside-a-sibling');
		function uploadPart(partNumber: number, bytes: Uint8Array) {
			return ingestion.uploadGraphicAssetMultipartPart({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				partNumber,
				bytes: createBoundedByteStream(bytes, {
					byteLength: bytes.byteLength,
					maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				}),
			});
		}

		await expect(uploadPart(1, firstPart)).rejects.toMatchObject(refusal);

		await expect(uploadPart(1, firstPart)).resolves.toMatchObject({
			transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES + 1,
			transfer: {
				completedParts: [
					{ partNumber: 1 },
					{ partNumber: 2 },
				],
			},
		});
	});

	it('says what the catalogue threw when a part meets an unreachable checkpoint (#633)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		let checkpointReachable = true;
		const ingestion = createIngestion(undefined, {
			...catalogue,
			async getGraphicAssetMultipartState(...input) {
				if (!checkpointReachable)
					throw new Error('D1_ERROR: database is locked: SQLITE_BUSY');
				return await catalogue.getGraphicAssetMultipartState(...input);
			},
		});
		const operation = await initiateLargeTransfer(ingestion, 'unreachable-checkpoint');
		checkpointReachable = false;
		const firstPart = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES);

		await expect(ingestion.uploadGraphicAssetMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 1,
			bytes: createBoundedByteStream(firstPart, {
				byteLength: firstPart.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		})).rejects.toMatchObject({
			code: 'graphics-asset-library-unavailable',
			message: 'Graphics multipart checkpoint is temporarily unavailable',
		});
		expect(warn.mock.calls.map(([line]) => JSON.parse(line as string))).toEqual([
			expect.objectContaining({
				message: 'graphics_catalogue_unavailable',
				reason: 'D1_ERROR: database is locked: SQLITE_BUSY',
			}),
		]);
	});

	it('bounds retries per part and aborts multipart state idempotently on cancellation', async () => {
		const delegate = createInMemoryStagingGraphicsObjectStore();
		let abortCount = 0;
		const staging: InMemoryGraphicsStagingObjectStore = {
			...delegate,
			async abortMultipart(upload) {
				abortCount++;
				return await delegate.abortMultipart(upload);
			},
		};
		const ingestion = createIngestion(staging);
		const operation = await initiateLargeTransfer(ingestion, 'bounded-part-retries');
		const firstPart = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES);
		staging.injectTransientFailure('multipart-upload-part', 3);

		for (let attempt = 0; attempt < 3; attempt++) {
			await expect(ingestion.uploadGraphicAssetMultipartPart({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				partNumber: 1,
				bytes: createBoundedByteStream(firstPart, {
					byteLength: firstPart.byteLength,
					maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				}),
			})).rejects.toMatchObject({ code: 'graphics-asset-library-unavailable' });
		}
		await expect(ingestion.uploadGraphicAssetMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 1,
			bytes: createBoundedByteStream(firstPart, {
				byteLength: firstPart.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });

		const cancelled = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		const cancelledAgain = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(cancelled.stage).toBe('cancelled');
		expect(cancelledAgain).toEqual(cancelled);
		expect(abortCount).toBe(1);
	});

	it('durably retries staged-byte cleanup when multipart abort is unavailable', async () => {
		const staging = createInMemoryStagingGraphicsObjectStore();
		const ingestion = createIngestion(staging);
		const operation = await initiateLargeTransfer(ingestion, 'retry-cancelled-cleanup');
		staging.injectTransientFailure('multipart-abort');

		const pending = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(pending).toMatchObject({
			stage: 'cancelled',
			transfer: { cleanupPending: true },
		});

		const cleaned = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(cleaned).toMatchObject({
			stage: 'cancelled',
			transfer: { cleanupPending: false },
		});
	});

	it('finishes cancelled cleanup when the checkpoint names an upload the store no longer holds', async () => {
		const delegate = createInMemoryStagingGraphicsObjectStore();
		let upload: GraphicsMultipartUpload | undefined;
		const staging: InMemoryGraphicsStagingObjectStore = {
			...delegate,
			async beginMultipart(input) {
				const started = await delegate.beginMultipart(input);
				if (started.outcome === 'started')
					upload = started.upload;
				return started;
			},
		};
		const ingestion = createIngestion(staging);
		const operation = await initiateLargeTransfer(ingestion, 'cleanup-upload-already-gone');
		staging.injectTransientFailure('multipart-abort');

		const pending = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(pending).toMatchObject({
			stage: 'cancelled',
			transfer: { cleanupPending: true },
		});

		// Reclaiming the upload out of band leaves the checkpoint naming a gone
		// upload — what a landed abort with a failed checkpoint-clear leaves behind.
		// Every later pass re-aborts it, so reading that as unavailable kept
		// `cleanupPending` true until the 24h sweep.
		expect(upload).toBeDefined();
		await expect(staging.abortMultipart(upload!)).resolves.toEqual({ outcome: 'aborted' });

		const cleaned = await ingestion.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(cleaned).toMatchObject({
			stage: 'cancelled',
			transfer: { cleanupPending: false },
		});
	});
});

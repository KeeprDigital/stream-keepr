import type { InMemoryGraphicsStagingObjectStore } from '~~/server/modules/graphics-asset-library/object-store';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	unavailableObjectStoreOutcome,
} from '~~/server/modules/graphics-asset-library/object-store';
import {
	GRAPHICS_MULTIPART_PART_BYTES,
} from '~~/shared/utils/graphicsAssetCompatibility';

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++)
			value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xFFFFFFFF;
	for (const byte of bytes)
		crc = crcTable[(crc ^ byte) & 0xFF]! ^ (crc >>> 8);
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeUint32(value: number): Uint8Array {
	return Uint8Array.of(
		(value >>> 24) & 0xFF,
		(value >>> 16) & 0xFF,
		(value >>> 8) & 0xFF,
		value & 0xFF,
	);
}

function largeValidPng() {
	const idatOffset = 33;
	const type = new TextEncoder().encode('skPR');
	const payloadLength = GRAPHICS_MULTIPART_PART_BYTES + 1
		- transparentPixelPng.byteLength
		- 12;
	const payload = new Uint8Array(payloadLength);
	const checksumInput = new Uint8Array(type.byteLength + payload.byteLength);
	checksumInput.set(type);
	checksumInput.set(payload, type.byteLength);
	const chunk = new Uint8Array(12 + payload.byteLength);
	chunk.set(writeUint32(payload.byteLength));
	chunk.set(type, 4);
	chunk.set(payload, 8);
	chunk.set(writeUint32(crc32(checksumInput)), chunk.byteLength - 4);
	const result = new Uint8Array(transparentPixelPng.byteLength + chunk.byteLength);
	result.set(transparentPixelPng.subarray(0, idatOffset));
	result.set(chunk, idatOffset);
	result.set(transparentPixelPng.subarray(idatOffset), idatOffset + chunk.byteLength);
	return result;
}

function createLibrary(
	staging: InMemoryGraphicsStagingObjectStore = createInMemoryStagingGraphicsObjectStore(),
) {
	let nextIdentity = 0;
	return createGraphicsAssetLibrary({
		catalogue: createInMemoryGraphicsAssetCatalogue(),
		staging,
		canonical: createInMemoryCanonicalGraphicsObjectStore(),
		generateIdentity: () => `multipart-identity-${++nextIdentity}`,
		now: () => new Date('2026-07-28T01:00:00.000Z'),
	});
}

async function initiateLargeTransfer(
	library: ReturnType<typeof createLibrary>,
	idempotencyKey: string,
) {
	const operation = await library.initiateImageIngestion({
		idempotencyKey,
		initiatedBy: 'graphics-author-1',
		name: 'Large transfer',
		declaredByteLength: GRAPHICS_MULTIPART_PART_BYTES + 1,
	});
	await library.startImageMultipartUpload({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
	});
	return operation;
}

describe('resumable image ingestion through the Graphics Asset Library public module', () => {
	it('resumes from verified parts, ignores a duplicate part, and publishes through the normal pipeline', async () => {
		const bytes = largeValidPng();
		const library = createLibrary();
		const operation = await library.initiateImageIngestion({
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

		const started = await library.startImageMultipartUpload({
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
		const afterFirstPart = await library.uploadImageMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 1,
			bytes: createBoundedByteStream(firstPartBytes, {
				byteLength: firstPartBytes.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		});
		const reconnected = await library.getIngestionOperation({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(reconnected).toEqual(afterFirstPart);
		expect(reconnected).toMatchObject({
			transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			transfer: {
				completedParts: [{
					partNumber: 1,
					partIdentity: `${operation.id}:1`,
					byteLength: GRAPHICS_MULTIPART_PART_BYTES,
				}],
			},
		});

		const duplicate = await library.uploadImageMultipartPart({
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
		await library.uploadImageMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 2,
			bytes: createBoundedByteStream(finalPartBytes, {
				byteLength: finalPartBytes.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		});
		const completed = await library.completeImageMultipartUpload({
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
		const library = createLibrary(staging);
		const operation = await initiateLargeTransfer(library, 'ambiguous-part-response');
		const firstPart = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES);

		await expect(library.uploadImageMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 1,
			bytes: createBoundedByteStream(firstPart, {
				byteLength: firstPart.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		})).rejects.toMatchObject({ code: 'graphics-asset-library-unavailable' });
		await expect(library.getIngestionOperation({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		})).resolves.toMatchObject({
			transferredByteLength: 0,
			transfer: { completedParts: [] },
		});

		const retried = await library.uploadImageMultipartPart({
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
				completedParts: [{ partNumber: 1 }],
			},
		});
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
		const library = createLibrary(staging);
		const operation = await initiateLargeTransfer(library, 'bounded-part-retries');
		const firstPart = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES);
		staging.injectTransientFailure('multipart-upload-part', 3);

		for (let attempt = 0; attempt < 3; attempt++) {
			await expect(library.uploadImageMultipartPart({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				partNumber: 1,
				bytes: createBoundedByteStream(firstPart, {
					byteLength: firstPart.byteLength,
					maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				}),
			})).rejects.toMatchObject({ code: 'graphics-asset-library-unavailable' });
		}
		await expect(library.uploadImageMultipartPart({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			partNumber: 1,
			bytes: createBoundedByteStream(firstPart, {
				byteLength: firstPart.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });

		const cancelled = await library.cancelImageIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		const cancelledAgain = await library.cancelImageIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(cancelled.stage).toBe('cancelled');
		expect(cancelledAgain).toEqual(cancelled);
		expect(abortCount).toBe(1);
	});

	it('durably retries staged-byte cleanup when multipart abort is unavailable', async () => {
		const staging = createInMemoryStagingGraphicsObjectStore();
		const library = createLibrary(staging);
		const operation = await initiateLargeTransfer(library, 'retry-cancelled-cleanup');
		staging.injectTransientFailure('multipart-abort');

		const pending = await library.cancelImageIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(pending).toMatchObject({
			stage: 'cancelled',
			transfer: { cleanupPending: true },
		});

		const cleaned = await library.cancelImageIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(cleaned).toMatchObject({
			stage: 'cancelled',
			transfer: { cleanupPending: false },
		});
	});
});

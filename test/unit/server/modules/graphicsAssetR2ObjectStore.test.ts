import { describe, expect, it, vi } from 'vitest';
import {
	createBoundedByteStream,
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';
import {
	createR2CanonicalGraphicsObjectStore,
	createR2StagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/r2-object-store';

function r2Object(key: string): R2Object {
	return {
		key,
		version: 'version-1',
		size: 5,
		etag: 'etag-1',
		httpEtag: '"etag-1"',
		checksums: { toJSON: () => ({}) },
		uploaded: new Date('2026-07-27T04:00:00.000Z'),
		httpMetadata: { contentType: 'text/plain' },
		customMetadata: { digest: 'example' },
		storageClass: 'Standard',
		writeHttpMetadata: vi.fn(),
	} as R2Object;
}

describe('the R2 Graphic Asset object-store adapter', () => {
	it('does not expose multipart completion from the canonical binding adapter', () => {
		const store = createR2CanonicalGraphicsObjectStore({} as R2Bucket);

		expect('beginMultipart' in store).toBe(false);
		expect('completeMultipart' in store).toBe(false);
	});

	it('uses an atomic create-if-absent header and returns existing metadata on conflict', async () => {
		const identity = graphicsObjectIdentity('canonical/sha256/example');
		const existing = r2Object(identity);
		const put = vi.fn().mockResolvedValue(null);
		const head = vi.fn().mockResolvedValue(existing);
		const bucket = { put, head } as unknown as R2Bucket;
		const store = createR2CanonicalGraphicsObjectStore(bucket);

		const outcome = await store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new TextEncoder().encode('first'), {
				byteLength: 5,
				maximumByteLength: 5,
			}),
			metadata: {
				contentType: 'text/plain',
				custom: { digest: 'example' },
			},
		});

		const options = put.mock.calls[0]?.[2] as R2PutOptions;
		expect(options.onlyIf).toEqual({ etagDoesNotMatch: '*' });
		expect(head).toHaveBeenCalledWith(identity);
		expect(outcome).toEqual({
			outcome: 'already-exists',
			object: {
				identity,
				byteLength: 5,
				contentType: 'text/plain',
				customMetadata: { digest: 'example' },
				uploadedAt: new Date('2026-07-27T04:00:00.000Z'),
			},
		});
	});

	it('rejects deterministic bounded-stream and range errors instead of reporting an outage', async () => {
		const identity = graphicsObjectIdentity('staging/operation/invalid-input');
		const put = vi.fn(async (_key, body: ReadableStream<Uint8Array>) => {
			await new Response(body).arrayBuffer();
			return r2Object(identity);
		});
		const get = vi.fn();
		const store = createR2CanonicalGraphicsObjectStore({ put, get } as unknown as R2Bucket);

		await expect(store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new Uint8Array(4), {
				byteLength: 5,
				maximumByteLength: 5,
			}),
		})).rejects.toThrow('Byte stream length mismatch');
		await expect(store.read(identity, { offset: -1, length: 1 }))
			.rejects
			.toThrow('Range offset must be a non-negative safe integer');
		expect(get).not.toHaveBeenCalled();
	});

	it('completes multipart staging writes without advertising a non-atomic immutability check', async () => {
		const identity = graphicsObjectIdentity('staging/operation/multipart');
		const object = r2Object(identity);
		const complete = vi.fn().mockResolvedValue(object);
		const resumeMultipartUpload = vi.fn().mockReturnValue({
			uploadId: 'upload-1',
			complete,
		});
		const head = vi.fn();
		const store = createR2StagingGraphicsObjectStore({
			head,
			resumeMultipartUpload,
		} as unknown as R2Bucket);

		const outcome = await store.completeMultipart({
			upload: {
				identity,
				uploadId: 'upload-1' as never,
			},
			parts: [{
				partNumber: 1,
				partIdentity: 'etag-1' as never,
				byteLength: 5,
			}],
		});

		expect(head).not.toHaveBeenCalled();
		expect(complete).toHaveBeenCalledWith([{ partNumber: 1, etag: 'etag-1' }]);
		expect(outcome).toMatchObject({ outcome: 'created', object: { identity } });
	});

	it('reads a gone multipart upload as reclaimed and every other refusal as an outage', async () => {
		const identity = graphicsObjectIdentity('staging/operation/multipart');
		async function abortAgainst(rejection: unknown) {
			const abort = vi.fn().mockRejectedValue(rejection);
			const store = createR2StagingGraphicsObjectStore({
				resumeMultipartUpload: vi.fn().mockReturnValue({ uploadId: 'upload-1', abort }),
			} as unknown as R2Bucket);
			const outcome = await store.abortMultipart({ identity, uploadId: 'upload-1' as never });
			expect(abort).toHaveBeenCalled();
			return outcome;
		}

		// R2 answers `NoSuchUpload` (10024) for an upload it no longer holds, which
		// is what a second abort of an already-reclaimed upload gets.
		await expect(abortAgainst(Object.assign(
			new Error('The specified multipart upload does not exist.'),
			{ code: 10024 },
		))).resolves.toEqual({ outcome: 'missing' });
		// The sentence alone is enough: a proxied refusal can lose the numeric code.
		await expect(abortAgainst(
			new Error('The specified multipart upload does not exist.'),
		)).resolves.toEqual({ outcome: 'missing' });
		// Anything else is an outage. Reading these as reclaimed would clear a
		// checkpoint whose upload is still held, which is what strands one.
		await expect(abortAgainst(Object.assign(
			new Error('We encountered an internal error. Please try again.'),
			{ code: 10001 },
		))).resolves.toMatchObject({ outcome: 'unavailable' });
		await expect(abortAgainst(new Error('Network connection lost.')))
			.resolves
			.toMatchObject({ outcome: 'unavailable' });
		await expect(abortAgainst('not an error at all'))
			.resolves
			.toMatchObject({ outcome: 'unavailable' });
	});
});

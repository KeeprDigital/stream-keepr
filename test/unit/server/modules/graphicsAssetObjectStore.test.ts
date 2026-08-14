import { describe, expect, it } from 'vitest';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';

describe('the Graphic Asset object-store contract', () => {
	it('does not expose staging multipart capabilities from the canonical adapter', () => {
		const store = createInMemoryCanonicalGraphicsObjectStore();

		expect('beginMultipart' in store).toBe(false);
		expect('completeMultipart' in store).toBe(false);
	});

	it('creates bytes immutably and reports the existing object on a repeated identity', async () => {
		const store = createInMemoryCanonicalGraphicsObjectStore();
		const identity = graphicsObjectIdentity('canonical/sha256/example');

		const created = await store.createImmutable({
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
		const repeated = await store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new TextEncoder().encode('second'), {
				byteLength: 6,
				maximumByteLength: 6,
			}),
			metadata: {
				contentType: 'text/plain',
				custom: { digest: 'different' },
			},
		});

		expect(created).toMatchObject({
			outcome: 'created',
			object: {
				identity,
				byteLength: 5,
				contentType: 'text/plain',
				customMetadata: { digest: 'example' },
			},
		});
		expect(repeated).toEqual({
			outcome: 'already-exists',
			object: created.outcome === 'created' ? created.object : undefined,
		});
	});

	it('preserves the first immutable object when creates race for one identity', async () => {
		const store = createInMemoryCanonicalGraphicsObjectStore();
		const identity = graphicsObjectIdentity('canonical/sha256/concurrent');
		const firstBytes = new TextEncoder().encode('first');
		const secondBytes = new TextEncoder().encode('second');

		const [first, second] = await Promise.all([
			store.createImmutable({
				identity,
				bytes: createBoundedByteStream(firstBytes, {
					byteLength: firstBytes.byteLength,
					maximumByteLength: firstBytes.byteLength,
				}),
			}),
			store.createImmutable({
				identity,
				bytes: createBoundedByteStream(secondBytes, {
					byteLength: secondBytes.byteLength,
					maximumByteLength: secondBytes.byteLength,
				}),
			}),
		]);

		expect([first.outcome, second.outcome].toSorted()).toEqual(['already-exists', 'created']);
		const createdBytes = first.outcome === 'created' ? 'first' : 'second';
		const read = await store.read(identity);
		expect(read.outcome).toBe('available');
		if (read.outcome === 'available')
			expect(await new Response(read.body).text()).toBe(createdBytes);
	});

	it('reads metadata and exact byte ranges without conflating a missing object', async () => {
		const store = createInMemoryCanonicalGraphicsObjectStore();
		const identity = graphicsObjectIdentity('canonical/sha256/ranged');
		await store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new TextEncoder().encode('first'), {
				byteLength: 5,
				maximumByteLength: 5,
			}),
		});

		const metadata = await store.readMetadata(identity);
		const ranged = await store.read(identity, { offset: 1, length: 3 });
		const overlongTail = await store.read(identity, { offset: 3, length: 99 });
		const missing = await store.read(graphicsObjectIdentity('canonical/sha256/missing'));

		expect(metadata).toMatchObject({
			outcome: 'available',
			object: { identity, byteLength: 5 },
		});
		expect(ranged.outcome).toBe('available');
		if (ranged.outcome === 'available') {
			expect(ranged.range).toEqual({ offset: 1, length: 3, completeLength: 5 });
			expect(await new Response(ranged.body).text()).toBe('irs');
		}
		expect(overlongTail.outcome).toBe('available');
		if (overlongTail.outcome === 'available') {
			expect(overlongTail.range).toEqual({ offset: 3, length: 2, completeLength: 5 });
			expect(await new Response(overlongTail.body).text()).toBe('st');
		}
		expect(missing).toEqual({ outcome: 'missing' });
	});

	it('distinguishes unavailable bytes and supports injected transient failures', async () => {
		const store = createInMemoryCanonicalGraphicsObjectStore();
		const identity = graphicsObjectIdentity('canonical/sha256/unavailable');
		await store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new TextEncoder().encode('bytes'), {
				byteLength: 5,
				maximumByteLength: 5,
			}),
		});

		store.markUnavailable(identity);
		expect(await store.readMetadata(identity)).toEqual({
			outcome: 'unavailable',
			reason: { code: 'object-unavailable', retryable: true },
		});
		expect(await store.read(identity)).toEqual({
			outcome: 'unavailable',
			reason: { code: 'object-unavailable', retryable: true },
		});

		store.restore(identity);
		store.injectTransientFailure('read', 2);
		expect(await store.read(identity)).toEqual({
			outcome: 'unavailable',
			reason: { code: 'transient-object-store-failure', retryable: true },
		});
		expect(await store.read(identity)).toEqual({
			outcome: 'unavailable',
			reason: { code: 'transient-object-store-failure', retryable: true },
		});
		expect((await store.read(identity)).outcome).toBe('available');
	});

	it('reports transient store health failures independently of object state', async () => {
		const store = createInMemoryCanonicalGraphicsObjectStore();

		expect(await store.checkHealth()).toEqual({ outcome: 'healthy' });
		store.injectTransientFailure('health');
		expect(await store.checkHealth()).toEqual({
			outcome: 'unavailable',
			reason: { code: 'transient-object-store-failure', retryable: true },
		});
		expect(await store.checkHealth()).toEqual({ outcome: 'healthy' });
	});

	it('injects transient failures into mutation operations without committing partial state', async () => {
		const store = createInMemoryCanonicalGraphicsObjectStore();
		const identity = graphicsObjectIdentity('canonical/sha256/transient-create');
		store.injectTransientFailure('create');

		expect(await store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new TextEncoder().encode('first'), {
				byteLength: 5,
				maximumByteLength: 5,
			}),
		})).toEqual({
			outcome: 'unavailable',
			reason: { code: 'transient-object-store-failure', retryable: true },
		});
		expect(await store.readMetadata(identity)).toEqual({ outcome: 'missing' });

		expect(await store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new TextEncoder().encode('first'), {
				byteLength: 5,
				maximumByteLength: 5,
			}),
		})).toMatchObject({ outcome: 'created' });
	});

	it('rejects bytes outside the declared stream bounds without reserving the identity', async () => {
		const store = createInMemoryCanonicalGraphicsObjectStore();
		const identity = graphicsObjectIdentity('canonical/sha256/bounded');

		expect(() => createBoundedByteStream(new Uint8Array(6), {
			byteLength: 6,
			maximumByteLength: 5,
		})).toThrow('Byte stream exceeds its maximum byte length');

		await expect(store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new Uint8Array(4), {
				byteLength: 5,
				maximumByteLength: 5,
			}),
		})).rejects.toThrow('Byte stream length mismatch');

		await expect(store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new Uint8Array(5), {
				byteLength: 5,
				maximumByteLength: 5,
			}),
		})).resolves.toMatchObject({ outcome: 'created' });
	});

	it('resumes multipart uploads, completes ordered parts, and deletes the result', async () => {
		const store = createInMemoryStagingGraphicsObjectStore();
		const identity = graphicsObjectIdentity('staging/operation/multipart');
		const started = await store.beginMultipart({
			identity,
			metadata: { contentType: 'application/octet-stream' },
		});
		expect(started.outcome).toBe('started');
		if (started.outcome !== 'started')
			throw new Error('Expected multipart upload to start');

		const resumed = await store.resumeMultipart(identity, started.upload.uploadId);
		expect(resumed).toEqual({ outcome: 'resumed', upload: started.upload });
		if (resumed.outcome !== 'resumed')
			throw new Error('Expected multipart upload to resume');

		const second = await store.uploadPart({
			upload: resumed.upload,
			partNumber: 2,
			bytes: createBoundedByteStream(new TextEncoder().encode('part-2'), {
				byteLength: 6,
				maximumByteLength: 6,
			}),
		});
		const first = await store.uploadPart({
			upload: resumed.upload,
			partNumber: 1,
			bytes: createBoundedByteStream(new TextEncoder().encode('part-1/'), {
				byteLength: 7,
				maximumByteLength: 7,
			}),
		});
		expect(first.outcome).toBe('uploaded');
		expect(second.outcome).toBe('uploaded');
		if (first.outcome !== 'uploaded' || second.outcome !== 'uploaded')
			throw new Error('Expected both parts to upload');

		const completed = await store.completeMultipart({
			upload: resumed.upload,
			parts: [first.part, second.part],
		});
		expect(completed).toMatchObject({
			outcome: 'created',
			object: { identity, byteLength: 13 },
		});

		const read = await store.read(identity);
		expect(read.outcome).toBe('available');
		if (read.outcome === 'available')
			expect(await new Response(read.body).text()).toBe('part-1/part-2');

		expect(await store.delete(identity)).toEqual({ outcome: 'deleted' });
		expect(await store.delete(identity)).toEqual({ outcome: 'missing' });
	});

	it('separates an upload that is already gone from a store that cannot answer', async () => {
		const store = createInMemoryStagingGraphicsObjectStore();
		const identity = graphicsObjectIdentity('staging/operation/aborted-twice');
		const started = await store.beginMultipart({ identity });
		if (started.outcome !== 'started')
			throw new Error('Expected multipart upload to start');

		expect(await store.abortMultipart(started.upload)).toEqual({ outcome: 'aborted' });
		// The second abort is the one a stranded checkpoint performs on every
		// retry. Reported as unavailable it refused forever; reported as missing
		// the caller can clear the checkpoint that names it.
		expect(await store.abortMultipart(started.upload)).toEqual({ outcome: 'missing' });
		// A different identity under the same upload id is the same fact: this
		// store does not hold the upload that was asked about.
		expect(await store.abortMultipart({
			identity: graphicsObjectIdentity('staging/operation/somewhere-else'),
			uploadId: started.upload.uploadId,
		})).toEqual({ outcome: 'missing' });

		// Unavailability keeps its own answer, so the two are never conflated.
		const live = await store.beginMultipart({ identity });
		if (live.outcome !== 'started')
			throw new Error('Expected the second multipart upload to start');
		store.injectTransientFailure('multipart-abort');
		expect(await store.abortMultipart(live.upload)).toMatchObject({
			outcome: 'unavailable',
			reason: { retryable: true },
		});
		expect(await store.abortMultipart(live.upload)).toEqual({ outcome: 'aborted' });
	});

	it('treats multipart completion as a staging write rather than an immutable create', async () => {
		const store = createInMemoryStagingGraphicsObjectStore();
		const identity = graphicsObjectIdentity('staging/operation/replaced-by-multipart');
		await store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new TextEncoder().encode('old'), {
				byteLength: 3,
				maximumByteLength: 3,
			}),
		});
		const started = await store.beginMultipart({ identity });
		if (started.outcome !== 'started')
			throw new Error('Expected multipart upload to start');
		const part = await store.uploadPart({
			upload: started.upload,
			partNumber: 1,
			bytes: createBoundedByteStream(new TextEncoder().encode('new'), {
				byteLength: 3,
				maximumByteLength: 3,
			}),
		});
		if (part.outcome !== 'uploaded')
			throw new Error('Expected multipart part to upload');

		await expect(store.completeMultipart({
			upload: started.upload,
			parts: [part.part],
		})).resolves.toMatchObject({ outcome: 'created' });

		const read = await store.read(identity);
		expect(read.outcome).toBe('available');
		if (read.outcome === 'available')
			expect(await new Response(read.body).text()).toBe('new');
	});
});

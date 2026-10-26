import type { MiniflareR2Harness } from '~~/test/helpers/miniflareR2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import { createBoundedByteStream, graphicsObjectIdentity } from '~~/server/modules/graphics-asset-library/object-store';
import {
	createR2CanonicalGraphicsObjectStore,
	createR2StagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/r2-object-store';
import { boundedBytes } from '~~/test/helpers/graphicsLibrary';
import { createMiniflareR2Harness } from '~~/test/helpers/miniflareR2';

const text = (value: string) => new TextEncoder().encode(value);

/** R2 refuses a non-final multipart part under 5 MiB, so the first part is padded to that. */
const FIRST_PART = new Uint8Array(5 * 1024 * 1024).fill(0x61);

let r2: MiniflareR2Harness;

beforeAll(async () => {
	r2 = await createMiniflareR2Harness();
}, 60_000);

afterAll(async () => await r2?.dispose());

it('refuses a stream longer than its declared maximum before any store sees it', () => {
	expect(() => createBoundedByteStream(new Uint8Array(6), { byteLength: 6, maximumByteLength: 5 }))
		.toThrow('Byte stream exceeds its maximum byte length');
});

// The same contract over the in-memory double every library suite runs on and the
// R2 adapter production runs on, so the double cannot drift from the real store.
describe.each([
	{
		store: 'the in-memory double',
		canonical: () => createInMemoryCanonicalGraphicsObjectStore(),
		staging: () => createInMemoryStagingGraphicsObjectStore(),
	},
	{
		store: 'the R2 adapter on Miniflare',
		canonical: () => createR2CanonicalGraphicsObjectStore(r2.bucket),
		staging: () => createR2StagingGraphicsObjectStore(r2.bucket),
	},
])('the Graphic Asset object-store contract on $store', ({ store: label, canonical, staging }) => {
	const at = (path: string) => graphicsObjectIdentity(`${label.replaceAll(' ', '-')}/${path}`);

	it('does not expose staging multipart capabilities from the canonical adapter', () => {
		const store = canonical();

		expect('beginMultipart' in store).toBe(false);
		expect('completeMultipart' in store).toBe(false);
	});

	it('creates bytes immutably and reports the existing object on a repeated identity', async () => {
		const store = canonical();
		const identity = at('canonical/sha256/example');

		const created = await store.createImmutable({
			identity,
			bytes: boundedBytes(text('first')),
			metadata: {
				contentType: 'text/plain',
				custom: { digest: 'example' },
			},
		});
		const repeated = await store.createImmutable({
			identity,
			bytes: boundedBytes(text('second')),
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
		expect(repeated).toMatchObject({
			outcome: 'already-exists',
			object: { identity, byteLength: 5 },
		});
	});

	it('preserves the first immutable object when creates race for one identity', async () => {
		const store = canonical();
		const identity = at('canonical/sha256/concurrent');

		const [first, second] = await Promise.all([
			store.createImmutable({
				identity,
				bytes: boundedBytes(text('first')),
			}),
			store.createImmutable({
				identity,
				bytes: boundedBytes(text('second')),
			}),
		]);

		expect([first.outcome, second.outcome].toSorted()).toEqual(['already-exists', 'created']);
		const read = await store.read(identity);
		if (read.outcome !== 'available')
			throw new Error(`Expected the raced object, got ${read.outcome}`);
		expect(await new Response(read.body).text()).toBe(first.outcome === 'created'
			? 'first'
			: 'second');
	});

	it('reads metadata and exact byte ranges without conflating a missing object', async () => {
		const store = canonical();
		const identity = at('canonical/sha256/ranged');
		await store.createImmutable({
			identity,
			bytes: boundedBytes(text('first')),
		});

		const ranged = await store.read(identity, { offset: 1, length: 3 });
		const overlongTail = await store.read(identity, { offset: 3, length: 99 });
		if (ranged.outcome !== 'available' || overlongTail.outcome !== 'available')
			throw new Error('Expected both ranges to be available');

		await expect(store.readMetadata(identity)).resolves.toMatchObject({
			outcome: 'available',
			object: { identity, byteLength: 5 },
		});
		expect(ranged.range).toEqual({ offset: 1, length: 3, completeLength: 5 });
		expect(await new Response(ranged.body).text()).toBe('irs');
		expect(overlongTail.range).toEqual({ offset: 3, length: 2, completeLength: 5 });
		expect(await new Response(overlongTail.body).text()).toBe('st');
		await expect(store.read(at('canonical/sha256/missing'))).resolves.toEqual({ outcome: 'missing' });
	});

	it('refuses a stream shorter than it declared without reserving the identity', async () => {
		const store = canonical();
		const identity = at('canonical/sha256/bounded');

		await expect(store.createImmutable({
			identity,
			bytes: createBoundedByteStream(new Uint8Array(4), { byteLength: 5, maximumByteLength: 5 }),
		})).rejects.toThrow('Byte stream length mismatch');
		await expect(store.createImmutable({
			identity,
			bytes: boundedBytes(new Uint8Array(5)),
		}))
			.resolves
			.toMatchObject({ outcome: 'created' });
	});

	it('resumes multipart uploads, completes ordered parts, and deletes the result', async () => {
		const store = staging();
		const identity = at('staging/operation/multipart');
		const started = await store.beginMultipart({
			identity,
			metadata: { contentType: 'application/octet-stream' },
		});
		if (started.outcome !== 'started')
			throw new Error('Expected multipart upload to start');

		const resumed = await store.resumeMultipart(identity, started.upload.uploadId);
		expect(resumed).toEqual({ outcome: 'resumed', upload: started.upload });
		if (resumed.outcome !== 'resumed')
			throw new Error('Expected multipart upload to resume');

		// Uploaded out of order; completion orders them by part number.
		const second = await store.uploadPart({
			upload: resumed.upload,
			partNumber: 2,
			bytes: boundedBytes(text('part-2')),
		});
		const first = await store.uploadPart({
			upload: resumed.upload,
			partNumber: 1,
			bytes: boundedBytes(FIRST_PART),
		});
		if (first.outcome !== 'uploaded' || second.outcome !== 'uploaded')
			throw new Error('Expected both parts to upload');

		await expect(store.completeMultipart({
			upload: resumed.upload,
			parts: [first.part, second.part],
		}))
			.resolves
			.toMatchObject({
				outcome: 'created',
				object: { identity, byteLength: FIRST_PART.byteLength + 6 },
			});
		const read = await store.read(identity, { offset: FIRST_PART.byteLength - 1, length: 7 });
		if (read.outcome !== 'available')
			throw new Error('Expected the completed object');
		expect(await new Response(read.body).text()).toBe('apart-2');

		expect(await store.delete(identity)).toEqual({ outcome: 'deleted' });
		expect(await store.delete(identity)).toEqual({ outcome: 'missing' });
	});

	it('treats multipart completion as a staging write rather than an immutable create', async () => {
		const store = staging();
		const identity = at('staging/operation/replaced-by-multipart');
		await store.createImmutable({
			identity,
			bytes: boundedBytes(text('old')),
		});
		const started = await store.beginMultipart({ identity });
		if (started.outcome !== 'started')
			throw new Error('Expected multipart upload to start');
		const part = await store.uploadPart({
			upload: started.upload,
			partNumber: 1,
			bytes: boundedBytes(text('new')),
		});
		if (part.outcome !== 'uploaded')
			throw new Error('Expected multipart part to upload');

		await expect(store.completeMultipart({
			upload: started.upload,
			parts: [part.part],
		}))
			.resolves
			.toMatchObject({ outcome: 'created' });
		const read = await store.read(identity);
		if (read.outcome !== 'available')
			throw new Error('Expected the replaced object');
		expect(await new Response(read.body).text()).toBe('new');
	});
});

// Not in the contract above: Miniflare accepts a repeated abort and fails a mismatched
// key with an internal error, where R2 answers NoSuchUpload (10024). The adapter's
// mapping of that answer to `missing` is pinned in graphicsAssetR2ObjectStore.test.ts.
it('reports an upload that is already gone as missing, however it is named', async () => {
	const store = createInMemoryStagingGraphicsObjectStore();
	const identity = graphicsObjectIdentity('staging/operation/aborted-twice');
	const started = await store.beginMultipart({ identity });
	if (started.outcome !== 'started')
		throw new Error('Expected multipart upload to start');

	expect(await store.abortMultipart(started.upload)).toEqual({ outcome: 'aborted' });
	// A stranded checkpoint retries this abort; `missing` lets it clear the checkpoint.
	expect(await store.abortMultipart(started.upload)).toEqual({ outcome: 'missing' });
	expect(await store.abortMultipart({
		identity: graphicsObjectIdentity('staging/operation/somewhere-else'),
		uploadId: started.upload.uploadId,
	})).toEqual({ outcome: 'missing' });
});

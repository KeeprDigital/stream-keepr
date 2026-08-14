import type {
	GraphicsMultipartUploadIdentity,
	InMemoryGraphicsStagingObjectStore,
} from '~~/server/modules/graphics-asset-library/object-store';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	consumeBoundedByteStream,
	createBoundedByteStream,
	graphicsObjectIdentity,
	unavailableObjectStoreOutcome,
} from '~~/server/modules/graphics-asset-library/object-store';
import { createGraphicsRemoteSourceFetcher } from '~~/server/modules/graphics-asset-library/remote-source';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import {
	GRAPHICS_MULTIPART_PART_BYTES,
	MAX_STILL_IMAGE_INGESTION_BYTES,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { publicServerFailure } from '~~/test/helpers/publicServerFailure';

// The API boundary imports the author session for its actor resolution, which
// reaches `hub:kv` — a binding no unit run has. Nothing here asks it anything.
vi.mock('~~/server/modules/graphics-author-session', () => ({
	optionalGraphicsAuthorSession: vi.fn(),
}));

// `rethrowGraphicsAssetApiError` reaches Nitro's auto-imported `createError`
// and, on its 503 branch, `setResponseHeader` — neither of which a unit run
// has. Nothing in the library module calls either.
vi.stubGlobal('createError', (input: { statusCode: number; message: string; cause?: unknown }) =>
	Object.assign(new Error(input.message), input));
const mockSetResponseHeader = vi.fn();
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

function sourceDigest(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

interface RemoteHop {
	status?: number;
	location?: string;
	body?: Uint8Array<ArrayBuffer>;
	/** `null` omits the header entirely. */
	contentLength?: string | null;
	contentType?: string;
	/**
	 * Delivers the body and then errors the stream, so the copy's own read throws
	 * rather than any store call answering `unavailable`. A connection dropped
	 * mid-transfer is the ordinary way that happens.
	 */
	failsAfterBody?: boolean;
}

/**
 * A controlled remote host. Each URL answers once per entry, so redirect chains
 * and hop revalidation are observable without reaching the network.
 */
function createRemoteHost(options: {
	hops?: Record<string, RemoteHop>;
	addresses?: Record<string, string[]>;
	unresolvable?: string[];
	resolverUnavailable?: string[];
	body?: Uint8Array<ArrayBuffer>;
}) {
	const requests: { url: string; headers: Record<string, string> }[] = [];
	const resolved: string[] = [];
	const body = options.body ?? transparentPixelPng;
	const hops = options.hops ?? {
		'https://cdn.example.test/scoreboard.png': { body },
	};

	const fetcher = createGraphicsRemoteSourceFetcher({
		resolver: {
			async resolve(hostname) {
				resolved.push(hostname);
				if (options.resolverUnavailable?.includes(hostname))
					return { outcome: 'unavailable' };
				if (options.unresolvable?.includes(hostname))
					return { outcome: 'not-found' };
				return {
					outcome: 'resolved',
					addresses: options.addresses?.[hostname] ?? ['93.184.216.34'],
				};
			},
		},
		async fetch(request) {
			const url = new URL(request.url);
			requests.push({
				url: request.url,
				headers: Object.fromEntries(request.headers.entries()),
			});
			const hop = hops[`${url.origin}${url.pathname}`];
			if (!hop)
				return new Response(null, { status: 404 });
			if (hop.location) {
				return new Response(null, {
					status: hop.status ?? 302,
					headers: { location: hop.location },
				});
			}
			const payload = hop.body ?? body;
			if (hop.failsAfterBody) {
				let delivered = false;
				// Errored from `pull` rather than after an `enqueue`: erroring a stream
				// discards whatever is queued, so a body enqueued and then errored in
				// one turn never reaches the reader at all.
				const failing = new ReadableStream<Uint8Array>({
					pull(controller) {
						if (delivered) {
							controller.error(new Error('Remote source connection reset'));
							return;
						}
						delivered = true;
						controller.enqueue(payload);
					},
				});
				return new Response(failing, {
					status: hop.status ?? 200,
					headers: hop.contentLength === null
						? {}
						: { 'content-length': hop.contentLength ?? String(payload.byteLength) },
				});
			}
			return new Response(payload, {
				status: hop.status ?? 200,
				headers: {
					...(hop.contentLength === null
						? {}
						: { 'content-length': hop.contentLength ?? String(payload.byteLength) }),
					...(hop.contentType ? { 'content-type': hop.contentType } : {}),
				},
			});
		},
	});
	return { fetcher, requests, resolved };
}

function createLibrary(
	options: Parameters<typeof createRemoteHost>[0] & {
		staging?: InMemoryGraphicsStagingObjectStore;
	} = {},
) {
	const staging = options.staging ?? createInMemoryStagingGraphicsObjectStore();
	const canonical = createInMemoryCanonicalGraphicsObjectStore();
	const catalogue = createInMemoryGraphicsAssetCatalogue();
	const remote = createRemoteHost(options);
	let nextIdentity = 0;
	const library = createGraphicsAssetLibrary({
		catalogue,
		staging,
		canonical,
		remoteSource: remote.fetcher,
		generateIdentity: () => `identity-${++nextIdentity}`,
		now: () => new Date('2026-07-30T04:00:00.000Z'),
	});
	return { library, staging, canonical, catalogue, remote };
}

/**
 * A source that outgrows one multipart part, so the resumable path is taken.
 * Shared because every test only reads it and a part is 16 MiB.
 */
const oversizedRemoteSource = (() => {
	const bytes = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 4096);
	bytes.set(transparentPixelPng, 0);
	return bytes;
})();

/**
 * A remote copy whose multipart upload outlives the request that started it:
 * the first part fails and the request's own abort cannot land either, which is
 * what a worker death leaves behind for a later sweep to reclaim.
 */
async function strandRemoteCopyMultipartUpload(idempotencyKey: string) {
	const delegate = createInMemoryStagingGraphicsObjectStore();
	let uploadId: GraphicsMultipartUploadIdentity | undefined;
	const staging: InMemoryGraphicsStagingObjectStore = {
		...delegate,
		async beginMultipart(input) {
			const started = await delegate.beginMultipart(input);
			if (started.outcome === 'started')
				uploadId = started.upload.uploadId;
			return started;
		},
	};
	const { library, catalogue } = createLibrary({
		staging,
		hops: {
			'https://cdn.example.test/scoreboard.png': {
				body: oversizedRemoteSource,
				contentLength: null,
			},
		},
	});
	const operation = await library.initiateRemoteGraphicAssetCopy({
		idempotencyKey,
		initiatedBy: 'graphics-author-1',
		name: 'Interrupted remote source',
		sourceFileName: 'scoreboard.png',
	});
	staging.injectTransientFailure('multipart-upload-part');
	staging.injectTransientFailure('multipart-abort');
	const failed = await library.copyRemoteGraphicAssetSource({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		sourceUrl: 'https://cdn.example.test/scoreboard.png',
	});
	return { library, catalogue, staging, operation, failed, uploadId };
}

describe('approved remote HTTPS copy through the Graphics Asset Library public module', () => {
	it('publishes an ordinary local Graphic Asset from a confirmed one-time copy', async () => {
		const { library } = createLibrary();
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-copy-1',
			initiatedBy: 'graphics-author-1',
			name: 'Remote scoreboard',
			sourceFileName: 'scoreboard.png',
		});
		expect(operation).toMatchObject({
			source: 'remote-copy',
			stage: 'created',
		});

		const copied = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png?signature=super-secret#fragment',
		});
		expect(copied).toMatchObject({
			stage: 'awaiting-confirmation',
			declaredByteLength: transparentPixelPng.byteLength,
			transferredByteLength: transparentPixelPng.byteLength,
			report: {
				outcome: 'accepted',
				compatibilityProfile: 'still-image-v1',
				facts: { kind: 'image', format: 'png' },
			},
		});

		const staged = await library.resolveStagedGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(staged.outcome).toBe('available');
		if (staged.outcome !== 'available')
			return;
		await expect(consumeBoundedByteStream({
			body: staged.body,
			byteLength: staged.byteLength,
			maximumByteLength: staged.byteLength,
		})).resolves.toEqual(transparentPixelPng);

		const completed = await library.confirmGraphicAssetBrowserEvidence({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			evidence: {
				outcome: 'decoded',
				sourceDigest: sourceDigest(transparentPixelPng),
				width: 1,
				height: 1,
			},
		});
		expect(completed).toMatchObject({
			stage: 'completed',
			result: { outcome: 'published' },
			report: { outcome: 'accepted', facts: { browserDecodable: true } },
		});

		const assets = await library.listGraphicAssets({});
		expect(assets).toHaveLength(1);
		const resolvedRevision = await library.resolveGraphicAssetRevision({
			assetId: completed.result!.assetId,
			revisionId: completed.result!.revisionId,
		});
		expect(resolvedRevision).toMatchObject({
			outcome: 'available',
			contentType: 'image/png',
			byteLength: transparentPixelPng.byteLength,
		});
	});

	it.each([
		{
			label: 'a plaintext HTTP destination',
			sourceUrl: 'http://cdn.example.test/scoreboard.png',
			code: 'remote-source-not-https',
		},
		{
			label: 'a non-HTTP scheme',
			sourceUrl: 'file:///etc/passwd',
			code: 'remote-source-not-https',
		},
		{
			label: 'embedded credentials',
			sourceUrl: 'https://user:secret@cdn.example.test/scoreboard.png',
			code: 'remote-source-credentials-present',
		},
		{
			label: 'a loopback literal',
			sourceUrl: 'https://127.0.0.1/scoreboard.png',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'an IPv6 loopback literal',
			sourceUrl: 'https://[::1]/scoreboard.png',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'a private literal',
			sourceUrl: 'https://10.1.2.3/scoreboard.png',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'a cloud-metadata literal',
			sourceUrl: 'https://169.254.169.254/latest/meta-data/scoreboard.png',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'a cloud-metadata hostname',
			sourceUrl: 'https://metadata.google.internal/scoreboard.png',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'the loopback hostname',
			sourceUrl: 'https://localhost/scoreboard.png',
			code: 'remote-source-destination-not-public',
		},
		{
			label: 'an mDNS hostname',
			sourceUrl: 'https://printer.local/scoreboard.png',
			code: 'remote-source-destination-not-public',
		},
	] as const)('rejects $label without copying a byte', async ({ sourceUrl, code }) => {
		const { library, remote, staging } = createLibrary();
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: `remote-reject-${code}-${sourceUrl}`,
			initiatedBy: 'graphics-author-1',
			name: 'Rejected remote source',
			sourceFileName: 'scoreboard.png',
		});

		const failed = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl,
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			transferredByteLength: 0,
			failure: { code: 'remote-source-rejected', retryable: false },
			report: { outcome: 'rejected', issues: [{ code }] },
		});
		expect(remote.requests).toEqual([]);
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
		await expect(
			staging.readMetadata(graphicsObjectIdentity(`ingestion/${operation.id}/source`)),
		).resolves.toMatchObject({ outcome: 'missing' });
	});

	it.each([
		{
			label: 'loopback',
			addresses: ['127.0.0.1'],
		},
		{
			label: 'private',
			addresses: ['93.184.216.34', '192.168.10.4'],
		},
		{
			label: 'link-local cloud metadata',
			addresses: ['169.254.169.254'],
		},
		{
			label: 'IPv6 unique-local',
			addresses: ['fd00::1'],
		},
		{
			label: 'IPv4-mapped loopback',
			addresses: ['::ffff:127.0.0.1'],
		},
		{
			label: 'reserved',
			addresses: ['240.0.0.1'],
		},
	] as const)('rejects a hostname whose DNS result includes a $label address', async ({
		addresses,
		label,
	}) => {
		const { library, remote } = createLibrary({
			addresses: { 'cdn.example.test': [...addresses] },
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: `remote-dns-${label}`,
			initiatedBy: 'graphics-author-1',
			name: 'Rebound remote source',
			sourceFileName: 'scoreboard.png',
		});

		const failed = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'remote-source-rejected', retryable: false },
			report: {
				outcome: 'rejected',
				issues: [{ code: 'remote-source-destination-not-public' }],
			},
		});
		expect(remote.requests).toEqual([]);
	});

	it('rejects a hostname with no public DNS result', async () => {
		const { library } = createLibrary({ unresolvable: ['cdn.example.test'] });
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-nxdomain',
			initiatedBy: 'graphics-author-1',
			name: 'Unresolvable remote source',
			sourceFileName: 'scoreboard.png',
		});

		await expect(library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		})).resolves.toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [{ code: 'remote-source-destination-not-public' }],
			},
		});
	});

	it('revalidates the scheme and destination at every redirect hop', async () => {
		const { library, remote } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					location: 'https://edge.example.test/hop-one.png',
				},
				'https://edge.example.test/hop-one.png': {
					location: 'https://internal.example.test/hop-two.png',
				},
				'https://internal.example.test/hop-two.png': { body: transparentPixelPng },
			},
			addresses: {
				'cdn.example.test': ['93.184.216.34'],
				'edge.example.test': ['93.184.216.35'],
				'internal.example.test': ['10.0.0.9'],
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-redirect-private',
			initiatedBy: 'graphics-author-1',
			name: 'Redirected remote source',
			sourceFileName: 'scoreboard.png',
		});

		const failed = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			transferredByteLength: 0,
			failure: { code: 'remote-source-rejected', retryable: false },
			report: {
				outcome: 'rejected',
				issues: [{ code: 'remote-source-destination-not-public' }],
			},
		});
		expect(remote.requests.map(request => request.url)).toEqual([
			'https://cdn.example.test/scoreboard.png',
			'https://edge.example.test/hop-one.png',
		]);
		expect(remote.resolved).toEqual([
			'cdn.example.test',
			'edge.example.test',
			'internal.example.test',
		]);
	});

	it('rejects a downgrade to plaintext HTTP after a redirect', async () => {
		const { library } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					location: 'http://cdn.example.test/scoreboard.png',
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-redirect-downgrade',
			initiatedBy: 'graphics-author-1',
			name: 'Downgraded remote source',
			sourceFileName: 'scoreboard.png',
		});

		await expect(library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		})).resolves.toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [{ code: 'remote-source-not-https' }],
			},
		});
	});

	it('follows at most three redirects', async () => {
		const { library, remote } = createLibrary({
			hops: {
				'https://cdn.example.test/hop-0.png': { location: '/hop-1.png' },
				'https://cdn.example.test/hop-1.png': { location: '/hop-2.png' },
				'https://cdn.example.test/hop-2.png': { location: '/hop-3.png' },
				'https://cdn.example.test/hop-3.png': { location: '/hop-4.png' },
				'https://cdn.example.test/hop-4.png': { body: transparentPixelPng },
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-redirect-limit',
			initiatedBy: 'graphics-author-1',
			name: 'Over-redirected remote source',
			sourceFileName: 'scoreboard.png',
		});

		const failed = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/hop-0.png',
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [{ code: 'remote-source-redirect-limit-exceeded' }],
			},
		});
		expect(remote.requests.map(request => request.url)).toEqual([
			'https://cdn.example.test/hop-0.png',
			'https://cdn.example.test/hop-1.png',
			'https://cdn.example.test/hop-2.png',
			'https://cdn.example.test/hop-3.png',
		]);
	});

	it('copies through exactly three redirects', async () => {
		const { library } = createLibrary({
			hops: {
				'https://cdn.example.test/hop-0.png': { location: '/hop-1.png' },
				'https://cdn.example.test/hop-1.png': { location: '/hop-2.png' },
				'https://cdn.example.test/hop-2.png': { location: '/hop-3.png' },
				'https://cdn.example.test/hop-3.png': { body: transparentPixelPng },
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-redirect-three',
			initiatedBy: 'graphics-author-1',
			name: 'Thrice-redirected remote source',
			sourceFileName: 'scoreboard.png',
		});

		await expect(library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/hop-0.png',
		})).resolves.toMatchObject({
			stage: 'awaiting-confirmation',
			report: { outcome: 'accepted' },
		});
	});

	it('sends no cookies, authorization, or interactive authentication', async () => {
		const { library, remote } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					location: 'https://edge.example.test/scoreboard.png',
				},
				'https://edge.example.test/scoreboard.png': { body: transparentPixelPng },
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-no-credentials',
			initiatedBy: 'graphics-author-1',
			name: 'Anonymous remote source',
			sourceFileName: 'scoreboard.png',
		});

		await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png?signature=super-secret',
		});

		expect(remote.requests).toHaveLength(2);
		for (const request of remote.requests) {
			expect(Object.keys(request.headers).toSorted()).toEqual(['accept']);
			expect(request.headers.accept).toBe('*/*');
		}
	});

	it('never persists remote query parameters or fragments', async () => {
		const { library, catalogue } = createLibrary();
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-secret-hygiene',
			initiatedBy: 'graphics-author-1',
			name: 'Signed remote source',
			sourceFileName: 'scoreboard.png',
		});

		const copied = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png?signature=super-secret&token=leak#private-fragment',
		});
		const completed = await library.confirmGraphicAssetBrowserEvidence({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			evidence: {
				outcome: 'decoded',
				sourceDigest: sourceDigest(transparentPixelPng),
				width: 1,
				height: 1,
			},
		});

		const durableState = JSON.stringify([
			copied,
			completed,
			await catalogue.getIngestionOperation(operation.id, operation.initiatedBy),
			await library.listGraphicAssets({}),
		]);
		expect(durableState).not.toContain('super-secret');
		expect(durableState).not.toContain('token=leak');
		expect(durableState).not.toContain('private-fragment');
		expect(durableState).not.toContain('signature');
	});

	it.each([
		{
			label: 'a length above the still-image limit',
			hop: { contentLength: String(26 * 1024 * 1024) },
			code: 'remote-source-length-exceeded',
		},
		{
			label: 'fewer bytes than it declared',
			hop: { contentLength: String(transparentPixelPng.byteLength + 5) },
			code: 'remote-source-length-mismatch',
		},
	] as const)('rejects a remote source that returns $label', async ({ hop, code }) => {
		const { library, staging } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					body: transparentPixelPng,
					...hop,
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: `remote-length-${code}`,
			initiatedBy: 'graphics-author-1',
			name: 'Mis-declared remote source',
			sourceFileName: 'scoreboard.png',
		});

		const failed = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'remote-source-rejected', retryable: false },
			report: { outcome: 'rejected', issues: [{ code }] },
		});
		// A reported byte count must name the length the source actually declared.
		const reported = failed.report?.outcome === 'rejected'
			? failed.report.issues[0]!.message
			: '';
		expect(reported).not.toContain('undefined');
		if (code === 'remote-source-length-mismatch')
			expect(reported).toContain(String(transparentPixelPng.byteLength + 5));
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
		await expect(
			staging.readMetadata(graphicsObjectIdentity(`ingestion/${operation.id}/source`)),
		).resolves.toMatchObject({ outcome: 'missing' });
	});

	it.each([
		{ label: 'declares no length at all', contentLength: null },
		{ label: 'declares an unparseable length', contentLength: 'chunked' },
		{ label: 'declares a zero length', contentLength: '0' },
	] as const)('copies a remote source that $label', async ({ contentLength }) => {
		const { library } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					body: transparentPixelPng,
					contentLength,
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: `remote-unknown-length-${contentLength}`,
			initiatedBy: 'graphics-author-1',
			name: 'Chunked remote source',
			sourceFileName: 'scoreboard.png',
		});

		const copied = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		expect(copied).toMatchObject({
			stage: 'awaiting-confirmation',
			declaredByteLength: transparentPixelPng.byteLength,
			transferredByteLength: transparentPixelPng.byteLength,
			report: {
				outcome: 'accepted',
				compatibilityProfile: 'still-image-v1',
				facts: { kind: 'image', format: 'png' },
			},
		});
	});

	it('rejects an undeclared remote source that outgrows its Graphic Asset kind limit', async () => {
		const { library, staging } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					body: new Uint8Array(MAX_STILL_IMAGE_INGESTION_BYTES + 1),
					contentLength: null,
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-unknown-length-exceeded',
			initiatedBy: 'graphics-author-1',
			name: 'Oversized remote source',
			sourceFileName: 'scoreboard.png',
		});

		const failed = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'remote-source-rejected', retryable: false },
			report: {
				outcome: 'rejected',
				issues: [{ code: 'remote-source-length-exceeded' }],
			},
		});
		await expect(
			staging.readMetadata(graphicsObjectIdentity(`ingestion/${operation.id}/source`)),
		).resolves.toMatchObject({ outcome: 'missing' });
	});

	it('rejects an undeclared remote source that returns no content', async () => {
		const { library } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					body: new Uint8Array(0),
					contentLength: null,
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-unknown-length-empty',
			initiatedBy: 'graphics-author-1',
			name: 'Empty remote source',
			sourceFileName: 'scoreboard.png',
		});

		await expect(library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		})).resolves.toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [{ code: 'remote-source-not-retrievable' }],
			},
		});
	});

	it('stages an undeclared remote source larger than one multipart part', async () => {
		// Bytes beyond one 16 MiB part force the resumable multipart path, so the
		// whole source reaches staging without ever being held in memory at once.
		const { library } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					body: oversizedRemoteSource,
					contentLength: null,
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-unknown-length-multipart',
			initiatedBy: 'graphics-author-1',
			name: 'Large remote source',
			sourceFileName: 'scoreboard.png',
		});

		const failed = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		// Every byte was staged and hashed; the source is then rejected on its own
		// merits by the compatibility profile, not by the remote-source guard.
		expect(failed).toMatchObject({
			stage: 'failed',
			declaredByteLength: oversizedRemoteSource.byteLength,
			transferredByteLength: oversizedRemoteSource.byteLength,
			failure: { code: 'validation-failed', retryable: false },
		});
		expect(
			failed.report?.outcome === 'rejected'
			&& failed.report.issues.every(issue => !issue.code.startsWith('remote-source-')),
		).toBe(true);
	});

	it('clears the multipart checkpoint once the remote copy stages its source', async () => {
		const { library, catalogue } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					body: oversizedRemoteSource,
					contentLength: null,
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-checkpoint-cleared',
			initiatedBy: 'graphics-author-1',
			name: 'Large remote source',
			sourceFileName: 'scoreboard.png',
		});

		await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		// The upload the checkpoint named is completed, so nothing is left to abort.
		await expect(catalogue.getGraphicAssetMultipartState(
			operation.id,
			operation.initiatedBy,
		)).resolves.toBeUndefined();
		const authoritative = await library.getIngestionOperation({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});
		expect(authoritative.transfer).toBeUndefined();
	});

	it('leaves an abortable checkpoint when a copy dies with its upload unreleased', async () => {
		const stranded = await strandRemoteCopyMultipartUpload('remote-checkpoint-stranded');

		expect(stranded.failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'staging-unavailable', retryable: true },
		});
		const state = await stranded.catalogue.getGraphicAssetMultipartState(
			stranded.operation.id,
			stranded.operation.initiatedBy,
		);
		// Both sides are optional, so without this the comparison below is satisfied
		// by a copy that never reached a multipart upload and a checkpoint that was
		// therefore never taken.
		expect(stranded.uploadId).toBeDefined();
		expect(state?.uploadId).toBe(stranded.uploadId);
		// A remote copy has no client-supplied parts to resume from; the checkpoint
		// carries the uploadId alone.
		expect(state?.parts).toEqual([]);
		await expect(stranded.staging.resumeMultipart(
			graphicsObjectIdentity(`ingestion/${stranded.operation.id}/source`),
			stranded.uploadId!,
		)).resolves.toMatchObject({ outcome: 'resumed' });
	});

	/**
	 * Staging a remote source has two deaths that converge on the same abort: a
	 * store call answering `unavailable`, and anything that throws. Only the first
	 * is reachable by injecting a store failure, so covering the second needs the
	 * read itself to die — which is what a connection dropped mid-body does.
	 */
	it('aborts and clears the checkpoint when the remote body dies mid-transfer', async () => {
		const delegate = createInMemoryStagingGraphicsObjectStore();
		let uploadId: GraphicsMultipartUploadIdentity | undefined;
		const staging: InMemoryGraphicsStagingObjectStore = {
			...delegate,
			async beginMultipart(input) {
				const started = await delegate.beginMultipart(input);
				if (started.outcome === 'started')
					uploadId = started.upload.uploadId;
				return started;
			},
		};
		const { library, catalogue } = createLibrary({
			staging,
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					body: oversizedRemoteSource,
					contentLength: null,
					failsAfterBody: true,
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-body-died',
			initiatedBy: 'graphics-author-1',
			name: 'Interrupted remote source',
			sourceFileName: 'scoreboard.png',
		});

		const failed = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'staging-unavailable', retryable: true },
		});
		// A part was taken and checkpointed before the read died, so this route owes
		// the same reclamation the structured one does: the upload is gone and the
		// checkpoint no longer names it.
		expect(uploadId).toBeDefined();
		await expect(staging.resumeMultipart(
			graphicsObjectIdentity(`ingestion/${operation.id}/source`),
			uploadId!,
		)).resolves.toMatchObject({ outcome: 'unavailable' });
		await expect(catalogue.getGraphicAssetMultipartState(
			operation.id,
			operation.initiatedBy,
		)).resolves.toBeUndefined();
	});

	it('clears the checkpoint when something else reclaimed the upload first', async () => {
		const delegate = createInMemoryStagingGraphicsObjectStore();
		let uploadId: GraphicsMultipartUploadIdentity | undefined;
		const staging: InMemoryGraphicsStagingObjectStore = {
			...delegate,
			async beginMultipart(input) {
				const started = await delegate.beginMultipart(input);
				if (started.outcome === 'started')
					uploadId = started.upload.uploadId;
				return started;
			},
			async uploadPart(input) {
				// The part fails and a concurrent sweep reclaims the upload before this
				// request's own abort runs, so that abort finds nothing to reclaim.
				await delegate.abortMultipart(input.upload);
				return unavailableObjectStoreOutcome();
			},
		};
		const { library, catalogue } = createLibrary({
			staging,
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					body: oversizedRemoteSource,
					contentLength: null,
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-upload-reclaimed-elsewhere',
			initiatedBy: 'graphics-author-1',
			name: 'Interrupted remote source',
			sourceFileName: 'scoreboard.png',
		});

		const failed = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		expect(failed).toMatchObject({
			stage: 'failed',
			failure: { code: 'staging-unavailable', retryable: true },
		});
		// A checkpoint exists only so a sweep can find the upload. This one is
		// already gone, so keeping the checkpoint would strand the next attempt
		// behind an abort that can never answer anything but 'already reclaimed'.
		expect(uploadId).toBeDefined();
		await expect(catalogue.getGraphicAssetMultipartState(
			operation.id,
			operation.initiatedBy,
		)).resolves.toBeUndefined();
	});

	it('retries past a checkpoint naming an upload the staging store no longer holds', async () => {
		const stranded = await strandRemoteCopyMultipartUpload('remote-checkpoint-already-gone');
		expect(stranded.uploadId).toBeDefined();
		// The abort landed and the checkpoint-clear write did not, which is the
		// state #293 is about: the checkpoint names an upload that is already gone.
		// Every retry re-aborts it, and an abort of a gone upload used to answer
		// unavailable — so the operation refused until the 24h sweep.
		await expect(stranded.staging.abortMultipart({
			identity: graphicsObjectIdentity(`ingestion/${stranded.operation.id}/source`),
			uploadId: stranded.uploadId!,
		})).resolves.toEqual({ outcome: 'aborted' });

		const retried = await stranded.library.copyRemoteGraphicAssetSource({
			operationId: stranded.operation.id,
			initiatedBy: stranded.operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		// The attempt got past the stale checkpoint and copied every byte; what
		// stops it now is the source's own compatibility, not a reclamation it
		// could not perform.
		expect(retried).toMatchObject({
			stage: 'failed',
			transferredByteLength: oversizedRemoteSource.byteLength,
			failure: { code: 'validation-failed', retryable: false },
		});
		await expect(stranded.catalogue.getGraphicAssetMultipartState(
			stranded.operation.id,
			stranded.operation.initiatedBy,
		)).resolves.toBeUndefined();
	});

	it('refuses a remote copy whose stranded upload the staging store cannot answer for', async () => {
		const stranded = await strandRemoteCopyMultipartUpload('remote-checkpoint-abort-unavailable');
		stranded.staging.injectTransientFailure('multipart-abort');

		const thrown = await stranded.library.copyRemoteGraphicAssetSource({
			operationId: stranded.operation.id,
			initiatedBy: stranded.operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		}).then(() => null, (error: unknown) => error);

		// A store that cannot answer may still be holding the upload, so this
		// attempt stops rather than stranding it behind a second one.
		expect(thrown).toMatchObject({
			code: 'graphics-asset-library-unavailable',
			message: 'Graphics Asset staging byte store could not release a previous approved remote Graphic Asset copy attempt',
		});
		// The checkpoint is what a later sweep reclaims from, so it survives.
		await expect(stranded.catalogue.getGraphicAssetMultipartState(
			stranded.operation.id,
			stranded.operation.initiatedBy,
		)).resolves.toMatchObject({ uploadId: stranded.uploadId });

		// The sentence names which store is out of reach, so it must reach the
		// caller rather than being rewritten to 'Internal Server Error'. There is no
		// route test for remote-copy.post.ts, so its two mapping hops are run here
		// instead. The event carries a distinguishing property because
		// `toHaveBeenCalledWith` compares deeply, and a bare `{}` cannot tell this
		// request apart from any other empty object (#356; the same change made the
		// helper's event parameter required, which is why this call passes one at
		// all — and having to pass one, the row now pins the `retry-after` header
		// its earlier form disclaimed).
		const requestEvent = { __requestEventFor: 'remote-copy-release-failure' } as never;
		let routeError: unknown;
		try {
			rethrowGraphicsAssetApiError(thrown, requestEvent);
		}
		catch (error) {
			routeError = error;
		}
		const refusal = await publicServerFailure(routeError);
		expect(refusal.statusCode).toBe(503);
		expect(refusal.message).toBe('Graphics Asset staging byte store could not release a previous approved remote Graphic Asset copy attempt');
		expect(mockSetResponseHeader).toHaveBeenCalledWith(requestEvent, 'retry-after', 5);
	});

	it('reports no client-transfer facts for a remote copy holding a checkpoint', async () => {
		const stranded = await strandRemoteCopyMultipartUpload('remote-checkpoint-no-transfer');

		const authoritative = await stranded.library.getIngestionOperation({
			operationId: stranded.operation.id,
			initiatedBy: stranded.operation.initiatedBy,
		});
		// The checkpoint names an upload; it never claims parts were verified.
		expect(authoritative.transfer).toBeUndefined();
		expect(authoritative.transferredByteLength).toBe(0);
	});

	it('treats the remote content type as an untrusted hint and trusts observed bytes', async () => {
		const { library } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': {
					body: transparentPixelPng,
					contentType: 'video/mp4',
				},
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-mime-hint',
			initiatedBy: 'graphics-author-1',
			name: 'Mislabelled remote source',
			sourceFileName: 'scoreboard.png',
		});

		const copied = await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		expect(copied).toMatchObject({
			stage: 'awaiting-confirmation',
			declaredMime: undefined,
			report: {
				outcome: 'accepted',
				compatibilityProfile: 'still-image-v1',
				facts: { format: 'png', canonicalMime: 'image/png' },
			},
		});
	});

	it('keeps a transiently unreachable remote source retryable with the same operation', async () => {
		const { library, remote } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': { status: 503 },
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-transient',
			initiatedBy: 'graphics-author-1',
			name: 'Flaky remote source',
			sourceFileName: 'scoreboard.png',
		});

		await expect(library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		})).rejects.toMatchObject({ code: 'graphics-asset-library-unavailable' });

		await expect(library.getIngestionOperation({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		})).resolves.toMatchObject({ stage: 'created', transferredByteLength: 0 });

		remote.requests.length = 0;
		const reinitiated = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-transient',
			initiatedBy: 'graphics-author-1',
			name: 'Flaky remote source',
			sourceFileName: 'scoreboard.png',
		});
		expect(reinitiated.id).toBe(operation.id);
	});

	it('rejects a permanently unavailable remote source', async () => {
		const { library } = createLibrary({
			hops: {
				'https://cdn.example.test/scoreboard.png': { status: 403 },
			},
		});
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-forbidden',
			initiatedBy: 'graphics-author-1',
			name: 'Forbidden remote source',
			sourceFileName: 'scoreboard.png',
		});

		await expect(library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		})).resolves.toMatchObject({
			stage: 'failed',
			failure: { code: 'remote-source-rejected', retryable: false },
			report: {
				outcome: 'rejected',
				issues: [{ code: 'remote-source-not-retrievable' }],
			},
		});
	});

	it('reuses an existing Graphic Asset when the copied bytes already exist', async () => {
		const { library } = createLibrary();
		const evidence = {
			outcome: 'decoded',
			sourceDigest: sourceDigest(transparentPixelPng),
			width: 1,
			height: 1,
		} as const;
		const first = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-dedupe-1',
			initiatedBy: 'graphics-author-1',
			name: 'First remote copy',
			sourceFileName: 'scoreboard.png',
		});
		await library.copyRemoteGraphicAssetSource({
			operationId: first.id,
			initiatedBy: first.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});
		const published = await library.confirmGraphicAssetBrowserEvidence({
			operationId: first.id,
			initiatedBy: first.initiatedBy,
			evidence,
		});

		const second = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-dedupe-2',
			initiatedBy: 'graphics-author-1',
			name: 'Second remote copy',
			sourceFileName: 'scoreboard.png',
		});
		await library.copyRemoteGraphicAssetSource({
			operationId: second.id,
			initiatedBy: second.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});
		const reused = await library.confirmGraphicAssetBrowserEvidence({
			operationId: second.id,
			initiatedBy: second.initiatedBy,
			evidence,
		});

		expect(reused).toMatchObject({
			stage: 'completed',
			result: {
				outcome: 'reused',
				assetId: published.result!.assetId,
				revisionId: published.result!.revisionId,
			},
		});
		await expect(library.listGraphicAssets({})).resolves.toHaveLength(1);
	});

	it('cancels a remote copy before publication and releases its staged bytes', async () => {
		const { library, staging } = createLibrary();
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-cancel',
			initiatedBy: 'graphics-author-1',
			name: 'Cancelled remote copy',
			sourceFileName: 'scoreboard.png',
		});
		await library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		});

		const cancelled = await library.cancelGraphicsIngestion({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});

		expect(cancelled).toMatchObject({ stage: 'cancelled' });
		await expect(
			staging.readMetadata(graphicsObjectIdentity(`ingestion/${operation.id}/source`)),
		).resolves.toMatchObject({ outcome: 'missing' });
		await expect(library.listGraphicAssets({})).resolves.toEqual([]);
		await expect(library.resolveStagedGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		})).resolves.toMatchObject({ outcome: 'missing' });
	});

	it('refuses a local streamed upload against a remote-copy operation', async () => {
		const { library } = createLibrary();
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-upload-refused',
			initiatedBy: 'graphics-author-1',
			name: 'Remote copy operation',
			sourceFileName: 'scoreboard.png',
		});

		await expect(library.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			bytes: createBoundedByteStream(transparentPixelPng, {
				byteLength: transparentPixelPng.byteLength,
				maximumByteLength: transparentPixelPng.byteLength,
			}),
		})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
	});

	it('refuses a client multipart transfer against a remote-copy operation', async () => {
		const { library } = createLibrary();
		const operation = await library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-multipart-refused',
			initiatedBy: 'graphics-author-1',
			name: 'Remote copy operation',
			sourceFileName: 'scoreboard.png',
		});

		await expect(library.startGraphicAssetMultipartUpload({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
	});

	it('refuses a remote copy against a local-upload operation', async () => {
		const { library } = createLibrary();
		const operation = await library.initiateGraphicsIngestion({
			idempotencyKey: 'local-copy-refused',
			initiatedBy: 'graphics-author-1',
			name: 'Local upload operation',
			sourceFileName: 'scoreboard.png',
			declaredByteLength: transparentPixelPng.byteLength,
		});

		await expect(library.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/scoreboard.png',
		})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
	});
});

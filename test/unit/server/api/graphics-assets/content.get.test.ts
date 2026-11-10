import type { GraphicsRevisionContent } from '~~/server/modules/graphics-asset-library/delivery';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGraphicsAssetDelivery } from '~~/server/modules/graphics-asset-library/delivery';
import { createInMemoryCanonicalGraphicsObjectStore } from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import { boundedBytes, canonicalIdentity } from '~~/test/helpers/graphicsLibrary';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';

const {
	library,
	mockRequireUserId,
	mockSetResponseHeader,
} = vi.hoisted(() => ({
	library: { current: undefined as unknown },
	mockRequireUserId: vi.fn(),
	mockSetResponseHeader: vi.fn(),
}));

vi.mock('~~/server/utils/auth', () => ({
	requireUserId: mockRequireUserId,
}));

vi.mock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => library.current,
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRouterParam', vi.fn((_event, name: string) =>
	name === 'assetId'
		? 'asset-1'
		: 'revision-1'));
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('getRequestHeader', vi.fn((event: { headers?: Record<string, string | undefined> }, name: string) =>
	event.headers?.[name]));

function eventWithHeaders(headers: Record<string, string | undefined>) {
	return stubH3Event({ headers });
}
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
}) => Object.assign(new Error(input.message), input));

const etag = '"sk-revision-asset-1-revision-1"';
const digest = 'c'.repeat(64);
const contentBytes = Uint8Array.from({ length: 1000 }, (_, index) => index % 251);

/**
 * The real delivery reads over an in-memory canonical store holding one
 * revision's content. The catalogue answers that revision until `purged`.
 */
async function deliveryOfOneRevision() {
	const canonical = createInMemoryCanonicalGraphicsObjectStore();
	await canonical.createImmutable({
		identity: canonicalIdentity(digest),
		bytes: boundedBytes(contentBytes),
		metadata: {
			contentType: 'video/webm',
			custom: { sha256: digest },
		},
	});
	const state = { purged: false };
	const content = {
		digest,
		byteLength: contentBytes.byteLength,
		canonicalMime: 'video/webm',
	} as GraphicsRevisionContent;
	library.current = createGraphicsAssetDelivery({
		canonical,
		catalogue: {
			findRevisionContent: async () => state.purged ? undefined : content,
			findRevisionContents: async () => [],
			findThumbnailContent: async () => undefined,
		},
	});
	return {
		state,
		bodyReads: vi.spyOn(canonical, 'read'),
		metadataReads: vi.spyOn(canonical, 'readMetadata'),
	};
}

async function contentHandler() {
	return (await import(
		'../../../../../server/api/graphics-assets/[assetId]/revisions/[revisionId]/content.get',
	)).default;
}

async function bytesOf(response: Response) {
	return new Uint8Array(await response.arrayBuffer());
}

describe('authenticated exact Graphic Asset Revision content delivery', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireUserId.mockReset().mockResolvedValue('author-1');
		mockSetResponseHeader.mockReset();
	});

	it('serves the complete revision with a validator and range support advertised', async () => {
		const { bodyReads } = await deliveryOfOneRevision();
		const handler = await contentHandler();

		const response = await handler(eventWithHeaders({})) as Response;

		expect(response.status).toBe(200);
		expect(response.headers.get('accept-ranges')).toBe('bytes');
		expect(response.headers.get('etag')).toBe(etag);
		expect(response.headers.get('content-type')).toBe('video/webm');
		expect(response.headers.get('content-length')).toBe('1000');
		expect(response.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate');
		expect(await bytesOf(response)).toEqual(contentBytes);
		expect(bodyReads).toHaveBeenCalledTimes(1);
	});

	it('answers a matching conditional read with 304 and reads no bytes', async () => {
		const { bodyReads } = await deliveryOfOneRevision();
		const handler = await contentHandler();

		const response = await handler(eventWithHeaders({ 'if-none-match': etag })) as Response;

		expect(response.status).toBe(304);
		expect(response.headers.get('etag')).toBe(etag);
		expect(bodyReads).not.toHaveBeenCalled();
	});

	// The validator names a route, not content, so it proves nothing about a
	// revision that is gone: existence is answered before any conditional.
	it.each([
		{
			read: 'conditional',
			headers: { 'if-none-match': etag },
		},
		{
			read: 'ranged',
			headers: { range: 'bytes=100-199' },
		},
		{ read: 'complete', headers: {} },
	])('answers 404 to a $read read of a revision that no longer exists', async ({ headers }) => {
		const { state, bodyReads } = await deliveryOfOneRevision();
		state.purged = true;
		const handler = await contentHandler();

		const failure = await refusalFrom(handler(eventWithHeaders(headers)));

		expect(failure).toMatchObject({
			statusCode: 404,
			message: 'Graphic Asset Revision not found',
		});
		expect(bodyReads).not.toHaveBeenCalled();
	});

	// A seek costs one byte read: the range's own. The revision's length comes
	// from its metadata, never from opening the whole object to discard it.
	it('serves an exact byte range as 206 from a single byte read', async () => {
		const { bodyReads } = await deliveryOfOneRevision();
		const handler = await contentHandler();

		const response = await handler(eventWithHeaders({ range: 'bytes=100-199' })) as Response;

		expect(response.status).toBe(206);
		expect(response.headers.get('content-range')).toBe('bytes 100-199/1000');
		expect(response.headers.get('content-length')).toBe('100');
		expect(response.headers.get('content-type')).toBe('video/webm');
		expect(await bytesOf(response)).toEqual(contentBytes.slice(100, 200));
		expect(bodyReads.mock.calls.map(([, range]) => range)).toEqual([
			{ offset: 100, length: 100 },
		]);
	});

	it('rejects an unsatisfiable range with 416 and the complete length', async () => {
		const { bodyReads } = await deliveryOfOneRevision();
		const handler = await contentHandler();

		const response = await handler(eventWithHeaders({ range: 'bytes=5000-' })) as Response;

		expect(response.status).toBe(416);
		expect(response.headers.get('content-range')).toBe('bytes */1000');
		expect(bodyReads).not.toHaveBeenCalled();
	});

	it('ignores the range when an if-range validator does not match', async () => {
		const { bodyReads } = await deliveryOfOneRevision();
		const handler = await contentHandler();

		const response = await handler(eventWithHeaders({
			'range': 'bytes=0-99',
			'if-range': '"some-other-validator"',
		})) as Response;

		expect(response.status).toBe(200);
		expect(await bytesOf(response)).toEqual(contentBytes);
		expect(bodyReads.mock.calls.map(([, range]) => range)).toEqual([undefined]);
	});

	/**
	 * #321. A store out of reach answers a classified 503 whose sentence survives
	 * the sanitizer, beside its retry guidance. Asserted after the mapper, and at
	 * each store read the route makes: the metadata, the whole body, the range.
	 */
	it.each([
		{ read: 'metadata', store: 'metadataReads', headers: {} },
		{ read: 'whole-body', store: 'bodyReads', headers: {} },
		{
			read: 'ranged',
			store: 'bodyReads',
			headers: { range: 'bytes=100-199' },
		},
	] as const)('says what is unavailable when the $read read cannot be served', async ({ store, headers }) => {
		const reads = await deliveryOfOneRevision();
		reads[store].mockResolvedValueOnce({ outcome: 'unavailable' } as never);
		const handler = await contentHandler();
		const event = eventWithHeaders(headers);

		const failure = await refusalFrom(handler(event));

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Graphic Asset Content is temporarily unavailable',
		});
		expect(mockSetResponseHeader).toHaveBeenCalledWith(event, 'retry-after', 5);
	});
});

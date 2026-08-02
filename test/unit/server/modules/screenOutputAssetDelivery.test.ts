import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreenOutputAssetDelivery } from '~~/server/modules/screen-output-assets';

const signingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const sourceBytes = Uint8Array.of(10, 20, 30, 40, 50);

function availableContent(range?: { offset: number; length: number }) {
	const bodyBytes = range
		? sourceBytes.slice(range.offset, range.offset + range.length)
		: sourceBytes;
	return {
		outcome: 'available' as const,
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bodyBytes);
				controller.close();
			},
		}),
		byteLength: sourceBytes.byteLength,
		contentType: 'image/png' as const,
	};
}

async function responseBytes(response: Response) {
	return Array.from(new Uint8Array(await response.arrayBuffer()));
}

describe('screen Output exact Graphic Asset Revision delivery', () => {
	const authorize = vi.fn();
	const inspect = vi.fn();
	const resolve = vi.fn();
	const match = vi.fn();
	const put = vi.fn();
	const defer = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		authorize.mockResolvedValue({
			outcome: 'authorized',
			contentIdentity: 'internal-content-digest',
		});
		inspect.mockResolvedValue({
			outcome: 'available',
			byteLength: sourceBytes.byteLength,
			contentType: 'image/png',
		});
		resolve.mockImplementation(({ range }) => Promise.resolve(availableContent(range)));
		match.mockResolvedValue(undefined);
		put.mockResolvedValue(undefined);
	});

	function delivery() {
		return createScreenOutputAssetDelivery({
			signingKey,
			authorize,
			inspect,
			resolve,
			cache: { match, put },
			defer,
		});
	}

	const request = {
		screenId: 17,
		capability: 'opaque-capability',
		assetId: 'asset-1',
		revisionId: 'revision-1',
		headers: new Headers(),
	};

	it('authorizes the capability and exact current Screen revision before consulting cached bytes', async () => {
		authorize.mockResolvedValue({ outcome: 'missing' });

		await expect(delivery().deliver(request)).resolves.toEqual({ outcome: 'missing' });

		expect(authorize).toHaveBeenCalledWith({
			screenId: 17,
			capabilityDigest: expect.stringMatching(/^[\da-f]{64}$/),
			assetId: 'asset-1',
			revisionId: 'revision-1',
			actualVideoTarget: 'other',
		});
		expect(match).not.toHaveBeenCalled();
		expect(inspect).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	/**
	 * Playback compatibility is decided per resolution request, not per session (#98).
	 *
	 * The engine that will actually decode the bytes is the one asking for them, so
	 * the request carries the fact. Refusing here costs the output exactly the clip
	 * it cannot play; refusing the session cost it every asset the Screen publishes.
	 */
	it('asks whether the requesting engine can play these exact bytes, and refuses only those', async () => {
		authorize.mockResolvedValue({
			outcome: 'incompatible',
			code: 'vp9-alpha-chromium-required',
		});

		await expect(delivery().deliver({
			...request,
			headers: new Headers({ 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15' }),
		})).resolves.toEqual({
			outcome: 'incompatible',
			code: 'vp9-alpha-chromium-required',
		});

		expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
			actualVideoTarget: 'safari',
		}));
		// Nothing is fetched, cached, or served for a revision this engine was
		// refused, and the refusal never reaches the byte store.
		expect(match).not.toHaveBeenCalled();
		expect(inspect).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('delivers the same restricted revision to the engine that can play it', async () => {
		const result = await delivery().deliver({
			...request,
			headers: new Headers({ 'user-agent': 'Mozilla/5.0 Chrome/138.0.0.0 Safari/537.36' }),
		});

		expect(result.outcome).toBe('delivered');
		expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
			actualVideoTarget: 'chromium',
		}));
	});

	it('fails closed with a retryable outcome when authorization storage is unavailable', async () => {
		authorize.mockRejectedValue(new Error('D1 unavailable'));

		await expect(delivery().deliver(request)).resolves.toEqual({
			outcome: 'unavailable',
			retryable: true,
		});

		expect(match).not.toHaveBeenCalled();
		expect(inspect).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('streams a full private response while only its opaque immutable cache entry is shared-cacheable', async () => {
		const result = await delivery().deliver(request);

		expect(result.outcome).toBe('delivered');
		if (result.outcome !== 'delivered')
			return;
		expect(result.response.status).toBe(200);
		expect(await responseBytes(result.response)).toEqual([10, 20, 30, 40, 50]);
		expect(result.response.headers.get('content-type')).toBe('image/png');
		expect(result.response.headers.get('content-length')).toBe('5');
		expect(result.response.headers.get('accept-ranges')).toBe('bytes');
		expect(result.response.headers.get('cache-control')).toBe('private, no-store');
		expect(result.response.headers.get('vary')).toBe('authorization, cookie');
		expect(result.response.headers.get('etag')).toMatch(/^"sk-[\w-]{43}"$/);
		expect(result.response.headers.get('etag')).not.toContain('asset-1');
		expect(match).toHaveBeenCalledWith(expect.objectContaining({
			url: expect.not.stringContaining('asset-1'),
		}));
		expect(defer).toHaveBeenCalledOnce();

		const deferred = defer.mock.calls[0]![0] as Promise<unknown>;
		await deferred;
		expect(put).toHaveBeenCalledOnce();
		const [cacheRequest, cacheResponse] = put.mock.calls[0] as [Request, Response];
		expect(cacheRequest.url).not.toContain('asset-1');
		expect(cacheRequest.url).not.toContain('revision-1');
		expect(cacheRequest.url).not.toContain('internal-content-digest');
		expect(cacheResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
	});

	it('returns a strong conditional 304 only after confirming bytes are available', async () => {
		const first = await delivery().deliver(request);
		if (first.outcome !== 'delivered')
			throw new Error('expected delivered response');
		const etag = first.response.headers.get('etag')!;
		inspect.mockClear();
		resolve.mockClear();
		const result = await delivery().deliver({
			...request,
			headers: new Headers({ 'if-none-match': etag }),
		});

		expect(result.outcome).toBe('delivered');
		if (result.outcome !== 'delivered')
			return;
		expect(result.response.status).toBe(304);
		expect(result.response.body).toBeNull();
		expect(inspect).toHaveBeenCalledOnce();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('streams a satisfiable single byte range without buffering the full object', async () => {
		const result = await delivery().deliver({
			...request,
			headers: new Headers({ range: 'bytes=1-3' }),
		});

		expect(result.outcome).toBe('delivered');
		if (result.outcome !== 'delivered')
			return;
		expect(result.response.status).toBe(206);
		expect(result.response.headers.get('content-range')).toBe('bytes 1-3/5');
		expect(result.response.headers.get('content-length')).toBe('3');
		expect(await responseBytes(result.response)).toEqual([20, 30, 40]);
		expect(resolve).toHaveBeenCalledWith({
			assetId: 'asset-1',
			revisionId: 'revision-1',
			range: { offset: 1, length: 3 },
		});
		expect(defer).not.toHaveBeenCalled();
	});

	it('returns 416 for an unsatisfiable byte range after authorization and byte availability checks', async () => {
		const result = await delivery().deliver({
			...request,
			headers: new Headers({ range: 'bytes=10-20' }),
		});

		expect(result.outcome).toBe('delivered');
		if (result.outcome !== 'delivered')
			return;
		expect(result.response.status).toBe(416);
		expect(result.response.headers.get('content-range')).toBe('bytes */5');
		expect(inspect).toHaveBeenCalledOnce();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('maps missing canonical bytes to a retryable outcome rather than an integrity result', async () => {
		resolve.mockResolvedValue({ outcome: 'unavailable', retryable: true });

		await expect(delivery().deliver(request)).resolves.toEqual({
			outcome: 'unavailable',
			retryable: true,
		});
	});
});

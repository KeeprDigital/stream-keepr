import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreenOutputAssetDelivery } from '~~/server/modules/screen-output-assets';

const signingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const sourceBytes = Uint8Array.of(10, 20, 30, 40, 50);

function availableContent() {
	return {
		outcome: 'available' as const,
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(sourceBytes);
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
		resolve.mockResolvedValue(availableContent());
		match.mockResolvedValue(undefined);
		put.mockResolvedValue(undefined);
	});

	function delivery() {
		return createScreenOutputAssetDelivery({
			signingKey,
			authorize,
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
		});
		expect(match).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('fails closed with a retryable outcome when authorization storage is unavailable', async () => {
		authorize.mockRejectedValue(new Error('D1 unavailable'));

		await expect(delivery().deliver(request)).resolves.toEqual({
			outcome: 'unavailable',
			retryable: true,
		});

		expect(match).not.toHaveBeenCalled();
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
		resolve.mockResolvedValue(availableContent());

		const result = await delivery().deliver({
			...request,
			headers: new Headers({ 'if-none-match': etag }),
		});

		expect(result.outcome).toBe('delivered');
		if (result.outcome !== 'delivered')
			return;
		expect(result.response.status).toBe(304);
		expect(result.response.body).toBeNull();
		expect(resolve).toHaveBeenCalled();
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
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('maps missing canonical bytes to a retryable outcome rather than an integrity result', async () => {
		resolve.mockResolvedValue({ outcome: 'unavailable', retryable: true });

		await expect(delivery().deliver(request)).resolves.toEqual({
			outcome: 'unavailable',
			retryable: true,
		});
	});
});

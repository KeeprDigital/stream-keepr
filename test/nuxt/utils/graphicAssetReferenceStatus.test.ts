import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockApiFetch);

const {
	graphicAssetReferenceStatus,
	graphicAssetReferenceStatusOrUnavailable,
} = await import('~~/app/utils/graphicAssetReferenceStatus');

const REFERENCE = {
	assetId: 'asset badge' as GraphicAssetId,
	revisionId: 'revision/1' as GraphicAssetRevisionId,
};

/**
 * The one question four surfaces used to ask in four places, each with its own error
 * mapping — which is how a mislabelled failure came to be fixed in one of them and
 * left in the other three (#204).
 */
describe('asking the Graphics Asset Library about one exact revision', () => {
	beforeEach(() => {
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'active', kind: 'image' });
	});

	it('addresses exactly the revision it was given, escaping what it puts in the path', async () => {
		await graphicAssetReferenceStatus(REFERENCE);

		expect(mockApiFetch).toHaveBeenCalledWith(
			'/api/graphics-assets/asset%20badge/revisions/revision%2F1/status',
		);
	});

	it('reports a request that could not be made as retryable rather than as missing', async () => {
		// A library that did not answer has not said the revision is gone. A Missing
		// Graphic Asset Reference is an integrity failure no retry resolves, so
		// inferring one from a failed request would name a permanent fault from a
		// temporary one and send the operator to repair something that is not broken.
		mockApiFetch.mockRejectedValue(new Error('Network error'));

		await expect(graphicAssetReferenceStatusOrUnavailable(REFERENCE))
			.resolves
			.toEqual({ outcome: 'unavailable', retryable: true });
	});

	it('lets the failure through when the caller can tell why it failed', async () => {
		// Live Control distinguishes an ended session from unreachable
		// bytes, and it can only do that if the failure reaches it.
		const signedOut = Object.assign(new Error('Unauthorized'), { statusCode: 401 });
		mockApiFetch.mockRejectedValue(signedOut);

		await expect(graphicAssetReferenceStatus(REFERENCE)).rejects.toBe(signedOut);
	});

	it('passes the library’s own answer through untouched', async () => {
		mockApiFetch.mockResolvedValue({ outcome: 'missing' });

		await expect(graphicAssetReferenceStatusOrUnavailable(REFERENCE))
			.resolves
			.toEqual({ outcome: 'missing' });
	});
});

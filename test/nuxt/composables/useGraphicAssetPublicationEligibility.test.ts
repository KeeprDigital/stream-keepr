import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockFetch);

/**
 * Statuses keyed by asset id; the real status util and reference discovery run
 * unmocked, so the seam is the revision-status route itself. A value of
 * 'unreachable' rejects the request, which the status util reports as
 * Unavailable Graphic Asset Content.
 */
const statusByAsset = new Map<string, { outcome: string } | 'unreachable'>();

function answerStatusRequests() {
	mockFetch.mockImplementation(async (url: string) => {
		for (const [assetId, status] of statusByAsset) {
			if (url.includes(`/graphics-assets/${assetId}/`)) {
				if (status === 'unreachable')
					throw new Error('library did not answer');
				return status;
			}
		}
		throw new Error(`unexpected status request: ${url}`);
	});
}

function overlayConfig(layout: Record<string, unknown> = {}): FeatureMatchOverlayModeConfig {
	return {
		featureMatchId: null,
		layout: {
			frame: {},
			sources: [],
			composition: { items: [], inputs: [] },
			...layout,
		},
	} as unknown as FeatureMatchOverlayModeConfig;
}

const BACKGROUND_SLOT = 'layout.frame.backgroundImage';

function configWithBackground() {
	return overlayConfig({ frame: { backgroundImage: { assetId: 'asset-1', revisionId: 'rev-1' } } });
}

function configWithBackgroundAndLogo() {
	return overlayConfig({
		frame: { backgroundImage: { assetId: 'asset-1', revisionId: 'rev-1' } },
		composition: {
			items: [{ id: 'logo', type: 'media', mediaKind: 'image', asset: { assetId: 'asset-2', revisionId: 'rev-2' } }],
			inputs: [],
		},
	});
}

function mountEligibility(config: Ref<FeatureMatchOverlayModeConfig>) {
	let result!: ReturnType<typeof useGraphicAssetPublicationEligibility>;
	const wrapper = mount(defineComponent({
		setup() {
			result = useGraphicAssetPublicationEligibility(() => config.value);
			return () => h('div');
		},
	}));

	return { wrapper, ...result };
}

describe('useGraphicAssetPublicationEligibility', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		statusByAsset.clear();
		answerStatusRequests();
	});

	it('is eligible without asking when nothing is referenced', () => {
		const { eligibility, blocked, reason } = mountEligibility(ref(overlayConfig()));

		expect(eligibility.value).toEqual({ outcome: 'eligible' });
		expect(blocked.value).toBe(false);
		expect(reason.value).toBeUndefined();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('checks every reference and blocks until the answers are in', async () => {
		statusByAsset.set('asset-1', { outcome: 'available' });
		statusByAsset.set('asset-2', { outcome: 'available' });

		const { eligibility, blocked, reason } = mountEligibility(ref(configWithBackgroundAndLogo()));

		expect(eligibility.value).toEqual({ outcome: 'checking' });
		expect(blocked.value).toBe(true);
		expect(reason.value).toContain('Checking exact Graphic Asset Revisions');

		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(eligibility.value).toEqual({ outcome: 'eligible' });
		expect(blocked.value).toBe(false);
	});

	it('reports a missing reference against the slot an author can repair', async () => {
		statusByAsset.set('asset-1', { outcome: 'missing' });

		const { eligibility, blocked, reason } = mountEligibility(ref(configWithBackground()));
		await flushPromises();

		expect(eligibility.value).toEqual({ outcome: 'missing', ownerSlots: [BACKGROUND_SLOT] });
		expect(blocked.value).toBe(true);
		expect(reason.value).toContain('missing');
	});

	it('reports an unanswered library as unavailable, not missing', async () => {
		statusByAsset.set('asset-1', 'unreachable');

		const { eligibility, reason } = mountEligibility(ref(configWithBackground()));
		await flushPromises();

		expect(eligibility.value).toEqual({ outcome: 'unavailable', ownerSlots: [BACKGROUND_SLOT] });
		expect(reason.value).toContain('temporarily unavailable');
	});

	it('lets missing win over unavailable when both are present', async () => {
		statusByAsset.set('asset-1', { outcome: 'missing' });
		statusByAsset.set('asset-2', 'unreachable');

		const { eligibility } = mountEligibility(ref(configWithBackgroundAndLogo()));
		await flushPromises();

		expect(eligibility.value).toEqual({ outcome: 'missing', ownerSlots: [BACKGROUND_SLOT] });
	});

	it('re-checks on retry and recovers once the library answers', async () => {
		statusByAsset.set('asset-1', 'unreachable');

		const { eligibility, retry } = mountEligibility(ref(configWithBackground()));
		await flushPromises();

		expect(eligibility.value.outcome).toBe('unavailable');

		statusByAsset.set('asset-1', { outcome: 'available' });
		retry();
		await flushPromises();

		expect(eligibility.value).toEqual({ outcome: 'eligible' });
	});

	it('discards the answer to a configuration that has moved on', async () => {
		let resolveStatus!: (value: unknown) => void;
		mockFetch.mockReturnValue(new Promise((resolve) => {
			resolveStatus = resolve;
		}));
		const config = ref(configWithBackground());

		const { eligibility } = mountEligibility(config);

		expect(eligibility.value).toEqual({ outcome: 'checking' });

		config.value = overlayConfig();
		await nextTick();

		expect(eligibility.value).toEqual({ outcome: 'eligible' });

		resolveStatus({ outcome: 'missing' });
		await flushPromises();

		expect(eligibility.value).toEqual({ outcome: 'eligible' });
	});
});

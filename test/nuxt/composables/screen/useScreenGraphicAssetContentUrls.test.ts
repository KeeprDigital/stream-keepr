import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { FeatureMatchOverlayMediaGraphicItemRenderModel } from '~/modules/feature-match-overlay/renderModel';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FeatureMatchOverlayMediaGraphicItem from '~/components/Screen/Modes/FeatureMatchOverlay/MediaGraphicItem.vue';

const reference: GraphicAssetReference = {
	assetId: 'video-asset' as never,
	revisionId: 'video-revision-3' as never,
};

describe('useScreenGraphicAssetContentUrls', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value: vi.fn(() => 'blob:fully-buffered-video'),
		});
		Object.defineProperty(URL, 'revokeObjectURL', {
			configurable: true,
			value: vi.fn(),
		});
	});

	it('renders an exact private silent-video revision without fetching it into a blob first', async () => {
		const context: ScreenContext = {
			screen: ref({ id: 42 } as never),
			eventId: computed(() => 7),
			interactive: ref(false),
			overlayContainer: ref(null),
			isPreview: ref(false),
			assetCapability: ref('opaque_fragment_capability'),
		};
		const Child = defineComponent({
			setup() {
				const { contentUrl } = useScreenGraphicAssetContentUrls([reference]);
				const media = computed<FeatureMatchOverlayMediaGraphicItemRenderModel>(() => ({
					item: {
						id: 'motion-ident',
						type: 'media',
						label: 'Motion ident',
						visible: true,
						x: 0,
						y: 0,
						width: 640,
						height: 360,
						mediaKind: 'silent-video',
						asset: reference,
						fit: 'cover',
						focalPosition: { horizontal: 0.5, vertical: 0.5 },
						opacity: 1,
						loop: true,
						playbackRate: 1,
						videoCompatibility: 'all-supported',
						videoTarget: 'chromium',
					},
					style: {},
					contentStyle: {},
					src: contentUrl(reference),
				}));
				return () => h(FeatureMatchOverlayMediaGraphicItem, { media: media.value });
			},
		});
		const Parent = defineComponent({
			setup() {
				provideScreenContext(context);
				return () => h(Child);
			},
		});

		const wrapper = mount(Parent);
		await flushPromises();

		expect(wrapper.get('video').attributes('src')).toBe(
			'/api/screen-output/screens/42/assets/video-asset/revisions/video-revision-3/content',
		);
		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch).toHaveBeenCalledWith(
			'/api/screen-output/screens/42/asset-capability-session',
			{
				method: 'POST',
				headers: { authorization: 'Bearer opaque_fragment_capability' },
			},
		);
		expect(URL.createObjectURL).not.toHaveBeenCalled();
	});

	it('keeps the shared Screen capability session when one of two render consumers unmounts', async () => {
		const context: ScreenContext = {
			screen: ref({ id: 42 } as never),
			eventId: computed(() => 7),
			interactive: ref(false),
			overlayContainer: ref(null),
			isPreview: ref(false),
			assetCapability: ref('opaque_fragment_capability'),
		};
		const Child = defineComponent({
			setup() {
				const { contentUrl } = useScreenGraphicAssetContentUrls([reference]);
				return () => h('video', { src: contentUrl(reference) });
			},
		});
		const showFirst = ref(true);
		const Parent = defineComponent({
			setup() {
				provideScreenContext(context);
				return () => h('div', [
					showFirst.value ? h(Child, { key: 'first' }) : null,
					h(Child, { key: 'second' }),
				]);
			},
		});

		const wrapper = mount(Parent);
		await flushPromises();
		expect(fetch).toHaveBeenCalledTimes(2);

		showFirst.value = false;
		await nextTick();
		await flushPromises();

		expect(vi.mocked(fetch).mock.calls.every(([, options]) =>
			options?.method === 'POST',
		)).toBe(true);
		expect(wrapper.get('video').attributes('src')).toBe(
			'/api/screen-output/screens/42/assets/video-asset/revisions/video-revision-3/content',
		);
	});
});

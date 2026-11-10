import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCREEN_MODE_REREAD_MS } from '~/modules/screen-mode/freshness';
import { deferred } from '../../../helpers/deferred';

const reference: GraphicAssetReference = {
	assetId: 'video-asset' as never,
	revisionId: 'video-revision-3' as never,
};

const laterReference: GraphicAssetReference = {
	assetId: 'image-asset' as never,
	revisionId: 'image-revision-1' as never,
};
const videoUrl = '/api/screen-output/screens/42/assets/video-asset/revisions/video-revision-3/content';
const imageUrl = '/api/screen-output/screens/42/assets/image-asset/revisions/image-revision-1/content';

/** An output rendering one element per reference it currently publishes. */
function mountOutput(references: Ref<GraphicAssetReference[]>) {
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
			const { contentUrl } = useScreenGraphicAssetContentUrls(references);
			return () => references.value.map(item => h('video', {
				'key': item.assetId,
				'data-asset': item.assetId,
				'src': contentUrl(item),
			}));
		},
	});
	const wrapper = mount(defineComponent({
		setup() {
			provideScreenContext(context);
			return () => h(Child);
		},
	}));
	return {
		src: (asset: string) => wrapper.get(`[data-asset="${asset}"]`).attributes('src'),
	};
}

describe('useScreenGraphicAssetContentUrls', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	// On-air media keeps its URL while the reference set re-resolves: an emptied
	// `src` tears the element down and restarts an on-air video from zero.
	it.each([
		{ answer: 'still pending', settle: undefined, added: '' },
		{
			answer: 'refused',
			settle: new Response(null, { status: 503 }),
			added: '',
		},
		{
			answer: 'answered',
			settle: new Response(null, { status: 204 }),
			added: imageUrl,
		},
	])('keeps on-air media resolved while a changed reference set is $answer', async ({ settle, added }) => {
		const references = ref([reference]);
		const output = mountOutput(references);
		await flushPromises();
		const reresolve = deferred<Response>();
		vi.mocked(fetch).mockReturnValueOnce(reresolve.promise);

		references.value = [reference, laterReference];
		await flushPromises();
		if (settle) {
			reresolve.resolve(settle);
			await flushPromises();
		}

		expect(output.src('video-asset')).toBe(videoUrl);
		expect(output.src('image-asset') ?? '').toBe(added);
	});

	it('asks again on the slow cadence after a refused capability session', async () => {
		vi.useFakeTimers();
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
		const output = mountOutput(ref([reference]));
		await flushPromises();
		expect(output.src('video-asset') ?? '').toBe('');

		await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
		await flushPromises();

		expect(output.src('video-asset')).toBe(videoUrl);
	});

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
				return () => h('video', {
					src: contentUrl(reference),
				});
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
				return () => h('video', {
					src: contentUrl(reference),
				});
			},
		});
		const showFirst = ref(true);
		const Parent = defineComponent({
			setup() {
				provideScreenContext(context);
				return () => h('div', [
					showFirst.value
						? h(Child, { key: 'first' })
						: null,
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

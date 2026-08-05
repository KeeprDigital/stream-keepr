import type {
	GraphicAsset,
	GraphicAssetId,
	GraphicAssetRevisionId,
} from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

enableAutoUnmount(afterEach);

const assets = ref<GraphicAsset[]>([
	{
		id: 'asset-event' as never,
		name: 'Event logo',
		kind: 'image',
		revisionId: 'revision-event-2' as never,
		revisionNumber: 2,
		revisions: [
			{
				id: 'revision-event-1' as never,
				revisionNumber: 1,
				facts: {} as never,
			},
			{
				id: 'revision-event-2' as never,
				revisionNumber: 2,
				facts: {} as never,
			},
		],
		lifecycle: { state: 'active' },
		eventIds: [7],
		facts: {
			kind: 'image',
			format: 'png',
			canonicalMime: 'image/png',
			byteLength: 1024,
			sha256: 'event-digest',
			width: 1920,
			height: 1080,
			pixelCount: 2_073_600,
			frameCount: 1,
			bitDepth: 8,
			colorSpace: 'srgb',
			colorModel: 'rgba',
			hasAlpha: true,
			orientation: 'normal',
		},
		operation: {} as never,
	},
	{
		id: 'asset-shared' as never,
		name: 'Shared logo',
		kind: 'image',
		revisionId: 'revision-shared-1' as never,
		revisionNumber: 1,
		revisions: [{
			id: 'revision-shared-1' as never,
			revisionNumber: 1,
			facts: {} as never,
		}],
		lifecycle: { state: 'active' },
		eventIds: [8],
		facts: {
			kind: 'image',
			format: 'png',
			canonicalMime: 'image/png',
			byteLength: 512,
			sha256: 'shared-digest',
			width: 640,
			height: 360,
			pixelCount: 230_400,
			frameCount: 1,
			bitDepth: 8,
			colorSpace: 'srgb',
			colorModel: 'rgb',
			hasAlpha: false,
			orientation: 'normal',
		},
		operation: {} as never,
	},
	{
		id: 'asset-alpha-video' as never,
		name: 'Chromium alpha ident',
		kind: 'silent-video',
		revisionId: 'revision-alpha-video-1' as never,
		revisionNumber: 1,
		revisions: [{
			id: 'revision-alpha-video-1' as never,
			revisionNumber: 1,
			facts: {} as never,
		}],
		lifecycle: { state: 'active' },
		eventIds: [7],
		facts: {
			kind: 'silent-video',
			format: 'webm',
			codec: 'vp9',
			canonicalMime: 'video/webm',
			byteLength: 2048,
			sha256: 'video-digest',
			width: 640,
			height: 360,
			durationSeconds: 1,
			frameRate: 30,
			frameCount: 30,
			bitDepth: 8,
			colorSpace: 'sdr',
			chromaSubsampling: '4:2:0',
			hasAlpha: true,
			fastStart: null,
			seekable: true,
			posterTimeSeconds: 0.1,
			targetCompatibility: 'chromium-transparency',
			browserPlayable: true,
			chromiumTransparencyPlayback: true,
		},
		operation: {} as never,
	},
	/**
	 * A transparent clip no engine is confirmed to play: its validation never
	 * established Chromium transparency playback, so the hard gate refuses it for every
	 * target including Chromium.
	 */
	{
		id: 'asset-unplayable-video' as never,
		name: 'Unverified alpha ident',
		kind: 'silent-video',
		revisionId: 'revision-unplayable-video-1' as never,
		revisionNumber: 1,
		revisions: [{
			id: 'revision-unplayable-video-1' as never,
			revisionNumber: 1,
			facts: {} as never,
		}],
		lifecycle: { state: 'active' },
		eventIds: [7],
		facts: {
			kind: 'silent-video',
			format: 'webm',
			codec: 'vp9',
			canonicalMime: 'video/webm',
			byteLength: 2048,
			sha256: 'unplayable-digest',
			width: 640,
			height: 360,
			durationSeconds: 1,
			frameRate: 30,
			frameCount: 30,
			bitDepth: 8,
			colorSpace: 'sdr',
			chromaSubsampling: '4:2:0',
			hasAlpha: true,
			fastStart: null,
			seekable: true,
			posterTimeSeconds: 0.1,
			targetCompatibility: 'chromium-transparency',
			browserPlayable: true,
		},
		operation: {} as never,
	},
]);
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

mockNuxtImport('useFetch', () => () => ({
	data: assets,
	status: ref('success'),
	error: ref(null),
}));
mockNuxtImport('$fetch', () => mockApiFetch);
// The real composable auto-starts a singleton that synchronises against
// `/api/time` on its own timers, so the shared `$fetch` mock would count
// requests this file never made.
mockNuxtImport('useServerTime', () => () => ({
	getServerTime: () => Date.now(),
}));

const passthroughStub = defineComponent({
	template: '<div><slot name="content" /><slot /></div>',
});
const buttonStub = defineComponent({
	props: ['label'],
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')"><slot />{{ label }}</button>',
});

describe('the contextual Graphic Asset Focus Picker', () => {
	beforeEach(() => {
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({
			outcome: 'available',
			lifecycleState: 'active',
		});
	});

	it('preserves Event context, shows verified facts, and returns one exact revision', async () => {
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				modelValue: undefined,
				eventId: 7,
				fieldLabel: 'Frame image',
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: passthroughStub,
					UIcon: passthroughStub,
				},
			},
		});

		await wrapper.get('[data-testid="open-graphic-asset-picker"]').trigger('click');
		expect(wrapper.text()).toContain('Frame image');
		expect(wrapper.text()).toContain('This Event');
		expect(wrapper.text()).toContain('Event logo');
		expect(wrapper.text()).toContain('1920 × 1080');
		expect(wrapper.text()).toContain('PNG compatible');
		expect(wrapper.text()).not.toContain('Shared logo');

		await wrapper.get('[data-testid="show-all-assets"]').trigger('click');
		expect(wrapper.text()).toContain('Shared logo');
		await wrapper.get('[data-testid="select-asset-shared"]').trigger('click');

		expect(wrapper.emitted('update:modelValue')).toEqual([[
			{ assetId: 'asset-shared', revisionId: 'revision-shared-1' },
		]]);
	});

	it('keeps a missing exact reference visible as a publication-blocking integrity failure', async () => {
		mockApiFetch.mockResolvedValue({ outcome: 'missing' });
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				modelValue: {
					assetId: 'missing-asset' as GraphicAssetId,
					revisionId: 'missing-revision' as GraphicAssetRevisionId,
				},
				eventId: 7,
				fieldLabel: 'Frame image',
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: defineComponent({
						props: ['title', 'description'],
						template: '<div>{{ title }} {{ description }}</div>',
					}),
					UIcon: passthroughStub,
				},
			},
		});
		await flushPromises();

		expect(wrapper.text()).toContain('Missing Graphic Asset Reference');
		expect(wrapper.text()).toContain('Publication-requiring actions are unavailable');
	});

	it('blocks VP9-alpha placement for a Safari target and permits a declared Chromium target', async () => {
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				eventId: 7,
				fieldLabel: 'Media Graphic Item',
				assetKind: ['silent-video'],
				videoTarget: 'safari',
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: passthroughStub,
					UIcon: passthroughStub,
				},
			},
		});

		await wrapper.get('[data-testid="open-graphic-asset-picker"]').trigger('click');
		const select = wrapper.get('[data-testid="select-asset-alpha-video"]');
		expect(select.attributes('disabled')).toBeDefined();
		await select.trigger('click');
		expect(wrapper.emitted('update:modelValue')).toBeUndefined();

		await wrapper.setProps({ videoTarget: 'chromium' });
		expect(select.attributes('disabled')).toBeUndefined();
		await select.trigger('click');
		expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({
			assetId: 'asset-alpha-video',
			revisionId: 'revision-alpha-video-1',
		});
	});

	/**
	 * The refusal has to name what refused it. The hard gate fires for a transparent
	 * clip whose facts do not confirm Chromium playback — a clip no engine is known to
	 * play — and it fires whatever target the host writes with. Live Control passes
	 * `chromium`, so calling that a Safari problem sends an operator mid-show to change
	 * a setting that is already right and cannot help (#204).
	 */
	it('does not blame the target for a revision no engine is confirmed to play', async () => {
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				eventId: 7,
				fieldLabel: 'Badge',
				assetKind: ['silent-video'],
				videoTarget: 'chromium',
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: passthroughStub,
					UIcon: passthroughStub,
				},
			},
		});

		await wrapper.get('[data-testid="open-graphic-asset-picker"]').trigger('click');

		const refused = wrapper.get('[data-testid="select-asset-unplayable-video"]');
		expect(refused.attributes('disabled')).toBeDefined();
		expect(refused.text()).not.toContain('Safari');
		expect(refused.text()).toContain('no engine plays this revision');
	});

	it('names the target when the target is what refuses the revision', async () => {
		// The same clip the Chromium target accepts, refused for Safari: here the
		// target really is the reason, and saying so is what tells the operator that
		// pinning it for the Chromium program output would work.
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				eventId: 7,
				fieldLabel: 'Badge',
				assetKind: ['silent-video'],
				videoTarget: 'safari',
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: passthroughStub,
					UIcon: passthroughStub,
				},
			},
		});

		await wrapper.get('[data-testid="open-graphic-asset-picker"]').trigger('click');

		expect(wrapper.get('[data-testid="select-asset-alpha-video"]').text())
			.toContain('Blocked for Safari target');
		// And the clip nothing can play still says so, rather than being folded into
		// the target's refusal because this host happens to write for Safari.
		expect(wrapper.get('[data-testid="select-asset-unplayable-video"]').text())
			.toContain('no engine plays this revision');
	});

	/**
	 * Compatibility is a fact of the revision, not a choice, so it is stated before
	 * the choice rather than discovered on air. It never refuses the revision: post-#98
	 * a clip one open output cannot play costs that output that clip and nothing else,
	 * and the Chromium program output is usually the one the operator is choosing for.
	 */
	it('names the open outputs that cannot play a revision without refusing it', async () => {
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				eventId: 7,
				fieldLabel: 'Badge',
				assetKind: ['silent-video'],
				videoTarget: 'chromium',
				openOutputTargets: ['chromium', 'safari'],
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: passthroughStub,
					UIcon: passthroughStub,
				},
			},
		});

		await wrapper.get('[data-testid="open-graphic-asset-picker"]').trigger('click');

		const warning = wrapper.get('[data-testid="open-output-incompatible-asset-alpha-video"]');
		expect(warning.text()).toContain('Safari');
		const select = wrapper.get('[data-testid="select-asset-alpha-video"]');
		expect(select.attributes('disabled')).toBeUndefined();

		await select.trigger('click');
		expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({
			assetId: 'asset-alpha-video',
			revisionId: 'revision-alpha-video-1',
		});
	});

	it('says nothing about playback when every open output can play the revision', async () => {
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				eventId: 7,
				fieldLabel: 'Badge',
				assetKind: ['silent-video'],
				videoTarget: 'chromium',
				openOutputTargets: ['chromium'],
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: passthroughStub,
					UIcon: passthroughStub,
				},
			},
		});

		await wrapper.get('[data-testid="open-graphic-asset-picker"]').trigger('click');

		expect(wrapper.find('[data-testid="open-output-incompatible-asset-alpha-video"]').exists()).toBe(false);
	});

	/**
	 * A host that shows and clears the pinned reference itself still wants the
	 * picker's report on it. Withholding the Clear is what lets it have both without
	 * offering the operator two of them.
	 */
	it('withholds its own Clear for a host that owns one, while still reporting the pinned revision', async () => {
		mockApiFetch.mockResolvedValue({ outcome: 'missing' });
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				modelValue: {
					assetId: 'missing-asset' as GraphicAssetId,
					revisionId: 'missing-revision' as GraphicAssetRevisionId,
				},
				eventId: 7,
				fieldLabel: 'Badge',
				clearable: false,
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: defineComponent({
						props: ['title', 'description'],
						template: '<div>{{ title }} {{ description }}</div>',
					}),
					UIcon: passthroughStub,
				},
			},
		});
		await flushPromises();

		expect(wrapper.find('[data-testid="clear-graphic-asset"]').exists()).toBe(false);
		expect(wrapper.text()).toContain('Missing Graphic Asset Reference');

		// The default is still to offer it, for the hosts that have no Clear of their own.
		await wrapper.setProps({ clearable: true });
		expect(wrapper.find('[data-testid="clear-graphic-asset"]').exists()).toBe(true);
	});

	it('refreshes its exact-revision status when unavailable content is retried', async () => {
		mockApiFetch.mockResolvedValue({ outcome: 'unavailable', retryable: true });
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				modelValue: {
					assetId: 'temporarily-unavailable-asset' as GraphicAssetId,
					revisionId: 'pinned-revision' as GraphicAssetRevisionId,
				},
				eventId: 7,
				fieldLabel: 'Frame image',
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: defineComponent({
						props: ['title', 'description'],
						template: '<div>{{ title }} {{ description }}</div>',
					}),
					UIcon: passthroughStub,
				},
			},
		});
		await flushPromises();

		expect(wrapper.text()).toContain('Unavailable Graphic Asset Content');

		const requestsBeforeRetry = mockApiFetch.mock.calls.length;
		mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'active' });
		await wrapper.get('[data-testid="retry-graphic-asset-reference-status"]').trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledTimes(requestsBeforeRetry + 1);
		expect(wrapper.text()).toContain('Pinned revision pinned-revision is available');
		expect(wrapper.text()).not.toContain('Unavailable Graphic Asset Content');
	});

	it('discards a stale reference-status Flight after the selected revision changes', async () => {
		let resolveFirst!: (status: { outcome: 'available'; lifecycleState: 'active' }) => void;
		let resolveSecond!: (status: { outcome: 'missing' }) => void;
		mockApiFetch
			.mockReturnValueOnce(new Promise(resolve => (resolveFirst = resolve)))
			.mockReturnValueOnce(new Promise(resolve => (resolveSecond = resolve)));
		const { default: FocusPicker } = await import('~/components/GraphicsAsset/FocusPicker.vue');
		const wrapper = mount(FocusPicker, {
			props: {
				modelValue: {
					assetId: 'first-asset' as GraphicAssetId,
					revisionId: 'first-revision' as GraphicAssetRevisionId,
				},
				eventId: 7,
				fieldLabel: 'Frame image',
			},
			global: {
				stubs: {
					UModal: passthroughStub,
					UButton: buttonStub,
					UInput: passthroughStub,
					UBadge: passthroughStub,
					UAlert: defineComponent({
						props: ['title', 'description'],
						template: '<div>{{ title }} {{ description }}</div>',
					}),
					UIcon: passthroughStub,
				},
			},
		});

		await wrapper.setProps({
			modelValue: {
				assetId: 'second-asset' as GraphicAssetId,
				revisionId: 'second-revision' as GraphicAssetRevisionId,
			},
		});
		resolveSecond({ outcome: 'missing' });
		await flushPromises();
		resolveFirst({ outcome: 'available', lifecycleState: 'active' });
		await flushPromises();

		expect(wrapper.text()).toContain('Missing Graphic Asset Reference');
		expect(wrapper.text()).not.toContain('Pinned revision first-revision');
	});
});

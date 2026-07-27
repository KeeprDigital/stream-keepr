import type {
	GraphicAsset,
	GraphicAssetId,
	GraphicAssetRevisionId,
} from '~~/shared/types/graphicsAsset';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

const assets = ref<GraphicAsset[]>([
	{
		id: 'asset-event' as never,
		name: 'Event logo',
		kind: 'image',
		revisionId: 'revision-event-2' as never,
		revisionNumber: 2,
		eventIds: [7],
		facts: {
			kind: 'image',
			canonicalMime: 'image/png',
			byteLength: 1024,
			sha256: 'event-digest',
			width: 1920,
			height: 1080,
			pixelCount: 2_073_600,
			bitDepth: 8,
			colorModel: 'rgba',
			hasAlpha: true,
		},
		operation: {} as never,
	},
	{
		id: 'asset-shared' as never,
		name: 'Shared logo',
		kind: 'image',
		revisionId: 'revision-shared-1' as never,
		revisionNumber: 1,
		eventIds: [8],
		facts: {
			kind: 'image',
			canonicalMime: 'image/png',
			byteLength: 512,
			sha256: 'shared-digest',
			width: 640,
			height: 360,
			pixelCount: 230_400,
			bitDepth: 8,
			colorModel: 'rgb',
			hasAlpha: false,
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

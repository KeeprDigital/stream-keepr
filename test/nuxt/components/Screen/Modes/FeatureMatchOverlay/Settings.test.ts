import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

enableAutoUnmount(afterEach);

const mockConfig = ref(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
const mockScreenConfig = ref({ width: 1920, height: 1080 });
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});
const mockUpdateScreenConfig = vi.fn((patch: Record<string, unknown>) => {
	mockScreenConfig.value = {
		...mockScreenConfig.value,
		...patch,
	};
});
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

const mockFeatureMatchStore = {
	loadFeatureMatchesByEventId: vi.fn().mockResolvedValue(undefined),
};

const mockScreenStore = {
	updateScreenConfig: vi.fn().mockResolvedValue(undefined),
};

mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useFeatureMatchMenuItems', () => () => computed(() => [
	{ label: 'Feature Match 1', value: 1 },
]));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));
mockNuxtImport('useScreenConfigUpdate', () => () => ({
	screenConfig: mockScreenConfig,
	saving: ref(false),
	updateScreenConfig: mockUpdateScreenConfig,
	resetScreenConfig: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

const ScreenSettingsCardStub = defineComponent({
	props: {
		title: { type: String, required: false },
	},
	template: '<section data-testid="settings-card"><h2>{{ title }}</h2><slot /></section>',
});

const LayerInspectorStub = defineComponent({
	props: {
		selectedTarget: { type: Object, required: true },
	},
	emits: ['update:selectedTarget'],
	template: '<div data-testid="layer-inspector" :data-selected="JSON.stringify(selectedTarget)" />',
});

const CompositorTreeStub = defineComponent({
	props: {
		selectedTarget: { type: Object, required: true },
	},
	emits: ['update:selectedTarget'],
	template: '<div data-testid="compositor-tree" :data-selected="JSON.stringify(selectedTarget)" />',
});

const CompositorInspectorStub = defineComponent({
	props: {
		selectedTarget: { type: Object, required: true },
	},
	template: '<div data-testid="compositor-inspector" :data-selected="JSON.stringify(selectedTarget)" />',
});

const PreviewOutputAsideStub = defineComponent({
	props: {
		config: { type: Object, required: true },
		selectedTarget: { type: Object, required: true },
		compositorTarget: { type: Object, required: true },
		publicationBlocked: { type: Boolean, required: false },
		publicationBlockReason: { type: String, required: false },
	},
	emits: ['selectTarget', 'selectCompositorTarget'],
	template: '<button data-testid="preview-output-aside" :data-selected="JSON.stringify(selectedTarget)" :data-compositor-selected="JSON.stringify(compositorTarget)" :data-config="JSON.stringify(config)" :data-publication-blocked="String(publicationBlocked)" :title="publicationBlockReason" @click="$emit(\'selectTarget\', { type: \'graphic-item\', itemId: \'top-bar\', childId: \'top-name-record\' })" />',
});

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<div data-testid="form-field"><span>{{ label }}</span><slot /></div>',
});

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="canvas-dimension-input" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))">',
});

const UFieldGroupStub = defineComponent({
	template: '<div data-testid="field-group"><slot /></div>',
});

const UButtonStub = defineComponent({
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

async function mountComponent(screen: Partial<Screen> = {}) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/Settings.vue';
	const { default: Settings } = await import(componentPath);

	return mount(Settings, {
		props: {
			screen: {
				id: 1,
				slug: 'main',
				screenConfig: { width: 1920, height: 1080 },
				...screen,
			} as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				FeatureMatchOverlayLayerInspector: LayerInspectorStub,
				FeatureMatchOverlayCompositorTree: CompositorTreeStub,
				FeatureMatchOverlayCompositorInspector: CompositorInspectorStub,
				FeatureMatchOverlayPreviewOutputAside: PreviewOutputAsideStub,
				// The Feature Match Layout Template library reads the installation's
				// library on mount. It has its own suite; here it is only a neighbour of
				// the two authoring surfaces under test.
				GraphicsFeatureMatchLayoutTemplateLibrary: true,
				UFormField: UFormFieldStub,
				USelect: true,
				UInputNumber: UInputNumberStub,
				UFieldGroup: UFieldGroupStub,
				UButton: UButtonStub,
				UAlert: true,
				UModal: true,
			},
		},
	});
}

function selectedTarget(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return JSON.parse(wrapper.get('[data-testid="layer-inspector"]').attributes('data-selected') ?? '{}');
}

function compositorTarget(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return JSON.parse(wrapper.get('[data-testid="compositor-tree"]').attributes('data-selected') ?? '{}');
}

function previewSelectedTarget(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return JSON.parse(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-selected') ?? '{}');
}

function previewConfig(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return JSON.parse(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-config') ?? '{}');
}

describe('featureMatchOverlaySettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		mockScreenConfig.value = { width: 1920, height: 1080 };
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({
			outcome: 'available',
			lifecycleState: 'active',
		});
	});

	it('updates selected target from the preview component', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(selectedTarget(wrapper)).toEqual({ type: 'canvas' });

		await wrapper.get('[data-testid="preview-output-aside"]').trigger('click');
		await nextTick();

		expect(selectedTarget(wrapper)).toEqual({ type: 'graphic-item', itemId: 'top-bar', childId: 'top-name-record' });
		expect(previewSelectedTarget(wrapper)).toEqual({ type: 'graphic-item', itemId: 'top-bar', childId: 'top-name-record' });
		expect(previewConfig(wrapper).presetId).toBe(mockConfig.value.presetId);
	});

	it('keeps canvas dimensions in the builder setup toolbar', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const inputs = wrapper.findAllComponents({ name: 'UInputNumber' });
		expect(inputs).toHaveLength(2);
		expect(inputs[0]?.props('modelValue')).toBe(1920);
		expect(inputs[1]?.props('modelValue')).toBe(1080);

		await inputs[0]?.vm.$emit('update:modelValue', 1280);
		await nextTick();

		expect(mockUpdateScreenConfig).toHaveBeenCalledWith({ width: 1280 });
	});

	it('visibly blocks output actions while an exact Graphic Asset Reference is missing', async () => {
		mockConfig.value.layout.frame.backgroundImage = {
			assetId: 'missing-asset',
			revisionId: 'missing-revision',
		} as never;
		mockApiFetch.mockResolvedValue({ outcome: 'missing' });

		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.find('[data-testid="graphic-asset-publication-block"]').exists()).toBe(true);
		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-publication-blocked')).toBe('true');
		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('title'))
			.toContain('missing');
	});

	it('retries unavailable Graphic Asset Content without changing the pinned reference', async () => {
		mockConfig.value.layout.frame.backgroundImage = {
			assetId: 'temporarily-unavailable-asset',
			revisionId: 'pinned-revision',
		} as never;
		mockApiFetch.mockResolvedValue({ outcome: 'unavailable', retryable: true });

		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-publication-blocked')).toBe('true');

		const requestsBeforeRetry = mockApiFetch.mock.calls.length;
		mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'active' });
		await wrapper.get('[data-testid="retry-graphic-asset-publication"]').trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledTimes(requestsBeforeRetry + 1);
		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-publication-blocked')).toBe('false');
		expect(mockConfig.value.layout.frame.backgroundImage).toEqual({
			assetId: 'temporarily-unavailable-asset',
			revisionId: 'pinned-revision',
		});
	});

	describe('two authoring surfaces, one selection', () => {
		it('clears the host-owned selection when a shared Graphic Item is chosen', async () => {
			// There is one property panel. Leaving both selections live meant the panel
			// kept showing the compositor's while the host-owned ref moved underneath it.
			const wrapper = await mountComponent();

			wrapper.getComponent(LayerInspectorStub).vm.$emit('update:selectedTarget', { type: 'frame' });
			await nextTick();
			expect(selectedTarget(wrapper)).toEqual({ type: 'frame' });

			wrapper.getComponent(CompositorTreeStub).vm.$emit('update:selectedTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: 'clock' });
			await nextTick();

			expect(compositorTarget(wrapper)).toMatchObject({ type: 'item', itemId: 'clock' });
			expect(selectedTarget(wrapper)).toEqual({ type: 'canvas' });
		});

		it('returns to the legacy inspector when a host-owned target is chosen', async () => {
			// The regression this pins: selecting a shared item and then a legacy widget
			// left the legacy inspector unreachable until the author re-selected canvas.
			const wrapper = await mountComponent();

			wrapper.getComponent(CompositorTreeStub).vm.$emit('update:selectedTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: 'clock' });
			await nextTick();
			expect(wrapper.find('[data-testid="compositor-inspector"]').exists()).toBe(true);

			wrapper.getComponent(LayerInspectorStub).vm.$emit('update:selectedTarget', { type: 'frame' });
			await nextTick();

			expect(compositorTarget(wrapper)).toEqual({ type: 'canvas' });
			expect(wrapper.find('[data-testid="compositor-inspector"]').exists()).toBe(false);
			expect(selectedTarget(wrapper)).toEqual({ type: 'frame' });
		});

		it('selects a shared Graphic Item clicked in the preview, and clears the host-owned one', async () => {
			// Parity with the legacy widgets on the same page: a shared Graphic Item
			// clicked in the preview reaches the same property panel choosing it in the
			// tree does, and the two authoring surfaces stay one selection.
			const wrapper = await mountComponent();
			wrapper.getComponent(LayerInspectorStub).vm.$emit('update:selectedTarget', { type: 'frame' });
			await nextTick();

			wrapper.getComponent(PreviewOutputAsideStub).vm.$emit('selectCompositorTarget', {
				type: 'item',
				graphicId: 'feature-match-layout',
				itemId: 'clock',
			});
			await nextTick();

			expect(compositorTarget(wrapper)).toMatchObject({ type: 'item', itemId: 'clock' });
			expect(selectedTarget(wrapper)).toEqual({ type: 'canvas' });
			expect(wrapper.find('[data-testid="compositor-inspector"]').exists()).toBe(true);
		});

		it('pushes the shared selection into the preview so it can mark what is under authoring', async () => {
			const wrapper = await mountComponent();

			wrapper.getComponent(CompositorTreeStub).vm.$emit('update:selectedTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: 'clock' });
			await nextTick();

			expect(JSON.parse(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-compositor-selected') ?? 'null'))
				.toMatchObject({ type: 'item', itemId: 'clock' });
		});

		it('returns both surfaces to the canvas when a preset is reset', async () => {
			const wrapper = await mountComponent();

			wrapper.getComponent(CompositorTreeStub).vm.$emit('update:selectedTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: 'clock' });
			await nextTick();

			await wrapper.get('[data-testid="reset-preset"]').trigger('click');
			await nextTick();

			expect(compositorTarget(wrapper)).toEqual({ type: 'canvas' });
			expect(selectedTarget(wrapper)).toEqual({ type: 'canvas' });
		});
	});
});

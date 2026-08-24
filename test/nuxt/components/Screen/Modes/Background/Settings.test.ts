import type { BackgroundLayer, BackgroundModeConfig } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { createMockScreen } from '../../../../../helpers/fixtures';

const config = ref<BackgroundModeConfig>({ layers: [] });
const updateConfig = vi.fn();
const resetConfig = vi.fn();

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving: computed(() => false),
	updateConfig,
	resetConfig,
}));

const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<label :data-label="label"><slot /></label>',
});

const USelectStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select data-testid="u-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items || []" :key="String(item.value ?? item)" :value="item.value ?? item" :disabled="item.disabled">{{ item.label ?? item }}</option></select>',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
	},
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
});

const UInputStub = defineComponent({
	props: { modelValue: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<input data-testid="u-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const UInputNumberStub = defineComponent({
	props: { modelValue: { type: Number, required: false } },
	emits: ['update:modelValue'],
	template: '<input data-testid="u-input-number" type="number" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
});

const ScreenSettingsToggleStub = defineComponent({
	props: {
		label: { type: String, required: false },
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

const AnimationEffectFieldsStub = defineComponent({
	props: { selection: { type: Object, required: true } },
	emits: ['update:selection'],
	template: '<div data-testid="animation-effect-fields" @click="$emit(\'update:selection\', { effect: \'caustics\' })" />',
});

function colorLayer(id: string, overrides: Partial<Extract<BackgroundLayer, { type: 'color' }>> = {}): BackgroundLayer {
	return { id, type: 'color', enabled: true, opacity: 1, color: '#101010', ...overrides };
}

function animationLayer(id: string): BackgroundLayer {
	return { id, type: 'animation', enabled: true, opacity: 1, animation: { effect: 'fog' } };
}

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/Background/Settings.vue';
	const { default: Settings } = await import(componentPath);

	return mount(Settings, {
		props: {
			screen: createMockScreen({ currentMode: 'background' }),
			eventId: 7,
		},
		global: {
			stubs: {
				ScreenSettingsCard: defineComponent({ template: '<section><slot /></section>' }),
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				ScreenAnimationEffectFields: AnimationEffectFieldsStub,
				GraphicsAssetFocusPicker: defineComponent({ template: '<div data-testid="asset-picker" />' }),
				UIColorPicker: defineComponent({ props: { modelValue: { type: String, required: false } }, template: '<div data-testid="color-picker" />' }),
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UButton: UButtonStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
			},
		},
	});
}

function lastLayersWrite(): BackgroundLayer[] {
	const patch = updateConfig.mock.calls.at(-1)?.[0] as { layers: BackgroundLayer[] };
	return patch.layers;
}

describe('screenModesBackgroundSettings', () => {
	beforeEach(() => {
		config.value = { layers: [] };
		updateConfig.mockClear();
		resetConfig.mockClear();
	});

	it('lists each layer in stack order', async () => {
		config.value = { layers: [colorLayer('base'), animationLayer('anim')] };
		const wrapper = await mountComponent();

		const rows = wrapper.findAll('[data-testid="background-layer-row"]');
		expect(rows).toHaveLength(2);
		expect(rows[0]!.attributes('data-layer-id')).toBe('base');
		expect(rows[1]!.attributes('data-layer-id')).toBe('anim');
	});

	it('adds a layer of the chosen type with its starting values', async () => {
		const wrapper = await mountComponent();

		await wrapper.find('[data-testid="add-layer-type"] select').setValue('color');
		await wrapper.find('[data-testid="add-layer"]').trigger('click');

		const layers = lastLayersWrite();
		expect(layers).toHaveLength(1);
		expect(layers[0]).toMatchObject({ type: 'color', enabled: true, opacity: 1 });
		expect(layers[0]!.id).toBeTruthy();
	});

	it('starts a new animation layer on fog', async () => {
		const wrapper = await mountComponent();

		await wrapper.find('[data-testid="add-layer-type"] select').setValue('animation');
		await wrapper.find('[data-testid="add-layer"]').trigger('click');

		expect(lastLayersWrite()[0]).toMatchObject({
			type: 'animation',
			animation: { effect: 'fog' },
		});
	});

	it('refuses a second animation layer at the editor, matching the schema rule', async () => {
		config.value = { layers: [animationLayer('anim')] };
		const wrapper = await mountComponent();

		const animationOption = wrapper.find('[data-testid="add-layer-type"] option[value="animation"]');
		expect(animationOption.attributes('disabled')).toBeDefined();
	});

	it('removes a layer', async () => {
		config.value = { layers: [colorLayer('base'), animationLayer('anim')] };
		const wrapper = await mountComponent();

		await wrapper.find('[data-layer-id="base"] [data-testid="remove-layer"]').trigger('click');

		expect(lastLayersWrite().map(layer => layer.id)).toEqual(['anim']);
	});

	it('reorders a layer within the stack', async () => {
		config.value = { layers: [colorLayer('base'), animationLayer('anim')] };
		const wrapper = await mountComponent();

		await wrapper.find('[data-layer-id="anim"] [data-testid="move-layer-back"]').trigger('click');

		expect(lastLayersWrite().map(layer => layer.id)).toEqual(['anim', 'base']);
	});

	it('writes an enabled toggle and an opacity change onto that layer alone', async () => {
		config.value = { layers: [colorLayer('base'), animationLayer('anim')] };
		const wrapper = await mountComponent();

		await wrapper.find('[data-layer-id="base"] [data-testid="settings-toggle"]').trigger('click');
		expect(lastLayersWrite().find(layer => layer.id === 'base')).toMatchObject({ enabled: false });
		expect(lastLayersWrite().find(layer => layer.id === 'anim')).toMatchObject({ enabled: true });

		await wrapper.find('[data-layer-id="base"] [data-testid="layer-opacity"] input').setValue('0.4');
		expect(lastLayersWrite().find(layer => layer.id === 'base')).toMatchObject({ opacity: 0.4 });
	});

	it('edits an animation layer through the shared Animation Effect fields', async () => {
		config.value = { layers: [animationLayer('anim')] };
		const wrapper = await mountComponent();

		await wrapper.find('[data-testid="animation-effect-fields"]').trigger('click');

		expect(lastLayersWrite()[0]).toMatchObject({
			type: 'animation',
			animation: { effect: 'caustics' },
		});
	});

	it('exposes resetConfig and saving for the configuration page', async () => {
		const wrapper = await mountComponent();
		const exposed = wrapper.vm as unknown as { resetConfig?: unknown; saving?: unknown };

		expect(exposed.resetConfig).toBeDefined();
		expect(exposed.saving).toBeDefined();
	});
});

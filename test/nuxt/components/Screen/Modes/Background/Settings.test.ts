import type { GraphicLinearGradientFill } from '~~/shared/types/graphics';
import type { BackgroundLayer, BackgroundModeConfig } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { screenSettingsPage } from '~~/test/nuxt/helpers/screenThemeOverrides';
import Settings from '~/components/Screen/Modes/Background/Settings.vue';
import { createMockScreen } from '../../../../../helpers/fixtures';
import { ScreenSettingsSectionStub } from '~~/test/nuxt/helpers/screenSettingsSection';

// Every mount reads the one shared config; a mount left behind re-renders on each later test's edit.
enableAutoUnmount(afterEach);

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
	props: {
		label: { type: String, required: false },
	},
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
	props: {
		modelValue: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="u-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
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
	props: {
		selection: { type: Object, required: true },
	},
	emits: ['update:selection'],
	template: '<div data-testid="animation-effect-fields" @click="$emit(\'update:selection\', { effect: \'caustics\' })" />',
});

function colorLayer(id: string, overrides: Partial<Extract<BackgroundLayer, { type: 'color' }>> = {}): BackgroundLayer {
	return {
		id,
		type: 'color',
		enabled: true,
		opacity: 1,
		color: '#101010',
		...overrides,
	};
}

const STARTING_GRADIENT: GraphicLinearGradientFill = {
	type: 'linear-gradient',
	angle: 180,
	stops: [
		{ color: '#0f172a', position: 0, opacity: 1 },
		{ color: '#020617', position: 1, opacity: 1 },
	],
};

function gradientLayer(id: string, gradient: Extract<BackgroundLayer, { type: 'gradient' }>['gradient']): BackgroundLayer {
	return {
		id,
		type: 'gradient',
		enabled: true,
		opacity: 1,
		gradient,
	};
}

function animationLayer(id: string): BackgroundLayer {
	return {
		id,
		type: 'animation',
		enabled: true,
		opacity: 1,
		animation: { effect: 'fog' },
	};
}

async function mountComponent() {
	const screen = createMockScreen({ currentMode: 'background' }) as never;
	return mount(screenSettingsPage(() => screen, () => h(Settings, { screen, eventId: 7 })), {
		global: {
			stubs: {
				ScreenSettingsSection: ScreenSettingsSectionStub,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				ScreenAnimationEffectFields: AnimationEffectFieldsStub,
				GraphicsAssetFocusPicker: defineComponent({ template: '<div data-testid="asset-picker" />' }),
				UIColorPicker: defineComponent({
					props: {
						modelValue: { type: String, required: false },
					},
					template: '<div data-testid="color-picker" />',
				}),
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
		config.value = {
			layers: [
				colorLayer('base'),
				animationLayer('anim'),
			],
		};
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

	it('starts a new gradient layer on a Graphic Fill gradient', async () => {
		const wrapper = await mountComponent();

		await wrapper.find('[data-testid="add-layer-type"] select').setValue('gradient');
		await wrapper.find('[data-testid="add-layer"]').trigger('click');

		expect(lastLayersWrite()[0]).toMatchObject({ type: 'gradient', gradient: STARTING_GRADIENT });
	});

	it('edits a gradient layer through the shared fill control, as a gradient only', async () => {
		config.value = {
			layers: [
				gradientLayer('grad', STARTING_GRADIENT),
			],
		};
		const wrapper = await mountComponent();
		const row = wrapper.get('[data-layer-id="grad"]');

		expect(row.findAll('[data-testid="background-gradient-stop"]')).toHaveLength(2);
		expect(row.find('[data-testid="background-gradient-kind"]').exists()).toBe(false);

		await row.get('[data-testid="background-gradient-add-stop"]').trigger('click');

		expect(lastLayersWrite()[0]).toMatchObject({
			gradient: {
				...STARTING_GRADIENT,
				stops: [...STARTING_GRADIENT.stops, STARTING_GRADIENT.stops[1]],
			},
		});
	});

	// A CSS gradient string stored before the layer held a Graphic Fill: shown, never typed.
	it('shows a stored CSS gradient as stored, and replaces it with a Graphic Fill gradient', async () => {
		config.value = {
			layers: [
				gradientLayer('grad', 'radial-gradient(#000, #123)'),
			],
		};
		const wrapper = await mountComponent();
		const row = wrapper.get('[data-layer-id="grad"]');

		expect(row.get('[data-testid="stored-css-gradient"]').text()).toBe('radial-gradient(#000, #123)');
		expect(row.find('[data-testid="background-gradient-stop"]').exists()).toBe(false);
		expect(row.find('input[data-testid="u-input"]').exists()).toBe(false);
		expect(updateConfig).not.toHaveBeenCalled();

		await row.get('[data-testid="replace-stored-gradient"]').trigger('click');

		expect(lastLayersWrite()).toEqual([
			gradientLayer('grad', STARTING_GRADIENT),
		]);
	});

	it('refuses a second animation layer at the editor, matching the schema rule', async () => {
		config.value = {
			layers: [
				animationLayer('anim'),
			],
		};
		const wrapper = await mountComponent();

		const animationOption = wrapper.find('[data-testid="add-layer-type"] option[value="animation"]');
		expect(animationOption.attributes('disabled')).toBeDefined();
	});

	it('removes a layer', async () => {
		config.value = {
			layers: [
				colorLayer('base'),
				animationLayer('anim'),
			],
		};
		const wrapper = await mountComponent();

		await wrapper.find('[data-layer-id="base"] [data-testid="remove-layer"]').trigger('click');

		expect(lastLayersWrite().map(layer => layer.id)).toEqual(['anim']);
	});

	it('reorders a layer within the stack', async () => {
		config.value = {
			layers: [
				colorLayer('base'),
				animationLayer('anim'),
			],
		};
		const wrapper = await mountComponent();

		await wrapper.find('[data-layer-id="anim"] [data-testid="move-layer-back"]').trigger('click');

		expect(lastLayersWrite().map(layer => layer.id)).toEqual(['anim', 'base']);
	});

	it('writes an enabled toggle and an opacity change onto that layer alone', async () => {
		config.value = {
			layers: [
				colorLayer('base'),
				animationLayer('anim'),
			],
		};
		const wrapper = await mountComponent();

		await wrapper.find('[data-layer-id="base"] [data-testid="settings-toggle"]').trigger('click');
		expect(lastLayersWrite().find(layer => layer.id === 'base')).toMatchObject({ enabled: false });
		expect(lastLayersWrite().find(layer => layer.id === 'anim')).toMatchObject({ enabled: true });

		await wrapper.find('[data-layer-id="base"] input[data-testid="layer-opacity"]').setValue('0.4');
		expect(lastLayersWrite().find(layer => layer.id === 'base')).toMatchObject({ opacity: 0.4 });
	});

	it('returns a cleared layer opacity to opaque rather than to clear', async () => {
		config.value = {
			layers: [
				colorLayer('base', { opacity: 0.4 }),
			],
		};
		const wrapper = await mountComponent();

		wrapper.findComponent(UInputNumberStub).vm.$emit('update:modelValue', null);

		expect(lastLayersWrite()[0]).toMatchObject({ opacity: 1 });
	});

	it('edits a video layer through the shared media fields, and an image layer without playback', async () => {
		const video: BackgroundLayer = {
			id: 'clip',
			type: 'video',
			enabled: true,
			opacity: 1,
			source: { kind: 'url', url: '' },
			fit: 'cover',
			playbackRate: 2,
			loop: true,
		};
		const image: BackgroundLayer = {
			id: 'plate',
			type: 'image',
			enabled: true,
			opacity: 1,
			source: { kind: 'url', url: '' },
			fit: 'cover',
		};
		config.value = {
			layers: [video, image],
		};
		const wrapper = await mountComponent();

		const fit = wrapper.get('[data-layer-id="clip"] [data-testid="media-fit"]');
		expect(fit.findAll('option').map(option => option.text())).toEqual(['Cover', 'Contain', 'Fill']);
		await fit.setValue('contain');
		expect(lastLayersWrite()[0]).toMatchObject({ fit: 'contain' });

		// The layer owns its opacity, so its media offers none of its own.
		expect(wrapper.find('[data-layer-id="clip"] [data-testid="media-opacity"]').exists()).toBe(false);
		expect(wrapper.find('[data-layer-id="plate"] [data-testid="media-playback-rate"]').exists()).toBe(false);

		const rate = wrapper.findAllComponents(UInputNumberStub).find(input => input.attributes('data-testid') === 'media-playback-rate')!;
		rate.vm.$emit('update:modelValue', null);
		expect(lastLayersWrite()[0]).toMatchObject({ playbackRate: 1 });
	});

	it('edits an animation layer through the shared Animation Effect fields', async () => {
		config.value = {
			layers: [
				animationLayer('anim'),
			],
		};
		const wrapper = await mountComponent();

		await wrapper.find('[data-testid="animation-effect-fields"]').trigger('click');

		expect(lastLayersWrite()[0]).toMatchObject({
			type: 'animation',
			animation: { effect: 'caustics' },
		});
	});
});

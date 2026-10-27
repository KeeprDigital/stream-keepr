import type { FeatureMatchLayoutFrameConfig, FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import FrameStyleCard from '~/components/Screen/Modes/FeatureMatchOverlay/FrameStyleCard.vue';

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<div data-testid="form-field"><span>{{ label }}</span><slot /></div>',
});

const UIColorPickerStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		allowRawValue: { type: Boolean, required: false },
		placeholder: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="color-picker" :data-allow-raw-value="String(allowRawValue)" @click="$emit(\'update:modelValue\', \'\')">{{ modelValue }}</button>',
});

const UInputStub = defineComponent({
	props: {
		modelValue: {
			type: [String, Number],
			required: false,
		},
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

const USelectStub = defineComponent({
	props: {
		modelValue: {
			type: [String, Number, Boolean],
			required: false,
		},
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select data-testid="u-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items || []" :key="String(item.value ?? item)" :value="item.value ?? item">{{ item.label ?? item }}</option></select>',
});

const ScreenSettingsToggleStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
		label: { type: String, required: false },
		description: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" :data-description="description" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

const ControlSectionStub = defineComponent({
	props: {
		title: { type: String, required: false },
	},
	template: '<section data-testid="control-section"><h3>{{ title }}</h3><slot /></section>',
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" role="switch" :aria-checked="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

async function mountComponent(options: Partial<{
	config: FeatureMatchOverlayModeConfig;
	patchFrame: (updates: Partial<FeatureMatchLayoutFrameConfig>) => void;
}> = {}) {
	return mount(FrameStyleCard, {
		props: {
			config: options.config ?? structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG),
			patchFrame: options.patchFrame ?? vi.fn<(updates: Partial<FeatureMatchLayoutFrameConfig>) => void>(),
			eventId: 7,
		},
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				UIColorPicker: UIColorPickerStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USelect: USelectStub,
				ScreenMediaBackgroundFields: defineComponent({ template: '<div data-testid="media-background-fields" />' }),
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				FeatureMatchOverlayControlSection: ControlSectionStub,
				USwitch: USwitchStub,
				UButton: defineComponent({ template: '<button type="button"><slot /></button>' }),
				UIOpacityInput: defineComponent({ template: '<input />' }),
			},
		},
	});
}

describe('featureMatchOverlayFrameStyleCard', () => {
	// The Frame's fill, border, glow and effect are the Theme's Mode Tokens (#831).
	it('offers no colour, gradient, border or glow of the Frame\'s own', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="color-picker"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="u-input"]').exists()).toBe(false);
		expect(wrapper.find('[role="switch"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="frame-theme-note"]').text()).toContain('Theme');
	});

	it.each([
		{ side: 'Left', stored: undefined, written: false },
		{ side: 'Top', stored: false, written: true },
	] as const)('switches the Frame border\'s $side edge, which shows unless switched off', async ({ side, stored, written }) => {
		const patchFrame = vi.fn();
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame = { ...config.layout.frame, [`border${side}Visible`]: stored };
		const wrapper = await mountComponent({ config, patchFrame });
		const toggle = wrapper.get(`button[title="${side} border"]`);

		expect(toggle.attributes('aria-pressed')).toBe(String(!written));
		await toggle.trigger('click');
		expect(patchFrame).toHaveBeenLastCalledWith({ [`border${side}Visible`]: written });
	});

	it('switches the Frame\'s Animation Effect on, keeping its opacity and naming no effect', async () => {
		const patchFrame = vi.fn();
		const wrapper = await mountComponent({ patchFrame });

		const toggle = wrapper.findAll('[data-testid="settings-toggle"]').find(candidate => candidate.text() === 'Animation');
		await toggle!.trigger('click');

		expect(patchFrame).toHaveBeenLastCalledWith({
			animation: { enabled: true, opacity: 0.45 },
		});
	});
});

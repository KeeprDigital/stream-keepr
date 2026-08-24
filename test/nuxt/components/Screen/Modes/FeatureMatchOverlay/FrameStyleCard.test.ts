import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

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
		modelValue: { type: [String, Number], required: false },
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
		modelValue: { type: [String, Number, Boolean], required: false },
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select data-testid="u-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items || []" :key="String(item.value ?? item)" :value="item.value ?? item">{{ item.label ?? item }}</option></select>',
});

const ScreenSettingsToggleStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
		label: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

const ControlSectionStub = defineComponent({
	props: {
		title: { type: String, required: false },
	},
	template: '<section data-testid="control-section"><h3>{{ title }}</h3><slot /></section>',
});

async function mountComponent(options: Partial<{
	config: FeatureMatchOverlayModeConfig;
	patchFrame: ReturnType<typeof vi.fn>;
}> = {}) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/FrameStyleCard.vue';
	const { default: FrameStyleCard } = await import(componentPath);

	return mount(FrameStyleCard, {
		props: {
			config: options.config ?? structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG),
			patchFrame: options.patchFrame ?? vi.fn(),
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
				FeatureMatchOverlayBorderSidesControl: defineComponent({ template: '<div data-testid="border-sides-control" />' }),
			},
		},
	});
}

describe('featureMatchOverlayFrameStyleCard', () => {
	it('renders a toggle for a toggle-control effect param and writes it into the params bag', async () => {
		const patchFrame = vi.fn();
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.animation = { enabled: true, effect: 'dots', opacity: 0.5 };
		const wrapper = await mountComponent({ config, patchFrame });

		const toggle = wrapper.findAll('[data-testid="settings-toggle"]').find(candidate => candidate.text() === 'Connecting lines');
		expect(toggle).toBeDefined();

		await toggle!.trigger('click');

		const patch = patchFrame.mock.calls.at(-1)?.[0] as { animation?: { params?: Record<string, unknown> } };
		expect(patch.animation?.params?.showLines).toBe(false);
	});

	it('preserves transparent frame background selections', async () => {
		const patchFrame = vi.fn();
		const wrapper = await mountComponent({ patchFrame });
		const frameBackgroundPicker = wrapper.findAll('[data-testid="color-picker"]')[0]!;

		expect(frameBackgroundPicker.attributes('data-allow-raw-value')).toBe('true');

		await frameBackgroundPicker.trigger('click');

		const patch = patchFrame.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig['layout']['frame']>;
		expect(patch.backgroundColor).toBe('transparent');
	});
});

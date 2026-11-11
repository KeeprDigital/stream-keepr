import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { FeatureMatchLayoutFrameConfig, FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { fakeScreenThemeNetwork, overrideWrites, screenSettingsPage, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import FrameStyleCard from '~/components/Screen/Modes/FeatureMatchOverlay/FrameStyleCard.vue';

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

enableAutoUnmount(afterEach);

beforeEach(() => {
	fakeScreenThemeNetwork(mockApiFetch, 'feature-match-overlay');
});

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
		summary: { type: String, required: false },
		defaultOpen: { type: Boolean, default: false },
	},
	template: '<section data-testid="control-section" :data-section="title" :data-summary="summary" :data-default-open="String(defaultOpen)"><h3>{{ title }}</h3><slot /></section>',
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
	themeOverrides: StoredThemeTokens;
}> = {}) {
	const screen = seedThemedScreen('feature-match-overlay', options.themeOverrides);
	const config = options.config ?? structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	const patchFrame = options.patchFrame ?? vi.fn<(updates: Partial<FeatureMatchLayoutFrameConfig>) => void>();
	const wrapper = mount(screenSettingsPage(screen, () => h(FrameStyleCard, {
		config,
		patchFrame,
		screen: screen(),
		eventId: 1,
	})), {
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				UIColorPicker: UIColorPickerStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USelect: USelectStub,
				ScreenMediaBackgroundFields: defineComponent({ template: '<div data-testid="media-background-fields" />' }),
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				ScreenSettingsSection: ControlSectionStub,
				USwitch: USwitchStub,
				UButton: defineComponent({ template: '<button type="button"><slot /></button>' }),
				UIOpacityInput: defineComponent({ template: '<input />' }),
				UBadge: defineComponent({
					props: {
						label: { type: String, required: false },
					},
					template: '<span>{{ label }}</span>',
				}),
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('featureMatchOverlayFrameStyleCard', () => {
	// The Frame's fill, border, glow and effect are the Theme's Mode Tokens (#831),
	// each edited only as a Screen Theme Override row.
	it('offers no colour, gradient, border or glow of the Frame\'s own', async () => {
		const wrapper = await mountComponent();
		const outsideRows = (selector: string) => wrapper.findAll(selector).filter(found => !found.element.closest('[data-token]'));

		expect(outsideRows('[data-testid="color-picker"]')).toHaveLength(0);
		expect(outsideRows('[data-testid="u-input"]')).toHaveLength(0);
		expect(outsideRows('[role="switch"]')).toHaveLength(0);
	});

	// The Frame has no position or content of its own, so every section starts closed behind a summary.
	it.each([
		['Background', 'opacity 1'],
		['Video', 'Off'],
		['Animation', 'Off'],
		['Surface', 'Fill, border and glow'],
	])('starts %s closed, summarised as "%s"', async (section, summary) => {
		const wrapper = await mountComponent();
		const found = wrapper.get(`[data-section="${section}"]`);

		expect(found.attributes('data-default-open')).toBe('false');
		expect(found.attributes('data-summary')).toBe(summary);
	});

	// Each Frame Mode Token's override sits in the section for what it styles (#982).
	it.each([
		['Surface', 'feature-match-overlay.frame-surface'],
		['Video', 'feature-match-overlay.frame-media'],
		['Animation', 'feature-match-overlay.frame-animation-effect'],
	])('shows the %s section\'s Look: %s, once', async (section, token) => {
		const wrapper = await mountComponent();

		expect(wrapper.findAll(`[data-token="${token}"]`)).toHaveLength(1);
		expect(wrapper.get(`[data-section="${section}"]`).findAll('[data-token]').map(row => row.attributes('data-token'))).toEqual([token]);
	});

	it.each([
		[
			'writes',
			'feature-match-overlay.frame-surface',
			{},
			{
				'feature-match-overlay.frame-surface': { token: 'panel' },
			},
		],
		[
			'clears',
			'feature-match-overlay.frame-surface',
			{
				'feature-match-overlay.frame-surface': { token: 'panel' },
			},
			{ 'feature-match-overlay.frame-surface': null },
		],
	] as const)('%s a Frame row\'s Screen Theme Override', async (action, token, stored, written) => {
		const wrapper = await mountComponent({ themeOverrides: stored });
		const row = wrapper.get(`[data-token="${token}"]`);

		if (action === 'clears')
			await row.findAll('button').find(button => button.text() === 'Clear')!.trigger('click');
		else
			await row.get('[data-token-part="source"]').setValue('panel');
		await flushPromises();

		expect(overrideWrites(mockApiFetch)).toEqual([written]);
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

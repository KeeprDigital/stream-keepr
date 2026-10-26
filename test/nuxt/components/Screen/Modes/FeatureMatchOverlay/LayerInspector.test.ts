import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlaySelectionTarget } from '~/modules/feature-match-overlay/selection';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import LayerInspector from '~/components/Screen/Modes/FeatureMatchOverlay/LayerInspector.vue';

/**
 * The host-owned half of the Feature Match Overlay property panel: the Frame and
 * the Source Items.
 *
 * Nothing here authors a Graphic Item, and nothing here chooses what to edit: the
 * shared compositor's inspector edits Graphic Items, and the editor's one layer
 * list selects, adds, reorders, and removes — each covered by its own suite.
 */

const ScreenSettingsToggleStub = defineComponent({
	props: {
		label: { type: String, required: true },
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

const ControlSectionStub = defineComponent({
	props: {
		title: { type: String, required: false },
		summary: { type: String, required: false },
		badge: { type: String, required: false },
	},
	template: '<section data-testid="control-section"><h3>{{ title }}</h3><p v-if="summary">{{ summary }}</p><span v-if="badge">{{ badge }}</span><slot /></section>',
});

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<div data-testid="form-field"><span>{{ label }}</span><slot /></div>',
});

const UInputStub = defineComponent({
	props: {
		modelValue: {
			type: [String, Number],
			required: false,
		},
	},
	template: '<div data-testid="u-input">{{ modelValue }}</div>',
});

const UButtonStub = defineComponent({
	emits: ['click'],
	template: '<button type="button" data-testid="u-button" @click="$emit(\'click\', $event)"><slot /></button>',
});

const GeometryFieldsStub = defineComponent({
	props: {
		anchor: { type: String, required: true },
	},
	emits: ['update:anchor'],
	template: '<button type="button" data-testid="geometry-anchor" :data-anchor-value="anchor" @click="$emit(\'update:anchor\', \'bottom-right\')">Anchor</button>',
});

async function mountComponent(overrides: Partial<{
	config: FeatureMatchOverlayModeConfig;
	selectedTarget: FeatureMatchOverlaySelectionTarget;
	updateConfig: FeatureMatchOverlayConfigUpdater;
}> = {}) {
	const updateConfig = overrides.updateConfig ?? vi.fn<FeatureMatchOverlayConfigUpdater>();

	return mount(LayerInspector, {
		props: {
			config: overrides.config ?? structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG),
			updateConfig,
			screenWidth: 1920,
			screenHeight: 1080,
			eventId: 7,
			selectedTarget: overrides.selectedTarget ?? { type: 'canvas' },
		},
		global: {
			stubs: {
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				FeatureMatchOverlayControlSection: ControlSectionStub,
				FeatureMatchOverlayFrameStyleCard: defineComponent({ template: '<div data-testid="frame-style-card" />' }),
				GraphicsGeometryFields: GeometryFieldsStub,
				FeatureMatchOverlaySourceFramingStyleFields: defineComponent({
					props: {
						framingStyle: { type: Object, required: false },
					},
					emits: ['update'],
					template: '<button type="button" data-testid="source-framing-style" :data-framing-style="JSON.stringify(framingStyle)" @click="$emit(\'update\', { borderWidth: 6 })" />',
				}),
				UFormField: UFormFieldStub,
				UInput: UInputStub,
				UButton: UButtonStub,
				UBadge: true,
				UIcon: true,
			},
		},
	});
}

describe('featureMatchOverlayLayerInspector', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('edits the Frame when the Canvas is selected', async () => {
		const wrapper = await mountComponent({
			selectedTarget: { type: 'canvas' },
		});

		expect(wrapper.find('[data-testid="frame-style-card"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('1920×1080 frame and background');
	});

	it('edits the selected Source Item and writes the whole layout back', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'source', itemId: 'main-source' },
		});

		await wrapper.find('[data-testid="source-framing-style"]').trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		expect(patch.layout?.sources.find(source => source.id === 'main-source')?.framingStyle)
			.toMatchObject({ borderWidth: 6 });
	});

	it('asks the editor to duplicate or remove the selected Source Item', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'source', itemId: 'main-source' },
		});

		await wrapper.find('[data-testid="source-duplicate"]').trigger('click');
		await wrapper.find('[data-testid="source-remove"]').trigger('click');

		// The editor owns the layer list and the selection, so it does both.
		expect(wrapper.emitted('duplicate')).toEqual([
			['main-source'],
		]);
		expect(wrapper.emitted('remove')).toEqual([
			['main-source'],
		]);
		expect(updateConfig).not.toHaveBeenCalled();
	});

	it('persists a Source Item anchor selection', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'source', itemId: 'main-source' },
		});

		await wrapper.find('[data-testid="geometry-anchor"]').trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		expect(patch.layout?.sources.find(source => source.id === 'main-source')?.anchor).toBe('bottom-right');
	});

	it('reports a selection that no longer resolves rather than rendering nothing', async () => {
		const wrapper = await mountComponent({
			selectedTarget: { type: 'source', itemId: 'deleted-source' },
		});

		expect(wrapper.text()).toContain('Selection unavailable');
	});
});

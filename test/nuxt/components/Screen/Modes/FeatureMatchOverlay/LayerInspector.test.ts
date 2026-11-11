import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlaySelectionTarget } from '~/modules/feature-match-overlay/selection';
import type { Screen } from '~/types';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { stubPointerCapture } from '~~/test/nuxt/helpers/pointerCapture';
import LayerInspector from '~/components/Screen/Modes/FeatureMatchOverlay/LayerInspector.vue';

// The host-owned half of the Feature Match Overlay property panel: the Frame and the Source Items.

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
	template: '<div data-testid="form-field"><span><slot name="label">{{ label }}</slot></span><slot /></div>',
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
	writable: boolean | undefined;
	stubs: Record<string, unknown>;
}> = {}) {
	const updateConfig = overrides.updateConfig ?? vi.fn<FeatureMatchOverlayConfigUpdater>();

	return mount(LayerInspector, {
		props: {
			config: overrides.config ?? structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG),
			updateConfig,
			screenWidth: 1920,
			screenHeight: 1080,
			screen: { id: 1, currentMode: 'feature-match-overlay' } as Screen,
			eventId: 7,
			selectedTarget: overrides.selectedTarget ?? { type: 'canvas' },
			writable: 'writable' in overrides
				? overrides.writable
				: true,
		},
		global: {
			stubs: {
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				ScreenSettingsSection: ControlSectionStub,
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
				ScreenThemeTokenGroup: true,
				...overrides.stubs,
			},
		},
	});
}

describe('featureMatchOverlayLayerInspector', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Read-only without the Graphics Authoring Lease (#738), failing closed when unstated.
	it.each([
		[true, false],
		[false, true],
		[undefined, true],
	])('with writable %s, disables its fields: %s', async (writable, disabled) => {
		const wrapper = await mountComponent({
			selectedTarget: { type: 'source', itemId: 'main-source' },
			writable,
		});

		expect(wrapper.get('[data-testid="overlay-layer-inspector-fields"]').attributes('disabled') !== undefined).toBe(disabled);
	});

	// A Look row edits like any other field: read-only for an observer (#982).
	it('keeps the Source Item\'s Look inside the read-only fields', async () => {
		const wrapper = await mountComponent({
			selectedTarget: { type: 'source', itemId: 'main-source' },
			writable: false,
		});
		const fields = wrapper.get('[data-testid="overlay-layer-inspector-fields"]');

		expect(fields.attributes('disabled')).toBeDefined();
		expect(fields.find('[group="source-appearance"]').exists()).toBe(true);
	});

	it.each([
		{
			session: 'the lease holder',
			writable: true,
			offsets: [3],
		},
		{ session: 'a read-only observer', writable: false, offsets: [] },
	])('lets $session drag a Source Item\'s X label to move it', async ({ writable, offsets }) => {
		stubPointerCapture();
		const updateConfig = vi.fn<FeatureMatchOverlayConfigUpdater>();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'source', itemId: 'main-source' },
			writable,
			stubs: { GraphicsGeometryFields: false, UINinePointPicker: true, GraphicsGeometryUnitPicker: true },
		});
		const label = wrapper.findAll('[data-number-scrub]').find(handle => handle.text() === 'X')!;

		await label.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 0 });
		await label.trigger('pointermove', { pointerId: 1, clientX: 6 });

		const sourceX = (config: Partial<FeatureMatchOverlayModeConfig> | undefined) =>
			config?.layout?.sources.find(source => source.id === 'main-source')?.x ?? Number.NaN;
		const start = sourceX(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		expect(updateConfig.mock.calls.map(([patch]) => sourceX(patch) - start)).toEqual(offsets);
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

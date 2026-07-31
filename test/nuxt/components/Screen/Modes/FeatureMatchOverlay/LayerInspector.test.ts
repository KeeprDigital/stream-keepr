import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * The host-owned half of the Feature Match Overlay editor: the Frame and the
 * Source Items.
 *
 * Nothing here authors a Graphic Item. The shared compositor's own tree and
 * inspector do that, and are covered by their own suites — which is the point of
 * the rewrite this ticket completes.
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
		modelValue: { type: [String, Number], required: false },
	},
	template: '<div data-testid="u-input">{{ modelValue }}</div>',
});

const UButtonStub = defineComponent({
	emits: ['click'],
	template: '<button type="button" data-testid="u-button" @click="$emit(\'click\', $event)"><slot /></button>',
});

const GeometryFieldsStub = defineComponent({
	props: {
		anchorValue: { type: String, required: true },
	},
	emits: ['updateAnchor'],
	template: '<button type="button" data-testid="geometry-anchor" :data-anchor-value="anchorValue" @click="$emit(\'updateAnchor\', \'bottom-right\')">Anchor</button>',
});

const OrderSectionStub = defineComponent({
	emits: ['sendToBack', 'move', 'bringToFront'],
	template: `
		<div data-testid="order-section">
			<button type="button" data-testid="order-send-to-back" @click="$emit('sendToBack')">Back</button>
			<button type="button" data-testid="order-bring-to-front" @click="$emit('bringToFront')">Front</button>
		</div>
	`,
});

async function mountComponent(overrides: Partial<{
	config: FeatureMatchOverlayModeConfig;
	selectedTarget: { type: 'canvas' | 'source'; itemId?: string };
	updateConfig: ReturnType<typeof vi.fn>;
	variant: 'tree' | 'inspector';
}> = {}) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/LayerInspector.vue';
	const { default: LayerInspector } = await import(componentPath);
	const updateConfig = overrides.updateConfig ?? vi.fn();

	return mount(LayerInspector, {
		props: {
			config: overrides.config ?? structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG),
			updateConfig,
			screenWidth: 1920,
			screenHeight: 1080,
			eventId: 7,
			selectedTarget: overrides.selectedTarget ?? { type: 'canvas' },
			variant: overrides.variant ?? 'inspector',
		},
		global: {
			stubs: {
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				FeatureMatchOverlayControlSection: ControlSectionStub,
				FeatureMatchOverlayFrameStyleCard: defineComponent({ template: '<div data-testid="frame-style-card" />' }),
				FeatureMatchOverlayGeometryFields: GeometryFieldsStub,
				FeatureMatchOverlayOrderSection: OrderSectionStub,
				FeatureMatchOverlaySourceFramingStyleFields: defineComponent({
					props: { framingStyle: { type: Object, required: false } },
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

	it('renders a tree of the Canvas and the Source Items, and nothing else', async () => {
		const wrapper = await mountComponent({ variant: 'tree' });

		expect(wrapper.find('[data-testid="overlay-tree-canvas"]').text()).toContain('Canvas');
		expect(wrapper.findAll('[data-testid="overlay-tree-source"]')).toHaveLength(
			DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.sources.length,
		);
		expect(wrapper.text()).toContain('Canvas and external video source areas');
	});

	it('emits a source selection when a Source Item is chosen', async () => {
		const wrapper = await mountComponent({ variant: 'tree' });

		await wrapper.findAll('[data-testid="overlay-tree-source"]')[0]!.trigger('click');

		expect(wrapper.emitted('update:selectedTarget')?.at(-1)?.[0]).toEqual({
			type: 'source',
			itemId: 'main-source',
		});
	});

	it('adds a Source Item and selects it', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({ updateConfig, variant: 'tree' });

		await wrapper.find('[data-testid="overlay-add-source"]').trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		const added = patch.layout?.sources.at(-1);
		expect(added).toMatchObject({ frameCutout: true, sourceRole: 'main' });
		expect(wrapper.emitted('update:selectedTarget')?.at(-1)?.[0]).toEqual({
			type: 'source',
			itemId: added?.id,
		});
	});

	it('edits the Frame when the Canvas is selected', async () => {
		const wrapper = await mountComponent({ selectedTarget: { type: 'canvas' } });

		expect(wrapper.find('[data-testid="frame-style-card"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('1920x1080 frame and background');
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

	it('orders Source Items without exposing a raw z-index', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'source', itemId: 'main-source' },
		});

		await wrapper.find('[data-testid="order-bring-to-front"]').trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		expect(patch.layout?.sources.at(-1)?.id).toBe('main-source');
		expect(wrapper.html()).not.toContain('z-index');
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

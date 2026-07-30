import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

const ScreenSettingsCardStub = defineComponent({
	props: {
		title: { type: String, required: false },
		subtitle: { type: String, required: false },
	},
	template: '<section data-testid="settings-card"><h2>{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p><slot /></section>',
});

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

const USelectStub = defineComponent({
	props: {
		modelValue: { type: [String, Number, Boolean, Object], required: false },
		items: { type: Array, required: false },
		valueKey: { type: String, required: false, default: 'value' },
		placeholder: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: `
		<div data-testid="u-select">
			<button
				v-for="item in items || []"
				:key="String(item[valueKey] ?? item)"
				type="button"
				:data-value="String(item[valueKey] ?? item)"
				@click="$emit('update:modelValue', item[valueKey] ?? item)"
			>{{ item.label ?? item }}</button>
		</div>
	`,
});

const UInputStub = defineComponent({
	props: {
		modelValue: { type: [String, Number], required: false },
	},
	template: '<div data-testid="u-input">{{ modelValue }}</div>',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	template: '<div data-testid="u-input-number">{{ modelValue }}</div>',
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

async function mountComponent(overrides: Partial<{
	config: FeatureMatchOverlayModeConfig;
	selectedTarget: { type: 'canvas' | 'layer' | 'graphic-item'; itemId?: string; childId?: string };
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
				ScreenSettingsCard: ScreenSettingsCardStub,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				FeatureMatchOverlayControlSection: ControlSectionStub,
				FeatureMatchOverlayFrameStyleCard: defineComponent({ template: '<div data-testid="frame-style-card" />' }),
				FeatureMatchOverlayGeometryFields: GeometryFieldsStub,
				FeatureMatchOverlayGraphicItemEditor: defineComponent({ template: '<div data-testid="graphicItem-editor" />' }),
				FeatureMatchOverlayMediaFields: defineComponent({ template: '<div data-testid="media-fields" />' }),
				FeatureMatchOverlayBoxStyleFields: defineComponent({
					props: {
						boxStyle: { type: Object, required: false },
						fallbackStyle: { type: Object, required: false },
						includeText: { type: Boolean, required: false, default: true },
						includePadding: { type: Boolean, required: false, default: false },
						includeOverflow: { type: Boolean, required: false, default: false },
					},
					emits: ['update'],
					template: '<button type="button" data-testid="box-style-fields" :data-box-style="JSON.stringify(boxStyle)" :data-fallback-style="JSON.stringify(fallbackStyle)" :data-include-text="String(includeText)" :data-include-padding="String(includePadding)" :data-include-overflow="String(includeOverflow)" @click="$emit(\'update\', { backgroundGradient: \'linear-gradient(red, blue)\' })" />',
				}),
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
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

	it('renders the scene tree with canvas, layers, and nested Graphic Items', async () => {
		const wrapper = await mountComponent({ variant: 'tree' });

		expect(wrapper.find('[data-testid="overlay-tree-canvas"]').text()).toContain('Canvas');
		expect(wrapper.findAll('[data-testid="overlay-tree-layer"]').length).toBeGreaterThan(1);
		expect(wrapper.findAll('[data-testid="overlay-tree-graphicItem"]').length).toBeGreaterThan(1);
		expect(wrapper.text()).toContain('Canvas, layers, and Graphic Items');
	});

	it('emits selection updates for top-level layers and nested graphicItems', async () => {
		const wrapper = await mountComponent({ variant: 'tree' });

		await wrapper.findAll('[data-testid="overlay-tree-layer"]')[0]!.trigger('click');
		expect(wrapper.emitted('update:selectedTarget')?.at(-1)?.[0]).toMatchObject({
			type: 'layer',
			itemId: 'main-source',
		});

		await wrapper.findAll('[data-testid="overlay-tree-graphicItem"]')[0]!.trigger('click');
		expect(wrapper.emitted('update:selectedTarget')?.at(-1)?.[0]).toMatchObject({
			type: 'graphic-item',
			itemId: 'top-bar',
			childId: 'top-name-record',
		});
	});

	it('guided add creates the requested graphicItem type and selects the new layer', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({ updateConfig, variant: 'tree' });

		await wrapper.find('[data-testid="overlay-guided-add"] [data-value="player-life-graphic-item"]').trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		const added = patch.layout?.items.at(-1);
		expect(added).toMatchObject({
			type: 'graphic-item',
			label: 'Life Graphic Item',
			graphicItem: { type: 'player-life' },
		});
		expect(wrapper.emitted('update:selectedTarget')?.at(-1)?.[0]).toMatchObject({
			type: 'layer',
			itemId: added?.id,
		});
	});

	it('adds a Media Graphic Item inside a selected Graphic Group', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'layer', itemId: 'top-bar' },
		});

		await wrapper.find('[data-testid="overlay-guided-add-graphicItem"] [data-value="media"]').trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		const group = patch.layout?.items.find(item => item.id === 'top-bar');
		const added = group?.type === 'graphic-group' ? group.children.at(-1) : undefined;
		expect(added).toMatchObject({
			type: 'media',
			label: 'Media Graphic Item',
			mediaKind: 'image',
			fit: 'contain',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
		});
		expect(wrapper.emitted('update:selectedTarget')?.at(-1)?.[0]).toMatchObject({
			type: 'graphic-item',
			itemId: 'top-bar',
			childId: added?.id,
		});
	});

	it('shows selected graphicItem inspector summaries for group children', async () => {
		const wrapper = await mountComponent({
			selectedTarget: { type: 'graphic-item', itemId: 'top-bar', childId: 'top-name-record' },
		});
		const sectionTitles = wrapper.findAll('[data-testid="control-section"] h3').map(title => title.text());

		expect(sectionTitles).toEqual(expect.arrayContaining(['Details', 'Layout', 'Content', 'Overrides']));
		expect(sectionTitles).not.toContain('Bounds');
		expect(sectionTitles).not.toContain('Arrangement');
		expect(sectionTitles).not.toContain('Defaults');
		expect(sectionTitles).toContain('Order');
		expect(wrapper.text()).toContain('Name and Record');
		expect(wrapper.text()).toContain('{name}');
		expect(wrapper.find('[data-testid="graphicItem-editor"]').exists()).toBe(true);
	});

	it('shows Media Graphic Item summaries and controls for a Graphic Group child', async () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const group = config.layout.items.find(item => item.id === 'top-bar');
		if (group?.type !== 'graphic-group')
			throw new Error('Expected a Graphic Group fixture');
		group.children = [{
			id: 'group-media',
			type: 'media',
			label: 'Sponsor loop',
			visible: true,
			layout: { mode: 'canvas', x: 0, y: 0, width: 240, height: 120 },
			mediaKind: 'silent-video',
			fit: 'cover',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
			loop: true,
			playbackRate: 1,
			videoTarget: 'safari',
		}];
		const wrapper = await mountComponent({
			config,
			selectedTarget: { type: 'graphic-item', itemId: 'top-bar', childId: 'group-media' },
		});

		expect(wrapper.text()).toContain('Sponsor loop');
		expect(wrapper.text()).toContain('Media');
		expect(wrapper.find('[data-testid="media-fields"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="graphicItem-editor"]').exists()).toBe(false);
		expect(wrapper.findAll('[data-testid="control-section"] h3').map(title => title.text()))
			.not
			.toContain('Overrides');
	});

	it('keeps group-scoped controls separate from individual graphicItem controls', async () => {
		const wrapper = await mountComponent({
			selectedTarget: { type: 'layer', itemId: 'top-bar' },
		});

		const sectionTitles = wrapper.findAll('[data-testid="control-section"] h3').map(title => title.text());
		expect(sectionTitles).toEqual(expect.arrayContaining(['Details', 'Bounds', 'Appearance', 'Order', 'Arrangement', 'Defaults']));
		expect(sectionTitles).not.toContain('Overrides');
		expect(sectionTitles.indexOf('Appearance')).toBeLessThan(sectionTitles.indexOf('Arrangement'));
		expect(sectionTitles.indexOf('Order')).toBeLessThan(sectionTitles.indexOf('Arrangement'));

		const styleSections = wrapper.findAll('[data-testid="box-style-fields"]');
		expect(styleSections[0]?.attributes()).toMatchObject({
			'data-include-text': 'false',
			'data-include-padding': 'false',
			'data-include-overflow': 'false',
		});
		expect(styleSections[1]?.attributes()).toMatchObject({
			'data-include-text': 'true',
			'data-include-padding': 'true',
			'data-include-overflow': 'true',
		});
	});

	it('updates group appearance separately from inherited graphicItem defaults', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'layer', itemId: 'top-bar' },
		});

		await wrapper.findAll('[data-testid="box-style-fields"]')[0]!.trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		const group = patch.layout?.items.find(item => item.id === 'top-bar' && item.type === 'graphic-group');
		expect(group).toMatchObject({
			type: 'graphic-group',
			surfaceStyle: expect.objectContaining({ backgroundGradient: 'linear-gradient(red, blue)' }),
			defaultChildSurfaceStyle: expect.objectContaining({ fontSize: 30 }),
		});
	});

	it('does not create graphicItem defaults from group appearance when defaults are absent', async () => {
		const updateConfig = vi.fn();
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.items = config.layout.items.map((item) => {
			if (item.id !== 'top-bar' || item.type !== 'graphic-group')
				return item;
			const groupWithoutDefaults = { ...item };
			delete groupWithoutDefaults.defaultChildSurfaceStyle;
			return groupWithoutDefaults;
		});
		const wrapper = await mountComponent({
			config,
			updateConfig,
			selectedTarget: { type: 'layer', itemId: 'top-bar' },
		});

		await wrapper.findAll('[data-testid="box-style-fields"]')[0]!.trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		const group = patch.layout?.items.find(item => item.id === 'top-bar' && item.type === 'graphic-group');
		expect(group).toMatchObject({
			type: 'graphic-group',
			surfaceStyle: expect.objectContaining({ backgroundGradient: 'linear-gradient(red, blue)' }),
		});
		expect(group).not.toHaveProperty('defaultChildSurfaceStyle');
	});

	it('updates inherited graphicItem defaults separately from group appearance', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'layer', itemId: 'top-bar' },
		});

		await wrapper.findAll('[data-testid="box-style-fields"]')[1]!.trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		const group = patch.layout?.items.find(item => item.id === 'top-bar' && item.type === 'graphic-group');
		expect(group).toMatchObject({
			type: 'graphic-group',
			surfaceStyle: expect.not.objectContaining({ backgroundGradient: 'linear-gradient(red, blue)' }),
			defaultChildSurfaceStyle: expect.objectContaining({ backgroundGradient: 'linear-gradient(red, blue)' }),
		});
	});

	it('can reset a selected group graphicItem back to inherited graphicItem defaults', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'graphic-item', itemId: 'top-bar', childId: 'top-life' },
		});

		await wrapper.find('[data-testid="reset-graphicItem-appearance"]').trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		const group = patch.layout?.items.find(item => item.id === 'top-bar' && item.type === 'graphic-group');
		const child = group?.type === 'graphic-group' ? group.children.find(item => item.id === 'top-life') : undefined;
		expect(child).toBeDefined();
		expect(child).not.toHaveProperty('surfaceStyle');
	});

	it('provides layer ordering controls without requiring raw z-index editing', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'layer', itemId: 'main-source' },
		});

		const frontButton = wrapper.findAll('[data-testid="u-button"]')
			.find(button => button.text() === 'Front');
		expect(frontButton).toBeDefined();
		await frontButton!.trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		expect(patch.layout?.items.at(-1)?.id).toBe('main-source');
		expect(patch.layout?.items.some(item => 'zIndex' in item)).toBe(false);
	});

	it('persists top-level layer anchor selection in the overlay config', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'layer', itemId: 'main-source' },
		});

		await wrapper.find('[data-testid="geometry-anchor"]').trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		const updated = patch.layout?.items.find(item => item.id === 'main-source');
		expect(updated?.anchor).toBe('bottom-right');
	});

	it('persists canvas child anchor selection in the child layout config', async () => {
		const updateConfig = vi.fn();
		const wrapper = await mountComponent({
			updateConfig,
			selectedTarget: { type: 'graphic-item', itemId: 'top-bar', childId: 'top-name-record' },
		});

		await wrapper.find('[data-testid="geometry-anchor"]').trigger('click');

		const patch = updateConfig.mock.calls.at(-1)?.[0] as Partial<FeatureMatchOverlayModeConfig>;
		const group = patch.layout?.items.find(item => item.id === 'top-bar' && item.type === 'graphic-group');
		const child = group?.type === 'graphic-group' ? group.children.find(item => item.id === 'top-name-record') : undefined;
		expect(child?.layout).toMatchObject({ mode: 'canvas', anchor: 'bottom-right' });
	});
});

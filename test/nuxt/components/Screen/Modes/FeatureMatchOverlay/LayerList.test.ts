import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import { addGraphicGroupChild, addGraphicItem } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { useFeatureMatchLayoutEditor } from '~/composables/screen/useFeatureMatchLayoutEditor';

/**
 * The Feature Match Layout's one layer list: Graphic Items, then Source Items,
 * then the canvas — front to back, the order they composite in.
 */

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

const UButtonStub = defineComponent({
	props: { disabled: { type: Boolean, required: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

/** Every menu entry as a plain button, so the menu needs no opening. */
const UDropdownMenuStub = defineComponent({
	props: { items: { type: Array, required: true } },
	template: `
		<div>
			<slot />
			<template v-for="(group, groupIndex) in items" :key="groupIndex">
				<button
					v-for="entry in group.filter(entry => entry.onSelect)"
					:key="entry.label"
					type="button"
					:data-menu-entry="entry.label"
					:disabled="entry.disabled"
					@click="entry.onSelect()"
				>{{ entry.label }}</button>
			</template>
		</div>
	`,
});

function configWithItems(): FeatureMatchOverlayModeConfig {
	const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	let composition: BroadcastGraphicConfig = { ...config.layout.composition, items: [] };
	composition = addGraphicItem(composition, { kind: 'shape', id: 'back', ...CANVAS }).graphic;
	composition = addGraphicItem(composition, { kind: 'group', id: 'cluster', ...CANVAS }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'cluster', id: 'child' }).graphic;
	return { ...config, layout: { ...config.layout, composition } };
}

async function mountList() {
	const config = ref(configWithItems());
	const updateConfig = (patch: Partial<FeatureMatchOverlayModeConfig>) => {
		config.value = { ...config.value, ...patch };
	};
	const editor = useFeatureMatchLayoutEditor({ config, updateConfig, canvasWidth: 1920, canvasHeight: 1080 });
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/LayerList.vue';
	const { default: LayerList } = await import(componentPath);
	const wrapper = mount(LayerList, {
		props: { layout: config.value.layout, editor, canvasWidth: 1920, canvasHeight: 1080 },
		global: {
			stubs: {
				UButton: UButtonStub,
				UDropdownMenu: UDropdownMenuStub,
				UIcon: true,
			},
		},
	});
	const sync = async () => {
		await wrapper.setProps({ layout: config.value.layout });
	};
	return { wrapper, config, editor, sync };
}

function rowKeys(wrapper: Awaited<ReturnType<typeof mountList>>['wrapper']) {
	return wrapper.findAll('[data-testid="layer-row"]').map(row => row.attributes('data-layer-key'));
}

describe('featureMatchOverlayLayerList', () => {
	it('lists Graphic Items front to back with each group\'s children beneath it, then the Sources, then the canvas', async () => {
		const { wrapper, config } = await mountList();

		const sources = [...config.value.layout.sources].reverse().map(item => `source:${item.id}`);
		expect(rowKeys(wrapper)).toEqual(['item:cluster', 'item:child', 'item:back', ...sources]);
		expect(wrapper.find('[data-testid="layer-canvas"]').exists()).toBe(true);
	});

	it('marks only the selected row, and the canvas only while it is selected', async () => {
		const { wrapper } = await mountList();
		expect(wrapper.get('[data-testid="layer-canvas"]').attributes('aria-current')).toBe('true');

		await wrapper.findAll('[data-testid="layer-select"]')[0]!.trigger('click');

		expect(wrapper.findAll('[aria-current="true"]')).toHaveLength(1);
		expect(wrapper.get('[data-testid="layer-canvas"]').attributes('aria-current')).toBeUndefined();
	});

	it('moves a row toward the front with the arrow pointing up', async () => {
		const { wrapper, config, sync } = await mountList();
		const back = wrapper.get('[data-layer-key="item:back"]');

		expect(back.get('[data-testid="layer-backward"]').attributes('disabled')).toBeDefined();
		await back.get('[data-testid="layer-forward"]').trigger('click');
		await sync();

		expect(config.value.layout.composition.items.map(item => item.id)).toEqual(['cluster', 'back']);
		expect(rowKeys(wrapper).slice(0, 3)).toEqual(['item:back', 'item:cluster', 'item:child']);
	});

	it('hides and shows a layer from its row', async () => {
		const { wrapper, config } = await mountList();

		await wrapper.get('[data-layer-key="item:back"] [data-testid="layer-visibility"]').trigger('click');

		expect(config.value.layout.composition.items.find(item => item.id === 'back')?.visible).toBe(false);
	});

	it('adds a Source Item from the Add menu and selects it', async () => {
		const { wrapper, config, editor } = await mountList();
		const before = config.value.layout.sources.length;

		await wrapper.get('[data-menu-entry="Source Item"]').trigger('click');

		expect(config.value.layout.sources).toHaveLength(before + 1);
		expect(editor.selection.value).toEqual({ type: 'source', itemId: config.value.layout.sources.at(-1)!.id });
	});

	it('offers to add into the Graphic Group the selection sits in', async () => {
		const { wrapper, editor, config } = await mountList();
		const textEntries = () => wrapper.findAll('[data-menu-entry="Text"]');
		expect(textEntries()).toHaveLength(1);

		editor.select({ type: 'item', itemId: 'child' });
		await wrapper.vm.$nextTick();
		expect(textEntries()).toHaveLength(2);

		await textEntries()[1]!.trigger('click');

		const cluster = config.value.layout.composition.items.find(item => item.id === 'cluster');
		expect(cluster?.type === 'group' && cluster.children).toHaveLength(2);
	});
});

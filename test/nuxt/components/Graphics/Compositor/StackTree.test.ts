import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { BROADCAST_GRAPHICS_HOST_CONTRACT, squareShapeGeometry } from '~~/shared/modules/graphics';

enableAutoUnmount(afterEach);

const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div><span>{{ label }}</span><slot /></div>',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: { items: { type: Array, required: false }, modelValue: { type: [String, Number], required: false } },
	emits: ['update:modelValue'],
	template: '<select @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, required: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

async function mountComponent(options: {
	graphics: BroadcastGraphicConfig[];
	selectedGraphicId?: string | null;
	selectedTarget?: GraphicsSelectionTarget;
}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/StackTree.vue';
	const { default: StackTree } = await import(componentPath);

	return mount(StackTree, {
		props: {
			graphics: options.graphics,
			selectedTarget: options.selectedTarget ?? { type: 'canvas' },
			selectedGraphicId: options.selectedGraphicId ?? null,
			contract: BROADCAST_GRAPHICS_HOST_CONTRACT,
			canvasWidth: 1920,
			canvasHeight: 1080,
		},
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UButton: UButtonStub,
				UBadge: true,
				UIcon: true,
			},
		},
	});
}

function emittedGraphics(wrapper: Awaited<ReturnType<typeof mountComponent>>, index = 0) {
	return wrapper.emitted('update:graphics')?.[index]?.[0] as BroadcastGraphicConfig[];
}

function emittedTarget(wrapper: Awaited<ReturnType<typeof mountComponent>>, index = 0) {
	return wrapper.emitted('update:selectedTarget')?.[index]?.[0] as GraphicsSelectionTarget;
}

describe('graphicsCompositorStackTree', () => {
	it('adds a Broadcast Graphic to the front of the Screen stack and selects it', async () => {
		const wrapper = await mountComponent({ graphics: [{ id: 'a', name: 'Graphic 1', items: [] }] });

		await wrapper.get('[data-testid="add-broadcast-graphic"]').trigger('click');

		const graphics = emittedGraphics(wrapper);
		expect(graphics.map(graphic => graphic.name)).toEqual(['Graphic 1', 'Graphic 2']);
		expect(emittedTarget(wrapper)).toEqual({ type: 'graphic', graphicId: graphics[1]!.id });
	});

	it('reorders a Broadcast Graphic within the authored back-to-front stack', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }, { id: 'b', name: 'B', items: [] }],
		});

		await wrapper.get('[aria-label="Move A forward"]').trigger('click');

		expect(emittedGraphics(wrapper).map(graphic => graphic.id)).toEqual(['b', 'a']);
	});

	it('cannot move the frontmost Broadcast Graphic any further forward', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }, { id: 'b', name: 'B', items: [] }],
		});

		expect(wrapper.get('[aria-label="Move B forward"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[aria-label="Move A backward"]').attributes('disabled')).toBeDefined();
	});

	it('deletes a Broadcast Graphic and drops the selection', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }, { id: 'b', name: 'B', items: [] }],
			selectedGraphicId: 'a',
			selectedTarget: { type: 'graphic', graphicId: 'a' },
		});

		await wrapper.get('[aria-label="Delete A"]').trigger('click');

		expect(emittedGraphics(wrapper).map(graphic => graphic.id)).toEqual(['b']);
		expect(emittedTarget(wrapper)).toEqual({ type: 'canvas' });
	});

	it('offers only the Graphic Item kinds the Host Contract supports', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		const palette = wrapper.getComponent({ name: 'USelect' });
		expect((palette.props('items') as Array<{ value: string }>).map(item => item.value)).toEqual(['text', 'shape', 'group']);
	});

	it('places a Graphic Item at the front of the Graphic Layer Order and selects it', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		wrapper.getComponent({ name: 'USelect' }).vm.$emit('update:modelValue', 'text');
		await nextTick();

		const graphics = emittedGraphics(wrapper);
		expect(graphics[0]?.items.map(item => [item.type, item.label])).toEqual([['text', 'Text 1']]);
		expect(emittedTarget(wrapper)).toEqual({
			type: 'item',
			graphicId: 'a',
			itemId: graphics[0]!.items[0]!.id,
		});
	});

	it('shows no Graphic Item palette until a Broadcast Graphic is selected', async () => {
		const wrapper = await mountComponent({ graphics: [{ id: 'a', name: 'A', items: [] }] });

		expect(wrapper.find('[data-testid="graphic-item-palette"]').exists()).toBe(false);
	});

	it('deletes a Graphic Item and falls back to its Broadcast Graphic', async () => {
		const wrapper = await mountComponent({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{
					type: 'shape',
					id: 'bar',
					label: 'Shape 1',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					geometry: squareShapeGeometry(),
					surfaceStyle: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1 },
				}],
			}],
			selectedGraphicId: 'a',
			selectedTarget: { type: 'item', graphicId: 'a', itemId: 'bar' },
		});

		await wrapper.get('[aria-label="Delete Shape 1"]').trigger('click');

		expect(emittedGraphics(wrapper)[0]?.items).toEqual([]);
		expect(emittedTarget(wrapper)).toEqual({ type: 'graphic', graphicId: 'a' });
	});

	it('nests the children of a Graphic Group under it as one layer', async () => {
		const wrapper = await mountComponent({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{
					type: 'group',
					id: 'cluster',
					label: 'Name block',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 400,
					height: 100,
					arrangement: 'row',
					padding: 0,
					gap: 8,
					align: 'stretch',
					justify: 'start',
					clip: false,
					geometry: squareShapeGeometry(),
					children: [{
						type: 'shape',
						id: 'child',
						label: 'Shape 1',
						visible: true,
						anchor: 'top-left',
						x: 0,
						y: 0,
						width: 10,
						height: 10,
						geometry: squareShapeGeometry(),
						surfaceStyle: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1 },
					}],
				}],
			}],
			selectedGraphicId: 'a',
			selectedTarget: { type: 'item', graphicId: 'a', itemId: 'cluster' },
		});

		const rows = wrapper.findAll('[data-graphic-item-depth]');
		expect(rows.map(row => row.attributes('data-graphic-item-depth'))).toEqual(['0', '1']);
		expect(rows[1]!.text()).toContain('Shape 1');
	});

	it('offers a Graphic Group child palette that never offers another Graphic Group', async () => {
		const wrapper = await mountComponent({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{
					type: 'group',
					id: 'cluster',
					label: 'Name block',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 400,
					height: 100,
					arrangement: 'row',
					padding: 0,
					gap: 8,
					align: 'stretch',
					justify: 'start',
					clip: false,
					geometry: squareShapeGeometry(),
					children: [],
				}],
			}],
			selectedGraphicId: 'a',
			selectedTarget: { type: 'item', graphicId: 'a', itemId: 'cluster' },
		});

		const palettes = wrapper.findAllComponents({ name: 'USelect' });
		const childPalette = palettes[palettes.length - 1]!;
		expect((childPalette.props('items') as Array<{ value: string }>).map(item => item.value))
			.toEqual(['text', 'shape']);

		childPalette.vm.$emit('update:modelValue', 'text');
		await nextTick();

		const graphics = emittedGraphics(wrapper);
		const group = graphics[0]!.items[0]!;
		expect(group.type === 'group' && group.children.map(child => child.label)).toEqual(['Text 1']);
	});

	it('shows no Graphic Group child palette while no group is in the selection', async () => {
		const wrapper = await mountComponent({
			graphics: [{ id: 'a', name: 'A', items: [] }],
			selectedGraphicId: 'a',
		});

		expect(wrapper.find('[data-testid="graphic-group-child-palette"]').exists()).toBe(false);
	});
});

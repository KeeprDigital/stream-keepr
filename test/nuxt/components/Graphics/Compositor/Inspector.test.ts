import type {
	BroadcastGraphicConfig,
	GraphicGroupItemConfig,
	GraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { DEFAULT_GRAPHIC_TYPOGRAPHY, squareShapeGeometry } from '~~/shared/modules/graphics';

enableAutoUnmount(afterEach);

const shapeItem: GraphicItemConfig = {
	type: 'shape',
	id: 'bar',
	label: 'Shape 1',
	visible: true,
	anchor: 'center',
	x: 100,
	y: 200,
	width: 400,
	height: 100,
	geometry: squareShapeGeometry(),
	surfaceStyle: { fill: { type: 'solid', color: '#0077a3' }, fillOpacity: 1 },
};

const groupItem: GraphicGroupItemConfig = {
	type: 'group',
	id: 'cluster',
	label: 'Name block',
	visible: true,
	anchor: 'top-left',
	x: 200,
	y: 400,
	width: 800,
	height: 200,
	arrangement: 'row',
	padding: 0,
	gap: 16,
	align: 'stretch',
	justify: 'start',
	clip: false,
	geometry: squareShapeGeometry(),
	children: [],
};

function groupWith(
	children: GraphicGroupItemConfig['children'],
	overrides: Partial<GraphicGroupItemConfig> = {},
): GraphicGroupItemConfig {
	return { ...groupItem, children, ...overrides };
}

const textItem: GraphicItemConfig = {
	type: 'text',
	id: 'name',
	label: 'Text 1',
	visible: true,
	anchor: 'top-left',
	x: 0,
	y: 0,
	width: 400,
	height: 80,
	text: 'Commentator',
	typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
	overflowPolicy: 'ellipsis',
	minFontSize: 24,
};

function stack(items: GraphicItemConfig[]): BroadcastGraphicConfig[] {
	return [{ id: 'lower-third', name: 'Lower Third', items }];
}

const SlotOnlyStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div><span>{{ label }}</span><slot /></div>',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: { modelValue: { type: [String, Number], required: false }, items: { type: Array, required: false } },
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" />',
});

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: { modelValue: { type: Number, required: false } },
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
});

const UInputStub = defineComponent({
	name: 'UInput',
	props: { modelValue: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" />',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, required: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

async function mountComponent(options: {
	graphics: BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Inspector.vue';
	const { default: Inspector } = await import(componentPath);

	return mount(Inspector, {
		props: {
			graphics: options.graphics,
			selectedTarget: options.selectedTarget,
			canvasWidth: 1920,
			canvasHeight: 1080,
		},
		global: {
			stubs: {
				UFormField: SlotOnlyStub,
				USelect: USelectStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USwitch: USwitchStub,
				UTextarea: UInputStub,
				UIColorPicker: UInputStub,
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

function numberField(wrapper: Awaited<ReturnType<typeof mountComponent>>, ariaLabel: string) {
	return wrapper.findAllComponents({ name: 'UInputNumber' })
		.find(input => input.attributes('aria-label') === ariaLabel);
}

function selectField(wrapper: Awaited<ReturnType<typeof mountComponent>>, testId: string) {
	return wrapper.findAllComponents({ name: 'USelect' })
		.find(select => select.attributes('data-testid') === testId);
}

function switchField(wrapper: Awaited<ReturnType<typeof mountComponent>>, testId: string) {
	return wrapper.findAllComponents({ name: 'USwitch' })
		.find(entry => entry.attributes('data-testid') === testId);
}

function itemOf(graphics: BroadcastGraphicConfig[], index = 0) {
	return graphics[0]?.items[index];
}

function childOf(graphics: BroadcastGraphicConfig[], index = 0) {
	const group = graphics[0]?.items[0];
	return group?.type === 'group' ? group.children[index] : undefined;
}

describe('graphicsCompositorInspector', () => {
	it('offers no Graphic Item controls while the canvas is selected', async () => {
		const wrapper = await mountComponent({ graphics: stack([shapeItem]), selectedTarget: { type: 'canvas' } });

		expect(wrapper.find('[data-testid="graphic-item-label"]').exists()).toBe(false);
		expect(wrapper.text()).toContain('1920x1080');
	});

	it('renames the selected Broadcast Graphic', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
		});

		wrapper.getComponent(UInputStub).vm.$emit('update:modelValue', 'Talent Lower Third');
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.name).toBe('Talent Lower Third');
	});

	it('shows the anchored coordinate of the selected Graphic Anchor Point', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(numberField(wrapper, 'Item x')?.props('modelValue')).toBe(300);
		expect(numberField(wrapper, 'Item y')?.props('modelValue')).toBe(250);
	});

	it('moves the stored top-left rectangle when the author edits the anchored coordinate', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		numberField(wrapper, 'Item x')?.vm.$emit('update:modelValue', 960);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.items[0]).toMatchObject({ x: 760, y: 200 });
	});

	it('holds the Graphic Anchor Point fixed while the author resizes the item', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		numberField(wrapper, 'Item width')?.vm.$emit('update:modelValue', 200);
		await nextTick();

		expect(emittedGraphics(wrapper)[0]?.items[0]).toMatchObject({ x: 200, width: 200 });
	});

	it('offers a Minimum font size control only for the shrink Text Overflow Policy', async () => {
		const ellipsis = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});
		expect(ellipsis.find('[data-testid="text-min-font-size"]').exists()).toBe(false);

		const shrink = await mountComponent({
			graphics: stack([{ ...textItem, overflowPolicy: 'shrink' }]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});
		expect(shrink.find('[data-testid="text-min-font-size"]').exists()).toBe(true);
	});

	it('offers Shape Graphic Item controls but not Text ones for a shape', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(wrapper.find('[data-testid="shape-geometry-preset"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="text-overflow-policy"]').exists()).toBe(false);
	});

	it('offers Text Graphic Item controls but not Shape ones for text', async () => {
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		expect(wrapper.find('[data-testid="text-overflow-policy"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="graphic-item-text"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="shape-geometry-preset"]').exists()).toBe(false);
	});

	it('hides a Graphic Item without removing it from the Graphic Layer Order', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await wrapper.get('[data-testid="graphic-item-visible"]').trigger('click');

		expect(emittedGraphics(wrapper)[0]?.items).toHaveLength(1);
		expect(emittedGraphics(wrapper)[0]?.items[0]?.visible).toBe(false);
	});

	it('explains a selection the Screen stack no longer carries', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'gone' },
		});

		expect(wrapper.text()).toContain('Selection unavailable');
		expect(wrapper.find('[data-testid="graphic-item-label"]').exists()).toBe(false);
	});

	it('offers Graphic Rotation for a canvas-positioned item and stores its degrees', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		numberField(wrapper, 'Graphic Rotation')?.vm.$emit('update:modelValue', -6);
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ rotation: -6 });
	});

	it('configures one Shape Geometry corner without disturbing the others', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		selectField(wrapper, 'shape-corner-topRight')?.vm.$emit('update:modelValue', 'cut');
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({
			geometry: {
				topRight: { treatment: 'cut' },
				topLeft: { treatment: 'square' },
			},
		});
	});

	it('slants an edge in canonical pixels', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		numberField(wrapper, 'Right edge slant')?.vm.$emit('update:modelValue', 48);
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ geometry: { rightSlant: 48 } });
	});

	it('initialises a Shape Geometry from a preset', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		selectField(wrapper, 'shape-geometry-preset')?.vm.$emit('update:modelValue', 'corner-cut');
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({
			geometry: { topRight: { treatment: 'cut' }, bottomLeft: { treatment: 'cut' } },
		});
	});

	it('switches a Graphic Fill to a linear gradient and edits one of its stops', async () => {
		const gradient = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		selectField(gradient, 'graphic-fill-kind')?.vm.$emit('update:modelValue', 'linear-gradient');
		await nextTick();

		const withGradient = emittedGraphics(gradient);
		expect(itemOf(withGradient)).toMatchObject({
			surfaceStyle: { fill: { type: 'linear-gradient', angle: 90 } },
		});

		const stops = await mountComponent({
			graphics: withGradient,
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});
		expect(stops.findAll('[data-testid="graphic-fill-stop"]')).toHaveLength(2);

		numberField(stops, 'Stop 2 opacity')?.vm.$emit('update:modelValue', 0.4);
		await nextTick();

		const patched = itemOf(emittedGraphics(stops));
		expect(patched?.surfaceStyle?.fill.type === 'linear-gradient'
			&& patched.surfaceStyle.fill.stops[1]?.opacity).toBe(0.4);
	});

	it('adds and removes gradient stops within the bounds of the vocabulary', async () => {
		const wrapper = await mountComponent({
			graphics: stack([{
				...shapeItem,
				surfaceStyle: {
					fill: {
						type: 'linear-gradient',
						angle: 90,
						stops: [
							{ color: '#000000', position: 0, opacity: 1 },
							{ color: '#ffffff', position: 1, opacity: 1 },
						],
					},
					fillOpacity: 1,
				},
			}]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(wrapper.get('[data-testid="graphic-fill-remove-stop"]').attributes('disabled')).toBeDefined();

		await wrapper.get('[data-testid="graphic-fill-add-stop"]').trigger('click');

		const patched = itemOf(emittedGraphics(wrapper));
		expect(patched?.surfaceStyle?.fill.type === 'linear-gradient'
			&& patched.surfaceStyle.fill.stops).toHaveLength(3);
	});

	it('adds an outline and a glow, and takes them away again', async () => {
		const wrapper = await mountComponent({
			graphics: stack([shapeItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await switchField(wrapper, 'graphic-outline-enabled')?.trigger('click');
		await switchField(wrapper, 'graphic-glow-enabled')?.trigger('click');

		expect(itemOf(emittedGraphics(wrapper, 0))?.surfaceStyle?.outline).toMatchObject({ width: 2 });
		expect(itemOf(emittedGraphics(wrapper, 1))?.surfaceStyle?.glow).toMatchObject({ size: 24 });

		const styled = await mountComponent({
			graphics: stack([{
				...shapeItem,
				surfaceStyle: {
					fill: { type: 'solid', color: '#0077a3' },
					fillOpacity: 1,
					outline: { color: '#ffffff', width: 4 },
				},
			}]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		await switchField(styled, 'graphic-outline-enabled')?.trigger('click');

		expect(itemOf(emittedGraphics(styled))?.surfaceStyle?.outline).toBeUndefined();
	});

	it('gives a Text Graphic Item a Graphic Surface Style of its own', async () => {
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		expect(wrapper.find('[data-testid="graphic-fill-kind"]').exists()).toBe(false);

		await switchField(wrapper, 'surface-style-own')?.trigger('click');

		expect(itemOf(emittedGraphics(wrapper))?.surfaceStyle).toMatchObject({ fillOpacity: 1 });
	});

	it('offers Graphic Group controls for a group', async () => {
		const wrapper = await mountComponent({
			graphics: stack([groupItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'cluster' },
		});

		selectField(wrapper, 'graphic-group-arrangement')?.vm.$emit('update:modelValue', 'canvas');
		await nextTick();

		expect(itemOf(emittedGraphics(wrapper))).toMatchObject({ arrangement: 'canvas' });
		// A Graphic Group owns a Shape Geometry too, for its surface and its clipping.
		expect(wrapper.find('[data-testid="shape-geometry-preset"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="graphic-group-clip"]').exists()).toBe(true);
	});

	it('offers main-axis sizing instead of a coordinate for a row Graphic Group child', async () => {
		const wrapper = await mountComponent({
			graphics: stack([groupWith([shapeItem])]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		expect(numberField(wrapper, 'Item x')).toBeUndefined();
		expect(wrapper.find('[data-testid="graphic-item-rotation"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="graphic-group-child-sizing-mode"]').exists()).toBe(true);

		selectField(wrapper, 'graphic-group-child-sizing-mode')?.vm.$emit('update:modelValue', 'fill');
		await nextTick();

		expect(childOf(emittedGraphics(wrapper))).toMatchObject({ sizing: { mode: 'fill' } });
	});

	it('projects a canvas Graphic Group child coordinate against its group bounds', async () => {
		const wrapper = await mountComponent({
			graphics: stack([groupWith(
				[{ ...shapeItem, anchor: 'top-left', x: 400, y: 100 }],
				{ arrangement: 'canvas' },
			)]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		selectField(wrapper, 'graphic-geometry-unit')?.vm.$emit('update:modelValue', 'percent');
		await nextTick();

		// The group is 800 wide, so 400px is half of the containing canvas.
		expect(numberField(wrapper, 'Item x')?.props('modelValue')).toBe(50);
	});

	it('lets a Graphic Group child override the local style default of its group', async () => {
		const wrapper = await mountComponent({
			graphics: stack([groupWith(
				[{ ...shapeItem, surfaceStyle: undefined }],
				{ defaultChildSurfaceStyle: { fill: { type: 'solid', color: '#00ff00' }, fillOpacity: 0.5 } },
			)]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});

		// Inheriting, so the group owns the style and the child offers no fill controls.
		expect(wrapper.find('[data-testid="graphic-fill-kind"]').exists()).toBe(false);

		await switchField(wrapper, 'surface-style-own')?.trigger('click');

		expect(childOf(emittedGraphics(wrapper))?.surfaceStyle).toMatchObject({ fillOpacity: 1 });
	});
});

import type { BroadcastGraphicConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { DEFAULT_GRAPHIC_TYPOGRAPHY } from '~~/shared/modules/graphics';

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
	geometry: { cornerRadius: 8 },
	surfaceStyle: { fill: '#0077a3', fillOpacity: 1 },
};

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

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

async function mountComponent(options: {
	graphics: BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	writable?: boolean;
}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Inspector.vue';
	const { default: Inspector } = await import(componentPath);

	return mount(Inspector, {
		props: {
			graphics: options.graphics,
			selectedTarget: options.selectedTarget,
			canvasWidth: 1920,
			canvasHeight: 1080,
			writable: options.writable ?? true,
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

		expect(wrapper.find('[data-testid="shape-corner-radius"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="text-overflow-policy"]').exists()).toBe(false);
	});

	it('offers Text Graphic Item controls but not Shape ones for text', async () => {
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
		});

		expect(wrapper.find('[data-testid="text-overflow-policy"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="graphic-item-text"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="shape-corner-radius"]').exists()).toBe(false);
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
	it('shows a read-only observer every property without letting it change one', async () => {
		const wrapper = await mountComponent({
			graphics: stack([textItem]),
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'name' },
			writable: false,
		});

		expect(wrapper.get('[data-testid="graphic-item-label"]').attributes('value')).toBe('Text 1');
		expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();

		wrapper.getComponent(USwitchStub).vm.$emit('update:modelValue', false);
		wrapper.findAllComponents(UInputStub).forEach(input => input.vm.$emit('update:modelValue', 'changed'));
		numberField(wrapper, 'Item width')?.vm.$emit('update:modelValue', 12);
		await nextTick();

		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});

	it('refuses a read-only observer\'s rename of the selected Broadcast Graphic', async () => {
		const wrapper = await mountComponent({
			graphics: stack([]),
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
			writable: false,
		});

		wrapper.getComponent(UInputStub).vm.$emit('update:modelValue', 'Renamed');
		await nextTick();

		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});
});

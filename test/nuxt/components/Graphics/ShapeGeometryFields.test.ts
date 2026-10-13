import type { ShapeGeometry } from '~~/shared/types/graphics';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { squareShapeGeometry } from '~~/shared/modules/graphics';
import { MAX_SHAPE_GEOMETRY_PX } from '~~/shared/types/graphics';
import ShapeGeometryFields from '~/components/Graphics/ShapeGeometryFields.vue';

/**
 * The one Shape Geometry fields control, shared by the compositor Inspector and
 * a Graphic Style Set's Shape Geometry entries: which fields an author sees, the
 * bounds they may enter, and the patch each edit emits.
 */

enableAutoUnmount(afterEach);

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
		min: { type: Number, required: false },
		max: { type: Number, required: false },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" :disabled="disabled" />',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: String, required: false },
		items: { type: Array, default: () => [] },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" :disabled="disabled" />',
});

const global = {
	stubs: {
		UFormField: defineComponent({ props: { label: { type: String, default: '' } }, template: '<label><span>{{ label }}</span><slot /></label>' }),
		UInputNumber: UInputNumberStub,
		USelect: USelectStub,
	},
};

const cutTopRight: ShapeGeometry = { ...squareShapeGeometry(), topRight: { treatment: 'cut', size: 24 } };

function mountFields(props: { geometry?: ShapeGeometry; disabled?: boolean } = {}) {
	return mount(ShapeGeometryFields, {
		global,
		props: { geometry: props.geometry ?? cutTopRight, disabled: props.disabled },
	});
}

type Wrapper = ReturnType<typeof mountFields>;

function number(wrapper: Wrapper, ariaLabel: string) {
	return wrapper.findAllComponents({ name: 'UInputNumber' }).find(input => input.attributes('aria-label') === ariaLabel);
}

function select(wrapper: Wrapper, testId: string) {
	return wrapper.findAllComponents({ name: 'USelect' }).find(input => input.attributes('data-testid') === testId);
}

describe('shape geometry fields', () => {
	it('asks for a corner size only while the corner is not square', () => {
		const wrapper = mountFields();

		expect(number(wrapper, 'Top left size')).toBeUndefined();
		expect(number(wrapper, 'Top right size')?.props('modelValue')).toBe(24);
	});

	it('emits a whole corner when one of its fields changes', async () => {
		const wrapper = mountFields();

		number(wrapper, 'Top right size')!.vm.$emit('update:modelValue', 40);
		select(wrapper, 'shape-corner-topLeft')!.vm.$emit('update:modelValue', 'rounded');
		await flushPromises();

		expect(wrapper.emitted('update')).toEqual([
			[{ topRight: { treatment: 'cut', size: 40 } }],
			[{ topLeft: { treatment: 'rounded', size: 0 } }],
		]);
	});

	it('emits an edge slant in canonical pixels, and a cleared field as zero', async () => {
		const wrapper = mountFields();

		number(wrapper, 'Right edge slant')!.vm.$emit('update:modelValue', -48);
		number(wrapper, 'Left edge slant')!.vm.$emit('update:modelValue', null);
		await flushPromises();

		expect(wrapper.emitted('update')).toEqual([[{ rightSlant: -48 }], [{ leftSlant: 0 }]]);
	});

	it('bounds every entry by what a saved Shape Geometry accepts', () => {
		const wrapper = mountFields();

		expect(number(wrapper, 'Top right size')!.props()).toMatchObject({ min: 0, max: MAX_SHAPE_GEOMETRY_PX });
		expect(number(wrapper, 'Left edge slant')!.props()).toMatchObject({
			min: -MAX_SHAPE_GEOMETRY_PX,
			max: MAX_SHAPE_GEOMETRY_PX,
		});
	});

	it('hands the chosen preset to its host, which knows the bounds it applies to', async () => {
		const wrapper = mountFields();

		select(wrapper, 'shape-geometry-preset')!.vm.$emit('update:modelValue', 'corner-cut');
		await flushPromises();

		expect(wrapper.emitted('preset')).toEqual([['corner-cut']]);
		expect(wrapper.emitted('update')).toBeUndefined();
	});

	it('gives an observer every field to read and none to write', () => {
		const wrapper = mountFields({ disabled: true });

		const controls = wrapper.findAll('input, select');
		expect(controls.length).toBe(1 + 4 + 1 + 2);
		for (const control of controls)
			expect((control.element as HTMLInputElement).disabled).toBe(true);
	});
});

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

const global = {
	stubs: {
		UFormField: defineComponent({
			props: {
				label: { type: String, default: '' },
			},
			template: '<label><span>{{ label }}</span><slot /></label>',
		}),
		UInputNumber: UInputNumberStub,
	},
};

const cutTopRight: ShapeGeometry = {
	...squareShapeGeometry(),
	topRight: { treatment: 'cut', size: 24 },
};

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

describe('shape geometry fields', () => {
	it('asks for a corner size only while the corner is not square', () => {
		const wrapper = mountFields();

		expect(number(wrapper, 'Top left size')).toBeUndefined();
		expect(number(wrapper, 'Top right size')?.props('modelValue')).toBe(24);
	});

	it('emits a whole corner when one of its fields changes', async () => {
		const wrapper = mountFields();

		number(wrapper, 'Top right size')!.vm.$emit('update:modelValue', 40);
		await wrapper.get('[data-testid="shape-corner-topLeft"] [data-treatment-option="rounded"]').trigger('click');
		await flushPromises();

		expect(wrapper.emitted('update')).toEqual([
			[
				{
					topRight: { treatment: 'cut', size: 40 },
				},
			],
			[
				{
					topLeft: { treatment: 'rounded', size: 0 },
				},
			],
		]);
	});

	it('emits an edge slant in canonical pixels, and a cleared field as zero', async () => {
		const wrapper = mountFields();

		number(wrapper, 'Right edge slant')!.vm.$emit('update:modelValue', -48);
		number(wrapper, 'Left edge slant')!.vm.$emit('update:modelValue', null);
		await flushPromises();

		expect(wrapper.emitted('update')).toEqual([
			[
				{ rightSlant: -48 },
			],
			[
				{ leftSlant: 0 },
			],
		]);
	});

	it('bounds every entry by what a saved Shape Geometry accepts', () => {
		const wrapper = mountFields();

		expect(number(wrapper, 'Top right size')!.props()).toMatchObject({ min: 0, max: MAX_SHAPE_GEOMETRY_PX });
		expect(number(wrapper, 'Left edge slant')!.props()).toMatchObject({
			min: -MAX_SHAPE_GEOMETRY_PX,
			max: MAX_SHAPE_GEOMETRY_PX,
		});
	});

	it('shows each corner\'s treatment where the corner sits', () => {
		const wrapper = mountFields();

		expect(wrapper.get('[data-testid="shape-corner-topRight"]').attributes('data-treatment')).toBe('cut');
		expect(wrapper.get('[data-testid="shape-corner-topRight"] [data-treatment-option="cut"]').attributes('aria-pressed')).toBe('true');
	});

	it('applies a corner edit to all four while All corners is on', async () => {
		const wrapper = mountFields();

		await wrapper.get('[data-testid="shape-corners-linked"]').trigger('click');
		await wrapper.get('[data-testid="shape-corner-bottomLeft"] [data-treatment-option="rounded"]').trigger('click');

		const rounded = { treatment: 'rounded', size: 0 };
		expect(wrapper.emitted('update')).toEqual([
			[
				{
					topLeft: rounded,
					topRight: rounded,
					bottomLeft: rounded,
					bottomRight: rounded,
				},
			],
		]);
	});

	it('hands the chosen preset to its host, which knows the bounds it applies to', async () => {
		const wrapper = mountFields();

		await wrapper.get('[data-testid="shape-geometry-preset-corner-cut"]').trigger('click');
		await flushPromises();

		expect(wrapper.emitted('preset')).toEqual([
			['corner-cut'],
		]);
		expect(wrapper.emitted('update')).toBeUndefined();
	});

	it('gives an observer every field to read and none to write', () => {
		const wrapper = mountFields({ disabled: true });

		// Four presets, the All corners link, three treatments per corner, the one
		// sized corner, and two slants.
		const controls = wrapper.findAll('input, button');
		expect(controls.length).toBe(4 + 1 + 12 + 1 + 2);
		for (const control of controls)
			expect((control.element as HTMLInputElement).disabled).toBe(true);
	});
});

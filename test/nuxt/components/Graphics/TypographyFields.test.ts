import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import TypographyFields from '~/components/Graphics/TypographyFields.vue';

/**
 * The one typography fields control, shared by a Graphic Item's base typography, a
 * Graphic Placeholder Style, and a Graphic Style Set typography entry: the bounds
 * each field holds, what clearing one emits, and what the inheritable mode a
 * Graphic Placeholder Style uses adds and removes.
 */

enableAutoUnmount(afterEach);

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
		min: { type: Number, required: false },
		max: { type: Number, required: false },
		step: { type: Number, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" :disabled="disabled" />',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: String, required: false },
		items: { type: Array, default: () => [] },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" :disabled="disabled" />',
});

const global = {
	stubs: {
		UFormField: defineComponent({ template: '<div><slot /></div>' }),
		UInputNumber: UInputNumberStub,
		USelect: USelectStub,
	},
};

const BASE = {
	fontSize: 64,
	fontWeight: 700,
	fontStyle: 'normal' as const,
	textTransform: 'none' as const,
	letterSpacing: 0,
	lineHeight: 1.15,
};

function mountFields(props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}) {
	return mount(TypographyFields, {
		global,
		props: { typography: BASE, testIdPrefix: 'type', ...props },
		slots,
	});
}

type Wrapper = ReturnType<typeof mountFields>;

function numberField(wrapper: Wrapper, ariaLabel: string) {
	return wrapper.findAllComponents({ name: 'UInputNumber' }).find(input => input.attributes('aria-label') === ariaLabel);
}

function selectField(wrapper: Wrapper, testId: string) {
	return wrapper.findAllComponents({ name: 'USelect' }).find(select => select.attributes('data-testid') === testId);
}

async function enter(wrapper: Wrapper, ariaLabel: string, value: number | null) {
	numberField(wrapper, ariaLabel)!.vm.$emit('update:modelValue', value);
	await flushPromises();
	return wrapper.emitted('update')?.at(-1)?.[0];
}

async function choose(wrapper: Wrapper, testId: string, value: string) {
	selectField(wrapper, testId)!.vm.$emit('update:modelValue', value);
	await flushPromises();
	return wrapper.emitted('update')?.at(-1)?.[0];
}

describe('typography fields', () => {
	it('offers size, weight, letter spacing, line height, style and case', () => {
		const wrapper = mountFields();

		expect(numberField(wrapper, 'Font size')?.props('modelValue')).toBe(64);
		expect(numberField(wrapper, 'Font weight')?.props('modelValue')).toBe(700);
		expect(numberField(wrapper, 'Letter spacing')?.props('modelValue')).toBe(0);
		expect(numberField(wrapper, 'Line height')?.props('modelValue')).toBe(1.15);
		expect(selectField(wrapper, 'type-font-style')?.props('modelValue')).toBe('normal');
		expect(selectField(wrapper, 'type-case')?.props('modelValue')).toBe('none');
	});

	it('bounds every field to what each typography schema accepts', () => {
		const wrapper = mountFields();
		const bounds = (label: string) => {
			const field = numberField(wrapper, label)!;
			return [field.props('min'), field.props('max')];
		};

		expect(bounds('Font size')).toEqual([1, 600]);
		expect(bounds('Font weight')).toEqual([1, 1000]);
		expect(bounds('Letter spacing')).toEqual([-100, 100]);
		expect(bounds('Line height')).toEqual([0.05, 10]);
		expect(numberField(wrapper, 'Line height')!.props('step')).toBe(0.05);
	});

	it('emits one field at a time, held within its bounds', async () => {
		const wrapper = mountFields();

		expect(await enter(wrapper, 'Font size', 96)).toEqual({ fontSize: 96 });
		expect(await enter(wrapper, 'Font size', 900)).toEqual({ fontSize: 600 });
		expect(await enter(wrapper, 'Font weight', 0)).toEqual({ fontWeight: 1 });
		// A weight is a whole number on every typography schema.
		expect(await enter(wrapper, 'Font weight', 450.6)).toEqual({ fontWeight: 451 });
		expect(await enter(wrapper, 'Letter spacing', -250)).toEqual({ letterSpacing: -100 });
		expect(await enter(wrapper, 'Line height', 0)).toEqual({ lineHeight: 0.05 });
		expect(await choose(wrapper, 'type-font-style', 'italic')).toEqual({ fontStyle: 'italic' });
		expect(await choose(wrapper, 'type-case', 'uppercase')).toEqual({ textTransform: 'uppercase' });
	});

	it('returns a cleared field to the default typography, since a typography must name every value', async () => {
		const wrapper = mountFields();

		expect(await enter(wrapper, 'Font size', null)).toEqual({ fontSize: 64 });
		expect(await enter(wrapper, 'Font weight', null)).toEqual({ fontWeight: 700 });
		expect(await enter(wrapper, 'Letter spacing', null)).toEqual({ letterSpacing: 0 });
		expect(await enter(wrapper, 'Line height', null)).toEqual({ lineHeight: 1.15 });
	});

	describe('inheritable, for a Graphic Placeholder Style', () => {
		it('leaves out line height, which lays out the whole text block rather than one run', () => {
			const wrapper = mountFields({ inheritable: true, typography: {} });

			expect(numberField(wrapper, 'Line height')).toBeUndefined();
			expect(numberField(wrapper, 'Letter spacing')).toBeDefined();
			expect(selectField(wrapper, 'type-case')).toBeDefined();
		});

		it('returns a cleared field to the base typography rather than a value', async () => {
			const wrapper = mountFields({ inheritable: true, typography: { fontSize: 24, letterSpacing: 2 } });

			expect(await enter(wrapper, 'Font size', null)).toEqual({ fontSize: undefined });
			expect(await enter(wrapper, 'Letter spacing', null)).toEqual({ letterSpacing: undefined });
		});

		it('offers "same as base" for style and case, and shows it for an unset one', async () => {
			const wrapper = mountFields({ inheritable: true, typography: { textTransform: 'uppercase' } });

			expect(selectField(wrapper, 'type-font-style')?.props('modelValue')).toBe('base');
			expect(selectField(wrapper, 'type-case')?.props('modelValue')).toBe('uppercase');
			expect((selectField(wrapper, 'type-case')?.props('items') as { value: string }[])[0])
				.toEqual({ label: 'Same as base', value: 'base' });
			expect(await choose(wrapper, 'type-case', 'base')).toEqual({ textTransform: undefined });
			expect(await choose(wrapper, 'type-font-style', 'italic')).toEqual({ fontStyle: 'italic' });
		});
	});

	it('puts the host\'s font above the grid and its colour inside it', () => {
		const wrapper = mountFields({}, {
			font: () => h('div', { 'data-testid': 'font-slot' }),
			color: () => h('div', { 'data-testid': 'color-slot' }),
		});

		expect(wrapper.find('[data-testid="font-slot"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="type-grid"] [data-testid="color-slot"]').exists()).toBe(true);
	});

	it('disables every field for an observer', () => {
		const wrapper = mountFields({ disabled: true });

		for (const control of wrapper.findAll('input, select'))
			expect((control.element as HTMLInputElement).disabled).toBe(true);
	});
});

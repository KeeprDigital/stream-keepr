import type { BorderFieldsValue, GlowFieldsValue } from '~/types/borderGlow';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import BorderGlowFields from '~/components/Graphics/BorderGlowFields.vue';

// The one border and glow fields control, shared by the Feature Match Overlay Frame, Source Item
// framing, a Graphic Surface Style, and a Graphic Surface Style entry in a Graphic Style Set: what…

enableAutoUnmount(afterEach);

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<div><span>{{ label }}</span><slot /></div>',
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: {
		modelValue: { type: Boolean, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" role="switch" :aria-checked="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
		min: { type: Number, required: false },
		max: { type: Number, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

const global = {
	stubs: {
		UFormField: UFormFieldStub,
		USwitch: USwitchStub,
		UInputNumber: UInputNumberStub,
		UIOpacityInput: defineComponent({
			name: 'UIOpacityInput',
			props: {
				modelValue: { type: Number, required: false },
			},
			emits: ['update:modelValue'],
			template: '<input type="number" :value="modelValue" />',
		}),
		UButton: UButtonStub,
		USelect: defineComponent({
			name: 'USelect',
			props: {
				modelValue: { type: String, required: false },
				items: { type: Array, required: false },
			},
			emits: ['update:modelValue'],
			template: '<select />',
		}),
		UIColorPicker: defineComponent({
			name: 'UIColorPicker',
			props: {
				modelValue: { type: String, required: false },
				hexOnly: { type: Boolean, required: false },
			},
			emits: ['update:modelValue'],
			template: '<button type="button" />',
		}),
	},
};

const border: BorderFieldsValue = { color: '#0077a3', width: 4 };
const glow: GlowFieldsValue = { color: '#ffffff', size: 8, opacity: 0.75 };

function mountFields(props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) {
	return mount(BorderGlowFields, {
		global,
		props: {
			borderLabel: 'Border',
			border,
			glow,
			...props,
		},
		slots: slots as never,
	});
}

type Wrapper = ReturnType<typeof mountFields>;

function switchFor(wrapper: Wrapper, label: string) {
	return wrapper.findAllComponents({ name: 'USwitch' }).find(entry => entry.attributes('aria-label') === label);
}

function input(wrapper: Wrapper, name: string, ariaLabel: string) {
	return wrapper.findAllComponents({ name }).find(entry => entry.attributes('aria-label') === ariaLabel);
}

function lastEdit(wrapper: Wrapper) {
	return wrapper.emitted('edit')?.at(-1)?.[0];
}

describe('border and glow fields', () => {
	it('labels the border with the host\'s name for it', () => {
		const wrapper = mountFields({ borderLabel: 'Outline' });

		expect(switchFor(wrapper, 'Outline')?.props('modelValue')).toBe(true);
		expect(input(wrapper, 'UInputNumber', 'Outline width')?.props('modelValue')).toBe(4);
	});

	it('switches the border on with an empty patch and off with null', async () => {
		const off = mountFields({ border: null });
		expect(input(off, 'UInputNumber', 'Border width')).toBeUndefined();

		await switchFor(off, 'Border')!.trigger('click');
		expect(lastEdit(off)).toEqual({ kind: 'border', patch: {} });

		const on = mountFields();
		await switchFor(on, 'Border')!.trigger('click');
		expect(lastEdit(on)).toEqual({ kind: 'border', patch: null });
	});

	it('switches the glow on with an empty patch and off with null', async () => {
		const off = mountFields({ glow: null });
		expect(input(off, 'UInputNumber', 'Glow size')).toBeUndefined();

		await switchFor(off, 'Glow')!.trigger('click');
		expect(lastEdit(off)).toEqual({ kind: 'glow', patch: {} });

		const on = mountFields();
		await switchFor(on, 'Glow')!.trigger('click');
		expect(lastEdit(on)).toEqual({ kind: 'glow', patch: null });
	});

	it('emits each value edit as a patch, a cleared number as 0', async () => {
		const wrapper = mountFields();

		input(wrapper, 'UInputNumber', 'Border width')!.vm.$emit('update:modelValue', 6);
		await flushPromises();
		expect(lastEdit(wrapper)).toEqual({
			kind: 'border',
			patch: { width: 6 },
		});

		input(wrapper, 'UInputNumber', 'Glow size')!.vm.$emit('update:modelValue', null);
		await flushPromises();
		expect(lastEdit(wrapper)).toEqual({
			kind: 'glow',
			patch: { size: 0 },
		});

		input(wrapper, 'UIOpacityInput', 'Glow opacity')!.vm.$emit('update:modelValue', 0.4);
		await flushPromises();
		expect(lastEdit(wrapper)).toEqual({
			kind: 'glow',
			patch: { opacity: 0.4 },
		});
	});

	it('edits colour with a colour picker, hex-only where the host asks, and clears to undefined', async () => {
		const wrapper = mountFields({ hexOnly: true });
		const picker = input(wrapper, 'UIColorPicker', 'Border colour')!;

		expect(picker.props('hexOnly')).toBe(true);
		expect(picker.props('modelValue')).toBe('#0077a3');

		picker.vm.$emit('update:modelValue', '');
		await flushPromises();
		expect(lastEdit(wrapper)).toEqual({
			kind: 'border',
			patch: { color: undefined },
		});

		input(wrapper, 'UIColorPicker', 'Glow colour')!.vm.$emit('update:modelValue', '#ff0000');
		await flushPromises();
		expect(lastEdit(wrapper)).toEqual({
			kind: 'glow',
			patch: { color: '#ff0000' },
		});
	});

	it('lets the host replace the colour picker through the colour slot', async () => {
		const wrapper = mountFields({}, {
			color: (slot: { target: 'border' | 'glow'; value?: string; label: string; update: (value?: string) => void }) =>
				h('button', {
					'type': 'button',
					'data-testid': `palette-${slot.target}`,
					'data-value': slot.value,
					'aria-label': slot.label,
					'onClick': () => slot.update('brand'),
				}),
		});

		expect(wrapper.findComponent({ name: 'UIColorPicker' }).exists()).toBe(false);
		expect(wrapper.get('[data-testid="palette-border"]').attributes('data-value')).toBe('#0077a3');
		expect(wrapper.get('[data-testid="palette-glow"]').attributes('aria-label')).toBe('Glow colour');

		await wrapper.get('[data-testid="palette-glow"]').trigger('click');
		expect(lastEdit(wrapper)).toEqual({
			kind: 'glow',
			patch: { color: 'brand' },
		});
	});

	it('offers per-side borders only where the host does, a missing side counting as shown', async () => {
		expect(mountFields().text()).not.toContain('Top');

		const wrapper = mountFields({
			perSide: true,
			border: {
				...border,
				sides: { right: false },
			},
		});
		const sideButton = (label: string) => wrapper.findAll('button').find(button => button.text() === label)!;

		expect(sideButton('Top').attributes('aria-pressed')).toBe('true');
		expect(sideButton('Right').attributes('aria-pressed')).toBe('false');

		await sideButton('Top').trigger('click');
		expect(lastEdit(wrapper)).toEqual({ kind: 'border-side', side: 'top', visible: false });

		await sideButton('Right').trigger('click');
		expect(lastEdit(wrapper)).toEqual({ kind: 'border-side', side: 'right', visible: true });
	});

	it('offers a glow position only where the host does, absent meaning both', async () => {
		expect(input(mountFields(), 'USelect', 'Glow position')).toBeUndefined();

		const wrapper = mountFields({ glowPosition: true });
		const select = input(wrapper, 'USelect', 'Glow position')!;
		expect(select.props('modelValue')).toBe('both');

		select.vm.$emit('update:modelValue', 'inside');
		await flushPromises();
		expect(lastEdit(wrapper)).toEqual({
			kind: 'glow',
			patch: { position: 'inside' },
		});
	});

	it('hides the glow while the border is off where the host only glows a border', () => {
		const gated = mountFields({ glowGatedOnBorder: true, border: null });
		expect(switchFor(gated, 'Glow')).toBeUndefined();
		expect(input(gated, 'UInputNumber', 'Glow size')).toBeUndefined();

		expect(input(mountFields({ glowGatedOnBorder: true }), 'UInputNumber', 'Glow size')).toBeDefined();
		expect(input(mountFields({ border: null }), 'UInputNumber', 'Glow size')).toBeDefined();
	});

	it('prefixes accessible names where several surfaces share one form', () => {
		const wrapper = mountFields({ borderLabel: 'Outline', ariaLabelPrefix: 'Won box' });

		expect(switchFor(wrapper, 'Won box outline')).toBeDefined();
		expect(input(wrapper, 'UInputNumber', 'Won box outline width')).toBeDefined();
		expect(input(wrapper, 'UInputNumber', 'Won box glow size')).toBeDefined();
	});

	it('disables every control when the host is read-only', () => {
		const wrapper = mountFields({ disabled: true });

		expect(wrapper.findAllComponents({ name: 'USwitch' }).every(entry => entry.props('disabled'))).toBe(true);
		expect(wrapper.findAllComponents({ name: 'UInputNumber' }).every(entry => entry.props('disabled'))).toBe(true);
	});
});

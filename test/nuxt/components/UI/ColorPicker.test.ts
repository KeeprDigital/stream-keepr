import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

const UPopoverStub = defineComponent({
	props: {
		open: { type: Boolean, required: false },
	},
	emits: ['update:open'],
	template: '<div><slot /><slot name="content" /></div>',
});

const UButtonStub = defineComponent({
	props: {
		variant: { type: String, required: false },
		color: { type: String, required: false },
		size: { type: String, required: false },
		block: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :class="$attrs.class" @click="$emit(\'click\')"><slot /></button>',
});

const UColorPickerStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		size: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="color-input" type="color" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const UInputStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		placeholder: { type: String, required: false },
		size: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="text-input" type="text" :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

async function mountComponent(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../app/components/UI/ColorPicker.vue';
	const { default: ColorPicker } = await import(componentPath);

	return mount(ColorPicker, {
		props,
		global: {
			stubs: {
				UPopover: UPopoverStub,
				UButton: UButtonStub,
				UColorPicker: UColorPickerStub,
				UInput: UInputStub,
			},
		},
	});
}

describe('uiColorPicker', () => {
	it('clears to transparent from the transparent action', async () => {
		const wrapper = await mountComponent({ modelValue: '#112233' });
		const buttons = wrapper.findAll('button');

		await buttons[1]!.trigger('click');

		expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['']);
	});

	it('accepts raw CSS values unchanged when allowRawValue is enabled', async () => {
		const wrapper = await mountComponent({ allowRawValue: true, modelValue: 'linear-gradient(red, blue)' });
		const input = wrapper.get('[data-testid="text-input"]');

		await input.setValue('radial-gradient(circle, red, blue)');

		expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['radial-gradient(circle, red, blue)']);
	});

	it('treats the transparent keyword as transparent state', async () => {
		const wrapper = await mountComponent({ allowRawValue: true, modelValue: 'transparent' });

		expect(wrapper.find('button').classes()).toContain('checkerboard');
	});
});

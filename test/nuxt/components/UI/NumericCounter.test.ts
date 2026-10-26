import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { UButtonStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import NumericCounter from '~/components/UI/NumericCounter.vue';

// The counter blurs and selects through the input's exposed `inputRef`, which
// the shared stub does not expose.
const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: [
		'update:modelValue',
		'blur',
		'focus',
		'keydown',
	],
	setup(_, { emit, expose }) {
		const inputRef = ref<HTMLInputElement | null>(null);
		expose({ inputRef });
		return {
			inputRef,
			onInput: (event: Event) => emit('update:modelValue', Number((event.target as HTMLInputElement).value)),
		};
	},
	template: '<input ref="inputRef" :value="modelValue ?? \'\'" :disabled="disabled" @input="onInput" @blur="$emit(\'blur\', $event)" @focus="$emit(\'focus\', $event)" @keydown="$emit(\'keydown\', $event)" />',
});

async function mountComponent(props: Record<string, unknown>) {
	return mount(NumericCounter, {
		props: {
			value: 20,
			...props,
		},
		global: {
			stubs: {
				UButton: UButtonStub,
				UInputNumber: UInputNumberStub,
			},
		},
	});
}

describe('numericCounter', () => {
	it('clamps manual input on blur', async () => {
		const wrapper = await mountComponent({ value: 2, min: 0, max: 5 });

		const input = wrapper.get('input');
		await input.trigger('focus');
		await input.setValue('9');
		await input.trigger('blur');

		expect(wrapper.emitted('set')).toEqual([
			[5],
		]);
	});

	it('updates button disabled state from the draft value while editing', async () => {
		const wrapper = await mountComponent({ value: 2, min: 0, max: 3 });

		const input = wrapper.get('input');
		await input.trigger('focus');
		await input.setValue('0');
		await nextTick();

		const buttons = wrapper.findAll('button');
		expect(buttons[0]?.attributes('disabled')).toBeDefined();
		expect(buttons[1]?.attributes('disabled')).toBeUndefined();
	});

	it('reverts the draft value on escape', async () => {
		const wrapper = await mountComponent({ value: 20 });

		const input = wrapper.get('input');
		(input.element as HTMLInputElement).focus();
		await input.trigger('focus');
		await input.setValue('27');
		await input.trigger('keydown', { key: 'Escape' });
		await nextTick();

		expect(wrapper.emitted('set')).toBeUndefined();
		expect((input.element as HTMLInputElement).value).toBe('20');
	});

	it('commits the draft value once on enter', async () => {
		const wrapper = await mountComponent({ value: 20 });

		const input = wrapper.get('input');
		(input.element as HTMLInputElement).focus();
		await input.trigger('focus');
		await input.setValue('23');
		await input.trigger('keydown', { key: 'Enter' });
		await nextTick();

		expect(wrapper.emitted('set')).toEqual([
			[23],
		]);
	});

	it('gives every control a contextual accessible name', async () => {
		const wrapper = await mountComponent({ accessibleLabel: 'Alice life total' });
		const buttons = wrapper.findAll('button');

		expect(buttons[0]?.attributes('aria-label')).toBe('Decrease Alice life total');
		expect(wrapper.get('input').attributes('aria-label')).toBe('Alice life total');
		expect(buttons[1]?.attributes('aria-label')).toBe('Increase Alice life total');
	});
});

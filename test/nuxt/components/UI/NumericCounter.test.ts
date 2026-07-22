import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

const UButtonStub = defineComponent({
	props: {
		size: { type: String, required: false },
		disabled: { type: Boolean, required: false },
		icon: { type: String, required: false },
	},
	emits: ['click'],
	template: '<button :class="$attrs.class" :data-size="size" :data-icon="icon" :disabled="disabled" @click="$emit(\'click\')" />',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
		size: { type: String, required: false },
		ui: { type: Object, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue', 'blur', 'focus', 'keydown'],
	setup(_, { emit, expose }) {
		const inputRef = ref<HTMLInputElement | null>(null);

		function handleInput(event: Event) {
			emit('update:modelValue', Number((event.target as HTMLInputElement).value));
		}

		expose({ inputRef });

		return {
			inputRef,
			handleInput,
		};
	},
	template: '<input ref="inputRef" :class="$attrs.class" :value="modelValue ?? \'\'" :data-size="size" :data-ui-base="ui?.base" :disabled="disabled" @input="handleInput" @blur="$emit(\'blur\', $event)" @focus="$emit(\'focus\', $event)" @keydown="$emit(\'keydown\', $event)" />',
});

async function mountComponent(props: Record<string, unknown>) {
	const componentPath = '../../../../app/components/UI/' + 'NumericCounter.vue';
	const { default: NumericCounter } = await import(componentPath);

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
	it('uses slimmer touch sizing for secondary vertical counters', async () => {
		const wrapper = await mountComponent({ touch: true, orientation: 'vertical' });

		const buttons = wrapper.findAll('button');
		expect(buttons[0]?.attributes('data-size')).toBe('xl');
		expect(buttons[0]?.classes()).toContain('h-16');
		expect(buttons[0]?.classes()).toContain('w-[7.25rem]');

		const input = wrapper.get('input');
		expect(input.attributes('data-ui-base')).toContain('w-[7.25rem]');
		expect(input.attributes('data-ui-base')).toContain('text-6xl');
	});

	it('clamps manual input on blur', async () => {
		const wrapper = await mountComponent({ value: 2, min: 0, max: 5 });

		const input = wrapper.get('input');
		await input.trigger('focus');
		await input.setValue('9');
		await input.trigger('blur');

		expect(wrapper.emitted('set')).toEqual([[5]]);
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

		expect(wrapper.emitted('set')).toEqual([[23]]);
	});

	it('gives every control a contextual accessible name', async () => {
		const wrapper = await mountComponent({ accessibleLabel: 'Alice life total' });
		const buttons = wrapper.findAll('button');

		expect(buttons[0]?.attributes('aria-label')).toBe('Decrease Alice life total');
		expect(wrapper.get('input').attributes('aria-label')).toBe('Alice life total');
		expect(buttons[1]?.attributes('aria-label')).toBe('Increase Alice life total');
	});
});

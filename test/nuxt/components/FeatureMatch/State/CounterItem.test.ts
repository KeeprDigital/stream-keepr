import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

const UButtonStub = defineComponent({
	props: {
		size: { type: String, required: false },
		label: { type: String, required: false },
		icon: { type: String, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button :class="$attrs.class" :data-size="size" :data-label="label" :data-icon="icon" :data-disabled="String(!!disabled)" @click="$emit(\'click\')">{{ label }}</button>',
});

const UPopoverStub = defineComponent({
	template: '<div><slot /><slot name="content" /></div>',
});

const UINumericCounterStub = defineComponent({
	props: {
		touch: { type: Boolean, required: false },
		compact: { type: Boolean, required: false },
		orientation: { type: String, required: false },
		value: { type: Number, required: false },
		readonly: { type: Boolean, required: false },
	},
	template: `<div data-testid="numeric-counter" :data-touch="String(!!touch)" :data-compact="String(!!compact)" :data-orientation="orientation || 'horizontal'" :data-value="String(value ?? 0)" :data-readonly="String(!!readonly)" />`,
});

async function mountComponent(props: Record<string, unknown>) {
	const componentPath = '../../../../../app/components/FeatureMatch/State/' + 'CounterItem.vue';
	const { default: CounterItem } = await import(componentPath);

	return mount(CounterItem, {
		props: {
			counter: { type: 'poison', value: 3 },
			config: { key: 'poison', label: 'Poison', shortLabel: 'Poison', icon: 'i-lucide-skull' },
			...props,
		},
		global: {
			stubs: {
				UButton: UButtonStub,
				UPopover: UPopoverStub,
				UINumericCounter: UINumericCounterStub,
			},
		},
	});
}

describe('featureMatchCounterItem', () => {
	it('uses the larger non-compact numeric counter for touch mode', async () => {
		const wrapper = await mountComponent({ touch: true });

		expect(wrapper.classes()).toContain('gap-2.5');
		expect(wrapper.get('[data-testid="numeric-counter"]').attributes('data-touch')).toBe('true');
		expect(wrapper.get('[data-testid="numeric-counter"]').attributes('data-compact')).toBe('false');
		expect(wrapper.get('[data-testid="numeric-counter"]').attributes('data-orientation')).toBe('vertical');

		const buttons = wrapper.findAll('button');
		expect(buttons[0]?.attributes('data-size')).toBe('md');
		expect(buttons[0]?.classes()).toContain('px-3');
	});

	it('renders a non-interactive label shell and readonly value in readonly mode', async () => {
		const wrapper = await mountComponent({ readonly: true });

		const buttons = wrapper.findAll('button');
		expect(buttons).toHaveLength(1);
		expect(buttons[0]?.attributes('data-disabled')).toBe('true');
		expect(wrapper.get('[data-testid="numeric-counter"]').attributes('data-readonly')).toBe('true');
	});
});

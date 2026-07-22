import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

const UButtonStub = defineComponent({
	props: {
		size: { type: String, required: false },
		disabled: { type: Boolean, required: false },
		icon: { type: String, required: false },
	},
	emits: ['click'],
	template: '<button :class="$attrs.class" :data-size="size" :data-icon="icon" :disabled="disabled" @click="$emit(\'click\')" />',
});

async function mountComponent(props: Record<string, unknown>) {
	const componentPath = '../../../../../app/components/FeatureMatch/State/' + 'TurnCounter.vue';
	const { default: TurnCounter } = await import(componentPath);

	return mount(TurnCounter, {
		props,
		global: {
			stubs: {
				UButton: UButtonStub,
			},
		},
	});
}

describe('featureMatchTurnCounter', () => {
	it('renders a larger vertical touch layout for tablet controls', async () => {
		const wrapper = await mountComponent({
			touch: true,
			orientation: 'vertical',
			label: 'Turn',
			half: 2,
		});

		expect(wrapper.classes()).toContain('min-w-[14rem]');
		expect(wrapper.classes()).toContain('gap-4');

		const buttons = wrapper.findAll('button');
		expect(buttons).toHaveLength(2);
		expect(buttons[0]?.attributes('data-size')).toBe('xl');
		expect(buttons[0]?.classes()).toContain('rounded-3xl');
		expect(buttons[0]?.classes()).toContain('p-5');

		expect(wrapper.text()).toContain('Turn');
		const label = wrapper.get('span.text-center');
		expect(label.classes()).toContain('text-2xl');
	});
});

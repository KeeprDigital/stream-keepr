import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CounterItem from '~/components/FeatureMatch/State/CounterItem.vue';

function mountCounterItem(props: Record<string, unknown> = {}) {
	return mount(CounterItem, {
		props: {
			counter: { type: 'poison', value: 3 },
			config: {
				key: 'poison',
				label: 'Poison',
				shortLabel: 'Poison',
				icon: 'i-lucide-skull',
			},
			...props,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				UINumericCounter: {
					props: ['value', 'readonly'],
					template: '<output :data-readonly="String(!!readonly)">{{ value }}</output>',
				},
			},
		},
	});
}

describe('featureMatchCounterItem', () => {
	it.each([
		['reset', 'Reset Poison'],
		['remove', 'Remove Poison'],
	])('offers to %s the counter from its label', async (event, action) => {
		const wrapper = mountCounterItem();

		await wrapper.get('[aria-label="Poison counter actions"]').trigger('click');
		await wrapper.findAll('button').find(button => button.text() === action)!.trigger('click');

		expect(wrapper.emitted(event)).toHaveLength(1);
	});

	it('shows the value without its actions when read-only', () => {
		const wrapper = mountCounterItem({ readonly: true });

		expect(wrapper.find('[aria-label="Poison counter actions"]').exists()).toBe(false);
		expect(wrapper.get('button').attributes('disabled')).toBeDefined();
		expect(wrapper.get('output').attributes('data-readonly')).toBe('true');
	});
});

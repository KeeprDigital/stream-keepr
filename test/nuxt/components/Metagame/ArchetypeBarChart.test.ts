import type { ArchetypeBreakdownEntry } from '~~/shared/types/metagame';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import MetagameArchetypeBarChart from '~/components/Metagame/ArchetypeBarChart.vue';

vi.mock('vue-echarts', () => ({
	THEME_KEY: Symbol('theme'),
	default: {
		name: 'VChart',
		props: {
			option: { type: Object, required: true },
			autoresize: { type: Boolean, required: false },
		},
		emits: ['click'],
		template: '<div @click="$emit(\'click\', { componentType: \'series\', name: \'Mono Red\' })" />',
	},
}));

function makeEntry(overrides: Partial<ArchetypeBreakdownEntry> = {}): ArchetypeBreakdownEntry {
	return {
		id: 1,
		name: 'Azorius Control',
		colors: 'WU',
		count: 12,
		metaShare: 37.5,
		winRate: 55.2,
		avgPosition: 3.2,
		conversionRate: null,
		keyCards: [],
		...overrides,
	};
}

async function mountComponent(entries: ArchetypeBreakdownEntry[], loading = false) {
	return mount(MetagameArchetypeBarChart, {
		props: {
			entries,
			totalPlayers: 32,
			loading,
		},
	});
}

describe('metagameArchetypeBarChart', () => {
	it('renders an empty state when there are no entries and not loading', async () => {
		const wrapper = await mountComponent([]);

		expect(wrapper.text()).toContain('No archetype data available');
	});

	it('keeps the chart mounted while loading and emits selection on click', async () => {
		const wrapper = await mountComponent([
			makeEntry(),
			makeEntry({
				id: 2,
				name: 'Mono Red',
				count: 7,
				metaShare: 20,
			}),
		], true);

		expect(wrapper.find('[data-testid="archetype-bar-chart-loading-overlay"]').exists()).toBe(true);

		await wrapper.getComponent({ name: 'VChart' }).trigger('click');

		expect(wrapper.emitted('select')).toEqual([
			['Mono Red'],
		]);
	});
});

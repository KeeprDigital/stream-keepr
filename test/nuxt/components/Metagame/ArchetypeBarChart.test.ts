import type { ArchetypeBreakdownEntry } from '~~/shared/types/metagame';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const THEME_KEY = Symbol('theme');

const VChartStub = defineComponent({
	name: 'VChart',
	props: {
		option: { type: Object, required: true },
		autoresize: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<div class="v-chart-stub" @click="$emit(\'click\', { componentType: \'series\', name: \'Mono Red\' })" />',
});

vi.mock('vue-echarts', () => ({
	THEME_KEY,
	default: VChartStub,
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
	const componentPath = '../../../../app/components/Metagame/ArchetypeBarChart.vue';
	const { default: MetagameArchetypeBarChart } = await import(componentPath);

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
			makeEntry({ id: 2, name: 'Mono Red', count: 7, metaShare: 20 }),
		], true);

		expect(wrapper.findComponent(VChartStub).exists()).toBe(true);
		expect(wrapper.find('[data-testid="archetype-bar-chart-loading-overlay"]').exists()).toBe(true);

		await wrapper.getComponent(VChartStub).trigger('click');

		expect(wrapper.emitted('select')).toEqual([['Mono Red']]);
	});
});

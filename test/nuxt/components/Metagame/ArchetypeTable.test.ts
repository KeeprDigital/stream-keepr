import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ArchetypeTable from '~/components/Metagame/ArchetypeTable.vue';

mockNuxtImport('useOverlay', () => () => ({
	create: vi.fn(() => ({
		open: vi.fn(),
	})),
}));

describe('metagameArchetypeTable', () => {
	it('keeps the current rows on screen while a new read loads', async () => {
		const wrapper = mount(ArchetypeTable, {
			props: {
				entries: [
					{
						id: 1,
						name: 'Azorius Control',
						colors: 'WU',
						count: 12,
						metaShare: 37.5,
						winRate: 55.2,
						avgPosition: 3.2,
						conversionRate: null,
						keyCards: [],
					},
				],
				totalPlayers: 32,
				loading: false,
				sortBy: 'metaShare',
			},
			global: {
				stubs: {
					...nuxtUiStubs,
					UTable: {
						props: ['data'],
						template: '<table><tr v-for="row in data" :key="row.id"><td>{{ row.name }}</td></tr></table>',
					},
					MtgManaColorDisplay: true,
					MetagameMetaShareBar: true,
				},
			},
		});

		await wrapper.setProps({ loading: true });

		expect(wrapper.find('[data-testid="archetype-table-loading-overlay"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Azorius Control');
	});
});

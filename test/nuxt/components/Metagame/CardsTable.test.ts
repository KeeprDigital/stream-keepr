import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardsTable from '~/components/Metagame/CardsTable.vue';

describe('metagameCardsTable', () => {
	it('keeps the current rows on screen while a new read loads', async () => {
		const wrapper = mount(CardsTable, {
			props: {
				entries: [
					{
						id: 1,
						name: 'Lightning Bolt',
						cardType: 'Instant',
						scryfallId: null,
						colors: 'R',
						cmc: 1,
						manaCost: '{R}',
						inclusionRate: 50,
						avgCopies: 3,
						totalCopies: 6,
						mainboardCount: 4,
						sideboardCount: 2,
						mainboardDeckCount: 1,
						sideboardDeckCount: 1,
						deckCount: 2,
					},
				],
				loading: false,
				sortBy: 'inclusionRate',
				boardFilter: 'full',
			},
			global: {
				stubs: {
					...nuxtUiStubs,
					UTable: {
						props: ['data'],
						template: '<table><tr v-for="row in data" :key="row.id"><td>{{ row.name }}</td></tr></table>',
					},
					MetagameMetaShareBar: true,
				},
			},
		});

		await wrapper.setProps({ loading: true });

		expect(wrapper.find('[data-testid="cards-table-loading-overlay"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Lightning Bolt');
	});

	it('shows the Decks column unless the host opts out', async () => {
		const wrapper = await mountComponent();
		const columns = wrapper.findComponent(UTableStub).props('columns') as { accessorKey?: string }[];

		expect(columns.map(column => column.accessorKey)).toContain('deckCount');
	});
});

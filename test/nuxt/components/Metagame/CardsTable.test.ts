import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardsTable from '~/components/Metagame/CardsTable.vue';

const lightningBolt = {
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
};

function mountCardsTable(props: Record<string, unknown> = {}) {
	return mount(CardsTable, {
		props: {
			entries: [lightningBolt],
			loading: false,
			sortBy: 'inclusionRate',
			boardFilter: 'full',
			...props,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				UTable: {
					props: ['data', 'columns'],
					template: `<table>
						<tr><th v-for="column in columns" :key="column.accessorKey ?? column.id" :data-column="column.accessorKey">{{ column.accessorKey }}</th></tr>
						<tr v-for="row in data" :key="row.id"><td>{{ row.name }}</td></tr>
					</table>`,
				},
				MetagameMetaShareBar: true,
			},
		},
	});
}

describe('metagameCardsTable', () => {
	it('keeps the current rows on screen while a new read loads', async () => {
		const wrapper = mountCardsTable();

		await wrapper.setProps({ loading: true });

		expect(wrapper.find('[data-testid="cards-table-loading-overlay"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Lightning Bolt');
	});

	it.each([
		[{}, true],
		[
			{ showDeckCount: false },
			false,
		],
	])('shows the Decks column unless the host opts out (%o)', (props, shown) => {
		expect(mountCardsTable(props).find('[data-column="deckCount"]').exists()).toBe(shown);
	});
});

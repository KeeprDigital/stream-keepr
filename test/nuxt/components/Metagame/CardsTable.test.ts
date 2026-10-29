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

	it.each([
		[{}, false],
		[
			{ showPoints: true },
			true,
		],
	])('shows the Points column and Pointed only toggle only with a points system (%o)', (props, shown) => {
		const wrapper = mountCardsTable(props);

		expect(wrapper.find('[data-column="highlanderPoints"]').exists()).toBe(shown);
		expect(wrapper.text().includes('Pointed only')).toBe(shown);
	});

	it.each([
		[false, 'false', true],
		[true, 'true', false],
	])('with pointedOnly %s the toggle is pressed %s and asks for %s', async (pointedOnly, pressed, next) => {
		const wrapper = mountCardsTable({ showPoints: true, pointedOnly });
		const toggle = wrapper.findAll('button').find(button => button.text() === 'Pointed only')!;

		expect(toggle.attributes('aria-pressed')).toBe(pressed);
		await toggle.trigger('click');
		expect(wrapper.emitted('update:pointedOnly')).toEqual([
			[next],
		]);
	});

	it('shows pointed lands once the pointed view is on', async () => {
		const stripMine = {
			...lightningBolt,
			id: 2,
			name: 'Strip Mine',
			cardType: 'Land',
			highlanderPoints: 2,
		};
		const wrapper = mountCardsTable({
			entries: [stripMine],
			showPoints: true,
		});

		expect(wrapper.text()).not.toContain('Strip Mine');
		await wrapper.setProps({ pointedOnly: true });
		expect(wrapper.text()).toContain('Strip Mine');
	});
});

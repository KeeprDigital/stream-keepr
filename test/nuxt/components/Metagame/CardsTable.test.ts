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
	cardNumber: null as string | null,
	imageUrl: null as string | null,
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

const usopp = {
	...lightningBolt,
	id: 2,
	name: 'Usopp',
	cardType: 'Character',
	colors: 'Green',
	cmc: null,
	manaCost: null,
	cardNumber: 'OP01-040',
	imageUrl: 'https://cards-img.keepr.digital/OP01-040.png',
	sideboardCount: 0,
};
const gumGum = {
	...usopp,
	id: 3,
	name: 'Gum-Gum Jet Pistol',
	cardType: 'Event',
};

describe('metagameCardsTable', () => {
	// An OP card has no mana cost, its deck no Sideboard, and its types are its categories past the Leader (ADR-0074).
	it('on a One Piece Event, shows no Cost or Sideboard, and filters by OP card type', async () => {
		const wrapper = mountCardsTable({
			game: 'op',
			entries: [usopp, gumGum],
		});

		expect(wrapper.findAll('th').map(column => column.attributes('data-column'))).not.toEqual(expect.arrayContaining(['manaCost']));
		expect(wrapper.find('[data-column="sideboardCount"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain('Side');
		const chips = wrapper.findAll('button').filter(button => ['Character', 'Event'].includes(button.text()));
		expect(chips.map(chip => chip.text())).toEqual(['Character', 'Event']);

		await chips[1]!.trigger('click');

		expect(wrapper.findAll('td').map(cell => cell.text())).toEqual(['Usopp']);
	});

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

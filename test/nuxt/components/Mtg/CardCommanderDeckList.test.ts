import type { CommanderSeatDeckData, DeckListCardWithData } from '~/types/card/deckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardCommanderDeckList from '~/components/Mtg/CardCommanderDeckList.vue';

// The Cards page's Seats of a Commander Slot (ADR-0087): each Seat somebody sits in,
// its Commanders apart from the Mainboard of the list it holds.

const cardStore = reactive({
	loadingDeckList: false,
	deckListHasData: true,
	deckListFilter: 'for',
	deckListMatchup: { kind: 'slot', id: 7 },
	commanderDeckListSeats: [] as CommanderSeatDeckData[],
});
mockNuxtImport('useCardStore', () => () => cardStore);

function card(name: string, quantity = 1): DeckListCardWithData {
	return {
		name,
		quantity,
		compartment: 'mainboard',
		cardType: null,
		scryfallId: name,
		mtgCard: null,
	};
}

function seated(seat: CommanderSeatDeckData['seat'], playerName: string, commanders: string[], mainboard: DeckListCardWithData[], failed = false): CommanderSeatDeckData {
	return {
		seat,
		playerName,
		deckName: commanders.join(' / '),
		deckColors: 'URG',
		commanders: commanders.map(name => card(name)),
		mainboard,
		failed,
	};
}

function mountSeats(seats: CommanderSeatDeckData[]) {
	cardStore.commanderDeckListSeats = seats;
	return mount(CardCommanderDeckList, {
		global: {
			stubs: {
				...nuxtUiStubs,
				MtgManaColorDisplay: true,
				UIEmptyState: {
					props: ['title'],
					template: '<p data-empty>{{ title }}</p>',
				},
				UILoadingSpinner: true,
				// The section draws its cards and previews the one chosen; here it says what it was given.
				MtgCardDeckListSection: {
					props: ['title', 'cards', 'filter'],
					template: '<div data-section :data-title="title" :data-filter="filter">{{ cards.map(card => card.quantity + " " + card.name).join("|") }}</div>',
				},
			},
		},
	});
}

/** Each Seat's column as shown: where it sits, who sits there, and each section's cards. */
function shown(wrapper: ReturnType<typeof mountSeats>) {
	return wrapper.findAll('[data-seat]').map(column => ({
		seat: column.attributes('data-seat'),
		heading: column.get('[data-seat-heading]').text(),
		sections: column.findAll('[data-section]').map(section => [
			section.attributes('data-title'),
			section.text(),
		]),
		empty: column.find('[data-empty]').exists()
			? column.get('[data-empty]').text()
			: null,
	}));
}

describe('the Cards page\'s Commander Slot', () => {
	it('shows each Seat with its Commanders apart from its Mainboard, filtered as the page filters', () => {
		const wrapper = mountSeats([
			seated('player1', 'Ana', ['Ashling, the Limitless'], [
				card('Forest', 3),
				card('Hedge Maze'),
			]),
			seated('player4', 'Dee', ['Tymna the Weaver', 'Kraum, Ludevic\'s Opus'], []),
		]);

		expect(shown(wrapper)).toEqual([
			{
				seat: 'player1',
				heading: expect.stringMatching(/^Seat 1\s*Ana/),
				sections: [
					['Commander', '1 Ashling, the Limitless'],
					['Mainboard', '3 Forest|1 Hedge Maze'],
				],
				empty: null,
			},
			{
				seat: 'player4',
				heading: expect.stringMatching(/^Seat 4\s*Dee/),
				sections: [
					['Commanders', '1 Tymna the Weaver|1 Kraum, Ludevic\'s Opus'],
				],
				empty: 'No Deck List',
			},
		]);
		expect(wrapper.get('[data-section]').attributes('data-filter')).toBe('for');
	});

	it('says so when a Seat\'s Deck List could not be read', () => {
		const wrapper = mountSeats([
			seated('player2', 'Ben', ['Ashling, the Limitless'], [], true),
		]);

		expect(shown(wrapper)[0]?.empty).toBe('Deck List could not be loaded');
	});
});

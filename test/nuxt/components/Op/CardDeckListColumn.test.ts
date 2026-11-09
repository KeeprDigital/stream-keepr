import type { OpMatchPlayerDeckData } from '~/types/card/deckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { opDeckListEntry, ZORO } from '~~/test/helpers/opCards';
import CardDeckListColumn from '~/components/Op/CardDeckListColumn.vue';

const { selectOpCard, openPlayerDeckList } = vi.hoisted(() => ({
	selectOpCard: vi.fn(),
	openPlayerDeckList: vi.fn(),
}));
mockNuxtImport('useCardStore', () => () => ({ selectOpCard }));
const BOB = { id: 42, name: 'Bob' };
mockNuxtImport('usePlayerStore', () => () => ({
	players: [BOB],
}));
mockNuxtImport('usePlayerDeckListModal', () => () => ({ openPlayerDeckList }));

const UCollapsibleStub = defineComponent({
	props: {
		defaultOpen: { type: Boolean, default: false },
	},
	template: '<section data-testid="deck-section"><slot :open="defaultOpen" /><div v-if="defaultOpen"><slot name="content" /></div></section>',
});
const UIEmptyStateStub = defineComponent({
	props: {
		title: { type: String, required: true },
	},
	template: '<p data-testid="empty-state">{{ title }}</p>',
});

/** Zoro, a 4-of Character, a 2-of Event, and a 3-of number bandai-keepr does not know. */
function sideData(overrides: Partial<OpMatchPlayerDeckData> = {}): OpMatchPlayerDeckData {
	return {
		playerName: 'Alice',
		playerId: null,
		leader: ZORO,
		deckList: {
			entries: [
				opDeckListEntry(ZORO.number, 1, 'leader'),
				opDeckListEntry('OP01-025', 4, 'character', 3),
				opDeckListEntry('OP01-026', 2, 'event', 1),
				opDeckListEntry('OP99-999', 3, null),
			],
			leaderNumber: ZORO.number,
			mainboardCount: 9,
			warnings: [],
		},
		failed: false,
		...overrides,
	};
}

function mountColumn(playerData: OpMatchPlayerDeckData | null, filter = '') {
	return mount(CardDeckListColumn, {
		props: { playerData, filter },
		global: {
			stubs: {
				UCollapsible: UCollapsibleStub,
				UIEmptyState: UIEmptyStateStub,
				OpColorDisplay: true,
				UIcon: true,
			},
		},
	});
}

/** Each section's title and count badge, and the card numbers it shows. */
function sections(wrapper: ReturnType<typeof mountColumn>) {
	return wrapper.findAll('[data-testid="deck-section"]').map(section => ({
		title: section.get('h3').text(),
		count: section.findComponent({ name: 'UBadge' }).text(),
		cards: section.findAll('[data-card-number]').map(card => card.attributes('data-card-number')),
	}));
}

describe('opCardDeckListColumn', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		[
			'every card',
			'',
			[
				{
					title: 'Leader',
					count: '1',
					cards: [ZORO.number],
				},
				{
					title: 'Mainboard',
					count: '9',
					cards: ['OP01-025', 'OP01-026', 'OP99-999'],
				},
			],
		],
		[
			'the cards a filter names by card name',
			'card op01-025',
			[
				{ title: 'Leader', count: '0/1', cards: [] },
				{
					title: 'Mainboard',
					count: '4/9',
					cards: ['OP01-025'],
				},
			],
		],
		[
			'the cards a filter names by number, unresolved ones included',
			'OP99',
			[
				{ title: 'Leader', count: '0/1', cards: [] },
				{
					title: 'Mainboard',
					count: '3/9',
					cards: ['OP99-999'],
				},
			],
		],
	])('shows the Leader and one Mainboard section, holding %s', (_, filter, shown) => {
		expect(sections(mountColumn(sideData(), filter))).toEqual(shown);
	});

	it.each([
		[
			'a card',
			'OP01-025',
			[
				{ number: 'OP01-025' },
			],
		],
		[
			'the Leader',
			ZORO.number,
			[
				{ number: ZORO.number },
			],
		],
	])('previews %s on Card Spotlight when chosen', async (_, number, calls) => {
		const wrapper = mountColumn(sideData());

		await wrapper.get(`[data-card-number="${number}"] [role="button"]`).trigger('click');

		expect(selectOpCard.mock.calls.map(([card]) => card)).toEqual(calls);
	});

	it('offers no choice of an Unresolved Deck Card', () => {
		const unresolved = mountColumn(sideData()).get('[data-card-number="OP99-999"]');

		expect(unresolved.attributes()).toHaveProperty('data-unresolved-deck-card');
		expect(unresolved.find('[role="button"]').exists()).toBe(false);
		expect(unresolved.text()).toContain('3x');
	});

	it.each([
		['no player', null, 'No player'],
		[
			'a player with no Deck List',
			sideData({ deckList: null }),
			'No deck list',
		],
		[
			'a Deck List that failed to load',
			sideData({ deckList: null, failed: true }),
			'Failed to load deck list',
		],
	])('shows %s as such', (_, playerData, message) => {
		expect(mountColumn(playerData).get('[data-testid="empty-state"]').text()).toBe(message);
	});

	it.each([
		[
			'opens a linked Player\'s Deck List read-only',
			42,
			[
				[BOB],
			],
		],
		['names a pasted Deck List\'s Leader without opening it', null, []],
	])('%s', async (_, playerId, opened) => {
		const wrapper = mountColumn(sideData({ playerId }));

		await wrapper.findAll('button').find(button => button.text() === 'Roronoa Zoro')?.trigger('click');

		expect(wrapper.text()).toContain('Roronoa Zoro');
		expect(openPlayerDeckList.mock.calls).toEqual(opened);
	});
});

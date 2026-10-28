import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import CardPlayerDeckHeader from '~/components/Mtg/CardPlayerDeckHeader.vue';

const cardStore = {
	playerDeckHasData: false,
	deckListFilter: '',
	loadPlayerDeck: vi.fn(),
	clearPlayerDeck: vi.fn(),
};

mockNuxtImport('useCardStore', () => () => cardStore);
mockNuxtImport('usePlayerStore', () => () => ({ players: [] }));

describe('mtgCardPlayerDeckHeader', () => {
	it.each([
		[
			'loads the deck of a Player selected before mount',
			12,
			false,
			[
				[12],
			],
		],
		[
			'keeps the deck the store already holds',
			12,
			true,
			[],
		],
		[
			'loads nothing without a selection',
			undefined,
			false,
			[],
		],
	])('%s', (_, playerId, playerDeckHasData, loads) => {
		cardStore.playerDeckHasData = playerDeckHasData;
		cardStore.loadPlayerDeck.mockClear();
		mount(CardPlayerDeckHeader, {
			props: { playerId },
			global: {
				stubs: { USelectMenu: true, UInput: true, UButton: true },
			},
		});

		expect(cardStore.loadPlayerDeck.mock.calls).toEqual(loads);
	});
});

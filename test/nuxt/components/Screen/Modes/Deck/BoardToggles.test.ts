import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import BoardToggles from '~/components/Screen/Modes/Deck/BoardToggles.vue';

// A Deck List Screen's board toggles write the one `board` selection, keeping the last board
// shown on, and say when a shown board's Deck Source holds no cards for it (#477, #478).

enableAutoUnmount(afterEach);

const mockFetchDeck = vi.fn();
const mockBroadcastDeckListStore = reactive({
	summaries: [] as { id: number; name: string; mainboardQuantity: number; sideboardQuantity: number }[],
});

mockNuxtImport('usePlayerStore', () => () => ({
	players: [
		{ id: 1, name: 'Alice', updatedAt: '2026-08-01T00:00:00.000Z' },
	],
}));
mockNuxtImport('useBroadcastDeckListStore', () => () => mockBroadcastDeckListStore);
mockNuxtImport('usePlayerDeckCache', () => () => ({
	fetchDeck: mockFetchDeck,
}));

const PLAYER_SOURCE = { type: 'player', playerId: 1 };

async function mountToggles(config: Record<string, unknown>) {
	const wrapper = mount(BoardToggles, {
		props: {
			config: { deckSource: PLAYER_SOURCE, ...config },
			eventId: 1,
		},
		global: { stubs: nuxtUiStubs },
	});
	await flushPromises();
	return wrapper;
}

function toggle(wrapper: Awaited<ReturnType<typeof mountToggles>>, board: 'mainboard' | 'sideboard') {
	return wrapper.get(`[data-board-toggle="${board}"] [role="switch"]`);
}

describe('a Deck List Screen\'s board toggles', () => {
	beforeEach(() => {
		mockFetchDeck.mockReset();
		mockFetchDeck.mockResolvedValue({
			cards: [
				{ name: 'Mana Drain', quantity: 4, compartment: 'mainboard' },
				{ name: 'Pyroblast', quantity: 1, compartment: 'sideboard' },
			],
		});
		mockBroadcastDeckListStore.summaries = [];
	});

	it.each([
		{ board: 'full', toggled: 'mainboard', written: 'sideboard' },
		{ board: 'full', toggled: 'sideboard', written: 'mainboard' },
		{ board: 'mainboard', toggled: 'sideboard', written: 'full' },
		{ board: 'mainboard', toggled: 'mainboard', written: undefined },
	] as const)('at board: $board, toggling the $toggled writes board: $written', async ({ board, toggled, written }) => {
		const wrapper = await mountToggles({ board });

		await toggle(wrapper, toggled).trigger('click');

		expect(wrapper.emitted('update')).toEqual(written
			? [
					[
						{ board: written },
					],
				]
			: undefined);
	});

	it('says the only board shown stays on', async () => {
		const wrapper = await mountToggles({ board: 'mainboard' });

		expect(wrapper.get('[data-board-toggle="mainboard"]').text()).toContain('The only board shown, so it stays on');
		expect(toggle(wrapper, 'mainboard').attributes('aria-checked')).toBe('true');
	});

	it.each([
		{
			name: 'a Player\'s deck with no sideboard, sideboard shown',
			board: 'full',
			sideboard: false,
			hint: 'no sideboard cards',
		},
		{
			name: 'a Player\'s deck with no sideboard, sideboard hidden',
			board: 'mainboard',
			sideboard: false,
			hint: null,
		},
		{
			name: 'a Player\'s deck with a sideboard',
			board: 'full',
			sideboard: true,
			hint: null,
		},
	])('hints for $name: $hint', async ({ board, sideboard, hint }) => {
		mockFetchDeck.mockResolvedValue({
			cards: [
				{ name: 'Mana Drain', quantity: 4, compartment: 'mainboard' },
				...(sideboard
					? [
							{ name: 'Pyroblast', quantity: 1, compartment: 'sideboard' },
						]
					: []),
			],
		});
		const wrapper = await mountToggles({ board });

		const shown = wrapper.find('[data-testid="empty-board-hint"]');
		if (hint)
			expect(shown.text()).toContain(hint);
		else
			expect(shown.exists()).toBe(false);
	});

	it.each([
		{ mainboardQuantity: 0, sideboardQuantity: 15, hint: 'no mainboard cards' },
		{ mainboardQuantity: 60, sideboardQuantity: 0, hint: 'no sideboard cards' },
		{ mainboardQuantity: 0, sideboardQuantity: 0, hint: 'no cards, so the output shows only its header' },
	])('hints for a Broadcast Deck List of $mainboardQuantity and $sideboardQuantity cards', async ({ mainboardQuantity, sideboardQuantity, hint }) => {
		mockBroadcastDeckListStore.summaries = [
			{
				id: 23,
				name: 'Feature Table',
				mainboardQuantity,
				sideboardQuantity,
			},
		];
		const wrapper = await mountToggles({
			board: 'full',
			deckSource: { type: 'broadcast', broadcastDeckListId: 23 },
		});

		expect(wrapper.get('[data-testid="empty-board-hint"]').text()).toContain(hint);
	});
});

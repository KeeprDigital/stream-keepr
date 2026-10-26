import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateModeConfig = vi.fn();
const mockToast = {
	add: vi.fn(),
};

const allScreens = [
	{ id: 1, name: 'Screen 1', currentMode: 'deck' },
	{ id: 2, name: 'Screen 2', currentMode: 'match' },
	{ id: 3, name: 'Screen 3', currentMode: 'deck' },
];

const mockScreenStore = {
	screens: allScreens,
	updateModeConfig: mockUpdateModeConfig,
};

const mockEventStore = {
	eventId: 1 as number | null,
};

mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useToast', () => () => mockToast);

const playerWithDeck = { id: 42, name: 'Test', gameData: { type: 'mtg', deckName: 'Mono Red' } } as any;
const deckSourceOf = (playerId: number) => ({ deckSource: { type: 'player', playerId } });

describe('useSendDeckToScreen', () => {
	beforeEach(() => {
		mockEventStore.eventId = 1;
		mockScreenStore.screens = allScreens;
		mockUpdateModeConfig.mockResolvedValue(undefined);
	});

	it('offers only the Screens in Deck mode', () => {
		const { deckScreens, hasDeckScreens, hasMultipleDeckScreens } = useSendDeckToScreen();

		expect(deckScreens.value.map(screen => screen.id)).toEqual([1, 3]);
		expect(hasDeckScreens.value).toBe(true);
		expect(hasMultipleDeckScreens.value).toBe(true);
	});

	it('points a Screen\'s Deck Source at the Player and confirms it', async () => {
		const { sendToScreen } = useSendDeckToScreen();

		await expect(sendToScreen(42, allScreens[2] as any)).resolves.toBe(true);

		expect(mockUpdateModeConfig).toHaveBeenCalledWith(1, 3, 'deck', deckSourceOf(42));
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Deck Sent', color: 'success' }));
	});

	it('sends nothing without an Event', async () => {
		mockEventStore.eventId = null;
		const { sendToScreen } = useSendDeckToScreen();

		await expect(sendToScreen(42, allScreens[0] as any)).resolves.toBe(false);
		expect(mockUpdateModeConfig).not.toHaveBeenCalled();
	});

	describe('the Player menu', () => {
		it('offers nothing for a Player without a deck', () => {
			const { createSendDeckItems } = useSendDeckToScreen();

			expect(createSendDeckItems({ ...playerWithDeck, gameData: { type: 'mtg', deckName: null } })).toEqual([]);
		});

		it('offers nothing when no Screen is in Deck mode', () => {
			mockScreenStore.screens = [allScreens[1]!];
			const { createSendDeckItems } = useSendDeckToScreen();

			expect(createSendDeckItems(playerWithDeck)).toEqual([]);
		});

		it('sends straight to the only Deck Screen', async () => {
			mockScreenStore.screens = [allScreens[0]!];
			const [item] = useSendDeckToScreen().createSendDeckItems(playerWithDeck);

			item!.onSelect!();
			await flushPromises();

			expect(mockUpdateModeConfig).toHaveBeenCalledWith(1, 1, 'deck', deckSourceOf(42));
		});

		it('asks which Deck Screen when there are several', () => {
			const [item] = useSendDeckToScreen().createSendDeckItems(playerWithDeck);

			expect(item!.label).toBe('Send Deck to…');
			expect((item as { children: { label: string }[] }).children.map(child => child.label)).toEqual(['Screen 1', 'Screen 3']);
		});
	});
});

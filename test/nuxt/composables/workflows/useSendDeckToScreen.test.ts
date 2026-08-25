import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateModeConfig = vi.fn();
const mockToast = { add: vi.fn() };

const mockScreenStore = {
	screens: [
		{ id: 1, name: 'Screen 1', currentMode: 'deck' },
		{ id: 2, name: 'Screen 2', currentMode: 'match' },
		{ id: 3, name: 'Screen 3', currentMode: 'deck' },
	],
	updateModeConfig: mockUpdateModeConfig,
};

const mockEventStore = {
	eventId: 1,
};

mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useToast', () => () => mockToast);

describe('useSendDeckToScreen', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.eventId = 1;
	});

	it('filters screens to only deck-mode screens', () => {
		const { deckScreens, hasDeckScreens } = useSendDeckToScreen();
		expect(deckScreens.value).toHaveLength(2);
		expect(hasDeckScreens.value).toBe(true);
	});

	it('reports hasMultipleDeckScreens correctly', () => {
		const { hasMultipleDeckScreens } = useSendDeckToScreen();
		expect(hasMultipleDeckScreens.value).toBe(true);
	});

	it('sends deck to a specific screen', async () => {
		mockUpdateModeConfig.mockResolvedValue(undefined);
		const { sendToScreen } = useSendDeckToScreen();

		const result = await sendToScreen(42, mockScreenStore.screens[0] as any);
		expect(result).toBe(true);
		expect(mockUpdateModeConfig).toHaveBeenCalledWith(1, 1, 'deck', {
			deckSource: { type: 'player', playerId: 42 },
		});
	});

	it('shows success toast on successful send', async () => {
		mockUpdateModeConfig.mockResolvedValue(undefined);
		const { sendToScreen } = useSendDeckToScreen();

		await sendToScreen(42, mockScreenStore.screens[0] as any);
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Deck Sent',
			color: 'success',
		}));
	});

	it('returns false and shows error when no eventId', async () => {
		mockEventStore.eventId = null as any;
		const { sendToScreen } = useSendDeckToScreen();

		const result = await sendToScreen(42, mockScreenStore.screens[0] as any);
		expect(result).toBe(false);
	});

	it('sendToFirstDeckScreen sends to the first deck screen', async () => {
		mockUpdateModeConfig.mockResolvedValue(undefined);
		const { sendToFirstDeckScreen } = useSendDeckToScreen();

		const result = await sendToFirstDeckScreen(42);
		expect(result).toBe(true);
		expect(mockUpdateModeConfig).toHaveBeenCalledWith(1, 1, 'deck', {
			deckSource: { type: 'player', playerId: 42 },
		});
	});

	it('createSendDeckItems returns empty for player without deckName in gameData', () => {
		const { createSendDeckItems } = useSendDeckToScreen();
		const items = createSendDeckItems({ id: 1, name: 'Test', gameData: { type: 'mtg', deckName: null } } as any);
		expect(items).toEqual([]);
	});

	it('createSendDeckItems returns single item for one deck screen', () => {
		mockScreenStore.screens = [{ id: 1, name: 'Screen 1', currentMode: 'deck' }];
		const { createSendDeckItems } = useSendDeckToScreen();
		const items = createSendDeckItems({ id: 1, name: 'Test', gameData: { type: 'mtg', deckName: 'Mono Red' } } as any);
		expect(items).toHaveLength(1);
		expect(items[0]).toHaveProperty('label', 'Send Deck to Screen');
	});

	it('createSendDeckItems returns submenu for multiple deck screens', () => {
		mockScreenStore.screens = [
			{ id: 1, name: 'S1', currentMode: 'deck' },
			{ id: 2, name: 'S2', currentMode: 'deck' },
		];
		const { createSendDeckItems } = useSendDeckToScreen();
		const items = createSendDeckItems({ id: 1, name: 'Test', gameData: { type: 'mtg', deckName: 'Mono Red' } } as any);
		expect(items).toHaveLength(1);
		expect(items[0]).toHaveProperty('children');
	});
});

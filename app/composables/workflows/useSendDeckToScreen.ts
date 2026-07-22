import type { Player, Screen } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';

export function useSendDeckToScreen() {
	const screenStore = useScreenStore();
	const eventStore = useEventStore();
	const toast = useToast();
	const { runRequest } = useRequestFeedback();

	// Get all screens in deck mode
	const deckScreens = computed(() => {
		return screenStore.screens.filter(s => s.currentMode === 'deck');
	});

	const hasDeckScreens = computed(() => deckScreens.value.length > 0);
	const hasMultipleDeckScreens = computed(() => deckScreens.value.length > 1);

	/**
	 * Send a player's deck to a specific screen
	 */
	async function sendToScreen(playerId: number, screen: Screen) {
		const eventId = eventStore.eventId;
		if (!eventId) {
			toast.add({
				title: 'Error',
				description: 'No event loaded',
				color: 'error',
			});
			return false;
		}

		const sent = await runRequest(async () => {
			await screenStore.updateModeConfig(eventId, screen.id, 'deck', {
				playerId,
			});

			return true;
		}, {
			success: {
				title: 'Deck Sent',
				description: `Deck sent to "${screen.name}"`,
				color: 'success',
			},
			error: {
				title: 'Error',
				description: 'Failed to send deck to screen',
				color: 'error',
			},
		});

		return sent === true;
	}

	/**
	 * Send a player's deck to the first (or only) deck screen
	 */
	async function sendToFirstDeckScreen(playerId: number) {
		const screen = deckScreens.value[0];
		if (!screen) {
			toast.add({
				title: 'No Deck Screen',
				description: 'No screen is configured for deck mode',
				color: 'warning',
			});
			return false;
		}

		return sendToScreen(playerId, screen);
	}

	/**
	 * Get dropdown items for selecting a deck screen
	 */
	function getDeckScreenItems(playerId: number) {
		return deckScreens.value.map(screen => ({
			label: screen.name,
			icon: 'i-lucide-monitor',
			onSelect: () => sendToScreen(playerId, screen),
		}));
	}

	/**
	 * Create dropdown items for a player - handles single vs multiple screens
	 */
	function createSendDeckItems(player: Player) {
		// Use deckName as proxy for "player has a deck" (set during Melee sync)
		if (!getMtgGameData(player.gameData).deckName) {
			return [];
		}

		if (deckScreens.value.length === 0) {
			return [];
		}

		if (deckScreens.value.length === 1) {
			return [
				{
					label: 'Send Deck to Screen',
					icon: 'i-lucide-send',
					onSelect: () => sendToFirstDeckScreen(player.id),
				},
			];
		}

		// Multiple screens - create submenu
		return [
			{
				label: 'Send Deck to…',
				icon: 'i-lucide-send',
				children: getDeckScreenItems(player.id),
			},
		];
	}

	return {
		deckScreens,
		hasDeckScreens,
		hasMultipleDeckScreens,
		sendToScreen,
		sendToFirstDeckScreen,
		getDeckScreenItems,
		createSendDeckItems,
	};
}

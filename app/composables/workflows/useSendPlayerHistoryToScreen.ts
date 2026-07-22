import type { Screen } from '~/types';

export function useSendPlayerHistoryToScreen() {
	const screenStore = useScreenStore();
	const eventStore = useEventStore();
	const toast = useToast();
	const { runRequest } = useRequestFeedback();

	const playerHistoryScreens = computed(() => screenStore.screens.filter(s => s.currentMode === 'player-history'));
	const hasPlayerHistoryScreens = computed(() => playerHistoryScreens.value.length > 0);

	async function sendToScreen(playerId: number, screen: Screen) {
		const eventId = eventStore.eventId;
		if (!eventId) {
			toast.add({ title: 'Error', description: 'No event loaded', color: 'error' });
			return false;
		}

		const sent = await runRequest(async () => {
			await screenStore.updateModeConfig(eventId, screen.id, 'player-history', { playerId, currentPage: 1 });
			return true;
		}, {
			success: { title: 'Match history sent', description: `Player history sent to "${screen.name}"`, color: 'success' },
			error: { title: 'Error', description: 'Failed to send match history to screen', color: 'error' },
		});

		return sent === true;
	}

	async function sendToFirstPlayerHistoryScreen(playerId: number) {
		const screen = playerHistoryScreens.value[0];
		if (!screen) {
			toast.add({ title: 'No Player History Screen', description: 'No screen is configured for player history mode', color: 'warning' });
			return false;
		}
		return sendToScreen(playerId, screen);
	}

	return { playerHistoryScreens, hasPlayerHistoryScreens, sendToScreen, sendToFirstPlayerHistoryScreen };
}

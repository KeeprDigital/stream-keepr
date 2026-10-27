import type { Screen } from '~/types';

export function useSendHeadToHeadToScreen() {
	const screenStore = useScreenStore();
	const eventStore = useEventStore();
	const toast = useToast();
	const { runRequest } = useRequestFeedback();

	const headToHeadScreens = computed(() => screenStore.screens.filter(s => s.currentMode === 'head-to-head'));
	const hasHeadToHeadScreens = computed(() => headToHeadScreens.value.length > 0);

	/** Picks the two Players directly; the Screen's Feature Match Slot is kept for switching back. */
	async function sendToScreen(player1Id: number, player2Id: number, screen: Screen) {
		const eventId = eventStore.eventId;
		if (!eventId) {
			toast.add({ title: 'Error', description: 'No event loaded', color: 'error' });
			return false;
		}

		const sent = await runRequest(async () => {
			await screenStore.updateModeConfig(eventId, screen.id, 'head-to-head', { playerSource: 'players', player1Id, player2Id });
			return true;
		}, {
			success: { title: 'Head-to-Head sent', description: `Head-to-Head sent to "${screen.name}"`, color: 'success' },
			error: { title: 'Error', description: 'Failed to send Head-to-Head to screen', color: 'error' },
		});

		return sent === true;
	}

	async function sendToFirstHeadToHeadScreen(player1Id: number, player2Id: number) {
		const screen = headToHeadScreens.value[0];
		if (!screen) {
			toast.add({ title: 'No Head-to-Head Screen', description: 'No screen is configured for head-to-head mode', color: 'warning' });
			return false;
		}
		return sendToScreen(player1Id, player2Id, screen);
	}

	return {
		headToHeadScreens,
		hasHeadToHeadScreens,
		sendToScreen,
		sendToFirstHeadToHeadScreen,
	};
}

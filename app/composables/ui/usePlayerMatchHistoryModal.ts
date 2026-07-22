import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import type { Player } from '~/types';
import { LazyPlayerMatchHistoryModal } from '#components';

export function usePlayerMatchHistoryModal() {
	const overlay = useOverlay();
	const eventStore = useEventStore();
	const toast = useToast();
	const modal = overlay.create(LazyPlayerMatchHistoryModal);
	let currentRequestId = 0;

	async function openPlayerMatchHistory(player: Player) {
		const requestId = ++currentRequestId;

		void modal.open({
			player,
			history: [],
			loading: true,
		});

		if (!eventStore.eventId) {
			modal.patch({ loading: false });
			toast.add({ title: 'Error', description: 'No event loaded', color: 'error' });
			return;
		}

		try {
			const data = await $fetch<{ player: Player; history: PlayerMatchHistoryEntry[] }>(`/api/events/${eventStore.eventId}/players/${player.id}/match-history`);
			if (requestId !== currentRequestId)
				return;
			modal.patch({
				player: data.player,
				history: data.history,
				loading: false,
			});
		}
		catch {
			if (requestId !== currentRequestId)
				return;
			modal.patch({ loading: false });
			toast.add({ title: 'Error', description: 'Failed to load match history', color: 'error' });
		}
	}

	return { openPlayerMatchHistory };
}

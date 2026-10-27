import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import type { Player } from '~/types';
import { createSharedComposable } from '@vueuse/core';
import { LazyPlayerMatchHistoryModal } from '#components';

function _usePlayerMatchHistoryModal() {
	const overlay = useOverlay();
	const eventStore = useEventStore();
	const toast = useToast();
	const modal = overlay.create(LazyPlayerMatchHistoryModal);
	let currentRequestId = 0;
	// The Player the open modal shows, and those it showed before, most recent last.
	let current: Player | null = null;
	const trail: Player[] = [];

	function goBack() {
		const previous = trail.pop();
		if (previous)
			void show(previous);
	}

	async function show(player: Player) {
		const requestId = ++currentRequestId;
		const opening = !current;
		current = player;

		const closed = modal.open({
			player,
			history: [],
			loading: true,
			previousPlayer: trail.at(-1) ?? null,
			onBack: goBack,
		});
		if (opening) {
			void Promise.resolve(closed).then(() => {
				current = null;
				trail.length = 0;
			});
		}

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

	/** Opens a Player's history; from inside an open modal, such as an opponent's name, it remembers the way back. */
	async function openPlayerMatchHistory(player: Player) {
		if (current && current.id !== player.id)
			trail.push(current);
		await show(player);
	}

	return { openPlayerMatchHistory };
}

// One modal for every Player name on screen: opening another Player, an opponent included, replaces what it shows.
export const usePlayerMatchHistoryModal = createSharedComposable(_usePlayerMatchHistoryModal);

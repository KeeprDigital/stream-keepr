import type { Player } from '~/types';
import { createSharedComposable } from '@vueuse/core';
import { LazyPlayerMatchHistoryModal } from '#components';

function _usePlayerMatchHistoryModal() {
	const overlay = useOverlay();
	const modal = overlay.create(LazyPlayerMatchHistoryModal);
	// The Player the open modal shows, and those it showed before, most recent last.
	let current: Player | null = null;
	const trail: Player[] = [];
	const shownPlayerId = ref<number | null>(null);

	function goBack() {
		const previous = trail.pop();
		if (previous)
			show(previous);
	}

	function show(player: Player) {
		const opening = !current;
		current = player;
		shownPlayerId.value = player.id;

		// The modal reads the Player's history itself, and keeps it current while open.
		const closed = modal.open({
			player,
			previousPlayer: trail.at(-1) ?? null,
			onBack: goBack,
		});
		if (opening) {
			void Promise.resolve(closed).then(() => {
				current = null;
				trail.length = 0;
				shownPlayerId.value = null;
			});
		}
	}

	/** Opens a Player's history; from inside an open modal, such as an opponent's name, it remembers the way back. */
	function openPlayerMatchHistory(player: Player) {
		if (current && current.id !== player.id)
			trail.push(current);
		show(player);
	}

	return {
		openPlayerMatchHistory,
		/** The Player the open modal shows; `null` while it is closed. */
		shownPlayerId: readonly(shownPlayerId),
	};
}

// One modal for every Player name on screen: opening another Player, an opponent included, replaces what it shows.
export const usePlayerMatchHistoryModal = createSharedComposable(_usePlayerMatchHistoryModal);

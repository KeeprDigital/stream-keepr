import type { Player } from '~/types';
import { LazyPlayerManageModal } from '#components';

/** Opens Edit Player with the Event's game and identity settings. */
export function usePlayerEditModal() {
	const overlay = useOverlay();
	const eventStore = useEventStore();
	const modal = overlay.create(LazyPlayerManageModal);

	function openPlayerEdit(player: Player) {
		void modal.open({
			player,
			game: eventStore.event?.game ?? 'mtg',
			pronounsEnabled: eventStore.event?.pronounsEnabled ?? true,
			lgsEnabled: eventStore.event?.lgsEnabled ?? false,
		});
	}

	return { openPlayerEdit };
}

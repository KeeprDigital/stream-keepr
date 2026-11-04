import type { PlayerDeckList } from '~~/shared/types/deckList';
import type { Player } from '~/types';
import { playerDisplayName } from '~~/shared/utils/playerName';
import { LazyPlayerDeckListModal, LazyPlayerOpDeckListModal } from '#components';

interface OpenDeckListsOptions {
	playerName: string;
	playerId?: number;
	deckLists: PlayerDeckList[];
	loading?: boolean;
}

export function usePlayerDeckListModal() {
	const overlay = useOverlay();
	const eventStore = useEventStore();
	const deckCache = usePlayerDeckCache();
	const deckListModal = overlay.create(LazyPlayerDeckListModal);
	const opDeckListModal = overlay.create(LazyPlayerOpDeckListModal);
	let currentRequestId = 0;

	function openDeckLists(options: OpenDeckListsOptions) {
		void deckListModal.open({
			playerName: options.playerName,
			playerId: options.playerId,
			deckLists: options.deckLists,
			loading: options.loading ?? false,
		});
	}

	async function openPlayerDeckList(player: Player) {
		// A One Piece Card Game Player holds one Deck List, read in its own layout (ADR-0074).
		if (eventStore.event?.game === 'op') {
			++currentRequestId;
			void opDeckListModal.open({ player, readonly: true });
			return;
		}

		const deckLists = deckCache.getDeckLists(player);
		const loading = deckLists.length === 0;
		const requestId = ++currentRequestId;

		openDeckLists({
			playerName: playerDisplayName(player),
			playerId: player.id,
			deckLists,
			loading,
		});

		if (!eventStore.eventId || !loading) {
			return;
		}

		await deckCache.fetchDecks(player.id, eventStore.eventId, player.updatedAt);

		if (requestId !== currentRequestId) {
			return;
		}

		deckListModal.patch({
			deckLists: deckCache.getDeckLists(player),
			loading: false,
		});
	}

	return {
		openDeckLists,
		openPlayerDeckList,
	};
}

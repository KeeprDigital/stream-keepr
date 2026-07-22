import type { Player, PlayerData } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';

/**
 * Composable for deck list helpers within a match panel:
 * finding players by name, resolving phase-aware decks, and opening the deck list modal.
 */
export function useFeatureMatchDeckList(
	player1Data: ComputedRef<PlayerData>,
	player2Data: ComputedRef<PlayerData>,
) {
	const playerStore = usePlayerStore();
	const { openPlayerDeckList } = usePlayerDeckListModal();

	function getDeckForCurrentPhase(
		playerId: number | null,
		defaultName: string | null,
		defaultColors: string | null,
	): { name: string | null; colors: string | null } {
		if (!playerId) {
			return { name: defaultName, colors: defaultColors };
		}
		const player = playerStore.players.find(p => p.id === playerId);
		if (!player) {
			return { name: defaultName, colors: defaultColors };
		}
		const deck = getMtgGameData(player.gameData);
		return {
			name: deck.deckName ?? defaultName,
			colors: deck.deckColors ?? defaultColors,
		};
	}

	function findPlayerByName(name: string | null): Player | null {
		if (!name)
			return null;
		const normalizedName = name.toLowerCase().trim();
		return playerStore.players.find(p => p.name.toLowerCase().trim() === normalizedName) ?? null;
	}

	const player1ForDeckList = computed(() => findPlayerByName(player1Data.value?.name ?? null));
	const player2ForDeckList = computed(() => findPlayerByName(player2Data.value?.name ?? null));

	// A player "has" a deck if their gameData has a deckName set (proxy for having deck cards)
	const player1HasDeckList = computed(() => !!getMtgGameData(player1ForDeckList.value?.gameData).deckName);
	const player2HasDeckList = computed(() => !!getMtgGameData(player2ForDeckList.value?.gameData).deckName);

	async function openDeckListModal(player: Player) {
		await openPlayerDeckList(player);
	}

	return {
		getDeckForCurrentPhase,
		player1ForDeckList,
		player2ForDeckList,
		player1HasDeckList,
		player2HasDeckList,
		openDeckListModal,
	};
}

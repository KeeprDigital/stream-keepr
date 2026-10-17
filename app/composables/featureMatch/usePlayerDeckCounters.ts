import type { MaybeRefOrGetter } from 'vue';
import type { CounterTypeConfig } from '~~/shared/types/game';
import type { PlayerDeckResponse } from '~~/shared/types/metagame';
import type { ScreenOutputPlayerDecksResponse } from '~~/shared/types/screenOutputReads';
import type { Player } from '~/types';
import { getCounterTypeConfigs } from '~~/shared/config/games';
import { counterConfigsForDeckCounterTypes } from '~~/shared/utils/deckCounters';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { selectPlayerDeck } from '~/composables/data/usePlayerDeckCache';

/** How a rendering of a Screen reads a Player it shows, with their decks (#604). */
export type ScreenOutputPlayerDeckReader = (playerId: number) => Promise<ScreenOutputPlayerDecksResponse>;

export function usePlayerDeckCounters(
	matchId: MaybeRefOrGetter<number>,
	playerSide: MaybeRefOrGetter<PlayerSide>,
	/**
	 * Set on a rendering of the Screen: a Screen Output holds no Session for the
	 * operator's Player and deck reads, so it reads the Slot's Players through
	 * the Screen and holds the record so its edits keep it live.
	 */
	readAsScreenOutput?: ScreenOutputPlayerDeckReader,
) {
	const eventStore = useEventStore();
	const featureMatchStore = useFeatureMatchStore();
	const playerStore = usePlayerStore();
	const deckCache = usePlayerDeckCache();

	const availableCounterTypes = ref<CounterTypeConfig[] | undefined>(undefined);
	let requestId = 0;

	const match = computed(() => {
		return featureMatchStore.featureMatches.find(match => match.id === toValue(matchId)) ?? null;
	});

	const playerLocator = computed(() => {
		const side = toValue(playerSide);
		const m = match.value;
		if (!m)
			return { id: null, name: null };

		return side === 'player1'
			? { id: m.player1Id, name: m.player1Data?.name ?? null }
			: { id: m.player2Id, name: m.player2Data?.name ?? null };
	});

	const matchedPlayer = computed(() => {
		const playerId = playerLocator.value.id;
		if (playerId) {
			return playerStore.players.find(player => player.id === playerId) ?? null;
		}

		const name = playerLocator.value.name;
		if (!name)
			return null;
		return playerStore.players.find(player => player.name.toLowerCase() === name.toLowerCase()) ?? null;
	});

	watch(
		() => [
			eventStore.eventId,
			eventStore.displayEvent?.game,
			playerLocator.value.id,
			playerLocator.value.name,
			matchedPlayer.value?.id,
			matchedPlayer.value?.updatedAt,
			getMtgGameData(matchedPlayer.value?.gameData).deckName,
		] as const,
		async () => {
			const currentRequestId = ++requestId;
			availableCounterTypes.value = undefined;

			if (eventStore.displayEvent?.game !== 'mtg') {
				availableCounterTypes.value = [];
				return;
			}

			const eventId = eventStore.eventId;
			if (!eventId) {
				return;
			}

			let player: Player | null;
			let deck: PlayerDeckResponse | null;
			if (readAsScreenOutput) {
				const playerId = playerLocator.value.id;
				const read = playerId ? await readAsScreenOutput(playerId).catch(() => null) : null;
				if (currentRequestId !== requestId) {
					return;
				}
				player = read?.player ?? null;
				deck = read ? selectPlayerDeck(read.decks) : null;
				if (player && player.updatedAt !== matchedPlayer.value?.updatedAt)
					playerStore.holdPlayer(player);
				if (!player || !getMtgGameData(player.gameData).deckName) {
					return;
				}
			}
			else {
				player = matchedPlayer.value
					?? (playerLocator.value.id ? await playerStore.getPlayerById(eventId, playerLocator.value.id) : null);
				if (currentRequestId !== requestId) {
					return;
				}
				if (!player || !getMtgGameData(player.gameData).deckName) {
					return;
				}

				deck = await deckCache.fetchDeck(player.id, eventId, player.updatedAt);
				if (currentRequestId !== requestId) {
					return;
				}
			}

			if (!deck || deck.cards.length === 0) {
				availableCounterTypes.value = [];
				return;
			}

			const counterTypes = deck.cards.flatMap(card => card.deckCounterTypes);
			availableCounterTypes.value = counterConfigsForDeckCounterTypes(counterTypes, getCounterTypeConfigs('mtg'));
		},
		{ immediate: true },
	);

	return {
		availableCounterTypes,
	};
}

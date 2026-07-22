import type { MaybeRefOrGetter } from 'vue';
import type { CounterTypeConfig } from '~~/shared/types/game';
import { getCounterTypeConfigs } from '~~/shared/config/games';
import { counterConfigsForDeckCounterTypes } from '~~/shared/utils/deckCounters';
import { getMtgGameData } from '~~/shared/utils/gameData';

export function usePlayerDeckCounters(
	matchId: MaybeRefOrGetter<number>,
	playerSide: MaybeRefOrGetter<PlayerSide>,
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
			eventStore.event?.game,
			playerLocator.value.id,
			playerLocator.value.name,
			matchedPlayer.value?.id,
			matchedPlayer.value?.updatedAt,
			getMtgGameData(matchedPlayer.value?.gameData).deckName,
		] as const,
		async () => {
			const currentRequestId = ++requestId;
			availableCounterTypes.value = undefined;

			if (eventStore.event?.game !== 'mtg') {
				availableCounterTypes.value = [];
				return;
			}

			const eventId = eventStore.eventId;
			if (!eventId) {
				return;
			}

			const player = matchedPlayer.value
				?? (playerLocator.value.id ? await playerStore.getPlayerById(eventId, playerLocator.value.id) : null);
			if (currentRequestId !== requestId) {
				return;
			}
			if (!player || !getMtgGameData(player.gameData).deckName) {
				return;
			}

			const deck = await deckCache.fetchDeck(player.id, eventId, player.updatedAt);
			if (currentRequestId !== requestId) {
				return;
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

import type { PlayerDeckSummaryResponse } from '~~/shared/types/metagame';
import type { Archetype } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';

export const usePlayerDeckStore = defineStore('playerDeck', () => {
	const decks = ref<PlayerDeckSummaryResponse[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const isLoaded = ref(false);
	const apiHeaders = useApiHeaders();
	const deckCache = usePlayerDeckCache();

	async function loadByEventId(eventId: number) {
		loading.value = true;
		error.value = null;
		try {
			const response = await $fetch<{ decks: PlayerDeckSummaryResponse[] }>(`/api/events/${eventId}/decks`, {
				headers: apiHeaders.getHeaders(),
			});
			decks.value = response.decks;
			isLoaded.value = true;
			return decks.value;
		}
		catch (cause) {
			error.value = cause instanceof Error ? cause.message : 'Failed to load submitted decks';
			throw cause;
		}
		finally {
			loading.value = false;
		}
	}

	async function reviewDeck(eventId: number, playerId: number, deckId: number, archetypeId: number) {
		const result = await deckCache.reviewDeck(eventId, playerId, deckId, archetypeId);
		const deckIndex = decks.value.findIndex(deck => deck.id === deckId);
		if (deckIndex !== -1)
			decks.value[deckIndex] = result.deck;

		if (result.player) {
			const player = usePlayerStore().players.find(item => item.id === result.player!.id);
			if (player)
				Object.assign(player, result.player);
		}
		useMetagameStore().applyRemoteInvalidated();
		await Promise.allSettled([
			useFeatureMatchStore().loadFeatureMatchesByEventId(eventId),
		]);
		return result;
	}

	function applyRemoteReviewed(data: { deck: PlayerDeckSummaryResponse }) {
		deckCache.applyReviewedDeck(data.deck);
		const index = decks.value.findIndex(deck => deck.id === data.deck.id);
		if (index !== -1)
			decks.value[index] = data.deck;
	}

	function applyArchetypeUpdated(archetype: Archetype) {
		deckCache.applyArchetypeUpdated(archetype);
		for (const deck of decks.value) {
			if (deck.reviewedAt == null || deck.archetypeId !== archetype.id)
				continue;

			deck.name = archetype.name;
			deck.colors = archetype.colors ?? '';
			if (deck.isPrimary)
				applyPrimaryDeckProjection(deck);
		}
	}

	function applyArchetypeDeleted(archetypeId: number) {
		deckCache.applyArchetypeDeleted(archetypeId);
		for (const deck of decks.value) {
			if (deck.archetypeId !== archetypeId)
				continue;

			deck.name = deck.submittedName;
			deck.colors = deck.submittedColors;
			deck.archetypeId = null;
			deck.reviewedAt = null;
			if (deck.isPrimary)
				applyPrimaryDeckProjection(deck);
		}
	}

	function applyPrimaryDeckProjection(deck: PlayerDeckSummaryResponse) {
		const player = usePlayerStore().players.find(item => item.id === deck.playerId);
		if (!player)
			return;

		player.archetypeId = deck.archetypeId;
		if ((player.gameData as { type?: string } | null)?.type !== 'mtg')
			return;

		player.gameData = {
			...getMtgGameData(player.gameData),
			type: 'mtg',
			deckName: deck.name,
			deckColors: deck.colors,
		};
	}

	function $reset() {
		decks.value = [];
		loading.value = false;
		error.value = null;
		isLoaded.value = false;
	}

	return {
		decks,
		loading,
		error,
		isLoaded,
		loadByEventId,
		reviewDeck,
		applyRemoteReviewed,
		applyArchetypeUpdated,
		applyArchetypeDeleted,
		$reset,
	};
});

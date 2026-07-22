import type { PlayerDeckList } from '~~/shared/types/deckList';
import type { PlayerDeckCollectionResponse, PlayerDeckResponse, PlayerDeckReviewResponse } from '~~/shared/types/metagame';
import type { Archetype, Player } from '~/types';
import { calculateDeckCurve, calculateDeckPips, calculateDeckStats } from '~~/shared/utils/deckStats';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { createPlayerDeckList } from '~~/shared/utils/playerDeck';

interface DeckCacheEntry {
	updatedAtKey: string;
	collection: PlayerDeckCollectionResponse;
}

export interface PlayerDeckSelection {
	deckId?: number;
	phaseId?: number;
	roundId?: number;
}

const cache = new Map<number, DeckCacheEntry>();
const inFlight = new Map<string, Promise<PlayerDeckCollectionResponse | null>>();

function updatedAtKey(updatedAt: Date | string) {
	return typeof updatedAt === 'string' ? updatedAt : updatedAt.toISOString();
}

function selectDeck(
	collection: PlayerDeckCollectionResponse,
	selection: PlayerDeckSelection = {},
): PlayerDeckResponse | null {
	if (selection.deckId != null) {
		return collection.decks.find(deck => deck.id === selection.deckId) ?? null;
	}

	if (selection.phaseId != null) {
		const phaseId = selection.phaseId;
		const formatDeck = collection.decks.find(deck => deck.phaseIds.includes(phaseId));
		if (formatDeck)
			return formatDeck;
	}

	return collection.decks.find(deck => deck.id === collection.selectedDeckId)
		?? collection.decks.find(deck => deck.isPrimary)
		?? collection.decks[0]
		?? null;
}

export function usePlayerDeckCache() {
	async function fetchDecks(
		playerId: number,
		eventId: number,
		updatedAt: Date | string,
		selection: PlayerDeckSelection = {},
	): Promise<PlayerDeckCollectionResponse | null> {
		const key = updatedAtKey(updatedAt);
		const cached = cache.get(playerId);
		const requiresServerSelection = selection.roundId != null;
		if (cached?.updatedAtKey === key && !requiresServerSelection) {
			return cached.collection;
		}

		const queryKey = `${playerId}:${key}:${selection.deckId ?? ''}:${selection.phaseId ?? ''}:${selection.roundId ?? ''}`;
		const existing = inFlight.get(queryKey);
		if (existing)
			return existing;

		const promise = $fetch<PlayerDeckCollectionResponse>(
			`/api/events/${eventId}/players/${playerId}/decks`,
			{ query: selection },
		).then((collection) => {
			const primaryDeck = collection.decks.find(deck => deck.isPrimary) ?? collection.decks[0] ?? null;
			cache.set(playerId, {
				updatedAtKey: key,
				collection: {
					...collection,
					selectedDeckId: primaryDeck?.id ?? null,
				},
			});
			return collection;
		}).catch(() => null).finally(() => {
			inFlight.delete(queryKey);
		});

		inFlight.set(queryKey, promise);
		return promise;
	}

	async function fetchDeck(
		playerId: number,
		eventId: number,
		updatedAt: Date | string,
		selection: PlayerDeckSelection = {},
	): Promise<PlayerDeckResponse | null> {
		const collection = await fetchDecks(playerId, eventId, updatedAt, selection);
		return collection ? selectDeck(collection, selection) : null;
	}

	function getCachedDeck(playerId: number, selection: PlayerDeckSelection = {}): PlayerDeckResponse | null {
		const collection = cache.get(playerId)?.collection;
		return collection ? selectDeck(collection, selection) : null;
	}

	function clearCachedDeck(playerId: number) {
		cache.delete(playerId);
		for (const key of inFlight.keys()) {
			if (key.startsWith(`${playerId}:`))
				inFlight.delete(key);
		}
	}

	async function reviewDeck(
		eventId: number,
		playerId: number,
		deckId: number,
		archetypeId: number,
	): Promise<PlayerDeckReviewResponse> {
		const result = await $fetch<PlayerDeckReviewResponse>(
			`/api/events/${eventId}/players/${playerId}/decks/${deckId}/review`,
			{ method: 'PATCH', body: { archetypeId } },
		);
		const cachedDeck = cache.get(playerId)?.collection.decks.find(deck => deck.id === deckId);
		if (cachedDeck) {
			Object.assign(cachedDeck, {
				name: result.deck.name,
				colors: result.deck.colors,
				submittedName: result.deck.submittedName,
				submittedColors: result.deck.submittedColors,
				archetypeId: result.deck.archetypeId,
				reviewedAt: result.deck.reviewedAt,
			});
		}
		return result;
	}

	function applyArchetypeUpdated(archetype: Archetype) {
		for (const { collection } of cache.values()) {
			for (const deck of collection.decks) {
				if (deck.reviewedAt != null && deck.archetypeId === archetype.id) {
					deck.name = archetype.name;
					deck.colors = archetype.colors ?? '';
				}
			}
		}
	}

	function applyReviewedDeck(reviewedDeck: PlayerDeckReviewResponse['deck']) {
		const cachedDeck = cache.get(reviewedDeck.playerId)?.collection.decks.find(deck => deck.id === reviewedDeck.id);
		if (!cachedDeck)
			return;

		Object.assign(cachedDeck, {
			name: reviewedDeck.name,
			colors: reviewedDeck.colors,
			submittedName: reviewedDeck.submittedName,
			submittedColors: reviewedDeck.submittedColors,
			archetypeId: reviewedDeck.archetypeId,
			reviewedAt: reviewedDeck.reviewedAt,
		});
	}

	function applyArchetypeDeleted(archetypeId: number) {
		for (const { collection } of cache.values()) {
			for (const deck of collection.decks) {
				if (deck.archetypeId === archetypeId) {
					deck.name = deck.submittedName;
					deck.colors = deck.submittedColors;
					deck.archetypeId = null;
					deck.reviewedAt = null;
				}
			}
		}
	}

	function getDeckLists(player: Player): PlayerDeckList[] {
		const collection = cache.get(player.id)?.collection;
		if (!collection)
			return [];

		return collection.decks.map((deck) => {
			const pips = calculateDeckPips(deck.cards);
			const hasRealPips = Object.values(pips).some(value => value > 0);
			return createPlayerDeckList(deck, {
				stats: calculateDeckStats(deck.cards),
				curve: calculateDeckCurve(deck.cards),
				pips: hasRealPips ? pips : undefined,
			});
		});
	}

	function getActiveDeckForPlayer(player: Player): { name: string | null; colors: string | null } | null {
		const cachedDeck = getCachedDeck(player.id);
		if (cachedDeck) {
			return { name: cachedDeck.name, colors: cachedDeck.colors };
		}

		const gameData = getMtgGameData(player.gameData);
		if (!gameData.deckName)
			return null;
		return { name: gameData.deckName, colors: gameData.deckColors ?? null };
	}

	return {
		fetchDecks,
		fetchDeck,
		getCachedDeck,
		clearCachedDeck,
		reviewDeck,
		applyArchetypeUpdated,
		applyArchetypeDeleted,
		applyReviewedDeck,
		getDeckLists,
		getActiveDeckForPlayer,
	};
}

export function clearPlayerDeckCache() {
	cache.clear();
	inFlight.clear();
}

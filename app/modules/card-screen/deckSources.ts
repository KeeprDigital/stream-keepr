import type { MaybeRefOrGetter, Ref } from 'vue';
import type { DeckListCard, PlayerDeckList } from '~~/shared/types/deckList';
import type { PlayerDeckResponse } from '~~/shared/types/metagame';
import type { DeckTokenRequirement } from '~~/shared/utils/deckTokens';
import type { FeatureMatch, Player } from '~/types';
import type { DeckListTokenWithData, MatchPlayerDeckData } from '~/types/card/deckList';
import type { MtgCard } from '~/types/card/mtg';
import { computed, toValue } from 'vue';
import { getCounterTypeConfigs } from '~~/shared/config/games';
import { counterConfigsForDeckCounterTypes } from '~~/shared/utils/deckCounters';
import { uniqueDeckTokens } from '~~/shared/utils/deckTokens';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { createPlayerDeckList } from '~~/shared/utils/playerDeck';

interface CardDeckSourceRuntimeState {
	eventId: MaybeRefOrGetter<number | null | undefined>;
	featureMatches: MaybeRefOrGetter<FeatureMatch[]>;
	players: MaybeRefOrGetter<Player[]>;
	loadingDeckList: Ref<boolean>;
	deckListPlayer1: Ref<MatchPlayerDeckData | null>;
	deckListPlayer2: Ref<MatchPlayerDeckData | null>;
	deckListFilter: Ref<string>;
	deckListRoundId: Ref<number | null>;
	playerDeckPlayerId: Ref<number | null>;
	playerDeckData: Ref<MatchPlayerDeckData | null>;
	loadingPlayerDeck: Ref<boolean>;
}

/**
 * Card Screen Deck List source Module.
 *
 * Owns Feature Match and Player Deck List source loading, Scryfall enrichment,
 * source availability checks, and source reset behaviour for Card Screens.
 */
export function useCardDeckSourceRuntime(state: CardDeckSourceRuntimeState) {
	const { fetchScryfallCards, buildDeckListArrays } = useScryfallBatch();
	const deckCache = usePlayerDeckCache();
	const roundStore = useRoundStore();

	const canUseDeckListMode = computed(() => {
		const players = toValue(state.players);
		return toValue(state.featureMatches).some((match) => {
			const slots = [match.player1Data, match.player2Data];
			return slots.some((slot) => {
				if (slot && Object.hasOwn(slot, 'deckId'))
					return slot.deckId != null;
				if (getMtgGameData(slot?.gameData).deckName)
					return true;
				const slotName = slot?.name;
				if (!slotName)
					return false;
				return players.some(p =>
					p.name.toLowerCase() === slotName.toLowerCase()
					&& getMtgGameData(p.gameData).deckName,
				);
			});
		});
	});

	const canUsePlayerDeckMode = computed(() => {
		return toValue(state.players).some(p => getMtgGameData(p.gameData).deckName);
	});

	function findPlayerByName(playerName: string): Player | undefined {
		return toValue(state.players).find(
			p => p.name.toLowerCase() === playerName.toLowerCase(),
		);
	}

	function resolveMatchPlayer(playerId: number | null | undefined, playerName: string | null | undefined): Player | undefined {
		if (playerId != null) {
			// A durable Match identity must never fall through to a different player
			// merely because two entrants share a display name.
			return toValue(state.players).find(player => player.id === playerId);
		}

		// Legacy/manual snapshots may only have retained display data.
		return playerName ? findPlayerByName(playerName) : undefined;
	}

	function resolveMatchPlayerLabel(
		playerName: string | null | undefined,
		player: Player | undefined,
		playerId: number | null | undefined,
		deckId: number | null | undefined,
	): string | undefined {
		const resolvedName = playerName?.trim() || player?.name.trim();
		if (resolvedName)
			return resolvedName;

		// A historical match can outlive the active-player projection. Stable IDs
		// are still sufficient to load its exact submitted deck, so retain a
		// deterministic label for card-screen display rather than dropping it.
		return playerId != null && deckId != null ? `Player ${playerId}` : undefined;
	}

	async function resolvePlayerDeckResponse(
		player: Player | undefined,
		playerId: number | null | undefined,
		deckId?: number | null,
	): Promise<PlayerDeckResponse | null> {
		// `null` is an authoritative match snapshot: this side had no submitted
		// deck. Only `undefined` represents legacy data that may use format/primary
		// fallback selection.
		if (deckId === null)
			return null;

		const resolvedPlayerId = player?.id ?? (deckId != null ? playerId : null);
		if (resolvedPlayerId == null || (deckId === undefined && !getMtgGameData(player?.gameData).deckName))
			return null;

		const evtId = toValue(state.eventId);
		if (!evtId)
			return null;

		const selectedRound = state.deckListRoundId.value == null
			? null
			: roundStore.rounds.find(round => round.id === state.deckListRoundId.value) ?? null;
		return deckCache.fetchDeck(
			resolvedPlayerId,
			evtId,
			player?.updatedAt ?? `match-deck:${deckId}`,
			deckId !== undefined
				? { deckId }
				: selectedRound ? { phaseId: selectedRound.phaseId } : {},
		);
	}

	/**
	 * Build a PlayerDeckList from a deck response and the player's game data.
	 * Returns null when no deck response is available (deck not yet loaded).
	 */
	function buildDeckList(playerName: string, deckResponse: PlayerDeckResponse | null): PlayerDeckList | null {
		if (!deckResponse)
			return null;
		return createPlayerDeckList(deckResponse);
	}

	/** Convert PlayerDeckResponse cards to DeckListCard-compatible format for Scryfall batch. */
	function toDeckListCards(deck: PlayerDeckResponse | null): DeckListCard[] {
		return (deck?.cards ?? []).map(c => ({
			name: c.name,
			setCode: null,
			quantity: c.quantity,
			compartment: c.compartment as 'mainboard' | 'sideboard',
			cardType: c.cardType ?? '',
			scryfallId: c.scryfallId,
			deckCounterTypes: c.deckCounterTypes,
			deckTokens: c.deckTokens,
			highlanderPoints: c.highlanderPoints,
		}));
	}

	function buildEmptyDeckSource(playerName: string, deckResponse: PlayerDeckResponse | null): MatchPlayerDeckData {
		return {
			playerName,
			deckList: buildDeckList(playerName, deckResponse),
			deckCounters: [],
			deckTokens: [],
			tokens: [],
			mainboard: [],
			sideboard: [],
		};
	}

	function deriveDeckCounters(cards: DeckListCard[]) {
		const counterTypes = cards.flatMap(card => card.deckCounterTypes ?? []);
		return counterConfigsForDeckCounterTypes(counterTypes, getCounterTypeConfigs('mtg'));
	}

	function deriveDeckTokens(cards: DeckListCard[]) {
		return uniqueDeckTokens(cards.flatMap(card => card.deckTokens ?? []));
	}

	function tokenImageUrl(scryfallId: string): string {
		return `https://api.scryfall.com/cards/${scryfallId}?format=image&version=normal`;
	}

	function tokenToMtgCard(token: DeckTokenRequirement): MtgCard | null {
		if (!token.scryfallId) {
			return null;
		}

		return {
			id: token.scryfallId,
			name: token.name,
			set: '',
			layout: 'token',
			imageData: {
				front: {
					small: tokenImageUrl(token.scryfallId),
					normal: tokenImageUrl(token.scryfallId),
					large: tokenImageUrl(token.scryfallId),
					png: tokenImageUrl(token.scryfallId),
					art_crop: tokenImageUrl(token.scryfallId),
					border_crop: tokenImageUrl(token.scryfallId),
				},
				back: null,
			},
			orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
			displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
			deckCounterTypes: [],
			deckTokens: [],
		};
	}

	function buildTokenList(tokens: ReturnType<typeof deriveDeckTokens>): DeckListTokenWithData[] {
		return tokens.map(token => ({
			...token,
			mtgCard: tokenToMtgCard(token),
		}));
	}

	function buildEnrichedDeckSource(
		playerName: string,
		deckResponse: PlayerDeckResponse | null,
		cards: DeckListCard[],
		cardDataMap: Map<string, MtgCard>,
	): MatchPlayerDeckData {
		const deckTokens = deriveDeckTokens(cards);

		return {
			playerName,
			deckList: buildDeckList(playerName, deckResponse),
			deckCounters: deriveDeckCounters(cards),
			deckTokens,
			tokens: buildTokenList(deckTokens),
			...buildDeckListArrays(cards, cardDataMap),
		};
	}

	function buildDeckSource(
		playerName: string,
		deckResponse: PlayerDeckResponse | null,
		cards: DeckListCard[],
		cardDataMap: Map<string, MtgCard>,
	): MatchPlayerDeckData {
		return cards.length
			? buildEnrichedDeckSource(playerName, deckResponse, cards, cardDataMap)
			: buildEmptyDeckSource(playerName, deckResponse);
	}

	async function loadMatchupDeckLists(
		player1Name: string | null | undefined,
		player2Name: string | null | undefined,
		player1Id?: number | null,
		player2Id?: number | null,
		player1DeckId?: number | null,
		player2DeckId?: number | null,
	) {
		state.loadingDeckList.value = true;

		try {
			const p1 = resolveMatchPlayer(player1Id, player1Name);
			const p2 = resolveMatchPlayer(player2Id, player2Name);
			const p1Name = resolveMatchPlayerLabel(player1Name, p1, player1Id, player1DeckId);
			const p2Name = resolveMatchPlayerLabel(player2Name, p2, player2Id, player2DeckId);
			const [p1DeckResponse, p2DeckResponse] = await Promise.all([
				p1Name ? resolvePlayerDeckResponse(p1, player1Id, player1DeckId) : null,
				p2Name ? resolvePlayerDeckResponse(p2, player2Id, player2DeckId) : null,
			]);

			const p1Cards = toDeckListCards(p1DeckResponse);
			const p2Cards = toDeckListCards(p2DeckResponse);

			// Batch fetch all cards from both players in one go.
			const allCards = [...p1Cards, ...p2Cards];
			const cardDataMap = allCards.length > 0
				? (await fetchScryfallCards(allCards)).cards
				: new Map<string, MtgCard>();

			state.deckListPlayer1.value = p1Name
				? buildDeckSource(p1Name, p1DeckResponse, p1Cards, cardDataMap)
				: null;

			state.deckListPlayer2.value = p2Name
				? buildDeckSource(p2Name, p2DeckResponse, p2Cards, cardDataMap)
				: null;
		}
		catch (err) {
			console.error('Failed to load match deck lists:', err);
			state.deckListPlayer1.value = null;
			state.deckListPlayer2.value = null;
		}
		finally {
			state.loadingDeckList.value = false;
		}
	}

	async function loadMatchDeckLists(matchId: number) {
		const match = toValue(state.featureMatches).find(m => m.id === matchId);
		if (!match)
			return;

		await loadMatchupDeckLists(
			match.player1Data?.name,
			match.player2Data?.name,
			match.player1Id,
			match.player2Id,
			match.player1Data?.deckId,
			match.player2Data?.deckId,
		);
	}

	function clearMatchDeckLists() {
		state.deckListPlayer1.value = null;
		state.deckListPlayer2.value = null;
		state.deckListFilter.value = '';
	}

	async function loadPlayerDeck(playerId: number) {
		const player = toValue(state.players).find(p => p.id === playerId);
		if (!player || !getMtgGameData(player.gameData).deckName)
			return;

		const evtId = toValue(state.eventId);
		if (!evtId)
			return;

		state.loadingPlayerDeck.value = true;
		state.playerDeckPlayerId.value = playerId;

		try {
			const deckResponse = await deckCache.fetchDeck(player.id, evtId, player.updatedAt);
			const deckCards = toDeckListCards(deckResponse);
			const cardDataMap = deckCards.length > 0
				? (await fetchScryfallCards(deckCards)).cards
				: new Map<string, MtgCard>();

			state.playerDeckData.value = buildDeckSource(player.name, deckResponse, deckCards, cardDataMap);
		}
		catch (err) {
			console.error('Failed to load player deck:', err);
			state.playerDeckData.value = null;
		}
		finally {
			state.loadingPlayerDeck.value = false;
		}
	}

	function clearPlayerDeck() {
		state.playerDeckPlayerId.value = null;
		state.playerDeckData.value = null;
	}

	function resetDeckSources() {
		state.loadingDeckList.value = false;
		state.deckListPlayer1.value = null;
		state.deckListPlayer2.value = null;
		state.deckListFilter.value = '';
		state.playerDeckPlayerId.value = null;
		state.playerDeckData.value = null;
		state.loadingPlayerDeck.value = false;
	}

	return {
		canUseDeckListMode,
		canUsePlayerDeckMode,
		loadMatchDeckLists,
		loadMatchupDeckLists,
		clearMatchDeckLists,
		loadPlayerDeck,
		clearPlayerDeck,
		resetDeckSources,
	};
}

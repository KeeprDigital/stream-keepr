import type { ScreenCard } from '~~/shared/types/card/mtg';
import type { OpCardDetail, OpCardSummary, OpScreenCard } from '~~/shared/types/card/op';
import type { CommanderSeatDeckData, MatchPlayerDeckData, OpMatchPlayerDeckData } from '~/types/card/deckList';
import type { MtgActiveCardAction, MtgCard, MtgFormat } from '~/types/card/mtg';
import type { CardMatchup, CardPageMode } from '~/types/card/page';
import { useCountdown, useStorage } from '@vueuse/core';
import { eventKind } from '~~/shared/config/games';
import { isOpScreenCard } from '~~/shared/utils/card/op';
import { useActiveCardScreenRuntime } from '~/modules/card-screen/activeCard';
import { useCommanderCardDeckSourceRuntime } from '~/modules/card-screen/commanderDeckSources';
import { useCardDeckSourceRuntime } from '~/modules/card-screen/deckSources';
import { useOpCardDeckSourceRuntime } from '~/modules/card-screen/opDeckSources';
import { useOpSpotlightRuntime } from '~/modules/card-screen/opSpotlight';
import { useCardSearchRuntime } from '~/modules/card-screen/search';

export const useCardStore = defineStore('card', () => {
	const eventStore = useEventStore();
	const featureMatchStore = useFeatureMatchStore();
	const playerStore = usePlayerStore();
	const { executeReporting } = useReportingAction();

	const timeout = useCountdown(0);
	const selectionHistory = useStorage<MtgCard[]>('mtgCard-history', []);

	// ──────────────── Card Display State ────────────────

	const previewCard = ref<MtgCard | null>(null);
	const previewCardPrintings = ref<MtgCard[]>([]);
	const activeCard = ref<ScreenCard | null>(null);
	const activeScreenId = ref<number | null>(null);

	const searching = ref(false);
	const searchResults = ref<MtgCard[]>([]);
	const selectedSearchFormat = ref<MtgFormat>('all');
	const showCardControls = ref(false);
	const autoShowSelectedCard = useStorage('mtgCard-autoShowSelectedCard', false);
	const cardPageMode = ref<CardPageMode>('search');

	// ──────────────── Deck List State ────────────────

	const loadingDeckList = ref(false);
	const deckListPlayer1 = ref<MatchPlayerDeckData | null>(null);
	const deckListPlayer2 = ref<MatchPlayerDeckData | null>(null);
	/** A One Piece Event's Slot sides, which hold One Piece Deck Lists (ADR-0057). */
	const opDeckListPlayer1 = ref<OpMatchPlayerDeckData | null>(null);
	const opDeckListPlayer2 = ref<OpMatchPlayerDeckData | null>(null);
	/** A Commander Event's Slot Seats somebody sits in, each with its Commanders and list (ADR-0087). */
	const commanderDeckListSeats = ref<CommanderSeatDeckData[]>([]);
	const deckListHasData = computed(() => deckListPlayer1.value !== null || deckListPlayer2.value !== null
		|| opDeckListPlayer1.value !== null || opDeckListPlayer2.value !== null
		|| commanderDeckListSeats.value.length > 0);
	const deckListRoundId = ref<number | null>(null);
	const deckListMatchup = ref<CardMatchup | null>(null);
	const deckListFilter = ref('');

	// ──────────────── Player Deck State ────────────────

	const playerDeckPlayerId = ref<number | null>(null);
	const playerDeckData = ref<MatchPlayerDeckData | null>(null);
	const loadingPlayerDeck = ref(false);

	const playerDeckHasData = computed(() => playerDeckData.value !== null);

	// ──────────────── Loading State ────────────────

	const loading = ref(false);
	const error = ref<string | null>(null);
	const activeCardRuntime = useActiveCardScreenRuntime({
		eventId: () => eventStore.eventId,
		activeScreenId,
		activeCard,
		timeout,
		loading,
		error,
		// Every Card write reports through one seam, and that seam says what the server
		// said: a refused save is 'Another operator is showing a card on this Screen',
		// not '[POST] "…": 409 Conflict'. Handed to the Module as its `executeAction` so
		// the reporting decision is the store's and the Module keeps one contract (#271).
		executeAction: executeReporting,
	});
	const saveActiveCard = activeCardRuntime.saveActiveCard;

	const cardSearchRuntime = useCardSearchRuntime({
		eventId: () => eventStore.eventId,
		activeScreenId,
		cardTimeoutSeconds: () => eventStore.event?.cardTimeout,
		previewCard,
		previewCardPrintings,
		searching,
		searchResults,
		selectedSearchFormat,
		showCardControls,
		autoShowSelectedCard,
		selectionHistory,
		saveActiveCard,
	});

	// ──────────────── One Piece Card Spotlight (ADR-0057) ────────────────

	const opSearching = ref(false);
	const opSearchResults = ref<OpCardSummary[]>([]);
	const opCardDataAvailable = ref<boolean | null>(null);
	const opSearchError = ref<string | null>(null);
	const opSearched = ref(false);
	const opPreviewCard = ref<OpScreenCard | null>(null);
	const opPreviewDetail = ref<OpCardDetail | null>(null);
	const opSelectionHistory = useStorage<OpScreenCard[]>('opCard-history', []);

	const opSpotlightRuntime = useOpSpotlightRuntime({
		eventId: () => eventStore.eventId,
		activeScreenId,
		cardTimeoutSeconds: () => eventStore.event?.cardTimeout,
		showCardControls,
		autoShowSelectedCard,
		searching: opSearching,
		results: opSearchResults,
		available: opCardDataAvailable,
		searchError: opSearchError,
		searched: opSearched,
		previewCard: opPreviewCard,
		previewDetail: opPreviewDetail,
		selectionHistory: opSelectionHistory,
		saveActiveCard,
	});

	const deckSourceRuntime = useCardDeckSourceRuntime({
		eventId: () => eventStore.eventId,
		featureMatches: () => featureMatchStore.featureMatches,
		players: () => playerStore.players,
		loadingDeckList,
		deckListPlayer1,
		deckListPlayer2,
		deckListFilter,
		deckListRoundId,
		playerDeckPlayerId,
		playerDeckData,
		loadingPlayerDeck,
	});
	const opDeckSourceRuntime = useOpCardDeckSourceRuntime({
		eventId: () => eventStore.eventId,
		featureMatches: () => featureMatchStore.featureMatches,
		loadingDeckList,
		deckListPlayer1: opDeckListPlayer1,
		deckListPlayer2: opDeckListPlayer2,
	});
	const commanderDeckSourceRuntime = useCommanderCardDeckSourceRuntime({
		eventId: () => eventStore.eventId,
		featureMatches: () => featureMatchStore.featureMatches,
		loadingDeckList,
		seats: commanderDeckListSeats,
	});
	/** A One Piece Event's matchups are its Feature Match Slots, read as One Piece Deck Lists. */
	const isOpEvent = computed(() => eventStore.event?.game === 'op');
	/** A Commander Event's are its Slots too, each Seat read as its Commanders and list (ADR-0087). */
	const isCommanderEvent = computed(() => !!eventStore.event && eventKind(eventStore.event) === 'mtg-commander');
	const canUseDeckListMode = computed(() => {
		if (isOpEvent.value)
			return opDeckSourceRuntime.canUseDeckListMode.value;
		return isCommanderEvent.value
			? commanderDeckSourceRuntime.canUseDeckListMode.value
			: deckSourceRuntime.canUseDeckListMode.value;
	});
	const canUsePlayerDeckMode = deckSourceRuntime.canUsePlayerDeckMode;
	const cardDataDegraded = deckSourceRuntime.cardDataDegraded;

	// ──────────────── Active Screen ────────────────

	const setActiveScreen = activeCardRuntime.setActiveScreen;

	// ──────────────── Computed ────────────────

	const cardsMatch = computed(() => {
		const active = activeCard.value;
		// An OP card is shown as printed: the same Printing is the same card on screen.
		if (isOpScreenCard(active) || opPreviewCard.value)
			return isOpScreenCard(active) && active.id === opPreviewCard.value?.id;
		return active?.id === previewCard.value?.id
			&& active?.displayData.flipped === previewCard.value?.displayData.flipped
			&& active?.displayData.rotated === previewCard.value?.displayData.rotated
			&& active?.displayData.turnedOver === previewCard.value?.displayData.turnedOver
			&& active?.displayData.counterRotated === previewCard.value?.displayData.counterRotated;
	});

	const searchFormatQuery = cardSearchRuntime.searchFormatQuery;

	// ──────────────── Card CRUD ────────────────

	const loadActiveCard = activeCardRuntime.loadActiveCard;
	const readActiveCardAsScreenOutput = activeCardRuntime.readAsScreenOutput;
	const clearActiveCard = activeCardRuntime.clearActiveCard;

	// ──────────────── Card Search and Preview ────────────────

	const searchFuzzyCardName = cardSearchRuntime.searchFuzzyCardName;
	const searchCardPrints = cardSearchRuntime.searchCardPrints;
	const selectPreviewCard = cardSearchRuntime.selectPreviewCard;
	const selectMeldCardPart = cardSearchRuntime.selectMeldCardPart;
	const controlPreviewCard = cardSearchRuntime.controlPreviewCard;

	// ──────────────── Card Controls ────────────────

	async function controlActiveCard(action: MtgActiveCardAction) {
		if (!activeCard.value)
			return;

		if (action === 'clear') {
			await clearActiveCard();
			return;
		}

		// Toggle the display property and save, putting it back if the save fails (#734).
		const toggleMap: Record<Exclude<MtgActiveCardAction, 'clear'>, keyof MtgCard['displayData']> = {
			flip: 'flipped',
			rotate: 'rotated',
			turnOver: 'turnedOver',
			counterRotate: 'counterRotated',
		};
		await activeCardRuntime.controlActiveCardDisplay(toggleMap[action]);
	}

	const clearSearch = cardSearchRuntime.clearSearch;
	const clearHistory = cardSearchRuntime.clearHistory;

	// ──────────────── Deck List Loading ────────────────

	async function loadMatchDeckLists(slotId: number) {
		if (isOpEvent.value)
			await opDeckSourceRuntime.loadMatchDeckLists(slotId);
		else if (isCommanderEvent.value)
			await commanderDeckSourceRuntime.loadMatchDeckLists(slotId);
		else
			await deckSourceRuntime.loadMatchDeckLists(slotId);
	}
	const loadMatchupDeckLists = deckSourceRuntime.loadMatchupDeckLists;
	function clearMatchDeckLists() {
		deckSourceRuntime.clearMatchDeckLists();
		opDeckSourceRuntime.clearMatchDeckLists();
		commanderDeckSourceRuntime.clearMatchDeckLists();
	}
	const opSlotHoldsDeckLists = opDeckSourceRuntime.slotHoldsDeckLists;
	const commanderSlotHoldsDecks = commanderDeckSourceRuntime.slotHoldsDecks;
	const loadPlayerDeck = deckSourceRuntime.loadPlayerDeck;
	const clearPlayerDeck = deckSourceRuntime.clearPlayerDeck;

	// ──────────────── Realtime Handlers ────────────────

	const applyRemoteUpdated = activeCardRuntime.applyRemoteUpdated;
	const applyRemotePreview = cardSearchRuntime.applyRemotePreview;
	const applyRemoteCleared = activeCardRuntime.applyRemoteCleared;

	// ──────────────── Reset ────────────────

	function $reset() {
		cardSearchRuntime.resetPreviewState();
		activeScreenId.value = null;
		cardPageMode.value = 'search';
		deckListRoundId.value = null;
		deckListMatchup.value = null;
		error.value = null;
		loading.value = false;
		// Ends the Event Lifetime for the Card too: a read still out lands nothing (#704),
		// and a save or Clear still out touches nothing (ADR-0024).
		activeCardRuntime.endLifetime();
		deckSourceRuntime.resetDeckSources();
		opDeckSourceRuntime.resetDeckSources();
		commanderDeckSourceRuntime.resetDeckSources();
		opSpotlightRuntime.reset();
	}

	return {
		// State
		activeCard,
		previewCard,
		previewCardPrintings,
		searchResults,
		selectionHistory,
		activeScreenId,
		selectedSearchFormat,
		searching,
		loading,
		error,
		timeout,
		showCardControls,
		autoShowSelectedCard,
		cardPageMode,
		// Deck list state
		loadingDeckList,
		deckListPlayer1,
		deckListPlayer2,
		opDeckListPlayer1,
		opDeckListPlayer2,
		commanderDeckListSeats,
		deckListHasData,
		deckListRoundId,
		deckListMatchup,
		deckListFilter,
		canUseDeckListMode,
		cardDataDegraded,
		// Player deck state
		playerDeckPlayerId,
		playerDeckData,
		playerDeckHasData,
		loadingPlayerDeck,
		canUsePlayerDeckMode,
		// One Piece Card Spotlight state
		opSearching,
		opSearchResults,
		opCardDataAvailable,
		opSearchError,
		opSearched,
		opPreviewCard,
		opPreviewPrintings: opSpotlightRuntime.previewPrintings,
		opSelectionHistory,

		// Computed
		cardsMatch,
		searchFormatQuery,

		// Actions
		setActiveScreen,
		loadActiveCard,
		readActiveCardAsScreenOutput,
		saveActiveCard,
		clearActiveCard,
		searchFuzzyCardName,
		searchCardPrints,
		selectPreviewCard,
		selectMeldCardPart,
		controlPreviewCard,
		controlActiveCard,
		clearSearch,
		clearHistory,
		loadMatchDeckLists,
		loadMatchupDeckLists,
		clearMatchDeckLists,
		opSlotHoldsDeckLists,
		commanderSlotHoldsDecks,
		loadPlayerDeck,
		clearPlayerDeck,
		searchOpCards: opSpotlightRuntime.search,
		selectOpCard: opSpotlightRuntime.selectCard,
		selectOpHistoryCard: opSpotlightRuntime.selectHistoryCard,
		selectOpPrinting: opSpotlightRuntime.selectPrinting,
		showOpPreviewCard: opSpotlightRuntime.showPreviewCard,
		clearOpPreview: opSpotlightRuntime.clearPreview,
		clearOpHistory: opSpotlightRuntime.clearHistory,
		applyRemoteUpdated,
		applyRemotePreview,
		applyRemoteCleared,
		$reset,
	};
});

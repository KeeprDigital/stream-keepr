import type { MatchPlayerDeckData } from '~/types/card/deckList';
import type { MtgActiveCardAction, MtgCard, MtgFormat } from '~/types/card/mtg';
import type { CardPageMode } from '~/types/card/page';
import { useCountdown, useStorage } from '@vueuse/core';
import { useActiveCardScreenRuntime } from '~/modules/card-screen/activeCard';
import { useCardDeckSourceRuntime } from '~/modules/card-screen/deckSources';
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
	const activeCard = ref<MtgCard | null>(null);
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
	const deckListHasData = computed(() => deckListPlayer1.value !== null || deckListPlayer2.value !== null);
	const deckListRoundId = ref<number | null>(null);
	const deckListMatchId = ref<number | null>(null);
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
	const canUseDeckListMode = deckSourceRuntime.canUseDeckListMode;
	const canUsePlayerDeckMode = deckSourceRuntime.canUsePlayerDeckMode;

	// ──────────────── Active Screen ────────────────

	const setActiveScreen = activeCardRuntime.setActiveScreen;

	// ──────────────── Computed ────────────────

	const cardsMatch = computed(() => {
		return activeCard.value?.id === previewCard.value?.id
			&& activeCard.value?.displayData.flipped === previewCard.value?.displayData.flipped
			&& activeCard.value?.displayData.rotated === previewCard.value?.displayData.rotated
			&& activeCard.value?.displayData.turnedOver === previewCard.value?.displayData.turnedOver
			&& activeCard.value?.displayData.counterRotated === previewCard.value?.displayData.counterRotated;
	});

	const searchFormatQuery = cardSearchRuntime.searchFormatQuery;

	// ──────────────── Card CRUD ────────────────

	const loadActiveCard = activeCardRuntime.loadActiveCard;
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

		// Toggle the display property and save
		const toggleMap: Record<Exclude<MtgActiveCardAction, 'clear'>, keyof MtgCard['displayData']> = {
			flip: 'flipped',
			rotate: 'rotated',
			turnOver: 'turnedOver',
			counterRotate: 'counterRotated',
		};
		const prop = toggleMap[action];
		activeCard.value.displayData[prop] = !activeCard.value.displayData[prop];
		await saveActiveCard(activeCard.value);
	}

	const clearSearch = cardSearchRuntime.clearSearch;
	const clearHistory = cardSearchRuntime.clearHistory;

	// ──────────────── Deck List Loading ────────────────

	const loadMatchDeckLists = deckSourceRuntime.loadMatchDeckLists;
	const loadMatchupDeckLists = deckSourceRuntime.loadMatchupDeckLists;
	const clearMatchDeckLists = deckSourceRuntime.clearMatchDeckLists;
	const loadPlayerDeck = deckSourceRuntime.loadPlayerDeck;
	const clearPlayerDeck = deckSourceRuntime.clearPlayerDeck;

	// ──────────────── Realtime Handlers ────────────────

	const applyRemoteUpdated = activeCardRuntime.applyRemoteUpdated;
	const applyRemotePreview = cardSearchRuntime.applyRemotePreview;
	const applyRemoteCleared = activeCardRuntime.applyRemoteCleared;
	const applyRemoteTimeout = activeCardRuntime.applyRemoteTimeout;
	const applyRemoteTimeoutCancel = activeCardRuntime.applyRemoteTimeoutCancel;

	// ──────────────── Reset ────────────────

	function $reset() {
		cardSearchRuntime.resetPreviewState();
		activeCard.value = null;
		activeScreenId.value = null;
		cardPageMode.value = 'search';
		deckListRoundId.value = null;
		deckListMatchId.value = null;
		error.value = null;
		loading.value = false;
		timeout.reset();
		activeCardRuntime.clearCardTimeout();
		deckSourceRuntime.resetDeckSources();
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
		deckListHasData,
		deckListRoundId,
		deckListMatchId,
		deckListFilter,
		canUseDeckListMode,
		// Player deck state
		playerDeckPlayerId,
		playerDeckData,
		playerDeckHasData,
		loadingPlayerDeck,
		canUsePlayerDeckMode,

		// Computed
		cardsMatch,
		searchFormatQuery,

		// Actions
		setActiveScreen,
		loadActiveCard,
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
		loadPlayerDeck,
		clearPlayerDeck,
		applyRemoteUpdated,
		applyRemotePreview,
		applyRemoteCleared,
		applyRemoteTimeout,
		applyRemoteTimeoutCancel,
		$reset,
	};
});

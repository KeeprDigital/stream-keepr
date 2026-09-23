import type { ScryfallCard, ScryfallList } from '@scryfall/api-types';
import type { MaybeRefOrGetter, Ref } from 'vue';
import type { MtgCard, MtgFormat, MtgPreviewCardAction } from '~/types/card/mtg';
import type { MessageData } from '~/types/realtime';
import { computed, toRaw, toValue } from 'vue';
import { cloneMtgCard } from '~~/shared/utils/card/clone';
import { cardParser } from '~~/shared/utils/card/parsers';

const SCRYFALL_CLIENT_TIMEOUT_MS = 10_000;

interface CardSearchRuntimeState {
	eventId: MaybeRefOrGetter<number | null | undefined>;
	activeScreenId: Ref<number | null>;
	cardTimeoutSeconds: MaybeRefOrGetter<number | null | undefined>;
	previewCard: Ref<MtgCard | null>;
	previewCardPrintings: Ref<MtgCard[]>;
	searching: Ref<boolean>;
	searchResults: Ref<MtgCard[]>;
	selectedSearchFormat: Ref<MtgFormat>;
	showCardControls: Ref<boolean>;
	autoShowSelectedCard: Ref<boolean>;
	selectionHistory: Ref<MtgCard[]>;
	saveActiveCard: (cardData: MtgCard) => Promise<unknown>;
}

export function buildCardSearchFormatQuery(format: MtgFormat): string {
	switch (format) {
		case 'all':
			return '';
		case 'token':
			return 'is:token';
		default:
			return `format:${format}`;
	}
}

/**
 * Card Screen search and preview Module.
 *
 * Owns Scryfall search, print selection, preview controls, preview history,
 * and remote preview application for the selected Screen.
 */
export function useCardSearchRuntime(state: CardSearchRuntimeState) {
	const { getServerTime } = useServerTime();
	const searchFormatQuery = computed(() => buildCardSearchFormatQuery(state.selectedSearchFormat.value));
	let fuzzySearchGeneration = 0;
	let printSearchGeneration = 0;
	let meldSearchGeneration = 0;
	let fuzzySearchController: AbortController | null = null;
	let printSearchController: AbortController | null = null;
	let meldSearchController: AbortController | null = null;
	const activeRequests = new Set<symbol>();

	function beginRequest() {
		const token = Symbol('card-search');
		activeRequests.add(token);
		state.searching.value = true;
		return token;
	}

	function endRequest(token: symbol) {
		activeRequests.delete(token);
		state.searching.value = activeRequests.size > 0;
	}

	function isMessageForActiveScreen(messageData?: { screenId?: number }) {
		if (!messageData)
			return false;
		return state.activeScreenId.value !== null && messageData.screenId === state.activeScreenId.value;
	}

	function pushToHistory(cardData: MtgCard) {
		const cardCopy = cloneMtgCard(toRaw(cardData));
		const existingIndex = state.selectionHistory.value.findIndex(card => card.name === cardData.name);
		if (existingIndex !== -1) {
			state.selectionHistory.value.splice(existingIndex, 1);
		}
		state.selectionHistory.value.unshift(cardCopy);
	}

	async function searchFuzzyCardName(name: string) {
		const generation = ++fuzzySearchGeneration;
		fuzzySearchController?.abort();
		fuzzySearchController = null;
		if (name.length < 3) {
			clearSearch();
			return;
		}
		const controller = new AbortController();
		fuzzySearchController = controller;
		const token = beginRequest();

		try {
			const data = await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
				query: {
					q: `${name} game:paper ${searchFormatQuery.value}`,
					unique: 'cards',
				},
				signal: controller.signal,
				timeout: SCRYFALL_CLIENT_TIMEOUT_MS,
			});
			if (generation === fuzzySearchGeneration)
				state.searchResults.value = data ? data.data.map(card => cardParser(card)) : [];
		}
		catch {
			if (generation === fuzzySearchGeneration)
				state.searchResults.value = [];
		}
		finally {
			if (fuzzySearchController === controller)
				fuzzySearchController = null;
			endRequest(token);
		}
	}

	async function searchCardPrints(exactName: string) {
		const generation = ++printSearchGeneration;
		printSearchController?.abort();
		const controller = new AbortController();
		printSearchController = controller;
		const token = beginRequest();
		try {
			const data = await $fetch<ScryfallList.Cards>('https://api.scryfall.com/cards/search', {
				query: {
					q: `"${exactName}" game:paper`,
					unique: 'prints',
					order: 'released',
				},
				signal: controller.signal,
				timeout: SCRYFALL_CLIENT_TIMEOUT_MS,
			});
			if (generation === printSearchGeneration)
				state.previewCardPrintings.value = data.data.map(card => cardParser(card));
		}
		catch {
			if (generation === printSearchGeneration)
				state.previewCardPrintings.value = [];
		}
		finally {
			if (printSearchController === controller)
				printSearchController = null;
			endRequest(token);
		}
	}

	async function selectPreviewCard(cardData: MtgCard, turnedOver: boolean) {
		state.showCardControls.value = !state.autoShowSelectedCard.value || state.activeScreenId.value === null;
		let shouldSearchPrintings = true;

		if (cardData.id === state.previewCard.value?.id) {
			if (turnedOver === state.previewCard.value.displayData.turnedOver)
				return;
			shouldSearchPrintings = false;
		}

		state.previewCard.value = structuredClone(toRaw(cardData));
		if (turnedOver && state.previewCard.value) {
			state.previewCard.value.displayData.turnedOver = true;
		}
		pushToHistory(cardData);

		if (state.autoShowSelectedCard.value && state.activeScreenId.value !== null) {
			await controlPreviewCard('show');
		}

		if (shouldSearchPrintings) {
			state.previewCardPrintings.value = [];
			await searchCardPrints(cardData.name);
		}
	}

	async function selectMeldCardPart(cardName: string) {
		const generation = ++meldSearchGeneration;
		meldSearchController?.abort();
		const controller = new AbortController();
		meldSearchController = controller;
		const token = beginRequest();
		try {
			const data = await $fetch<ScryfallCard.Any>('https://api.scryfall.com/cards/named', {
				query: { exact: cardName, unique: 'prints' },
				signal: controller.signal,
				timeout: SCRYFALL_CLIENT_TIMEOUT_MS,
			});
			if (generation === meldSearchGeneration) {
				state.previewCard.value = cardParser(data);
				await searchCardPrints(cardName);
			}
		}
		catch (err) {
			if (generation === meldSearchGeneration)
				console.error('Failed to fetch meld card part:', err);
		}
		finally {
			if (meldSearchController === controller)
				meldSearchController = null;
			endRequest(token);
		}
	}

	async function controlPreviewCard(action: MtgPreviewCardAction) {
		if (!state.previewCard.value)
			return;

		switch (action) {
			case 'show': {
				const cardData = cloneMtgCard(state.previewCard.value);
				const timeoutSeconds = toValue(state.cardTimeoutSeconds);
				if (timeoutSeconds) {
					cardData.timeoutData = {
						timeoutDuration: timeoutSeconds * 1000,
						timeoutStartTimestamp: Math.round(getServerTime()),
					};
				}
				await state.saveActiveCard(cardData);
				break;
			}
			case 'clear':
				state.previewCard.value = null;
				state.showCardControls.value = false;
				break;
			case 'flip':
				state.previewCard.value.displayData.flipped = !state.previewCard.value.displayData.flipped;
				break;
			case 'rotate':
				state.previewCard.value.displayData.rotated = !state.previewCard.value.displayData.rotated;
				break;
			case 'turnOver':
				state.previewCard.value.displayData.turnedOver = !state.previewCard.value.displayData.turnedOver;
				break;
			case 'counterRotate':
				state.previewCard.value.displayData.counterRotated = !state.previewCard.value.displayData.counterRotated;
				break;
		}
	}

	function clearSearch() {
		fuzzySearchGeneration++;
		fuzzySearchController?.abort();
		fuzzySearchController = null;
		state.searchResults.value = [];
		if (activeRequests.size === 0)
			state.searching.value = false;
	}

	function clearHistory() {
		state.selectionHistory.value = [];
	}

	function applyRemotePreview(data: MessageData<'card:preview'>) {
		const eventId = toValue(state.eventId);
		if (eventId && data.eventId === eventId && isMessageForActiveScreen(data)) {
			state.previewCard.value = data.card;
			state.showCardControls.value = true;
		}
	}

	function resetPreviewState() {
		fuzzySearchGeneration++;
		printSearchGeneration++;
		meldSearchGeneration++;
		fuzzySearchController?.abort();
		printSearchController?.abort();
		meldSearchController?.abort();
		fuzzySearchController = null;
		printSearchController = null;
		meldSearchController = null;
		activeRequests.clear();
		state.searching.value = false;
		state.previewCard.value = null;
		state.previewCardPrintings.value = [];
		state.searchResults.value = [];
		state.showCardControls.value = false;
	}

	return {
		searchFormatQuery,
		searchFuzzyCardName,
		searchCardPrints,
		selectPreviewCard,
		selectMeldCardPart,
		controlPreviewCard,
		clearSearch,
		clearHistory,
		applyRemotePreview,
		resetPreviewState,
	};
}

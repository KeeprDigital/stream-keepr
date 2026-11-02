import type { MaybeRefOrGetter, Ref } from 'vue';
import type { OpCardCategory, OpCardColor, OpCardDetail, OpCardSummary, OpPrinting, OpScreenCard } from '~~/shared/types/card/op';
import type { OpCardSearchParams } from '~/composables/repositories/useOpCardRepository';
import { computed, toRaw, toValue } from 'vue';
import { parseOpCardNumber } from '~~/shared/utils/card/op';
import { createGuardedSequence } from '~/utils/guardedSequence';

export interface OpCardSearch {
	/** Name or card text, or a card number such as `OP01-001`. */
	text: string;
	color?: OpCardColor | null;
	category?: OpCardCategory | null;
}

interface OpSpotlightRuntimeState {
	eventId: MaybeRefOrGetter<number | null | undefined>;
	activeScreenId: Ref<number | null>;
	cardTimeoutSeconds: MaybeRefOrGetter<number | null | undefined>;
	showCardControls: Ref<boolean>;
	autoShowSelectedCard: Ref<boolean>;
	searching: Ref<boolean>;
	results: Ref<OpCardSummary[]>;
	/** `null` until bandai-keepr has answered; `false` while this installation has none configured. */
	available: Ref<boolean | null>;
	searchError: Ref<string | null>;
	previewCard: Ref<OpScreenCard | null>;
	previewDetail: Ref<OpCardDetail | null>;
	selectionHistory: Ref<OpScreenCard[]>;
	saveActiveCard: (card: OpScreenCard) => Promise<unknown>;
}

const SEARCH_FAILED = 'Card search failed. Try again.';

/**
 * One Piece Card Spotlight Module: search through the Event's bandai-keepr
 * proxy, the Printing picker, the preview, and its Card History (ADR-0057).
 *
 * An OP card is shown as printed: it has no flip, rotate, turn-over or meld.
 * Showing it saves it as the Screen Card, with the Event's Card Timeout,
 * through the same save every Screen Card takes.
 */
export function useOpSpotlightRuntime(state: OpSpotlightRuntimeState) {
	const { searchCards, lookupCard } = useOpCardRepository();
	const { getServerTime } = useServerTime();
	const searches = createGuardedSequence();
	const lookups = createGuardedSequence();
	let searchController: AbortController | null = null;

	const previewPrintings = computed<OpPrinting[]>(() => state.previewDetail.value?.printings ?? []);

	function searchParams(search: OpCardSearch): OpCardSearchParams {
		const params: OpCardSearchParams = {};
		const text = search.text.trim();
		const number = parseOpCardNumber(text);
		if (number)
			params.number = number;
		else if (text)
			params.q = text;
		if (search.color)
			params.color = search.color;
		if (search.category)
			params.category = search.category;
		return params;
	}

	async function search(search: OpCardSearch) {
		const eventId = toValue(state.eventId);
		if (!eventId)
			return;
		const flight = searches.begin();
		searchController?.abort();
		const controller = new AbortController();
		searchController = controller;
		state.searching.value = true;
		try {
			const answer = await searchCards(eventId, searchParams(search), controller.signal);
			if (!flight.current)
				return;
			state.available.value = answer.available;
			state.results.value = answer.available
				? answer.items
				: [];
			state.searchError.value = null;
		}
		catch {
			if (!flight.current)
				return;
			state.results.value = [];
			state.searchError.value = SEARCH_FAILED;
		}
		finally {
			if (flight.current) {
				state.searching.value = false;
				searchController = null;
			}
		}
	}

	/** Load a Card's Printings; answers whether the lookup is still the latest and found the Card. */
	async function loadDetail(number: string): Promise<OpCardDetail | null> {
		const eventId = toValue(state.eventId);
		if (!eventId)
			return null;
		const flight = lookups.begin();
		try {
			const answer = await lookupCard(eventId, number);
			if (!flight.current)
				return null;
			if (!answer.available) {
				state.available.value = false;
				return null;
			}
			state.previewDetail.value = answer.card;
			return answer.card;
		}
		catch {
			if (flight.current)
				state.searchError.value = SEARCH_FAILED;
			return null;
		}
	}

	function screenCardOf(card: OpCardDetail, printing: OpPrinting): OpScreenCard {
		return {
			game: 'op',
			id: printing.id,
			number: card.number,
			name: card.name,
			set: printing.setId,
			printingKind: printing.kind,
			imageUrl: printing.imageUrl,
		};
	}

	function pushToHistory(card: OpScreenCard) {
		const history = state.selectionHistory.value.filter(entry => entry.number !== card.number);
		state.selectionHistory.value = [
			{
				...toRaw(card),
			},
			...history,
		];
	}

	async function preview(card: OpScreenCard) {
		state.previewCard.value = card;
		pushToHistory(card);
		if (state.autoShowSelectedCard.value && state.activeScreenId.value !== null)
			await showPreviewCard();
	}

	/** Preview a searched Card at its own Printing, and offer every Printing it has. */
	async function selectCard(card: OpCardSummary) {
		state.showCardControls.value = !state.autoShowSelectedCard.value || state.activeScreenId.value === null;
		const detail = await loadDetail(card.number);
		const printing = detail?.printings.find(entry => entry.id === card.printingId) ?? detail?.printings[0];
		if (!detail || !printing)
			return;
		await preview(screenCardOf(detail, printing));
	}

	/** Preview the Printing a History entry holds, offering its Card's Printings again. */
	async function selectHistoryCard(card: OpScreenCard) {
		state.showCardControls.value = true;
		state.previewCard.value = { ...card };
		pushToHistory(card);
		if (state.previewDetail.value?.number !== card.number) {
			state.previewDetail.value = null;
			await loadDetail(card.number);
		}
	}

	/** Switch the preview to another Printing of the same Card. */
	function selectPrinting(printingId: string) {
		const detail = state.previewDetail.value;
		const printing = detail?.printings.find(entry => entry.id === printingId);
		if (!detail || !printing)
			return;
		const card = screenCardOf(detail, printing);
		state.previewCard.value = card;
		pushToHistory(card);
	}

	async function showPreviewCard() {
		const previewCard = state.previewCard.value;
		if (!previewCard)
			return;
		const card: OpScreenCard = {
			...toRaw(previewCard),
		};
		delete card.timeoutData;
		const timeoutSeconds = toValue(state.cardTimeoutSeconds);
		if (timeoutSeconds) {
			card.timeoutData = {
				timeoutDuration: timeoutSeconds * 1000,
				timeoutStartTimestamp: Math.round(getServerTime()),
			};
		}
		await state.saveActiveCard(card);
	}

	function clearPreview() {
		state.previewCard.value = null;
		state.showCardControls.value = false;
	}

	function clearHistory() {
		state.selectionHistory.value = [];
	}

	function reset() {
		searches.supersede();
		lookups.supersede();
		searchController?.abort();
		searchController = null;
		state.searching.value = false;
		state.results.value = [];
		state.available.value = null;
		state.searchError.value = null;
		state.previewCard.value = null;
		state.previewDetail.value = null;
	}

	return {
		previewPrintings,
		search,
		selectCard,
		selectHistoryCard,
		selectPrinting,
		showPreviewCard,
		clearPreview,
		clearHistory,
		reset,
	};
}

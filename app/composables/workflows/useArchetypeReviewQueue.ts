import type { Ref } from 'vue';
import type { PlayerDeckResponse, PlayerDeckSummaryResponse } from '~~/shared/types/metagame';
import type { Player } from '~/types';
import { isReviewedPlayerDeck } from '~~/shared/utils/playerDeck';

export type QueueFilter = 'unreviewed' | 'reviewed' | 'all';

export interface ReviewEntry {
	player: Player;
	deck: PlayerDeckSummaryResponse;
	displayName: string;
	displayColors: string | null;
}

interface ReviewAdvanceController {
	commit: () => void;
	cancel: () => void;
}

function isDeckReviewed(entry: ReviewEntry): boolean {
	return isReviewedPlayerDeck(entry.deck);
}

export function useArchetypeReviewQueue() {
	const playerStore = usePlayerStore();
	const eventStore = useEventStore();
	const playerDeckStore = usePlayerDeckStore();
	const { fetchDeck } = usePlayerDeckCache();

	const queueFilter = ref<QueueFilter>('unreviewed');
	/** The deck shown, by id: it stays shown while the Event holds it, whichever list it moves to. */
	const shownDeckId = ref<number | null>(null);
	/** The decks shown before this one, oldest first, and those gone back from, nearest last. */
	const shownBefore = ref<number[]>([]);
	const goneBackFrom = ref<number[]>([]);

	// ── Queue entries — stable, no async dependencies ──

	const allEntries = computed<ReviewEntry[]>(() => {
		const entries: ReviewEntry[] = [];
		const playersById = new Map(playerStore.players.map(player => [player.id, player]));
		for (const deck of playerDeckStore.decks) {
			const player = playersById.get(deck.playerId);
			if (!player)
				continue;
			entries.push({
				player,
				deck,
				displayName: deck.name,
				displayColors: deck.colors || null,
			});
		}

		entries.sort((a, b) => {
			const aReviewed = isDeckReviewed(a)
				? 1
				: 0;
			const bReviewed = isDeckReviewed(b)
				? 1
				: 0;
			if (aReviewed !== bReviewed)
				return aReviewed - bReviewed;
			// Reviewed decks run most recently reviewed first.
			if (aReviewed) {
				const byReview = new Date(b.deck.reviewedAt!).getTime() - new Date(a.deck.reviewedAt!).getTime();
				if (byReview !== 0)
					return byReview;
			}
			const byName = a.displayName.localeCompare(b.displayName);
			return byName !== 0
				? byName
				: a.player.name.localeCompare(b.player.name);
		});

		return entries;
	});

	/** Filtered queue based on the current queueFilter */
	const filteredQueue = computed<ReviewEntry[]>(() => {
		switch (queueFilter.value) {
			case 'unreviewed':
				return allEntries.value.filter(e => !isDeckReviewed(e));
			case 'reviewed':
				return allEntries.value.filter(e => isDeckReviewed(e));
			case 'all':
			default:
				return allEntries.value;
		}
	});

	const filteredCount = computed(() => filteredQueue.value.length);
	const currentEntry = computed(() => allEntries.value.find(entry => entry.deck.id === shownDeckId.value) ?? null);
	/** The shown deck's place in the filter's list, or -1 for a deck outside it. */
	const currentIndex = computed(() => filteredQueue.value.findIndex(entry => entry.deck.id === shownDeckId.value));

	/** Where the list resumes: the place of the deck last shown from it. */
	let listPlace = 0;
	watch(currentIndex, (index) => {
		if (index >= 0)
			listPlace = index;
	}, { immediate: true, flush: 'sync' });

	function deckIdAtListPlace(): number | null {
		const queue = filteredQueue.value;
		return queue[Math.min(listPlace, queue.length - 1)]?.deck.id ?? null;
	}

	// ── Deck loading — separate from queue entries to avoid circular reactivity ──

	/**
	 * Active deck for the current entry. Reset to null immediately on navigation;
	 * populated once fetchDeck resolves. Kept separate from allEntries so that
	 * updating it cannot cause currentEntry to re-evaluate and re-trigger the watcher.
	 */
	const activeDeck = ref<PlayerDeckResponse | null>(null);
	const deckLoading = ref(false);
	let activeDeckRequestId = 0;

	watch(currentEntry, async (entry) => {
		const requestId = ++activeDeckRequestId;
		if (!entry || !eventStore.eventId) {
			activeDeck.value = null;
			deckLoading.value = false;
			return;
		}

		deckLoading.value = true;
		const deck = await fetchDeck(entry.player.id, eventStore.eventId, entry.player.updatedAt, { deckId: entry.deck.id });
		if (requestId !== activeDeckRequestId)
			return;
		activeDeck.value = deck;
		deckLoading.value = false;
	}, { immediate: true });

	// A filter change keeps the deck shown when the new list holds it, and
	// otherwise shows that list's first deck, or none for an empty list.
	watch(queueFilter, () => {
		if (currentIndex.value >= 0)
			return;
		listPlace = 0;
		show(deckIdAtListPlace());
	});

	// Nothing shown: on load, or once the Event no longer holds the deck shown.
	watch([currentEntry, filteredQueue], ([entry]) => {
		if (!entry)
			shownDeckId.value = deckIdAtListPlace();
	}, { immediate: true });

	// ── Progress ──

	const totalDecks = computed(() => allEntries.value.length);
	const reviewedCount = computed(() =>
		allEntries.value.filter(e => isDeckReviewed(e)).length,
	);
	const progressPercent = computed(() => {
		if (totalDecks.value === 0)
			return 100;
		return Math.round((reviewedCount.value / totalDecks.value) * 100);
	});

	/** Count of reviewed decks per archetype id (for sorting the archetype picker). */
	const archetypePlayerCounts = computed(() => {
		const counts = new Map<number, number>();
		for (const deck of playerDeckStore.decks) {
			if (!deck.archetypeId)
				continue;
			counts.set(deck.archetypeId, (counts.get(deck.archetypeId) ?? 0) + 1);
		}
		return counts;
	});

	const holdsDeck = (deckId: number) => allEntries.value.some(entry => entry.deck.id === deckId);

	/** Shows a deck, or none, as a step the reviewer can go back from. */
	function show(deckId: number | null) {
		if (deckId === shownDeckId.value)
			return;
		if (currentEntry.value)
			shownBefore.value.push(currentEntry.value.deck.id);
		goneBackFrom.value = [];
		shownDeckId.value = deckId;
	}

	/** Takes the nearest deck the Event still holds off a history, dropping those it lost. */
	function takeHeld(history: Ref<number[]>): number | null {
		while (history.value.length > 0) {
			const deckId = history.value.pop()!;
			if (holdsDeck(deckId))
				return deckId;
		}
		return null;
	}

	/** The list's next deck: after the deck shown, or where the list was left for a deck outside it. */
	const nextInListDeckId = computed(() => {
		if (currentIndex.value < 0)
			return deckIdAtListPlace();
		return filteredQueue.value[currentIndex.value + 1]?.deck.id ?? null;
	});

	const canGoBack = computed(() => shownBefore.value.some(holdsDeck));
	const canAdvance = computed(() => goneBackFrom.value.some(holdsDeck) || nextInListDeckId.value != null);

	/** Retraces a step gone back from, then carries on through the list. */
	function advance() {
		const retraced = takeHeld(goneBackFrom);
		if (retraced == null) {
			if (nextInListDeckId.value != null)
				show(nextInListDeckId.value);
			return;
		}
		if (currentEntry.value)
			shownBefore.value.push(currentEntry.value.deck.id);
		shownDeckId.value = retraced;
	}

	/** Returns to the deck shown before this one, whichever list holds it now. */
	function goBack() {
		const before = takeHeld(shownBefore);
		if (before == null)
			return;
		if (currentEntry.value)
			goneBackFrom.value.push(currentEntry.value.deck.id);
		shownDeckId.value = before;
	}

	/**
	 * Shows a deck of the Event, in its list or not, leaving the filter alone.
	 * `history: false` is the page opening on the deck: no step to go back from.
	 */
	function jumpToDeck(deckId: number, { history = true }: { history?: boolean } = {}): boolean {
		if (!holdsDeck(deckId))
			return false;
		if (history)
			show(deckId);
		else
			shownDeckId.value = deckId;
		return true;
	}

	/**
	 * Names the deck a review moves on to before the review takes the deck shown
	 * out of its list. The deck shown stays shown until `commit`.
	 */
	function prepareAdvance(): ReviewAdvanceController {
		const nextDeckId = nextInListDeckId.value;

		return {
			commit() {
				const moveTo = nextDeckId != null && holdsDeck(nextDeckId)
					? nextDeckId
					: deckIdAtListPlace();
				deckLoading.value = moveTo != null && moveTo !== shownDeckId.value;
				show(moveTo);
			},
			cancel() {
				deckLoading.value = false;
			},
		};
	}

	return {
		queueFilter,
		currentIndex,
		allEntries,
		filteredQueue,
		filteredCount,
		currentEntry,
		activeDeck,
		deckLoading,
		totalDecks,
		reviewedCount,
		progressPercent,
		archetypePlayerCounts,
		canGoBack,
		canAdvance,
		advance,
		goBack,
		jumpToDeck,
		prepareAdvance,
	};
}

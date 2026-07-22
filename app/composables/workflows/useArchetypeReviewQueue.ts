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
	const currentIndex = ref(0);
	const pinnedDeckId = ref<number | null>(null);

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
			const aReviewed = isDeckReviewed(a) ? 1 : 0;
			const bReviewed = isDeckReviewed(b) ? 1 : 0;
			if (aReviewed !== bReviewed)
				return aReviewed - bReviewed;
			const byName = a.displayName.localeCompare(b.displayName);
			return byName !== 0 ? byName : a.player.name.localeCompare(b.player.name);
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
	const currentEntry = computed(() => {
		if (pinnedDeckId.value != null)
			return allEntries.value.find(entry => entry.deck.id === pinnedDeckId.value) ?? null;

		return filteredQueue.value[currentIndex.value] ?? null;
	});

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

	// Reset index when filter changes
	watch(queueFilter, () => {
		currentIndex.value = 0;
	});

	watch(filteredQueue, (queue) => {
		if (queue.length === 0) {
			currentIndex.value = 0;
			return;
		}

		if (currentIndex.value > queue.length - 1)
			currentIndex.value = queue.length - 1;
	});

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

	function advance(onNavigate?: () => void) {
		if (currentIndex.value < filteredCount.value - 1) {
			currentIndex.value++;
			onNavigate?.();
		}
	}

	function goBack(onNavigate?: () => void) {
		if (currentIndex.value > 0) {
			currentIndex.value--;
			onNavigate?.();
		}
	}

	function jumpToDeck(deckId: number): boolean {
		let index = filteredQueue.value.findIndex(entry => entry.deck.id === deckId);
		if (index < 0) {
			queueFilter.value = 'all';
			index = filteredQueue.value.findIndex(entry => entry.deck.id === deckId);
		}
		if (index < 0)
			return false;
		currentIndex.value = index;
		return true;
	}

	function prepareAdvance(): ReviewAdvanceController {
		const pinnedId = currentEntry.value?.deck.id ?? null;
		const nextDeckId = filteredQueue.value[currentIndex.value + 1]?.deck.id ?? null;

		pinnedDeckId.value = pinnedId;

		return {
			commit() {
				deckLoading.value = nextDeckId != null;

				if (nextDeckId != null) {
					const nextIndex = filteredQueue.value.findIndex(entry => entry.deck.id === nextDeckId);
					currentIndex.value = nextIndex >= 0
						? nextIndex
						: Math.max(Math.min(currentIndex.value, filteredQueue.value.length - 1), 0);
				}
				else {
					currentIndex.value = filteredQueue.value.length > 0
						? Math.min(currentIndex.value, filteredQueue.value.length - 1)
						: 0;
				}

				pinnedDeckId.value = null;
			},
			cancel() {
				deckLoading.value = false;
				pinnedDeckId.value = null;
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
		advance,
		goBack,
		jumpToDeck,
		prepareAdvance,
	};
}

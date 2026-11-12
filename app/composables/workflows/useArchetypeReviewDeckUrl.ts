import type { Ref } from 'vue';
import type { useArchetypeReviewQueue } from './useArchetypeReviewQueue';

interface UseArchetypeReviewDeckUrlOptions {
	/** True until the Event's Players, Archetypes and decks have loaded. */
	loading: Ref<boolean>;
	queue: Pick<ReturnType<typeof useArchetypeReviewQueue>, 'currentEntry' | 'jumpToDeck'>;
}

/**
 * Keeps Archetype Review's `deckId` query and the deck it shows the same deck.
 * A URL that changes asks for its deck: on arrival, or when a link is followed
 * while the page is open. After that the deck shown writes the URL, replacing
 * the entry, so a reload reopens it. The queue's data changing asks for nothing.
 */
export function useArchetypeReviewDeckUrl({ loading, queue }: UseArchetypeReviewDeckUrlOptions) {
	const route = useRoute();
	const router = useRouter();

	const requestedDeckId = computed(() => {
		const raw = Array.isArray(route.query.deckId)
			? route.query.deckId[0]
			: route.query.deckId;
		const deckId = Number(raw);
		return raw && Number.isInteger(deckId)
			? deckId
			: null;
	});
	const shownDeckId = computed(() => queue.currentEntry.value?.deck.id ?? null);

	/** The URL's deck as last read or written here; `undefined` until the first read. */
	let reconciledDeckId: number | null | undefined;

	watch([loading, requestedDeckId, shownDeckId], ([isLoading, requested]) => {
		if (isLoading)
			return;

		if (requested !== reconciledDeckId) {
			reconciledDeckId = requested;
			if (requested != null && requested !== shownDeckId.value)
				queue.jumpToDeck(requested);
		}

		const shown = shownDeckId.value;
		if (shown === requested)
			return;
		reconciledDeckId = shown;
		const { deckId: _deckId, ...query } = route.query;
		void router.replace({
			query: shown == null
				? query
				: {
						...query,
						deckId: String(shown),
					},
		});
	}, { immediate: true });
}

import type { MaybeRefOrGetter } from 'vue';
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * What holds each of an Event's Archetypes: the Deck Lists assigned to it, and
 * so which Archetypes are empty. It loads the Archetypes, decks and Players it
 * reads, and finds none empty until all three have loaded.
 */
export function useArchetypeHoldings(eventId: MaybeRefOrGetter<number>) {
	const archetypeStore = useArchetypeStore();
	const playerDeckStore = usePlayerDeckStore();
	const playerStore = usePlayerStore();

	useConsumedEventData(['archetypes', 'playerDecks', 'players']);

	onMounted(async () => {
		const id = toValue(eventId);
		await Promise.allSettled([
			archetypeStore.isLoaded || archetypeStore.loadByEventId(id),
			playerDeckStore.isLoaded || playerDeckStore.loadByEventId(id),
			playerStore.isLoaded || playerStore.loadPlayersByEventId(id),
		]);
	});

	const deckCounts = computed(() => {
		const counts = new Map<number, number>();
		for (const deck of playerDeckStore.decks) {
			if (deck.archetypeId != null)
				counts.set(deck.archetypeId, (counts.get(deck.archetypeId) ?? 0) + 1);
		}
		return counts;
	});

	function deckCountOf(archetypeId: number) {
		return deckCounts.value.get(archetypeId) ?? 0;
	}

	/**
	 * The Empty Archetypes: no Deck List is assigned to them. One a Player holds
	 * with no Deck List has a Pilot, and the server keeps it too.
	 */
	const emptyArchetypes = computed(() => {
		if (!archetypeStore.isLoaded || !playerDeckStore.isLoaded || !playerStore.isLoaded)
			return [];
		const heldByPlayers = new Set(playerStore.players.map(player => player.archetypeId));
		return archetypeStore.archetypes.filter(archetype => deckCountOf(archetype.id) === 0 && !heldByPlayers.has(archetype.id));
	});

	return { deckCountOf, emptyArchetypes };
}

/** "1 deck", "3 decks". */
export function countOf(count: number, noun: string) {
	return `${count} ${noun}${count === 1
		? ''
		: 's'}`;
}

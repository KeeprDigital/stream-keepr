import { onScopeDispose } from 'vue';
import { useMeleeDataRefresh } from '~/composables/workflows/useMeleeDataRefresh';

/** The authoritative Event Data a client-side consumer can name as what it reads. */
export type ConsumedEventData
	= | 'event'
		| 'players'
		| 'phases'
		| 'rounds'
		| 'matches'
		| 'featureMatches'
		| 'archetypes'
		| 'playerLists'
		| 'playerDecks'
		| 'screens'
		| 'card';

/**
 * How one dataset is re-read in place. A reloader re-reads only what its store
 * holds, for the Event it holds it for, and never clears it first: a dataset
 * nothing has loaded is left for its consumer's own load.
 */
export type EventDataReloaders = Record<ConsumedEventData, () => unknown>;

/**
 * Event Data Resync: which Event Data this client consumes, so Reconnect Resync
 * re-reads exactly that.
 *
 * A consumer names the datasets it reads for as long as it is mounted, and
 * releases them on disposal. Coming back from a disconnection re-reads each
 * consumed dataset once, however many consumers share it. A dataset nobody
 * consumed then may still be held — a store outlives the page that loaded it —
 * so it is behind: the next consumer to name it re-reads it rather than finding
 * it loaded and trusting it. The end of an Event Lifetime forgets what was
 * behind, since nothing it held survives (ADR-0028).
 */
export function createEventDataResync(reloaders: EventDataReloaders) {
	const consumers = new Map<ConsumedEventData, number>();
	const behind = new Set<ConsumedEventData>();

	async function reload(datasets: Iterable<ConsumedEventData>) {
		await Promise.allSettled([...datasets].map(async dataset => reloaders[dataset]()));
	}

	/** Name what a consumer reads; the answer releases it. */
	function consume(datasets: readonly ConsumedEventData[]) {
		const named = [...new Set(datasets)];
		const caughtUp = named.filter(dataset => behind.delete(dataset));
		for (const dataset of named)
			consumers.set(dataset, (consumers.get(dataset) ?? 0) + 1);
		void reload(caughtUp);

		let released = false;
		return () => {
			if (released)
				return;
			released = true;
			for (const dataset of named) {
				const remaining = (consumers.get(dataset) ?? 1) - 1;
				if (remaining > 0)
					consumers.set(dataset, remaining);
				else
					consumers.delete(dataset);
			}
		};
	}

	async function resync() {
		for (const dataset of Object.keys(reloaders) as ConsumedEventData[]) {
			if (!consumers.has(dataset))
				behind.add(dataset);
		}
		await reload(consumers.keys());
	}

	function reset() {
		behind.clear();
	}

	return { consume, resync, reset };
}

/**
 * The reloaders for this client's stores, each re-reading only what its store
 * holds for the current Event.
 */
function storeReloaders(): EventDataReloaders {
	function forLoaded(store: () => { isLoaded: boolean }, load: (eventId: number) => unknown) {
		return () => {
			const eventId = useEventStore().eventId;
			if (eventId && store().isLoaded)
				return load(eventId);
		};
	}

	return {
		// The operator's Event. A rendering of a Screen holds none to re-read.
		event: () => {
			const eventStore = useEventStore();
			if (eventStore.event && eventStore.eventId === eventStore.event.id)
				return eventStore.loadEvent(eventStore.event.id);
		},
		players: forLoaded(usePlayerStore, eventId => usePlayerStore().loadPlayersByEventId(eventId)),
		phases: forLoaded(usePhaseStore, eventId => usePhaseStore().loadPhasesByEventId(eventId)),
		rounds: forLoaded(useRoundStore, eventId => useRoundStore().loadRoundsByEventId(eventId)),
		// Whichever scope is held — one Round's Matches or the Event's.
		matches: () => {
			const eventId = useEventStore().eventId;
			if (eventId)
				return useMeleeDataRefresh().refreshCurrentMatchScope(eventId);
		},
		featureMatches: forLoaded(useFeatureMatchStore, eventId => useFeatureMatchStore().loadFeatureMatchesByEventId(eventId)),
		archetypes: forLoaded(useArchetypeStore, eventId => useArchetypeStore().loadByEventId(eventId)),
		playerLists: forLoaded(usePlayerListStore, eventId => usePlayerListStore().loadByEventId(eventId)),
		playerDecks: forLoaded(usePlayerDeckStore, eventId => usePlayerDeckStore().loadByEventId(eventId)),
		screens: forLoaded(useScreenStore, eventId => useScreenStore().loadScreensByEventId(eventId)),
		// The selected Screen's Card, re-read without deselecting the Screen.
		card: () => {
			const cardStore = useCardStore();
			if (cardStore.activeScreenId !== null)
				return cardStore.loadActiveCard();
		},
	};
}

/** This client's Event Data Resync, which the Realtime Event Session runs on Reconnect Resync. */
export const eventDataResync = createEventDataResync(storeReloaders());

/** Name the Event Data this consumer reads until its scope is disposed. */
export function useConsumedEventData(datasets: readonly ConsumedEventData[]) {
	onScopeDispose(eventDataResync.consume(datasets));
}

import { onScopeDispose } from 'vue';
import { useMeleeDataRefresh } from '~/composables/workflows/useMeleeDataRefresh';

/** The authoritative Event Data a client-side consumer can name as what it reads. */
export type ConsumedEventData
	= | 'event'
		| 'players'
		| 'phases'
		| 'rounds'
		| 'matches'
		| 'featureMatchSlots'
		| 'archetypes'
		| 'playerLists'
		| 'playerDecks'
		| 'screens'
		| 'card';

/**
 * How one dataset is re-read in place. A reloader re-reads only what its store
 * holds, for the Event it holds it for, and never clears it first: a dataset
 * nothing has loaded is left for its consumer's own load. It answers `false`, or
 * fails, when its re-read did not land.
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
	const ownRereads = new Set<() => unknown>();
	// Which Event Lifetime a re-read began in, so one answered after a reset
	// marks nothing behind in the next.
	let lifetime = 0;

	/** Re-read each dataset; one whose re-read did not land stays behind. */
	async function reload(datasets: Iterable<ConsumedEventData>) {
		const named = [...datasets];
		const began = lifetime;
		const outcomes = await Promise.allSettled(named.map(async dataset => reloaders[dataset]()));
		if (began !== lifetime)
			return;
		outcomes.forEach((outcome, index) => {
			if (outcome.status === 'rejected' || outcome.value === false)
				behind.add(named[index]!);
		});
	}

	/**
	 * Name what a consumer reads; the answer releases it. A consumer that also
	 * reads what no store holds — a page's own summary — passes that re-read too.
	 * It dies with the consumer, so it is never behind.
	 */
	function consume(datasets: readonly ConsumedEventData[], reread?: () => unknown) {
		const named = [...new Set(datasets)];
		if (reread)
			ownRereads.add(reread);
		const caughtUp = named.filter(dataset => behind.delete(dataset));
		for (const dataset of named)
			consumers.set(dataset, (consumers.get(dataset) ?? 0) + 1);
		void reload(caughtUp);

		let released = false;
		return () => {
			if (released)
				return;
			released = true;
			if (reread)
				ownRereads.delete(reread);
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
		await Promise.all([
			reload(consumers.keys()),
			Promise.allSettled([...ownRereads].map(async reread => reread())),
		]);
	}

	function reset() {
		lifetime++;
		behind.clear();
	}

	return { consume, resync, reset };
}

/**
 * The reloaders for this client's stores, each re-reading only what its store
 * holds for the current Event.
 *
 * A loaded store holds the current Event's data because `resetAllEventStores()`
 * unloads every store before the Event changes, so being loaded is the check.
 */
export function storeReloaders(): EventDataReloaders {
	/** A collection load answers `null` when it did not land. */
	function forLoaded<S extends { isLoaded: boolean }>(useStore: () => S, load: (store: S, eventId: number) => Promise<unknown>) {
		return async () => {
			const eventId = useEventStore().eventId;
			const store = useStore();
			if (eventId && store.isLoaded)
				return await load(store, eventId) !== null;
		};
	}

	return {
		// The operator's Event. A rendering of a Screen holds none to re-read.
		event: () => {
			const eventStore = useEventStore();
			if (eventStore.event && eventStore.eventId === eventStore.event.id)
				return eventStore.loadEvent(eventStore.event.id);
		},
		players: forLoaded(usePlayerStore, (store, eventId) => store.loadPlayersByEventId(eventId)),
		phases: forLoaded(usePhaseStore, (store, eventId) => store.loadPhasesByEventId(eventId)),
		rounds: forLoaded(useRoundStore, (store, eventId) => store.loadRoundsByEventId(eventId)),
		// Whichever scope is held — one Round's Matches or the Event's.
		matches: () => {
			const eventId = useEventStore().eventId;
			if (eventId)
				return useMeleeDataRefresh().refreshCurrentMatchScope(eventId);
		},
		featureMatchSlots: forLoaded(useFeatureMatchStore, (store, eventId) => store.loadFeatureMatchesByEventId(eventId)),
		archetypes: forLoaded(useArchetypeStore, (store, eventId) => store.loadByEventId(eventId)),
		playerLists: forLoaded(usePlayerListStore, (store, eventId) => store.loadByEventId(eventId)),
		playerDecks: forLoaded(usePlayerDeckStore, (store, eventId) => store.loadByEventId(eventId)),
		screens: forLoaded(useScreenStore, (store, eventId) => store.loadScreensByEventId(eventId)),
		// The selected Screen's Card, re-read without deselecting the Screen. A read
		// of no Card lands; a failed or superseded one does not (#726).
		card: async () => {
			const cardStore = useCardStore();
			if (cardStore.activeScreenId !== null)
				return await cardStore.loadActiveCard() === 'landed';
		},
	};
}

/** This client's Event Data Resync, which the Realtime Event Session runs on Reconnect Resync. */
export const eventDataResync = createEventDataResync(storeReloaders());

/**
 * Name the Event Data this consumer reads until its scope is disposed, and its
 * own re-read of anything it reads outside the stores.
 */
export function useConsumedEventData(datasets: readonly ConsumedEventData[], reread?: () => unknown) {
	onScopeDispose(eventDataResync.consume(datasets, reread));
}

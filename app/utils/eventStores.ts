import { resetRegisteredEventDataLifecycles } from '~/modules/event-data/lifecycle';

/**
 * Reset all event-scoped stores and clear the player-deck cache.
 * Called whenever the active event changes, is deleted, or the user navigates away.
 *
 * Event Data lifecycle stores register their own reset functions; stores below
 * are still explicit until they move behind that seam.
 */
function resetStore(store: { $reset?: () => void }) {
	store.$reset?.();
}

type PendingEditFlush = () => void;

const pendingEditFlushes = new Set<PendingEditFlush>();

/**
 * Register a debounced write to be spent before Event-scoped state is discarded.
 *
 * A local-first surface applies an edit the moment it is made and writes it a few
 * hundred milliseconds later, so between those two moments the operator has been
 * told a change is saved that is not. The route middleware resets these stores
 * ahead of the page unmounting, so a surface that waited for its own disposal to
 * flush found the state its write needs already gone — the edit was lost and
 * nothing reported it (#308).
 *
 * Returns the unregistration, which callers run on scope dispose.
 */
export function registerPendingEditFlush(flush: PendingEditFlush) {
	pendingEditFlushes.add(flush);
	return () => pendingEditFlushes.delete(flush);
}

export function resetAllEventStores() {
	// Before anything is torn down: every layer below this one reads state these
	// resets are about to clear.
	for (const flush of [...pendingEditFlushes])
		flush();
	resetRegisteredEventDataLifecycles();
	resetStore(useEventStore());
	resetStore(useMetagameStore());
	resetStore(useFeatureMatchAssignmentStore());
	resetStore(useFeatureMatchStateStore());
	resetStore(useScreenStore());
	resetStore(useCardStore());
	resetStore(useMeleeStore());
	resetStore(usePlayerDeckStore());
	clearPlayerDeckCache();
}

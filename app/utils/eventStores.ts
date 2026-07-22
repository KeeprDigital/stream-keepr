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

export function resetAllEventStores() {
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

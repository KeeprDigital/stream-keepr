import { eventKind, isOfferedToEvent } from '~~/shared/config/games';
import { isScreenOutputPage } from '~/modules/auth/pageGate';
import { resetAllEventStores } from '~/utils/eventStores';

export default defineNuxtRouteMiddleware(async (to) => {
	// Asked first: everything below may reset the Event an open modal's unsaved
	// edit saves against, and "Keep editing" has to find that Event still held.
	if (!(await confirmDiscardInOpenModals()))
		return false;

	// A Screen Output holds no Session, so the operator's Event read would refuse
	// it and this would send program to the home page and on to sign-in (#604).
	// The output's display session loads the Event context its capability admits.
	if (isScreenOutputPage(to.path))
		return;

	const eventStore = useEventStore();
	const eventId = Number.parseInt(to.params.eventId as string);

	if (to.path.startsWith('/event/')) {
		if (!eventId || eventId < 1) {
			return navigateTo('/');
		}

		if (!eventStore.event?.id || eventStore.event.id !== eventId) {
			// Reset all stores when switching between events or loading a new one
			resetAllEventStores();

			try {
				await eventStore.loadEvent(eventId);
			}
			catch (err) {
				// Safety net for errors thrown outside executeAction (e.g. network failure)
				console.error('[event.global] Unexpected error loading event:', err);
			}

			if (!eventStore.event) {
				return navigateTo('/');
			}
		}

		// A page this Event is not offered, such as Matches on a One Piece Card
		// Game Event (ADR-0057) or Players on a Commander Event (ADR-0087), gives
		// way to the Event overview.
		if (to.meta.offeredTo && !isOfferedToEvent(to.meta.offeredTo, eventKind(eventStore.event))) {
			return navigateTo(`/event/${eventId}`);
		}
	}
	else {
		resetAllEventStores();
	}
});

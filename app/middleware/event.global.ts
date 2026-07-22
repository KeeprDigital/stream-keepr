import { resetAllEventStores } from '~/utils/eventStores';

export default defineNuxtRouteMiddleware(async (to) => {
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
	}
	else {
		resetAllEventStores();
	}
});

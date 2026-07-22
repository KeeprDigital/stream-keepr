export default defineNuxtRouteMiddleware((to) => {
	const eventStore = useEventStore();
	const eventId = Number.parseInt(to.params.eventId as string);

	if (!eventId) {
		return navigateTo('/');
	}

	const ev = eventStore.event;
	if (!ev?.meleeEnabled || !ev?.meleeConfigured) {
		return navigateTo(`/event/${eventId}/config/integrations`);
	}
});

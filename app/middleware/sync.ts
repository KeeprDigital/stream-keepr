export default defineNuxtRouteMiddleware((to) => {
	const eventStore = useEventStore();
	const eventId = Number.parseInt(to.params.eventId as string);

	if (!eventId) {
		return navigateTo('/');
	}

	const ev = eventStore.event;
	// A One Piece Card Game Event's Sync is its TCG+ Import, which needs no Melee (ADR-0074).
	if (ev?.game === 'op')
		return;
	if (!ev?.meleeEnabled || !ev?.meleeConfigured) {
		return navigateTo(`/event/${eventId}/config/integrations`);
	}
});

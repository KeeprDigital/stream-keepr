import { computed } from 'vue';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { useRealtimeMessageGate } from '~/composables/core/useRealtimeMessageGate';
import { createEventRealtimeHandlers } from '~/modules/realtime-event-session/handlers';

let sessionActive = false;

export function useEventRealtimeSession() {
	if (sessionActive)
		return;

	sessionActive = true;

	const realtime = useRealtime();
	const eventStore = useEventStore();

	const { accept } = useRealtimeMessageGate(computed(() => realtime.connectionId));

	realtime.onRoom('event-session', createEventRealtimeHandlers({ accept, eventStore, realtime }));

	watch(
		() => eventStore.eventId,
		(eventId) => {
			// The transport scopes its token to the room's Event internally, so
			// an event switch is just a room change.
			realtime.setRoom(eventId ? eventRealtimeChannel(eventId) : null);
		},
		{ immediate: true },
	);

	onScopeDispose(() => {
		realtime.offRoom('event-session');
		realtime.setRoom(null);
		sessionActive = false;
	});
}

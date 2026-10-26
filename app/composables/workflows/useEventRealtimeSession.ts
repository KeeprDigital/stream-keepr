import { computed } from 'vue';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { useRealtimeMessageGate } from '~/composables/core/useRealtimeMessageGate';
import { clearPlayerDeckCache } from '~/composables/data/usePlayerDeckCache';
import { eventDataResync } from '~/modules/event-data/resync';
import { createEventRealtimeHandlers } from '~/modules/realtime-event-session/handlers';

let sessionActive = false;

export function useEventRealtimeSession() {
	if (sessionActive)
		return;

	sessionActive = true;

	const realtime = useRealtime();
	const eventStore = useEventStore();
	const featureMatchAssignmentStore = useFeatureMatchAssignmentStore();
	const broadcastDeckListStore = useBroadcastDeckListStore();

	const { accept } = useRealtimeMessageGate(computed(() => realtime.connectionId));

	realtime.onRoom('event-session', createEventRealtimeHandlers({ accept, eventStore, realtime }));
	function resync() {
		// The cache is keyed by Player revision, which a resolved deck card does not
		// move (#648), so a resolution missed meanwhile could otherwise stay cached.
		clearPlayerDeckCache();
		void Promise.allSettled([
			featureMatchAssignmentStore.reloadConsumedRounds(),
			broadcastDeckListStore.reloadAuthoritativeState(),
			eventDataResync.resync(),
		]);
	}
	useReconnectResync(resync, () => eventStore.eventId, realtime);
	// Subscriptions that waited on a token missed what was published meanwhile,
	// and a first attach over an unbroken connection reports no continuity loss
	// (ADR-0023).
	watch(() => !!realtime.tokenError, (waiting, wasWaiting) => {
		if (wasWaiting && !waiting)
			resync();
	});

	watch(
		() => eventStore.eventId,
		(eventId) => {
			// The transport scopes its token to the room's Event internally, so
			// an event switch is just a room change.
			realtime.setRoom(eventId
				? eventRealtimeChannel(eventId)
				: null);
		},
		{ immediate: true },
	);

	onScopeDispose(() => {
		realtime.offRoom('event-session');
		realtime.setRoom(null);
		sessionActive = false;
	});
}

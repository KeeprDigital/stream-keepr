import { computed } from 'vue';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { useRealtimeMessageGate } from '~/composables/core/useRealtimeMessageGate';
import { clearPlayerDeckCache } from '~/composables/data/usePlayerDeckCache';
import { eventDataResync } from '~/modules/event-data/resync';
import { createEventRealtimeHandlers } from '~/modules/realtime-event-session/handlers';

let sessionActive = false;

/**
 * The Realtime Event Session: the Event room and every Event Data handler.
 *
 * Its room is the operator's Event, or an editor preview's. A Screen Output and
 * a Program monitor join no room and run none of these handlers: each follows
 * only its own Screen's channel (`useScreenChannelSession`), which the server
 * tells of exactly what that Screen shows.
 */
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
	const room = () => eventStore.roomEventId
		? eventRealtimeChannel(eventStore.roomEventId)
		: null;
	function resync() {
		// A live rendering is in no room and holds none of this.
		if (!room())
			return;
		// The cache is keyed by Player revision, which a resolved deck card does not
		// move (#648), so a resolution missed meanwhile could otherwise stay cached.
		clearPlayerDeckCache();
		void Promise.allSettled([
			featureMatchAssignmentStore.reloadConsumedRounds(),
			broadcastDeckListStore.reloadAuthoritativeState(),
			eventDataResync.resync(),
		]);
	}
	useReconnectResync(resync, room, realtime);
	// Subscriptions that waited on a token missed what was published meanwhile,
	// and a first attach over an unbroken connection reports no continuity loss
	// (ADR-0023).
	watch(() => !!realtime.tokenError, (waiting, wasWaiting) => {
		if (wasWaiting && !waiting)
			resync();
	});

	watch(
		room,
		(channel) => {
			// The transport scopes its token to the room's Event internally, so
			// an event switch is just a room change.
			realtime.setRoom(channel);
		},
		{ immediate: true },
	);

	onScopeDispose(() => {
		realtime.offRoom('event-session');
		realtime.setRoom(null);
		sessionActive = false;
	});
}

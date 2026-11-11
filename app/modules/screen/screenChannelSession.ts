import type { MessageType } from '~~/shared/types/messages';
import type { useScreenStore } from '~/stores/screen';
import type { RealtimeHandler, RealtimeTransport } from '~/types/realtime';
import { computed, watch } from 'vue';
import { useRealtimeMessageGate } from '~/composables/core/useRealtimeMessageGate';
import { useBroadcastGraphicsLiveSessionStore } from '~/stores/broadcastGraphicsLiveSession';
import { useCardStore } from '~/stores/card';
import { useFeatureMatchStateStore } from '~/stores/featureMatchState';

/**
 * The messages a Screen's own channel carries whole to its live renderings,
 * beside the two notices Screen Mode Data Freshness and the display session
 * answer by re-reading (`server/modules/screen-output-publication`).
 */
type ScreenChannelMessageType
	= | 'screen:updated'
		| 'screen:deleted'
		| 'card:updated'
		| 'card:cleared'
		| 'featureMatchSession:eventApplied'
		| 'broadcastGraphicsLiveSession:commandApplied'
		| 'broadcastGraphicsLiveSession:epochEnded'
		| 'output:eventContextChanged';

interface ScreenChannelSessionOptions {
	realtime: Pick<RealtimeTransport, 'onChannel' | 'connectionId'>;
	/** The store holding the Screen the rendering shows. */
	screenStore: Pick<ReturnType<typeof useScreenStore>, 'applyRemoteUpdated' | 'applyRemoteDeleted'>;
	/** The Screen channel the rendering follows, or `null` while it follows none. */
	channel: () => string | null;
	/** The Event context the Screen renders in changed: its Event, or the Event's Theme. */
	onEventContextChanged: () => void;
}

/**
 * A live rendering's whole realtime session: what its Screen's own channel
 * tells it, and nothing from its Event's.
 *
 * Each message is one its Screen's own read answers the same, so it is applied
 * as the Realtime Event Session applies it for an operator: the Screen is
 * re-read by id, its Card and Broadcast Graphics Live Session messages reach
 * their stores, and the Feature Match Session of the Slot it shows goes to the
 * Live State Follower at the sequence the Event's carried. Every other change
 * reaches a rendering as a cause to re-read on, never as a record to hold.
 *
 * A message this client's own command caused is skipped, as in the Event room:
 * a control Screen already holds its answer.
 */
export function useScreenChannelSession(options: ScreenChannelSessionOptions) {
	const { realtime, screenStore } = options;
	const { accept } = useRealtimeMessageGate(computed(() => realtime.connectionId));

	const handlers: { [K in ScreenChannelMessageType]: RealtimeHandler<K> } = {
		'screen:updated': accept('screen:updated', data => screenStore.applyRemoteUpdated(data)),
		'screen:deleted': accept('screen:deleted', data => screenStore.applyRemoteDeleted(data)),
		'card:updated': accept('card:updated', data => useCardStore().applyRemoteUpdated(data)),
		'card:cleared': accept('card:cleared', data => useCardStore().applyRemoteCleared(data)),
		'featureMatchSession:eventApplied': accept('featureMatchSession:eventApplied', data => useFeatureMatchStateStore().applyRemoteSessionEvent(data)),
		'broadcastGraphicsLiveSession:commandApplied': accept(
			'broadcastGraphicsLiveSession:commandApplied',
			data => useBroadcastGraphicsLiveSessionStore().applyRemoteCommand(data),
		),
		'broadcastGraphicsLiveSession:epochEnded': accept(
			'broadcastGraphicsLiveSession:epochEnded',
			data => useBroadcastGraphicsLiveSessionStore().applyEpochEnded(data),
		),
		'output:eventContextChanged': accept('output:eventContextChanged', () => options.onEventContextChanged()),
	};

	watch(options.channel, (channel, _previous, onCleanup) => {
		if (!channel)
			return;
		const stops = (Object.keys(handlers) as ScreenChannelMessageType[]).map(type =>
			realtime.onChannel(channel, type, handlers[type] as RealtimeHandler<MessageType>));
		onCleanup(() => {
			for (const stop of stops)
				stop();
		});
	}, { immediate: true });
}

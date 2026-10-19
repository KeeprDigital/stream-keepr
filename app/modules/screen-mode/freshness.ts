import type { Ref } from 'vue';
import type { MessageType } from '~~/shared/types/messages';
import type { MessageData, RealtimeTransport } from '~/types/realtime';
import { computed, onScopeDispose, watch } from 'vue';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { tryUseRealtime } from '~/composables/core/useRealtime';
import { useReconnectResync } from '~/composables/core/useReconnectResync';
import { useBroadcastDisplayData } from '~/composables/screen/useBroadcastDisplayData';

/**
 * How often a mode re-reads while realtime cannot tell it about changes. Well
 * under the transport's own 30 s recovery cadence (ADR-0023): this is what
 * keeps program current while that recovery waits.
 */
export const SCREEN_MODE_DEGRADED_REFETCH_MS = 15_000;

/**
 * Whether one Event message touches what a mode holds, per message type. `true`
 * means every such message does.
 */
export type ScreenModeDependencies<T> = {
	[K in MessageType]?: true | ((message: MessageData<K>, held: T) => boolean);
};

export type ScreenModeFreshnessTransport = Pick<RealtimeTransport, 'connectionState' | 'tokenError' | 'onChannel' | 'onContinuityLost'>;

export interface ScreenModeFreshnessOptions<T> {
	eventId: Readonly<Ref<number | null>>;
	/**
	 * What the mode reads, as one comparable value; `null` while it selects
	 * nothing, which clears what it holds. A change re-reads.
	 */
	source: () => string | null;
	/** The authoritative read. Realtime messages only say when to repeat it. */
	read: () => Promise<T>;
	initialData: T;
	errorMessage: string;
	/** The Event Data the mode depends on. */
	dependsOn: ScreenModeDependencies<T>;
	realtime?: ScreenModeFreshnessTransport;
}

/**
 * Screen Mode Data Freshness: keeps one mode's read current on a Screen Output.
 *
 * A mode states what it reads and the Event Data it depends on; this owns every
 * reason to read again, so no mode invents its own:
 *
 * - **load** — when what the mode selects changes;
 * - **live-follow** — on an Event message the mode depends on that touches
 *   what it holds, heard on the Event channel itself because an output holds
 *   no roster or Event Data collection for a store to update (#604);
 * - **degraded refetch** — on a slow cadence while realtime cannot deliver:
 *   disconnected, or connected with subscriptions waiting on a token for the
 *   one Event the transport covers (ADR-0023). It re-reads, never
 *   re-registers: holding subscriptions through an outage is the transport's;
 * - **Reconnect Resync** — once on coming back from either, because what was
 *   published meanwhile is gone.
 *
 * Every read is stale-while-revalidate: a rendering holds what it shows until a
 * newer read answers, and a failed re-read never blanks program.
 */
export function useScreenModeFreshness<T>(options: ScreenModeFreshnessOptions<T>) {
	const realtime = options.realtime ?? tryUseRealtime();
	const display = useBroadcastDisplayData<T>({ initialData: options.initialData });
	let refreshQueued = false;

	function refresh() {
		if (options.source() == null) {
			display.clear();
			return;
		}
		void display.refresh(options.read, options.errorMessage);
	}

	/** One read for however many reasons arrive together. */
	function queueRefresh() {
		if (refreshQueued)
			return;
		refreshQueued = true;
		queueMicrotask(() => {
			refreshQueued = false;
			refresh();
		});
	}

	watch(options.source, refresh, { immediate: true });

	// Live-follow.
	function touches<K extends MessageType>(type: K, message: MessageData<K>): boolean {
		const dependency = options.dependsOn[type] as ScreenModeDependencies<T>[K];
		if (options.source() == null || !dependency)
			return false;
		// What is held cannot judge a message the read in flight may predate.
		if (dependency === true || display.loading.value)
			return true;
		return dependency(message, display.data.value);
	}

	let unsubscribers: (() => void)[] = [];
	function unsubscribe() {
		for (const stop of unsubscribers.splice(0))
			stop();
	}

	watch(options.eventId, (eventId) => {
		unsubscribe();
		if (!realtime || !eventId)
			return;
		const channel = eventRealtimeChannel(eventId);
		unsubscribers = (Object.keys(options.dependsOn) as MessageType[]).map(type =>
			realtime.onChannel(channel, type, (message) => {
				if (touches(type, message))
					queueRefresh();
			}));
	}, { immediate: true });

	// Reconnect Resync, and its twin for subscriptions that waited on a token.
	const { disconnected } = useReconnectResync(
		queueRefresh,
		() => options.eventId.value ? eventRealtimeChannel(options.eventId.value) : null,
		realtime,
	);
	const waitingOnToken = computed(() => !!realtime?.tokenError);
	watch(waitingOnToken, (waiting, wasWaiting) => {
		if (wasWaiting && !waiting)
			queueRefresh();
	});

	// Degraded refetch.
	let cadence: ReturnType<typeof setInterval> | null = null;
	function stopCadence() {
		if (cadence !== null) {
			clearInterval(cadence);
			cadence = null;
		}
	}
	watch(() => disconnected.value || waitingOnToken.value, (degraded) => {
		stopCadence();
		if (degraded) {
			cadence = setInterval(queueRefresh, SCREEN_MODE_DEGRADED_REFETCH_MS);
		}
	}, { immediate: true });

	onScopeDispose(() => {
		unsubscribe();
		stopCadence();
	});

	return {
		data: display.data,
		loading: display.loading,
		error: display.error,
	};
}

import type { Ref } from 'vue';
import type { MessageType } from '~~/shared/types/messages';
import type { MessageData, RealtimeTransport } from '~/types/realtime';
import { computed, onScopeDispose, watch } from 'vue';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { tryUseRealtime } from '~/composables/core/useRealtime';
import { useReconnectResync } from '~/composables/core/useReconnectResync';
import { useBroadcastDisplayData } from '~/composables/screen/useBroadcastDisplayData';
import { createGuardedSequence } from '~/utils/guardedSequence';

/**
 * How often a mode re-reads while realtime cannot tell it about changes, or
 * after a read that failed. Well under the transport's own 30 s recovery
 * cadence (ADR-0023): this is what keeps program current while that recovery
 * waits.
 */
export const SCREEN_MODE_REREAD_MS = 15_000;

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
 *   published meanwhile is gone;
 * - **retry** — on the same slow cadence after the latest read failed, because
 *   the change that asked for it will not be announced again.
 *
 * Only a load supersedes the read in flight. Any other reason heard meanwhile
 * asks for one follow-up once it settles, so a burst costs at most one more
 * read however many messages it publishes.
 *
 * Every read is stale-while-revalidate: a rendering holds what it shows until a
 * newer read answers, and a failed re-read never blanks program.
 */
export function useScreenModeFreshness<T>(options: ScreenModeFreshnessOptions<T>) {
	const realtime = options.realtime ?? tryUseRealtime();
	const display = useBroadcastDisplayData<T>({ initialData: options.initialData });
	let refreshQueued = false;
	const reads = createGuardedSequence();
	let retry: ReturnType<typeof setTimeout> | null = null;

	function stopRetry() {
		if (retry !== null) {
			clearTimeout(retry);
			retry = null;
		}
	}

	/** Whether a read is in flight, and whether a reason arrived since it began. */
	let reading = false;
	let followUp = false;

	/** Reads now, superseding any read in flight. */
	function refresh() {
		stopRetry();
		followUp = false;
		reading = false;
		const flight = reads.begin();
		if (options.source() == null) {
			display.clear();
			return;
		}
		reading = true;
		void display.refresh(async () => {
			try {
				const answer = await options.read();
				// With nothing on program yet, an answer that predates a reason
				// would only make the follow-up a second rendering: it supersedes
				// this one instead, so its answer is the first shown (#567).
				if (flight.current && followUp && !display.hasDisplayedData.value)
					refresh();
				return answer;
			}
			catch (cause) {
				// Only the latest read's failure leaves program behind.
				if (flight.current)
					retry = setTimeout(queueRefresh, SCREEN_MODE_REREAD_MS);
				throw cause;
			}
		}, options.errorMessage).then(() => {
			if (flight.stale)
				return;
			reading = false;
			if (followUp)
				refresh();
		});
	}

	/**
	 * One read for however many reasons arrive together, and one follow-up for
	 * however many arrive while a read is in flight (#650).
	 */
	function queueRefresh() {
		if (reading) {
			followUp = true;
			return;
		}
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
	const { disconnected } = useReconnectResync(queueRefresh, options.eventId, realtime);
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
			cadence = setInterval(queueRefresh, SCREEN_MODE_REREAD_MS);
		}
	}, { immediate: true });

	onScopeDispose(() => {
		unsubscribe();
		stopCadence();
		stopRetry();
		reads.supersede();
	});

	return {
		data: display.data,
		loading: display.loading,
		error: display.error,
	};
}

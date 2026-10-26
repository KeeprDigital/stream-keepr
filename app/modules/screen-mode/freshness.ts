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

/**
 * Why a follow-up read is asked for while a read is in flight: a message, which
 * may postdate what that read answers, or the Event channel's first attach,
 * which says only that something may have been published unheard.
 */
type FollowUpReason = 'message' | 'first-attach';

export type ScreenModeFreshnessTransport = Pick<RealtimeTransport, 'connectionState' | 'tokenError' | 'onChannel' | 'onContinuityLost' | 'onceAttached'>;

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
 * - **first attach** — once when its Event channel first attaches, if it was
 *   not attached when the mode began listening: the mode's first read went out
 *   before anything listened, and that attach reports no continuity loss
 *   (ADR-0023, #733);
 * - **retry** — on the same slow cadence after the latest read failed, because
 *   the change that asked for it will not be announced again.
 *
 * A message or the first attach heard while a read is in flight asks for one
 * follow-up once that read settles rather than superseding it, so a burst
 * published one message at a time costs one more read per read in flight, not
 * one per message (#650).
 * Every other reason supersedes, as does a message heard once a read has run
 * for the slow cadence, since a read can hang where a reason must not.
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

	/** The read in flight: when it began, and whether a load asked for it. */
	let reading: { since: number; load: boolean } | null = null;
	/** What, since the read in flight began, asks for another once it settles. */
	let followUpAsked: FollowUpReason | null = null;

	/** Reads now, superseding any read in flight. */
	function refresh(load = false) {
		stopRetry();
		followUpAsked = null;
		reading = null;
		const flight = reads.begin();
		if (options.source() == null) {
			display.clear();
			return;
		}
		reading = {
			since: Date.now(),
			load,
		};
		void display.refresh(async () => {
			try {
				const answer = await options.read();
				// A load's answer that predates a message would only make the
				// follow-up a second rendering of the new selection: the follow-up
				// supersedes it, so its answer is the first shown (#567). Once,
				// so a steady stream of messages still renders. A first attach
				// does not: what the load answered is most likely current, so it
				// renders, and the follow-up only confirms it.
				if (flight.current && followUpAsked === 'message' && load)
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
			// The answer is applied: now the follow-up can start.
			if (flight.stale)
				return;
			reading = null;
			if (followUpAsked)
				refresh();
		});
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

	/** One follow-up for however many reasons arrive while a read is in flight. */
	function follow(reason: FollowUpReason) {
		if (reading && Date.now() - reading.since < SCREEN_MODE_REREAD_MS) {
			if (followUpAsked !== 'message')
				followUpAsked = reason;
		}
		else {
			queueRefresh();
		}
	}

	watch(options.source, () => refresh(true), { immediate: true });

	// Live-follow.
	function touches<K extends MessageType>(type: K, message: MessageData<K>): boolean {
		const dependency = options.dependsOn[type] as ScreenModeDependencies<T>[K];
		if (options.source() == null || !dependency)
			return false;
		// What is held cannot judge a message the read in flight may predate.
		if (dependency === true || reading)
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
					follow('message');
			}));
	}, { immediate: true });

	// Reconnect Resync, and its twin for subscriptions that waited on a token. A
	// mode reads as it mounts, which on a Screen Output's first load is before its
	// Event channel has attached: what was published in between was heard by
	// nothing, and that first attach reports no continuity loss (#733).
	const { disconnected } = useReconnectResync(queueRefresh, options.eventId, realtime, {
		onFirstAttach: () => {
			if (options.source() != null)
				follow('first-attach');
		},
	});
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
		/**
		 * Whether what the mode holds is a read's answer, or it selects nothing:
		 * false only while its first read is in flight. A mode judges "nothing to
		 * show" by this, not by `loading`, so an empty rendering does not flash its
		 * scaffold for the length of every re-read.
		 */
		answered: computed(() => display.hasDisplayedData.value || !display.loading.value),
		error: display.error,
	};
}

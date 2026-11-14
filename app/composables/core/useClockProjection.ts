import type { ComputedRef } from 'vue';

/** What a clock projection answers at one server instant. */
export interface ClockProjection<T> {
	value: T;
	/** How long until `value` next changes; null when it will not change on its own. */
	nextChangeInMs: number | null;
}

/** A projection whose answer itself says when it next changes: the answer is the value. */
export function selfTimed<T extends { nextChangeInMs: number | null }>(answer: T): ClockProjection<T> {
	return { value: answer, nextChangeInMs: answer.nextChangeInMs };
}

export interface ClockProjectionOptions<T> {
	/**
	 * What the projection answers while server time is unknown: `show` an answer
	 * without projecting, or project on the device's own time until the first sync.
	 */
	whileServerTimeUnknown: 'device-time' | { show: () => T };
}

/** The longest one timer waits; a change further off is waited for in steps of it. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * The scheduler every clock projection runs on (ADR-0088). `project` is a pure
 * function of server time, and of any reactive input it reads; its value is
 * answered anew exactly when it next changes, when such an input changes, and
 * when server time re-syncs or first becomes known. Timed from server time
 * rather than a free-running interval, so every rendering of one clock changes
 * together. Nothing is timed on the server, and the wait ends with its owner.
 */
export function useClockProjection<T>(
	project: (serverTime: number) => ClockProjection<T>,
	options: ClockProjectionOptions<T>,
): ComputedRef<T> {
	const { isSynced, serverTimeOffset, getServerTime } = useServerTime();
	const unknown = options.whileServerTimeUnknown;

	/** Advanced as the wait for the next change, or a step of it, runs out. */
	const tick = ref(0);

	const projection = computed<ClockProjection<T>>(() => {
		void tick.value;
		void serverTimeOffset.value;
		// `getServerTime` is itself reactive to a correction being eased in, so a
		// wait timed during one is taken again when it completes (ADR-0088).
		if (!isSynced.value && unknown !== 'device-time') {
			return {
				value: unknown.show(),
				nextChangeInMs: null,
			};
		}
		// A new object each time, so every answer takes its own wait.
		const { value, nextChangeInMs } = project(getServerTime());
		return { value, nextChangeInMs };
	});

	if (import.meta.client) {
		watch(projection, ({ nextChangeInMs }, _previous, onCleanup) => {
			if (nextChangeInMs == null)
				return;
			const timer = setTimeout(() => tick.value++, Math.min(Math.max(0, nextChangeInMs), MAX_TIMER_DELAY_MS));
			onCleanup(() => clearTimeout(timer));
		}, { immediate: true });
	}

	return computed(() => projection.value.value);
}

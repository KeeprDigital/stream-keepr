import type { MaybeRefOrGetter } from 'vue';
import type { ClockState } from '~~/shared/types/featureMatchState';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { clockDisplayNextChangeInMs, formatClockDisplay } from '~~/shared/utils/clock';

/**
 * Composable that encapsulates clock display logic:
 * tick tracking, formatted display time, color classes,
 * and expired/overtime/paused state detection.
 *
 * Shared between the admin Clock component and the
 * match control screen ClockBar.
 *
 * An untimed match shows the Event's Untimed Label in place of a time, and no
 * clock at all (`showsClock` false) while that label is blank.
 */
export function useClockDisplay(clock: MaybeRefOrGetter<ClockState | null>) {
	const { getServerTime } = useServerTime();
	const eventStore = useEventStore();

	const isUntimed = computed(() => toValue(clock)?.type === 'untimed');
	const untimedLabel = computed(() => toFeatureMatchDefaults(eventStore.displayEvent).untimedLabel.trim());
	const showsClock = computed(() => !isUntimed.value || untimedLabel.value !== '');

	/**
	 * What the clock shows and whether it has run out, re-evaluated as that next
	 * changes (ADR-0088). An output yet to sync counts on its own time rather than
	 * showing nothing.
	 */
	const shown = useClockProjection((serverTime) => {
		const held = toValue(clock);
		return {
			value: {
				displayTime: formatClockDisplay(held, serverTime, untimedLabel.value),
				isExpired: held?.type === 'countdown' && elapsedMsAt(held, serverTime) >= held.durationMs,
			},
			nextChangeInMs: held
				? clockDisplayNextChangeInMs(held, serverTime)
				: null,
		};
	}, { whileServerTimeUnknown: 'device-time' });

	function elapsedMsAt(c: ClockState, serverTime: number): number {
		let elapsedMs = c.elapsedMs;
		if (c.isRunning && c.lastStartedAt)
			elapsedMs += serverTime - c.lastStartedAt;
		return Math.max(0, elapsedMs);
	}

	function getElapsedMs(): number {
		const c = toValue(clock);
		if (!c)
			return 0;

		return elapsedMsAt(c, getServerTime());
	}

	function getRemainingMs(): number {
		const c = toValue(clock);
		if (!c)
			return 0;
		return Math.max(0, c.durationMs - getElapsedMs());
	}

	const isPaused = computed(() => {
		const c = toValue(clock);
		return c != null && !c.isRunning && c.elapsedMs > 0;
	});

	const isExpired = computed(() => shown.value.isExpired);

	const isInOvertime = computed(() => {
		const c = toValue(clock);
		return isExpired.value && (c?.countUpAfterCountdown ?? false);
	});

	const displayTime = computed(() => shown.value.displayTime);

	const timeColorClass = computed(() => {
		if (isExpired.value)
			return 'text-error';
		const c = toValue(clock);
		if (c?.isRunning)
			return 'text-primary';
		if (isPaused.value)
			return 'text-warning';
		return 'text-muted';
	});

	return {
		displayTime,
		isUntimed,
		showsClock,
		timeColorClass,
		isPaused,
		isExpired,
		isInOvertime,
		getElapsedMs,
		getRemainingMs,
	};
}

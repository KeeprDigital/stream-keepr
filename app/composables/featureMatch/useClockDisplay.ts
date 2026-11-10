import type { MaybeRefOrGetter } from 'vue';
import type { ClockState } from '~~/shared/types/featureMatchState';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { clockDisplayNextChangeInMs, formatClockDisplay, getEffectiveElapsedMs } from '~~/shared/utils/clock';

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
	 * Advanced each time the running clock's display, or its expiry, is due to
	 * change. Timed from server time rather than a free-running interval, so every
	 * rendering of one clock (an overlay's fill and key, say) changes digit together.
	 */
	const tick = ref(0);
	watch(
		// By the fields that move the display, so a clock updated in place re-times too.
		[
			() => {
				const held = toValue(clock);
				return held && `${held.type}:${held.isRunning}:${held.lastStartedAt}:${held.elapsedMs}:${held.durationMs}`;
			},
			tick,
		],
		(_changed, _previous, onCleanup) => {
			const held = toValue(clock);
			if (!held)
				return;
			const now = getServerTime();
			const untilDisplayChanges = clockDisplayNextChangeInMs(held, now);
			if (untilDisplayChanges == null)
				return;
			const untilExpiry = held.type === 'countdown'
				? held.durationMs - getEffectiveElapsedMs(held, now)
				: 0;
			const delay = untilExpiry > 0
				? Math.min(untilDisplayChanges, untilExpiry)
				: untilDisplayChanges;
			const timer = setTimeout(() => tick.value++, delay);
			onCleanup(() => clearTimeout(timer));
		},
		{ immediate: true },
	);

	function getElapsedMs(): number {
		const c = toValue(clock);
		if (!c)
			return 0;

		let elapsedMs = c.elapsedMs;
		if (c.isRunning && c.lastStartedAt) {
			const now = getServerTime();
			elapsedMs += now - c.lastStartedAt;
		}
		return Math.max(0, elapsedMs);
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

	const isExpired = computed(() => {
		const c = toValue(clock);
		if (!c || c.type !== 'countdown')
			return false;
		if (c.isRunning)
			void tick.value;
		return getElapsedMs() >= c.durationMs;
	});

	const isInOvertime = computed(() => {
		const c = toValue(clock);
		return isExpired.value && (c?.countUpAfterCountdown ?? false);
	});

	const displayTime = computed(() => {
		// Read tick to trigger reactivity while running
		if (toValue(clock)?.isRunning)
			void tick.value;
		return formatClockDisplay(toValue(clock), getServerTime(), untimedLabel.value);
	});

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

import type { MaybeRefOrGetter } from 'vue';
import type { ClockState } from '~~/shared/types/featureMatchState';
import { useIntervalFn } from '@vueuse/core';
import { formatClockTime } from '~~/shared/utils/clock';

/**
 * Composable that encapsulates clock display logic:
 * tick tracking, formatted display time, color classes,
 * and expired/overtime/paused state detection.
 *
 * Shared between the admin Clock component and the
 * match control screen ClockBar.
 */
export function useClockDisplay(clock: MaybeRefOrGetter<ClockState | null>) {
	const { getServerTime } = useServerTime();

	// Single tick counter that forces reactivity updates while clock is running
	const tick = ref(0);
	const { pause: pauseTick, resume: resumeTick } = useIntervalFn(
		() => { tick.value++; },
		1000,
		{ immediate: false },
	);

	// Start/stop the tick interval based on clock running state
	watch(
		() => toValue(clock)?.isRunning,
		(isRunning) => {
			if (isRunning)
				resumeTick();
			else
				pauseTick();
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
		const c = toValue(clock);
		if (!c)
			return '0:00';

		// Read tick to trigger reactivity while running
		if (c.isRunning)
			void tick.value;

		if (c.type === 'countdown') {
			const elapsed = getElapsedMs();
			// When expired and countUpAfterCountdown is enabled, show overtime elapsed
			if (c.countUpAfterCountdown && elapsed >= c.durationMs) {
				return formatClockTime(elapsed - c.durationMs);
			}
			return formatClockTime(Math.max(0, c.durationMs - elapsed));
		}
		return formatClockTime(getElapsedMs());
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
		timeColorClass,
		isPaused,
		isExpired,
		isInOvertime,
		getElapsedMs,
		getRemainingMs,
	};
}

import type { MaybeRefOrGetter } from 'vue';
import type { ClockState } from '~~/shared/types/featureMatchState';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { projectFeatureMatchClock } from '~~/shared/utils/clock';

/**
 * A Feature Match Session clock as a rendering shows it: its projection, kept
 * current, with its colour classes and run-out and overtime flags.
 *
 * Shared between the admin Clock component and the
 * match control screen ClockBar.
 *
 * An untimed match shows the Event's Untimed Label in place of a time, and no
 * clock at all (`showsClock` false) while that label is blank.
 */
export function useClockDisplay(clock: MaybeRefOrGetter<ClockState | null>) {
	const eventStore = useEventStore();

	const untimedLabel = computed(() => toFeatureMatchDefaults(eventStore.displayEvent).untimedLabel.trim());

	/**
	 * The clock's projection, re-evaluated as what it shows next changes
	 * (ADR-0088). An output yet to sync counts on its own time rather than
	 * showing nothing.
	 */
	const projection = useClockProjection((serverTime) => {
		const value = projectFeatureMatchClock(toValue(clock), serverTime, untimedLabel.value);
		return { value, nextChangeInMs: value.nextChangeInMs };
	}, { whileServerTimeUnknown: 'device-time' });

	const state = computed(() => projection.value.state);
	const displayTime = computed(() => projection.value.display);

	const isUntimed = computed(() => state.value === 'untimed');
	const showsClock = computed(() => !isUntimed.value || untimedLabel.value !== '');

	const isInOvertime = computed(() => state.value === 'counting-up' || state.value === 'holding');
	const isExpired = computed(() => state.value === 'run-out' || isInOvertime.value);

	const timeColorClass = computed(() => {
		if (isExpired.value)
			return 'text-error';
		if (state.value === 'running')
			return 'text-primary';
		if (state.value === 'paused')
			return 'text-warning';
		return 'text-muted';
	});

	return {
		displayTime,
		isUntimed,
		showsClock,
		timeColorClass,
		isExpired,
		isInOvertime,
	};
}

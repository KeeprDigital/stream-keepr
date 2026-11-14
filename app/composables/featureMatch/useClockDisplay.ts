import type { MaybeRefOrGetter } from 'vue';
import type { ClockState } from '~~/shared/types/featureMatchState';
import { projectFeatureMatchClock, readStoredClock } from '~~/shared/utils/clock';

/**
 * A Feature Match Session clock as a rendering shows it: its projection, kept
 * current. It answers with the clock's state and whether it runs; the colour
 * each takes is its component's to choose.
 *
 * The caller passes the Event's Untimed Label. An untimed match shows it in
 * place of a time, and no clock at all (`showsClock` false) while it is blank.
 */
export function useClockDisplay(
	clock: MaybeRefOrGetter<ClockState | null>,
	untimedLabel: MaybeRefOrGetter<string>,
) {
	/**
	 * The clock's projection, re-evaluated as what it shows next changes
	 * (ADR-0088). An output yet to sync counts on its own time rather than
	 * showing nothing.
	 */
	const projection = useClockProjection((serverTime) => {
		const stored = toValue(clock);
		return selfTimed(projectFeatureMatchClock(stored && readStoredClock(stored), serverTime, toValue(untimedLabel)));
	}, { whileServerTimeUnknown: 'device-time' });

	const state = computed(() => projection.value.state);
	const isRunning = computed(() => projection.value.isRunning);
	const displayTime = computed(() => projection.value.display);
	const showsClock = computed(() => state.value !== 'untimed' || displayTime.value !== '');

	return {
		projection,
		state,
		isRunning,
		displayTime,
		showsClock,
	};
}

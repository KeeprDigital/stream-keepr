import type { MaybeRefOrGetter } from 'vue';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';

export function useClockControls(matchId: MaybeRefOrGetter<number>) {
	const eventStore = useEventStore();
	const store = useFeatureMatchStateStore();

	const eid = () => eventStore.eventId;
	const mid = () => toValue(matchId);

	const defaultDurationMs = computed(() => {
		const { clockDuration } = toFeatureMatchDefaults(eventStore.event);
		if (!clockDuration)
			return undefined;
		return clockDuration * 60 * 1000;
	});

	function start() {
		if (eid())
			return store.startClock(eid()!, mid());
	}

	function pause() {
		if (eid())
			return store.pauseClock(eid()!, mid());
	}

	function reset() {
		if (eid())
			return store.resetClock(eid()!, mid());
	}

	function restart() {
		if (eid())
			return store.restartClock(eid()!, mid());
	}

	function adjust(deltaMs: number) {
		if (eid())
			return store.adjustClock(eid()!, mid(), deltaMs);
	}

	function set(targetMs: number) {
		if (eid())
			return store.setClock(eid()!, mid(), targetMs);
	}

	function resetToDefault() {
		if (!eid() || !defaultDurationMs.value)
			return;
		return store.setClock(eid()!, mid(), defaultDurationMs.value);
	}

	return {
		start,
		pause,
		reset,
		restart,
		adjust,
		set,
		resetToDefault,
		defaultDurationMs,
	};
}

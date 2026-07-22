import type { MaybeRefOrGetter } from 'vue';
import type { CounterState, GameWinOptions } from '~~/shared/types/featureMatchState';

export function usePlayerControls(
	matchId: MaybeRefOrGetter<number>,
	player: MaybeRefOrGetter<PlayerSide>,
) {
	const eventStore = useEventStore();
	const store = useFeatureMatchStateStore();

	const eid = () => eventStore.eventId;
	const mid = () => toValue(matchId);
	const p = () => toValue(player);

	function adjustLife(delta: number) {
		if (eid())
			return store.adjustLife(eid()!, mid(), p(), delta);
	}

	function setLife(value: number) {
		if (eid())
			return store.setLife(eid()!, mid(), p(), value);
	}

	function updateCounters(counters: CounterState[]) {
		if (eid())
			return store.updatePlayerFeatureMatchState(eid()!, mid(), p(), { counters });
	}

	function recordWin(options?: GameWinOptions) {
		if (eid())
			return store.recordGameWin(eid()!, mid(), p(), options);
	}

	function undoWin(options?: GameWinOptions) {
		if (eid())
			return store.undoGameWin(eid()!, mid(), p(), options);
	}

	function setCardsKept(value: number) {
		if (eid())
			return store.setCardsKept(eid()!, mid(), p(), value);
	}

	return {
		adjustLife,
		setLife,
		updateCounters,
		recordWin,
		undoWin,
		setCardsKept,
	};
}

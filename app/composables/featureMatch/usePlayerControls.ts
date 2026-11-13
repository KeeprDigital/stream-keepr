import type { MaybeRefOrGetter } from 'vue';
import type { Seat } from '~~/shared/types/enums';
import type { CounterState, GameWinOptions } from '~~/shared/types/featureMatchState';
import { pairSeatOf } from '~~/shared/modules/feature-match-session';

export function usePlayerControls(
	matchId: MaybeRefOrGetter<number>,
	player: MaybeRefOrGetter<Seat>,
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

	// A game win is one of the pair's: a Commander Session has none (ADR-0087).
	function recordWin(options?: GameWinOptions) {
		const side = pairSeatOf(p());
		if (eid() && side)
			return store.recordGameWin(eid()!, mid(), side, options);
	}

	function undoWin(options?: GameWinOptions) {
		const side = pairSeatOf(p());
		if (eid() && side)
			return store.undoGameWin(eid()!, mid(), side, options);
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

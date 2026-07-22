import type { PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';

export function otherFeatureMatchPlayer(player: PlayerSide): PlayerSide {
	return player === 'player1' ? 'player2' : 'player1';
}

export function applyFeatureMatchTurnStep(state: FeatureMatchState, delta: number): FeatureMatchState {
	if (!state.firstPlayer || !state.activePlayer)
		return state;

	// Represent normal play as a zero-based half-turn index. Turn zero is a
	// historical MTG pre-turn state with asymmetric rewind semantics, so retain
	// its two positions explicitly before entering the turn-one index space.
	const requestedDelta = Math.trunc(delta);
	let turnNumber: number;
	let activePlayer: PlayerSide;
	if (state.turnNumber <= 0) {
		const zeroTurnPosition = state.activePlayer === state.firstPlayer ? 0 : 1;
		if (requestedDelta <= 0) {
			turnNumber = 0;
			activePlayer = requestedDelta < 0 && zeroTurnPosition === 1
				? state.firstPlayer
				: state.activePlayer;
		}
		else {
			const nextPosition = zeroTurnPosition + requestedDelta;
			if (nextPosition < 2) {
				turnNumber = 0;
				activePlayer = nextPosition === 0
					? state.firstPlayer
					: otherFeatureMatchPlayer(state.firstPlayer);
			}
			else {
				const normalIndex = nextPosition - 2;
				turnNumber = Math.floor(normalIndex / 2) + 1;
				activePlayer = normalIndex % 2 === 0
					? state.firstPlayer
					: otherFeatureMatchPlayer(state.firstPlayer);
			}
		}
	}
	else {
		const currentIndex = (state.turnNumber - 1) * 2
			+ (state.activePlayer === state.firstPlayer ? 0 : 1);
		const nextIndex = Math.max(0, currentIndex + requestedDelta);
		turnNumber = Math.floor(nextIndex / 2) + 1;
		activePlayer = nextIndex % 2 === 0
			? state.firstPlayer
			: otherFeatureMatchPlayer(state.firstPlayer);
	}

	return { ...state, turnNumber, activePlayer };
}

export function applyFeatureMatchOvertimeStep(state: FeatureMatchState, delta: number): FeatureMatchState {
	if (!state.overtime)
		return state;

	const requestedSteps = Math.abs(Math.trunc(delta));
	const forward = delta > 0;
	const availableSteps = forward
		? (state.overtime.active ? state.overtime.turnsRemaining : 0)
		: state.overtime.totalTurns - state.overtime.turnsRemaining;
	const appliedSteps = Math.min(requestedSteps, Math.max(0, availableSteps));
	const turnsRemaining = forward
		? state.overtime.turnsRemaining - appliedSteps
		: state.overtime.turnsRemaining + appliedSteps;
	// Historical rewind events toggled the active player for every requested
	// step even after turnsRemaining had reached its configured ceiling. Keep
	// replay semantics identical without looping through the payload.
	const playerToggleSteps = forward ? appliedSteps : requestedSteps;
	const activePlayer = state.activePlayer && playerToggleSteps % 2 === 1
		? otherFeatureMatchPlayer(state.activePlayer)
		: state.activePlayer;
	const active = forward
		? turnsRemaining > 0
		: requestedSteps > 0 || state.overtime.active;

	return {
		...state,
		activePlayer,
		overtime: { ...state.overtime, turnsRemaining, active },
	};
}

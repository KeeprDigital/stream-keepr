import type { Seat } from '~~/shared/types/enums';
import type { FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { CommanderDamageState, CommanderNumber, FeatureMatchState, PlayerFeatureMatchState } from '~~/shared/types/featureMatchState';
import type { Commander } from '~~/shared/types/game';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { createInitialSeatState, DEFAULT_STARTING_LIFE } from '~~/shared/types/featureMatchState';

/**
 * What a Commander Session's game is made of (ADR-0087): which Seats are in
 * it, the Commander Damage each has taken, and whose turn it is. The reducer
 * applies these to a command; the client predicts with the same functions.
 */

/** The Seats' fields a snapshot or a state is read by. */
type SeatSnapshot = Pick<FeatureMatchSourceSnapshot, Seat>;

/** Whether a Session plays a Commander game: one game across up to four Seats. */
export function isCommanderSession(snapshot: Pick<FeatureMatchSourceSnapshot, 'variant'>): boolean {
	return snapshot.variant === 'commander';
}

/** Whether a Seat is filled. An empty Seat is not in the game. */
export function isSeatFilled(snapshot: SeatSnapshot, seat: Seat): boolean {
	return snapshot[seat]?.data != null;
}

/** The filled Seats, in Seat order. */
export function filledSeats(snapshot: SeatSnapshot): Seat[] {
	return SEAT_VALUES.filter(seat => isSeatFilled(snapshot, seat));
}

/** The Commanders a Seat holds: none, one, or a pair. */
export function seatCommanders(snapshot: SeatSnapshot, seat: Seat): readonly Commander[] {
	const gameData = snapshot[seat]?.data?.gameData;
	return gameData?.type === 'mtg'
		? gameData.commanders ?? []
		: [];
}

function holdsCommander(snapshot: SeatSnapshot, seat: Seat, commander: CommanderNumber): boolean {
	return seatCommanders(snapshot, seat).length >= commander;
}

/** The starting life a Seat joins a game at: the Event's, as the Session holds it. */
export function commanderStartingLife(snapshot: Pick<FeatureMatchSourceSnapshot, 'defaults'>): number {
	return snapshot.defaults.startingLife ?? DEFAULT_STARTING_LIFE;
}

/** The Commander Damage a Seat has taken from one opposing Commander. */
export function commanderDamageFrom(seatState: PlayerFeatureMatchState | undefined, from: Seat, commander: CommanderNumber): number {
	return seatState?.commanderDamage?.find(entry => entry.seat === from && entry.commander === commander)?.damage ?? 0;
}

/**
 * A Seat's state after Commander Damage from one opposing Commander is
 * entered or taken back. Its life moves by what the count moved: a count
 * cannot go below none, so taking back more than was there raises life only
 * by what was.
 */
export function withCommanderDamage(
	seatState: PlayerFeatureMatchState,
	from: Seat,
	commander: CommanderNumber,
	delta: number,
): PlayerFeatureMatchState {
	const held = commanderDamageFrom(seatState, from, commander);
	const damage = Math.max(0, held + Math.trunc(delta));
	if (damage === held)
		return seatState;

	const entries = seatState.commanderDamage ?? [];
	const isEntry = (entry: CommanderDamageState) => entry.seat === from && entry.commander === commander;
	return {
		...seatState,
		lifeTotal: seatState.lifeTotal - (damage - held),
		commanderDamage: damage === 0
			? entries.filter(entry => !isEntry(entry))
			: held === 0
				? [
						...entries,
						{ seat: from, commander, damage },
					]
				: entries.map(entry => isEntry(entry)
						? { ...entry, damage }
						: entry),
	};
}

/**
 * Commander Damage entered against a Seat, or `null` where it cannot be: a
 * Seat takes it from a Commander an opposing Seat holds, and both Seats are in
 * the game.
 */
export function applyCommanderDamage(
	state: FeatureMatchState,
	snapshot: SeatSnapshot,
	damage: { player: Seat; from: Seat; commander: CommanderNumber; delta: number },
): FeatureMatchState | null {
	const { player, from, commander, delta } = damage;
	const seatState = state[player];
	if (player === from || !seatState || !isSeatFilled(snapshot, player) || !holdsCommander(snapshot, from, commander))
		return null;
	const damaged = withCommanderDamage(seatState, from, commander, delta);
	return damaged === seatState
		? state
		: { ...state, [player]: damaged };
}

// ─── The turn ───────────────────────────────────────────────────────────────

/** Whether a Seat takes a turn: it is filled and not Eliminated. */
function takesTurn(state: FeatureMatchState, snapshot: SeatSnapshot, seat: Seat): boolean {
	return isSeatFilled(snapshot, seat) && !(state[seat]?.eliminated ?? false);
}

function seatAt(index: number): Seat {
	return SEAT_VALUES[((index % SEAT_VALUES.length) + SEAT_VALUES.length) % SEAT_VALUES.length]!;
}

/**
 * The turn passed on from `from`, to the next Seat in Seat order that takes
 * one. Its number goes up when it reaches or passes the Seat that went first,
 * so a round is still counted once that Seat is Eliminated or empty.
 */
function passTurnFrom(state: FeatureMatchState, snapshot: SeatSnapshot, from: Seat): FeatureMatchState {
	const start = SEAT_VALUES.indexOf(from);
	let passedFirst = false;
	for (let offset = 1; offset <= SEAT_VALUES.length; offset++) {
		const seat = seatAt(start + offset);
		passedFirst ||= seat === state.firstPlayer;
		if (takesTurn(state, snapshot, seat)) {
			return {
				...state,
				activePlayer: seat,
				turnNumber: state.turnNumber + (passedFirst ? 1 : 0),
			};
		}
	}
	return state;
}

/** The turn handed back to the Seat before, undoing `passTurnFrom`; it does not go before the first turn. */
function returnTurnFrom(state: FeatureMatchState, snapshot: SeatSnapshot, from: Seat): FeatureMatchState {
	const start = SEAT_VALUES.indexOf(from);
	let passedFirst = from === state.firstPlayer;
	for (let offset = 1; offset <= SEAT_VALUES.length; offset++) {
		const seat = seatAt(start - offset);
		if (takesTurn(state, snapshot, seat)) {
			const turnNumber = state.turnNumber - (passedFirst ? 1 : 0);
			return turnNumber < 1
				? state
				: { ...state, activePlayer: seat, turnNumber };
		}
		passedFirst ||= seat === state.firstPlayer;
	}
	return state;
}

/**
 * A Commander game's turn stepped `delta` times: forward in Seat order over
 * empty and Eliminated Seats, or back the way it came.
 */
export function applyCommanderTurnStep(state: FeatureMatchState, snapshot: SeatSnapshot, delta: number): FeatureMatchState {
	if (!state.firstPlayer || !state.activePlayer)
		return state;

	const steps = Math.trunc(delta);
	let stepped = state;
	for (let taken = 0; taken < Math.abs(steps); taken++) {
		const next = steps > 0
			? passTurnFrom(stepped, snapshot, stepped.activePlayer!)
			: returnTurnFrom(stepped, snapshot, stepped.activePlayer!);
		if (next === stepped)
			break;
		stepped = next;
	}
	return stepped;
}

// ─── Seats joining, leaving and changing places ─────────────────────────────

/**
 * A Commander Session's state under a corrected snapshot. A Seat filled since
 * joins at starting life, and one emptied leaves at once: its state goes, the
 * turn it held passes on, and the Commander Damage counted against a
 * Commander no Seat holds any more is dropped. Life already lost stays lost.
 */
export function withSeatsCorrected(
	state: FeatureMatchState,
	held: SeatSnapshot,
	corrected: FeatureMatchSourceSnapshot,
): FeatureMatchState {
	const startingLife = commanderStartingLife(corrected);
	let next = state;
	for (const seat of SEAT_VALUES) {
		const seatState = next[seat];
		if (!seatState || isSeatFilled(held, seat) !== isSeatFilled(corrected, seat)) {
			next = {
				...next,
				[seat]: createInitialSeatState(startingLife),
			};
		}
	}

	for (const seat of SEAT_VALUES) {
		const entries = next[seat]?.commanderDamage ?? [];
		const dealt = entries.filter(entry => holdsCommander(corrected, entry.seat, entry.commander));
		if (dealt.length !== entries.length) {
			next = {
				...next,
				[seat]: { ...next[seat]!, commanderDamage: dealt },
			};
		}
	}

	const active = next.activePlayer;
	if (active && next.firstPlayer && !isSeatFilled(corrected, active)) {
		const passed = passTurnFrom(next, corrected, active);
		next = passed === next
			? { ...next, activePlayer: null }
			: passed;
	}
	return next;
}

/**
 * A Commander Session's state with two Seats' players changed places: each
 * takes their live state with them, and everything naming one Seat names the
 * other (the turn, the Seat that went first, the winner, and the Commander
 * Damage dealt by their Commanders).
 */
export function withSeatsSwapped(state: FeatureMatchState, first: Seat, second: Seat): FeatureMatchState {
	const moved = <T extends Seat | null | undefined>(seat: T): T | Seat => {
		if (seat === first)
			return second;
		return seat === second
			? first
			: seat;
	};
	const next: FeatureMatchState = {
		...state,
		[first]: state[second],
		[second]: state[first],
		activePlayer: moved(state.activePlayer),
		firstPlayer: moved(state.firstPlayer),
		...(state.outcome && {
			outcome: {
				winner: moved(state.outcome.winner),
			},
		}),
	};
	for (const seat of SEAT_VALUES) {
		const seatState = next[seat];
		if (seatState?.commanderDamage?.length) {
			next[seat] = {
				...seatState,
				commanderDamage: seatState.commanderDamage.map(entry => ({
					...entry,
					seat: moved(entry.seat),
				})),
			};
		}
	}
	return next;
}

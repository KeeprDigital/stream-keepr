/**
 * Guarded Sequence: the single home for the invariant "discard the result of
 * an async operation when newer work has superseded it."
 *
 * A Flight is a ticket for one unit of supersedable work. Check
 * `flight.stale` after every await, before every side effect; supersession
 * suppresses effects, it does not cancel the underlying work. Staleness is
 * monotonic — once stale, a flight never becomes current again — and
 * `begin()` supersedes synchronously, before it returns.
 *
 * Currency is tracked by token identity, not counters, so superseded keys
 * can be dropped without any risk of a recycled counter validating a stale
 * flight. Pure in-process: no I/O, no timers, no Vue reactivity — safe in
 * composables, stores, and plain modules, on server and client alike.
 */

export interface Flight {
	/** True once superseded. Monotonic: never flips back to false. */
	readonly stale: boolean;
	/** Negation of stale; reads better at "apply result" sites. */
	readonly current: boolean;
}

export interface GuardedSequence {
	/** Start a new flight, synchronously superseding the prior one. */
	begin: () => Flight;
	/** Supersede the current flight without starting a new one. Idempotent. */
	supersede: () => void;
}

export interface KeyedGuardedSequence<K = string> {
	/** Start a new flight for a key, superseding the prior flight for that key only. */
	begin: (key: K) => Flight;
	/** Supersede the current flight for a key. No-op for unknown keys. */
	supersede: (key: K) => void;
	/** Supersede every in-flight key. */
	supersedeAll: () => void;
}

/** A Flight that is never stale — for call sites where guarding is optional. */
export const unguarded: Flight = { stale: false, current: true };

function createFlight(isCurrent: (flight: Flight) => boolean): Flight {
	const flight: Flight = {
		get stale() {
			return !isCurrent(flight);
		},
		get current() {
			return isCurrent(flight);
		},
	};
	return flight;
}

export function createGuardedSequence(): GuardedSequence {
	let currentFlight: Flight | null = null;
	return {
		begin: () => {
			const flight = createFlight(candidate => candidate === currentFlight);
			currentFlight = flight;
			return flight;
		},
		supersede: () => {
			currentFlight = null;
		},
	};
}

export function createKeyedGuardedSequence<K = string>(): KeyedGuardedSequence<K> {
	const currentByKey = new Map<K, Flight>();
	return {
		begin: (key: K) => {
			const flight = createFlight(candidate => currentByKey.get(key) === candidate);
			currentByKey.set(key, flight);
			return flight;
		},
		supersede: (key: K) => {
			currentByKey.delete(key);
		},
		supersedeAll: () => {
			currentByKey.clear();
		},
	};
}

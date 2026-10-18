import { createKeyedGuardedSequence } from '~/utils/guardedSequence';

/**
 * Live State Follower: the client half of Sequenced Live State.
 *
 * The server holds one authoritative order of accepted commands per live
 * aggregate; a client following one holds a snapshot of it and has to decide,
 * for everything that arrives, whether it moves that snapshot forward. This
 * module owns every one of those decisions, so a feature cannot get one wrong by
 * writing it again:
 *
 * - a notification at the held sequence or before it is a duplicate, and is dropped;
 * - a notification past the next sequence is a gap, and a notification offering no
 *   difference is one this client cannot follow — both are answered by reloading;
 * - anything from a different epoch (another aggregate id) than the one held is
 *   never applied: a command result is refused, a notification reloads;
 * - a command result older than what is held is refused, and what is held answers;
 * - loads are Flights from a keyed Guarded Sequence: a later load, and any newer
 *   write, supersedes an earlier load, so the load issued first and answered last
 *   cannot win by arriving late (#308);
 * - Reconnect Resync re-reads through `load`, which never clears what is held.
 *
 * The feature supplies only where it keeps a snapshot and how to apply a full
 * state or a difference. Reloading is the feature's to perform, because only it
 * knows how to read its aggregate; this module says when. Pure in-process: no
 * I/O, no timers, no Vue reactivity.
 */

/** What every followed snapshot carries: its epoch (the aggregate id) and position in the order. */
export interface LiveStateSnapshot {
	id: number;
	sequence: number;
}

/** What every notification of an accepted command carries. */
export interface LiveStateNotification {
	/** The epoch the command was accepted in. */
	sessionId: number;
	sequence: number;
}

/** What a notification did: moved the held snapshot, changed nothing, or left it behind. */
export type LiveStateNotificationOutcome = 'applied' | 'ignored' | 'reload';

export interface LiveStateFollowerOptions<K, S extends LiveStateSnapshot, N extends LiveStateNotification> {
	keyOf: (snapshot: S) => K;
	/** The snapshot the feature holds for a key. */
	held: (key: K) => S | undefined;
	/** Hold a full state. */
	applyState: (snapshot: S) => void;
	/**
	 * The snapshot one difference produces from the one immediately before it,
	 * at the notification's sequence; `undefined` when the notification offers none.
	 */
	withDifference: (held: S, notification: N) => S | undefined;
	/** Stop holding anything for a key. */
	forget: (key: K) => void;
	/**
	 * Whether a held snapshot may take a difference in place at all. One that may
	 * not reloads on every notification, repeated sequences included.
	 */
	acceptsDifferences?: (held: S) => boolean;
}

export function createLiveStateFollower<K, S extends LiveStateSnapshot, N extends LiveStateNotification>(
	options: LiveStateFollowerOptions<K, S, N>,
) {
	/**
	 * Loads in flight, one key at a time: two keys are two independent orders, and
	 * superseding across them would drop a load nothing had overtaken.
	 */
	const loads = createKeyedGuardedSequence<K>();

	/**
	 * Hold a snapshot known to be the newest thing this client has: the server
	 * produced it after whatever a load in flight will answer with, so it
	 * supersedes that load rather than racing it.
	 */
	function acceptSnapshot(snapshot: S) {
		loads.supersede(options.keyOf(snapshot));
		options.applyState(snapshot);
	}

	/**
	 * Read one key's authoritative snapshot and hold it, unless something newer
	 * superseded the read while it was in flight. A superseded load answers what
	 * is held instead of what it read: its caller mirrors the answer, so handing
	 * back the losing snapshot would put it on screen by the other door.
	 */
	async function load(key: K, read: () => Promise<S>): Promise<S | null> {
		const flight = loads.begin(key);
		const snapshot = await read();
		if (flight.stale)
			return options.held(key) ?? null;
		options.applyState(snapshot);
		return snapshot;
	}

	/**
	 * Hold a command's result unless it would move what is held backwards.
	 * Command requests may overlap: a late answer cannot move one epoch backwards,
	 * and an answer from an ended epoch cannot replace the current one at all.
	 */
	function acceptCommandResult(snapshot: S): S {
		const known = options.held(options.keyOf(snapshot));
		if (known && (known.id !== snapshot.id || known.sequence > snapshot.sequence))
			return known;
		acceptSnapshot(snapshot);
		return snapshot;
	}

	function notify(key: K, notification: N): LiveStateNotificationOutcome {
		const known = options.held(key);
		// Nothing held, or a different epoch entirely: only the snapshot can say
		// which epoch this client should be following.
		if (!known || known.id !== notification.sessionId)
			return 'reload';
		if (options.acceptsDifferences && !options.acceptsDifferences(known))
			return 'reload';
		if (notification.sequence <= known.sequence)
			return 'ignored';
		if (notification.sequence > known.sequence + 1)
			return 'reload';
		// No difference is not one to ignore: the order did advance, and this
		// client cannot say to what.
		const changed = options.withDifference(known, notification);
		if (!changed)
			return 'reload';
		acceptSnapshot(changed);
		return 'applied';
	}

	/**
	 * One key's epoch has ended. Everything held for it belongs to the ended
	 * epoch, so it is forgotten before the reload rather than after: if the reload
	 * fails, nothing from a show that is over stays held. A key holding nothing
	 * has nothing to correct, and does not open an epoch to hear about one ending.
	 */
	function end(key: K): Exclude<LiveStateNotificationOutcome, 'applied'> {
		if (!options.held(key))
			return 'ignored';
		options.forget(key);
		return 'reload';
	}

	/** Supersede every load in flight; the feature clears what it holds. */
	function reset() {
		loads.supersedeAll();
	}

	return { acceptSnapshot, acceptCommandResult, load, notify, end, reset };
}

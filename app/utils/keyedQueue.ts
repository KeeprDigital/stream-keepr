/**
 * Keyed FIFO serialization: run each key's actions one at a time, in order,
 * while different keys run concurrently. A failed action rejects only its own
 * enqueue promise — the key's chain continues. Settled chains are pruned so
 * the map does not grow with dead keys.
 *
 * The sibling of Guarded Sequence: that module discards stale results, this
 * one orders in-flight work. Pure in-process, no timers.
 */

export interface KeyedQueue<K = string> {
	/** Run action after every previously enqueued action for the key settles. */
	enqueue: <T>(key: K, action: () => Promise<T>) => Promise<T>;
}

export function createKeyedQueue<K = string>(): KeyedQueue<K> {
	const chains = new Map<K, Promise<unknown>>();
	return {
		enqueue: <T>(key: K, action: () => Promise<T>): Promise<T> => {
			const previous = chains.get(key);
			const current = previous
				? previous.catch(() => {
					// The previous failure already rejected its own enqueue promise.
					}).then(action)
				: action();
			chains.set(key, current);
			current
				.finally(() => {
					if (chains.get(key) === current)
						chains.delete(key);
				})
				.catch(() => {
					// Rejection is observed via the returned promise; keep the chain settled.
				});
			return current;
		},
	};
}

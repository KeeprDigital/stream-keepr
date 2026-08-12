export function createCancelableDebounce(
	callback: () => void | Promise<void>,
	delayMs: number,
	maxWaitMs?: number,
) {
	let delayTimer: ReturnType<typeof setTimeout> | null = null;
	let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

	function clearTimers() {
		if (delayTimer !== null)
			clearTimeout(delayTimer);
		if (maxWaitTimer !== null)
			clearTimeout(maxWaitTimer);
		delayTimer = null;
		maxWaitTimer = null;
	}

	function flush() {
		clearTimers();
		void callback();
	}

	/**
	 * Fire only if a call is actually waiting.
	 *
	 * What `flush` does unconditionally, for the callers that flush on a lifecycle
	 * event rather than on an edit — a scope disposal, an Event scope changing —
	 * where there is usually nothing waiting and firing anyway would turn every one
	 * of those events into a write.
	 */
	function flushIfPending() {
		if (delayTimer !== null || maxWaitTimer !== null)
			flush();
	}

	function schedule() {
		if (delayTimer !== null)
			clearTimeout(delayTimer);
		delayTimer = setTimeout(flush, delayMs);

		if (maxWaitMs !== undefined && maxWaitTimer === null)
			maxWaitTimer = setTimeout(flush, maxWaitMs);
	}

	return {
		schedule,
		flush,
		flushIfPending,
		cancel: clearTimers,
	};
}

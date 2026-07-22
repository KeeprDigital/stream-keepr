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
		cancel: clearTimers,
	};
}

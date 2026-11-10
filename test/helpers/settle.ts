import { flushPromises } from '@vue/test-utils';
import { LOAD_TOLERANT_WAIT_MS } from './loadTolerantBounds';

/** One round: pending promises, then a short timer, so answers on later tasks land. */
async function settleRound() {
	await flushPromises();
	await new Promise(resolve => setTimeout(resolve, 5));
}

/**
 * Lets promises and short timers run until `ready` holds, for renderings whose
 * reads answer on later tasks. Bounded by time, not rounds, so a loaded machine
 * only delays it; a condition that never holds fails here, not a line later.
 */
export async function settleUntil(ready: () => boolean) {
	const deadline = Date.now() + LOAD_TOLERANT_WAIT_MS;
	while (!ready()) {
		if (Date.now() >= deadline)
			throw new Error(`settleUntil: the condition did not hold within ${LOAD_TOLERANT_WAIT_MS} ms`);
		await settleRound();
	}
}

/** Rounds `snapshot` must hold still for: at least 100ms of nothing new. */
const STILL_ROUNDS = 20;

/**
 * Lets promises and short timers run until `snapshot` (what the test can see:
 * requests made, markup rendered) holds still for 20 rounds in a row. For
 * asserting nothing more happens: it waits out every answer and re-render.
 * Something that recurs within 100ms never holds still, and fails here.
 */
export async function settleUntilStill(snapshot: () => unknown) {
	const deadline = Date.now() + LOAD_TOLERANT_WAIT_MS;
	let last = JSON.stringify(snapshot());
	for (let still = 0; still < STILL_ROUNDS;) {
		if (Date.now() >= deadline)
			throw new Error(`settleUntilStill: the snapshot did not hold still within ${LOAD_TOLERANT_WAIT_MS} ms`);
		await settleRound();
		const next = JSON.stringify(snapshot());
		still = next === last
			? still + 1
			: 0;
		last = next;
	}
}

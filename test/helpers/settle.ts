import { flushPromises } from '@vue/test-utils';

/** One round: pending promises, then a short timer, so answers on later tasks land. */
async function settleRound() {
	await flushPromises();
	await new Promise(resolve => setTimeout(resolve, 5));
}

/**
 * Lets promises and short timers run until `ready` holds, or a bounded number
 * of rounds has passed, for renderings whose reads answer on later tasks.
 */
export async function settleUntil(ready: () => boolean, rounds = 100) {
	for (let round = 0; round < rounds && !ready(); round++)
		await settleRound();
}

/** Rounds `snapshot` must hold still for: at least 100ms of nothing new. */
const STILL_ROUNDS = 20;

/**
 * Lets promises and short timers run until `snapshot` (what the test can see:
 * requests made, markup rendered) holds still for 20 rounds in a row, or 100
 * rounds have passed. For asserting nothing more happens: it waits out every
 * answer and re-render, and anything that recurs within 100ms runs to the bound.
 */
export async function settleUntilStill(snapshot: () => unknown) {
	let last = JSON.stringify(snapshot());
	for (let round = 0, still = 0; round < 100 && still < STILL_ROUNDS; round++) {
		await settleRound();
		const next = JSON.stringify(snapshot());
		still = next === last
			? still + 1
			: 0;
		last = next;
	}
}

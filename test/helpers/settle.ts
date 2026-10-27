import { flushPromises } from '@vue/test-utils';

/**
 * Lets promises and short timers run until `ready` holds, or a bounded number
 * of rounds has passed, for renderings whose reads answer on later tasks.
 */
export async function settleUntil(ready: () => boolean, rounds = 100) {
	for (let round = 0; round < rounds && !ready(); round++) {
		await flushPromises();
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

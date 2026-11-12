import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOAD_TOLERANT_WAIT_MS } from '../../helpers/loadTolerantBounds';
import { settleUntil, settleUntilStill } from '../../helpers/settle';

afterEach(() => {
	vi.useRealTimers();
});

/** Jumps the clock past the settle bound; timers stay real, so rounds still run. */
function passTheBound() {
	vi.useFakeTimers({
		toFake: ['Date'],
	});
	vi.setSystemTime(Date.now() + LOAD_TOLERANT_WAIT_MS);
}

/**
 * Settles on a faked clock that only the kit's own round timers move, so the
 * settle takes as many rounds as the time it waits for, without the sleeping.
 */
async function onTheRoundClock(settling: () => Promise<void>) {
	vi.useFakeTimers({
		toFake: ['setTimeout', 'Date'],
	});
	const settled = settling().then(() => 'settled' as const);
	for (;;) {
		vi.advanceTimersToNextTimer();
		// One real turn of the event loop, for the promises between two round timers.
		const turned = new Promise<'turned'>(resolve => setImmediate(resolve, 'turned'));
		if (await Promise.race([settled, turned]) === 'settled')
			return;
	}
}

describe('settleUntil', () => {
	// A slow machine delays a settle, it does not end it: the bound is time, far
	// past the half second a fixed count of rounds used to allow.
	it('outlasts a condition slower than a second', async () => {
		let readyAt = Number.POSITIVE_INFINITY;

		await onTheRoundClock(() => {
			readyAt = Date.now() + 1_200;
			return settleUntil(() => Date.now() >= readyAt);
		});

		expect(Date.now()).toBeGreaterThanOrEqual(readyAt);
	});

	it('fails when the condition never holds', async () => {
		let rounds = 0;
		const settled = settleUntil(() => {
			if (++rounds === 3)
				passTheBound();
			return false;
		});

		await expect(settled).rejects.toThrow(/settleUntil: the condition did not hold within \d+ ms/);
	});
});

describe('settleUntilStill', () => {
	it('returns once what it watches has held still', async () => {
		let changes = 0;
		const changing = setInterval(() => {
			if (++changes === 10)
				clearInterval(changing);
		}, 10);

		await settleUntilStill(() => changes);

		expect(changes).toBe(10);
	});

	it('fails when what it watches never holds still', async () => {
		let rounds = 0;
		const settled = settleUntilStill(() => {
			if (++rounds === 3)
				passTheBound();
			return rounds;
		});

		await expect(settled).rejects.toThrow(/settleUntilStill: the snapshot did not hold still within \d+ ms/);
	});
});

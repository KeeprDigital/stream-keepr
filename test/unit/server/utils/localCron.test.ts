import type { Deferred } from '~~/test/helpers/deferred';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalCron } from '~~/server/utils/localCron';
import { deferred } from '~~/test/helpers/deferred';

/*
 * A local launcher's stand-in for a Cloudflare cron trigger: it fires at once and
 * then every interval, never while its previous firing is still running.
 */

const INTERVAL_MS = 60_000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Starts a cron whose firings each wait on a deferred the test settles. */
function startHeld() {
	const firings: Deferred<void>[] = [];
	const onError = vi.fn();
	const cron = startLocalCron({
		intervalMs: INTERVAL_MS,
		fire: () => {
			const firing = deferred();
			firings.push(firing);
			return firing.promise;
		},
		onError,
	});
	return { cron, firings, onError };
}

async function advanceMinutes(minutes: number) {
	await vi.advanceTimersByTimeAsync(minutes * INTERVAL_MS);
}

describe('a local cron', () => {
	it('fires at once, then once each interval after its firing settles', async () => {
		const { cron, firings } = startHeld();
		expect(firings).toHaveLength(1);

		for (const expected of [2, 3, 4]) {
			firings.at(-1)!.resolve();
			await advanceMinutes(1);
			expect(firings).toHaveLength(expected);
		}
		cron.stop();
	});

	it.each([1, 3])('skips every firing due while one has run for %i min', async (minutesPending) => {
		const { cron, firings } = startHeld();

		await advanceMinutes(minutesPending);
		expect(firings).toHaveLength(1);

		firings[0]!.resolve();
		await advanceMinutes(1);
		expect(firings).toHaveLength(2);
		cron.stop();
	});

	it('reports a failed firing and fires again on the next interval', async () => {
		const { cron, firings, onError } = startHeld();
		const failure = new Error('tick failed');

		firings[0]!.reject(failure);
		await advanceMinutes(1);

		expect(onError).toHaveBeenCalledWith(failure);
		expect(firings).toHaveLength(2);
		cron.stop();
	});

	it('fires no more once stopped', async () => {
		const { cron, firings } = startHeld();
		firings[0]!.resolve();

		cron.stop();
		await advanceMinutes(5);

		expect(firings).toHaveLength(1);
	});
});

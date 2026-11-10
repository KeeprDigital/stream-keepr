/**
 * A wait's bound says "this never happens", not "this is fast": `vi.waitFor` and
 * `vi.waitUntil` give up after one second by default, which a loaded machine
 * spends without the condition being wrong. Here they default to a bound far
 * past any slowdown; a wait that names its own timeout keeps it.
 */

import { vi } from 'vitest';

/** Below the suites' `testTimeout`, so a wait that never holds reports its own assertion. */
export const LOAD_TOLERANT_WAIT_MS = 20_000;

const WRAPPED = Symbol.for('stream-keepr.loadTolerantWaits');

type WaitOptions = number | { timeout?: number; interval?: number } | undefined;

function withDefaultBound(options: WaitOptions): WaitOptions {
	return typeof options === 'number'
		? options
		: { timeout: LOAD_TOLERANT_WAIT_MS, ...options };
}

const target = vi as typeof vi & { [WRAPPED]?: true };
if (!target[WRAPPED]) {
	target[WRAPPED] = true;
	const waitFor = vi.waitFor.bind(vi);
	const waitUntil = vi.waitUntil.bind(vi);
	vi.waitFor = ((callback, options) => waitFor(callback, withDefaultBound(options))) as typeof vi.waitFor;
	vi.waitUntil = ((callback, options) => waitUntil(callback, withDefaultBound(options))) as typeof vi.waitUntil;
}

/**
 * Timeouts detect a hang; they are not a speed budget. A test that takes two
 * seconds on an idle machine takes many times that beside a build or on fewer
 * cores, and a test cut off mid-flight keeps running into the next one. So the
 * bounds sit far above any honest slowdown.
 */
export const LOAD_TOLERANT_TEST_TIMEOUT_MS = 60_000;
export const LOAD_TOLERANT_HOOK_TIMEOUT_MS = 120_000;

/**
 * What `vi.waitFor`, `vi.waitUntil` and the settle kit give up at. A fraction
 * of the test timeout, so a wait that never holds reports its own failure
 * before the test is cut off.
 */
export const LOAD_TOLERANT_WAIT_MS = LOAD_TOLERANT_TEST_TIMEOUT_MS / 3;

/**
 * How many failed tests end a run. A real hang in a long serial file would
 * otherwise spend the test timeout on every test after it, and outlast CI's job
 * limit before the run could name the test that hung.
 */
export const LOAD_TOLERANT_BAIL_AFTER_FAILURES = 5;

/**
 * The calls a test means, chosen by name rather than taken by position (#273, #280, #342).
 *
 * A mock's call list belongs to the mock, not the test: a shared subject (a global
 * `$fetch`, a `console` spy) records strays too, so `mock.calls.at(-1)` can read the
 * wrong call and still pass. These helpers select before they read, and fail with a
 * named error listing what arrived instead of `Cannot read properties of undefined`.
 * Leave the selector off only for a purpose-built mock the code under test alone calls.
 *
 * ```ts
 * const [, options] = lastCallTo(mockApiFetch, '/api/admin/graphics-assets/evidence');
 * const [first, retried] = callsTo(mockRepository.sendCommand, 2).map(call => call[3]);
 * ```
 */

/** The part of a Vitest mock this reads: `vi.fn()`, `vi.spyOn()` and `vi.mocked()` all fit. */
interface CallRecorder<Args extends unknown[]> {
	mock: { calls: Args[] };
}

/**
 * How a test names the call it means: an endpoint compared against the first argument,
 * or a predicate over the whole argument tuple for subjects whose first argument is not
 * a name (a log line, a room, a payload).
 */
export type CallSelector<Args extends unknown[]> = string | ((call: Args) => boolean);

/** How many recorded calls the failure message lists before eliding. */
const LISTED_CALLS = 5;

/** How much of one argument the failure message renders before truncating. */
const RENDERED_ARGUMENT_CHARS = 80;

/**
 * The last call to `mock` that `select` accepts, or a named error naming what arrived.
 *
 * Returns the argument tuple, so callers destructure the argument they want rather
 * than indexing through a bang.
 */
export function lastCallTo<Args extends unknown[]>(
	mock: CallRecorder<Args>,
	select?: CallSelector<Args>,
): Args {
	const { calls } = mock.mock;
	const matched = calls.filter(matcherFor(select)).at(-1);
	if (!matched)
		throw new Error(`expected ${describeSelector(select)}, got ${describeCalls(calls)}`);
	return matched;
}

/**
 * The calls a test compares against each other, refused unless there are exactly
 * `expected` of them. Destructuring `mock.calls.map(…)` checks no count, so a missing
 * second call reads as `undefined` and `expect(first).not.toBe(second)` passes vacuously.
 */
export function callsTo<Args extends unknown[]>(
	mock: CallRecorder<Args>,
	expected: number,
	select?: CallSelector<Args>,
): Args[] {
	const { calls } = mock.mock;
	const matched = calls.filter(matcherFor(select));
	if (matched.length !== expected) {
		throw new Error(
			`expected ${expected} ${describeExpectedCalls(select, expected)}, got ${matched.length}; recorded ${describeCalls(calls)}`,
		);
	}
	return matched;
}

/** `describeSelector`'s wording for a count rather than for one call. */
function describeExpectedCalls<Args extends unknown[]>(select: CallSelector<Args> | undefined, count: number): string {
	const noun = count === 1
		? 'call'
		: 'calls';
	if (select === undefined)
		return noun;
	if (typeof select === 'string')
		return `${noun} to ${select}`;
	return `${noun} matching ${select.name || 'the given matcher'}`;
}

function matcherFor<Args extends unknown[]>(select?: CallSelector<Args>): (call: Args) => boolean {
	if (select === undefined)
		return () => true;
	if (typeof select === 'function')
		return select;
	return call => call[0] === select;
}

function describeSelector<Args extends unknown[]>(select?: CallSelector<Args>): string {
	if (select === undefined)
		return 'a call';
	if (typeof select === 'string')
		return `a call to ${select}`;
	return `a call matching ${select.name || 'the given matcher'}`;
}

/** What arrived instead: the most recent calls, earlier ones elided. */
function describeCalls(calls: unknown[][]): string {
	if (calls.length === 0)
		return 'none';
	const listed = calls.slice(-LISTED_CALLS);
	const elided = calls.length - listed.length;
	const rendered = listed.map(renderFirstArgument).join(', ');
	return elided > 0
		? `only [… ${elided} earlier, ${rendered}]`
		: `only [${rendered}]`;
}

function renderFirstArgument(call: unknown[]): string {
	if (call.length === 0)
		return '(no arguments)';
	const rendered = safeStringify(call[0]);
	return rendered.length > RENDERED_ARGUMENT_CHARS
		? `${rendered.slice(0, RENDERED_ARGUMENT_CHARS)}…`
		: rendered;
}

/** A rendering that cannot itself throw, so the diagnostic survives a circular payload. */
function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	}
	catch {
		try {
			return String(value);
		}
		catch {
			return '(unrenderable)';
		}
	}
}

/**
 * The calls a test means, chosen by name rather than taken by position.
 *
 * Two functions live here rather than the one this file is named for: `lastCallTo`
 * answers "which call", and `callsTo` below answers "which calls, and how many". The
 * name stayed at the older function's in #342 — thirteen files import from this path,
 * and a rename buys a reader nothing they do not get from this sentence while costing
 * every one of them an edit, in a round where sibling branches hold test files.
 *
 * A mock's call list belongs to the mock, not to the test — anything else sharing the
 * subject writes into it too. #273 proved the consequence in situ: `evidence.test.ts`
 * mocks `$fetch`, Nuxt's global route middleware starts a clock sync through the same
 * `$fetch`, and two `/api/time` samples land on every mount (#123). A read that takes
 * the last call gets a stray's arguments; a `toHaveBeenCalled` guard in front of it
 * passes, because a call does exist — just not the one under test. So this helper
 * **selects** before it takes the last, and the selector is the point of it.
 *
 * The second half is legibility. The shape it replaces is `mock.calls.at(-1)![1]`,
 * whose failure when nothing was recorded is `TypeError: Cannot read properties of
 * undefined` — a message that names neither the mock nor the expectation, and that
 * reads as a type crash in whatever branch happens to be running when one of #123's
 * load flakes fires. Here the same case is a named error that says what was wanted and
 * lists what arrived instead, which is usually enough to tell a flake from a defect
 * without re-running anything.
 *
 * ```ts
 * const [, options] = lastCallTo(mockApiFetch, '/api/admin/graphics-assets/evidence');
 * const [line] = lastCallTo(errorSpy, isPublishFailureLine);
 * ```
 *
 * The selector is optional, and leaving it off is honest only where the mock has
 * exactly one caller — a purpose-built port method, say, that nothing but the code
 * under test can reach. Where a subject is shared (a global `$fetch`, a `console`
 * spy), name the call: the unselected form cannot tell a stray from a subject, which
 * is the defect this file exists to prevent.
 *
 * **A sweep for `!` does not find every site this replaces.** #280 found its four by
 * searching for the bang, and that search is blind to the same defect written without
 * one — `spy.mock.calls.map(...)` followed by `[0]` on the result. The index is
 * unchecked, the empty case is the identical `Cannot read properties of undefined`, and
 * no `!` appears anywhere in it, so it survived both #273 and #280 untouched.
 * `ably.test.ts` carried the instance #300 closed; #330 then found three more in a
 * **destructuring** spelling — `const [first, second] = mock.calls.map(…)`, which has
 * no index in it either — in `broadcastGraphicsLiveSession.test.ts`. Those wanted
 * `callsTo` rather than this function, for the reason below.
 *
 * **#342 ran the sweep this paragraph used to ask for**: every shape, indexed or
 * `.at()` or destructured, bang or no bang, `.map()` in between or not — 83 reads across
 * 37 test files. Twelve of them were converted, and the judgement is the point of the
 * exercise, because the other 71 are honest. Convert where either holds:
 *
 * - **Something other than the code under test writes to the subject.** A
 *   `mockNuxtImport('$fetch')` mock is the standing example, because the clock sync's
 *   `/api/time` samples are recorded there (#123) — as is a `console` spy, and a module
 *   mock that records every message a module publishes, where `.at(-1)` follows whichever
 *   announcement happened to be last rather than the one under test. It is the mock's
 *   declaration that decides this and not the suite's environment: a *global* `fetch`
 *   stub in the Nuxt environment does **not** see the clock sync, because `$fetch` never
 *   reaches it — the sample fails inside `$fetch`, the run prints "Server time sync
 *   unavailable", and the stub records only what the page itself asked for (checked in
 *   `test/nuxt/pages/event/[eventId]/screen/[screenSlug].test.ts`).
 * - **The subject of the read is the relationship between two calls**, where the count
 *   belongs at the read rather than in a `toHaveBeenCalledTimes` a few lines above it.
 *   That is `callsTo`'s case, below.
 *
 * The 71 are purpose-built mocks with one caller — a DB or port double, a prop callback,
 * a toast a component's own suite counts before it reads. There the unselected form says
 * what it means, and its failure is loud rather than quiet: a missing call makes the read
 * `undefined`, and `expect(undefined).not.toHaveProperty(…)` does not pass vacuously the
 * way one might fear — it throws `TypeError: Cannot convert undefined or null to object`.
 * Worth having checked, since the opposite would have made a dozen `calls[0]?.[n]` sites
 * urgent instead of merely inelegant.
 *
 * Filed as #280, generalising the guard #273 built for one site; swept in #342.
 */

/**
 * The part of a Vitest mock this reads.
 *
 * Structural rather than `MockInstance`, because the four sites hand it three
 * different things — `vi.fn()`, `vi.spyOn(...)` and `vi.mocked(port.method)` — and
 * the argument tuple is what needs to survive to the caller, not the mock's own type.
 */
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
 * The calls a test means to compare against each other, and a refusal if there are not
 * exactly as many as it thinks.
 *
 * `lastCallTo` answers "which call", which is the wrong question for a test whose whole
 * subject is the **relationship between two** calls — that a retry reuses the first
 * attempt's command id, that two presses do not share one. Those read
 * `const [first, second] = mock.calls.map(…)`, and the count is the thing nothing
 * checks: on a run that recorded one call `second` is `undefined`, so
 * `expect(first).not.toBe(second)` passes while the second command was never sent, and
 * on a run that recorded none `expect(retried).toBe(first)` compares `undefined` to
 * `undefined` and passes too. Both are #273/#280's defect in the direction that hides
 * best — a vacuous pass rather than a `TypeError` — and #330 found three of them in one
 * file.
 *
 * So `expected` is required and is the point of the function. A count asserted here
 * cannot drift from the destructuring it guards, which is what happens when a
 * `toHaveBeenCalledTimes` sits a few lines above and someone later adds a selector, an
 * argument, or a third call.
 *
 * ```ts
 * const [first, retried] = callsTo(mockRepository.sendCommand, 2).map(call => call[3]);
 * ```
 *
 * The selector carries `lastCallTo`'s meaning unchanged: name the call where anything
 * else can reach the subject, and leave it off only for a purpose-built mock the code
 * under test is the sole caller of.
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
	const noun = count === 1 ? 'call' : 'calls';
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

/**
 * What arrived instead. The listed calls are the most recent ones, which is the useful
 * end for both callers, for two different reasons: `lastCallTo` takes the last match, so
 * a stray that displaced the call it wanted is right there — and `callsTo` reports a
 * count, where the tail is what the run just added and the earlier calls are elided
 * rather than blamed.
 */
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

/**
 * A rendering that cannot itself throw. The message is a diagnostic for a test that
 * has already failed, so a circular payload or a hostile getter must degrade to
 * something readable rather than replace the named error with its own.
 */
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

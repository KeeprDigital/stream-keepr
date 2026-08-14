import type { AsyncActionOptions } from './useAsyncAction';

/**
 * `useAsyncAction` for a store whose failures carry the authority's own words.
 *
 * `executeReporting` is `executeAction` with one difference: where the failure it caught
 * wrote a sentence about the request, that sentence is what reaches `errorRef` instead of
 * the transport's status line. Everything else — the loading ref, the rollback hook, the
 * `throwError` contract, the `null` an unhandled failure resolves to — is unchanged,
 * because it is the same composable underneath.
 *
 * The substitution sits inside the action rather than around the whole call, and that
 * placement is the contract a consumer builds on: `executeAction` still meets a failure
 * carrying the sentence, so an `onError` rollback and a `throwError` rejection both
 * receive it, while anything the action nests further inside — a retry reading a
 * `FetchError`'s status, say — still meets the raw failure untouched.
 *
 * It is a separate composable, not a second method on `useAsyncAction`, because reporting
 * the authority's sentence is a decision a surface makes: the Screen Output showing a bare
 * status line and the Live Control showing a refusal are not the same reader, and a store
 * adopts this by naming it rather than by hand-copying the wrapper #245 wrote when there
 * was no composable to put one in (`967d1aa`, #262). So the order runs the other way from
 * the ticket numbers: #262 built this and moved six stores onto it (`f82864a`), and #245's
 * own live-session store followed as the seventh, its inline re-raise becoming a single
 * delegation (`32e858e`). Those two numbers are that moment's and are kept here as history
 * — #271 added the Card store and the Player List member Module, #353 the Screen store, and
 * this line is not where a running total belongs. It is auto-imported, so a live count has
 * to be read from the call sites.
 *
 * A second, practical reason has since retired, and the rest of this is history. Suites
 * once stood a hand-written copy of `useAsyncAction` in for the real one returning
 * `{ executeAction }` alone, where a second method on that return would have been
 * `undefined`, while this composable calls whatever `useAsyncAction` a suite provides.
 * Nineteen suites did so when this was written and none do now — consolidated by #263,
 * then by #271 for the Card store's own suite and #290 for the Card Deck Sources one, and
 * last by #311, which took the two mocked Screen store suites onto the real composable.
 * The third, that store's error-reporting suite, never mocked it at all. Losing those two
 * is what let the Screen store drop its own hand-rolled copy of `executeReporting` and
 * name this one instead (#353).
 */
export function useReportingAction() {
	const { executeAction } = useAsyncAction();

	function executeReporting<T>(
		action: () => Promise<T>,
		options: AsyncActionOptions = {},
	): Promise<T | null> {
		return executeAction(() => withFailureSentence(action), options);
	}

	return { executeReporting };
}

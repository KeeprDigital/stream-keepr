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
 * A separate composable rather than a second method on `useAsyncAction`, because
 * reporting the authority's sentence is a decision a surface makes: the Screen Output
 * showing a bare status line and the Live Control showing a refusal are not the same
 * reader, and a store adopts this by naming it (#262 adopts six, #245 the seventh).
 *
 * That was once the second of two reasons. The first was practical: suites stood a
 * hand-written copy of `useAsyncAction` in for the real one returning `{ executeAction }`
 * alone, where a second method on that return would have been `undefined`, while this
 * composable calls whatever `useAsyncAction` a suite provides. Nineteen suites did so
 * when this was written, and the count is now zero — consolidated by #263, then by #271
 * for the Card store's own suite and #290 for the Card Deck Sources one, and finally by
 * #311, which put all three Screen store suites on the real composable. That last removal
 * is what let the Screen store drop its own hand-rolled copy of `executeReporting` and
 * name this one instead (#353). The reason above is the one still standing.
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

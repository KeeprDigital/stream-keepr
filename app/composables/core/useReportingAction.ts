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
 * A separate composable rather than a second method on `useAsyncAction`, for two reasons.
 * Reporting the authority's sentence is a decision a surface makes: the Screen Output
 * showing a bare status line and the Live Control showing a refusal are not the same
 * reader, and a store adopts this by naming it (#262 adopts six, #245 the seventh).
 * And practically, four suites still stand a hand-written copy of `useAsyncAction` in for
 * the real one, all of them returning `{ executeAction }` alone — a second method on that
 * return would be `undefined` in every one of them, while this composable calls whatever
 * `useAsyncAction` those suites provide. It was nineteen when this was written; #263
 * consolidated the rest onto the real composable, and the four that remain are the Card
 * and Screen stores' suites.
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

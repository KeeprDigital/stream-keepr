/**
 * The HTTP status a failed request carries, however the caller produced it.
 *
 * `$fetch` rejects with a `FetchError` carrying both `statusCode` and `status`,
 * a hand-rolled `fetch` branch carries whichever one the code that threw chose
 * to attach, and an ordinary `Error` carries neither. Deciding what a failure
 * means starts by reading its status the same way everywhere, so that a surface
 * which handles one kind of authorization loss handles all of them.
 */
export function failureStatus(caught: unknown): number | undefined {
	const failure = caught as { status?: number; statusCode?: number } | null;
	return failure?.statusCode ?? failure?.status;
}

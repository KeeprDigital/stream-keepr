/**
 * Expires the two cookies the Graphics Author Session left in browsers (#398,
 * ADR-0010's cutover).
 *
 * Hygiene, not correctness. Nothing reads either name since the module and its
 * minting middleware were retired, and the KV namespace behind the first clears
 * itself on its own 8-hour TTL — so the cost of leaving them would be a stale
 * `httpOnly` cookie sent on every request by every browser that was signed in
 * before the cutover, indefinitely. A deploy is the only moment that can reach
 * those browsers, which is why this is written now rather than left as tidying.
 *
 * **Both names are literals here.** The constants they came from are deleted, and
 * reintroducing either as an export would leave the codebase naming an identity
 * it no longer has. This file is the last thing in the application that knows
 * these strings, which is the whole reason it is one file.
 *
 * `deleteCookie` is `maxAge: 0` on the same path they were issued at — the
 * spelling ADR-0010 prescribed. Only cookies actually presented are expired, so
 * the ordinary request of a browser that never held one writes no header at all.
 *
 * **It refuses nothing**, deliberately: it is composed around every route in the
 * application, and `test/helpers/routeRefusalScan.ts` gives each middleware its
 * own graph. A refusal here would be a refusal every route inherits.
 *
 * Safe to delete once no browser that predates the cutover is still in use — a
 * few days of ordinary operation. Nothing breaks if it is kept.
 */
const RETIRED_COOKIES = [
	'stream_keepr_graphics_author_session',
	'stream_keepr_graphics_author_session_issue_failed',
] as const;

export default defineEventHandler((event) => {
	for (const name of RETIRED_COOKIES) {
		if (getCookie(event, name) !== undefined)
			deleteCookie(event, name, { path: '/' });
	}
});

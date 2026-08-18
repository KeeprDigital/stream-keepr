/**
 * What the realtime tests say about the key they were given, absent or unusable.
 *
 * #223 covered the *absent* key: a checkout with no `NUXT_ABLY_API_KEY` skips the two
 * tests that reach the service and says so once, before anything runs. #242 is the
 * other half. Only the empty string reads as absent, so a placeholder or a fabricated
 * but well-formed key reads as configured, and the run that follows is half green in a
 * way that hides its own cause:
 *
 *   - the realtime token test passes, because `createTokenRequest` computes its HMAC
 *     locally and never asks Ably whether the key names a real application;
 *   - the Screen-command test fails, because `publishScreenCommand` does reach Ably,
 *     which answers code 40400 — "no application found" — for a key whose
 *     application does not exist.
 *
 * That is the whole diagnosis sitting in plain sight and unspoken.
 * `diagnoseRealtimePublishFailure` turns it into a sentence, and the realtime
 * assertions carry that sentence as their failure message.
 *
 * What the failure *looks* like changed under #264, and both shapes are diagnosed:
 *
 *   - the Screen-command route now answers **502 "Realtime publish failed"**, its own
 *     name for a dependency refusing. That is unambiguous — no route answers it for
 *     any reason of its own — so the message is what the diagnosis matches on, and
 *     the server's `realtime_publish_failed` log line carries the provider's code;
 *   - a route that still propagates the provider's `ErrorInfo` untouched answers
 *     **404**, because h3's `createError` adopts `statusCode` from anything thrown.
 *     That was the Screen-command route until #264 and is the harder half to read:
 *     a 404 on a route whose own 404s are enumerable, which is why the caller has to
 *     name its own refusals before this can tell the two apart.
 *
 * It reports rather than skips, deliberately. An absent key is a checkout that never
 * claimed to have realtime; a rejected key is a configuration that claims to and does
 * not. Skipping would let a rotated, revoked or mistyped key go green in CI forever,
 * which is the failure mode #223 was trying to get away from, wearing the other face.
 */

/**
 * Named in both notices, in `.env.example`, in `.dev.vars.example`, and in
 * `build/devVars.ts` as the name #130's local-configuration notice deliberately
 * does not require. Keep the five in step — the last of them is pinned against
 * `.dev.vars.example` by `test/unit/build/devVars.test.ts`, the rest are not.
 */
export const INTEGRATION_ABLY_API_KEY_ENV = 'NUXT_ABLY_API_KEY';

/** #223: no key at all, so the two tests that reach the service do not run. */
export const INTEGRATION_REALTIME_SKIP_NOTICE
	= `[integration] realtime coverage skipped: ${INTEGRATION_ABLY_API_KEY_ENV} is not configured. `
		+ 'Every other test still runs; see .env.example. This is the expected state of a checkout without the secret.';

/**
 * #242: a key that exists and that Ably will not accept.
 *
 * Says the variable, the likely cause, and the fix, because the reader arriving at this
 * has a green token test in the same run telling them the opposite.
 */
export const INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE
	= `[integration] realtime publish rejected: ${INTEGRATION_ABLY_API_KEY_ENV} is set to a key Ably does not accept. `
		+ 'The likely cause is a placeholder or fabricated value: only the empty string reads as absent here, so any '
		+ 'well-formed string counts as configured, and Ably answers 404 with code 40400 ("no application found") for a '
		+ 'key whose application does not exist. The realtime token test passing is not evidence against this — '
		+ 'createTokenRequest signs locally and never asks the service. '
		+ `Fix: put a real key from your Ably app in ${INTEGRATION_ABLY_API_KEY_ENV} — .env for the test suites, `
		+ '.dev.vars for wrangler runs, see .env.example and .dev.vars.example — or clear it to the empty string, which '
		+ 'skips realtime coverage instead of failing it.';

/**
 * #264: the server's own name for a refused publish, and the status it wears.
 *
 * Duplicated deliberately from `server/utils/realtimePublishFailure.ts`, because this
 * file imports nothing — see the note on `INTEGRATION_ABLY_API_KEY_ENV` above for the
 * same trade. `test/unit/integration/realtimeDiagnosis.test.ts` runs a refusal through
 * the real error mapping and asserts the result is what this matches on, so a rename
 * on the server side fails there rather than quietly costing the notice.
 */
export const REALTIME_PUBLISH_FAILED_MESSAGE = 'Realtime publish failed';
const REALTIME_PUBLISH_FAILED_STATUS = 502;

/**
 * #264: the server saying, in its own voice, that the realtime service refused it.
 *
 * The sibling of the notice above with better evidence behind it and less certainty
 * in front of it. Better evidence, because the server now logs the provider's own
 * `statusCode`/`errorCode`/`reason` beside the request — so the reader can be sent to
 * a line that answers the question outright instead of inferring it from a status.
 * Less certainty, because a 502 does not distinguish a key Ably will not accept from
 * Ably being unwell, where the 404 band very nearly did. It names the likely cause
 * and then points at the thing that knows.
 */
export const INTEGRATION_REALTIME_PUBLISH_FAILED_NOTICE
	= '[integration] realtime publish refused: the server reached Ably and Ably would not accept the publish. '
		+ `The likely cause is ${INTEGRATION_ABLY_API_KEY_ENV} holding a placeholder or fabricated value — only the empty `
		+ 'string reads as absent here, so any well-formed string counts as configured, and Ably answers code 40400 '
		+ '("no application found") for a key whose application does not exist. The realtime token test passing is not '
		+ 'evidence against this — createTokenRequest signs locally and never asks the service. '
		+ 'The server said which it was: find the `realtime_publish_failed` line in the run output and read its '
		+ '`errorCode` and `reason` — 40400 is a key Ably does not know, 401/403 a key it will not honour, 5xx the '
		+ `service itself. Fix for the usual case: put a real key from your Ably app in ${INTEGRATION_ABLY_API_KEY_ENV} — `
		+ '.env for the test suites, .dev.vars for wrangler runs, see .env.example and .dev.vars.example — or clear it to '
		+ 'the empty string, which skips realtime coverage instead of failing it.';

/**
 * A refusal a route raises on its own terms: the status it answers with, and the
 * message it answers.
 *
 * Both halves, because the diagnosis fires on a status band and excuses on a
 * message, and #268 found the join missing: a message excused at every status in
 * the band means a genuine credential refusal whose body happened to echo the
 * route's own wording would go unremarked. A route that raises 'Screen not found'
 * at 404 has said nothing about what a 401 carrying those words would mean.
 */
export interface RouteRefusal {
	readonly statusCode: number;
	readonly message: string;
}

/**
 * Every refusal the Screen-command route raises on its own terms.
 *
 * This list is what separates "the route said no" from "the provider said no", so it
 * has to stay exhaustive. `test/unit/integration/realtimeDiagnosis.test.ts` reads
 * `command.post.ts` and fails when the route grows a refusal inside the credential
 * band that this does not name — the whole band since #268, where the scan filtered
 * on 404 alone and a route-grown 403 slipped past it silently.
 *
 * It is a caller's argument rather than a default, because it is true of one route
 * only. A second realtime-backed assertion — layout placements raises three distinct
 * 404s — would otherwise inherit this list and read its own legitimate refusals as a
 * fabricated key. Making the caller name its route's refusals keeps that structural
 * instead of documentary.
 *
 * 'Event not found' is the route's refusal as surely as 'Screen not found' is, even
 * though the route file does not raise it: Nitro composes `server/middleware/event-exists.ts`
 * around every `/api/events/:id/**` request, and it answers 404 for an Event that is not
 * there. #292 made the scan see it; listing it is what stops a fixture that never
 * inserted the Event from being answered with "check your Ably key". The narrow reading
 * matters — 404 only. A 401 or 403 carrying those same words is nothing this route says,
 * and stays diagnosed.
 *
 * 'Authentication is required' is the third, and it is the one ADR-0010 said in advance
 * would be added here: `server/middleware/api-session.ts` requires a Better Auth session
 * on every `/api/**` path the boundary does not exempt, and this route is inside it.
 * **The route really raises this**, which is the only ground on which anything may join
 * this list — the scan's own policy is to narrow the scan rather than widen the list, and
 * it is a policy about refusals the route *cannot* answer. A run whose session lapsed, or
 * a fixture that forgot the cookie, is answered by this 401 and not by Ably; diagnosing it
 * as a fabricated key would send a reader to their Ably dashboard over a missing header.
 *
 * The wording is the middleware's own literal, deliberately uniform across the whole
 * boundary, so this stays one entry rather than one per reason a session was absent. The
 * status pairing still matters as much as it does above: a 403 or a 404 carrying these
 * words is nothing this route says.
 */
export const SCREEN_COMMAND_ROUTE_REFUSALS: readonly RouteRefusal[] = [
	{ statusCode: 404, message: 'Screen not found' },
	{ statusCode: 404, message: 'Event not found' },
	{ statusCode: 401, message: 'Authentication is required' },
];

/** Nitro's own miss, when no handler matched: a renamed route, not a rejected key. */
const UNROUTED_MESSAGE_PREFIX = 'Cannot find any route matching';

/**
 * The statuses Ably uses to refuse a key: 404/40400 for an application it does not
 * know, 401/403 for a key it knows and will not honour. A 5xx is the service being
 * unwell rather than the key being wrong, and gets no diagnosis.
 *
 * Exported since #268 so the scan that keeps a route's refusal list exhaustive
 * filters on the same band this consults. Restating it there is what let the two
 * disagree: the diagnosis answered 401 and 403, the scan demanded a listing for
 * neither.
 */
export const CREDENTIAL_REJECTION_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/**
 * Nitro reports the thrown error's `message`; `statusMessage` is the fallback for a
 * body that carries only the status line. Both are absent from a body that is not an
 * error envelope at all, and an unrecognised body is not evidence either way.
 */
function errorMessageOf(body: unknown): string | undefined {
	if (typeof body !== 'object' || body === null)
		return undefined;

	const envelope = body as Record<string, unknown>;
	for (const field of ['message', 'statusMessage']) {
		const value = envelope[field];
		if (typeof value === 'string' && value.length > 0)
			return value;
	}
	return undefined;
}

/**
 * The notice for a realtime-backed response that did not succeed, or `undefined` where
 * the response is the route's own answer and the bare assertion already reads true.
 *
 * `routeRefusals` is every refusal the route under test raises on its own terms — for
 * the Screen-command route, `SCREEN_COMMAND_ROUTE_REFUSALS`. It is required because a
 * diagnosis is only as good as that list: anything in the credential-rejection band
 * this function is not told about becomes a rejected key, so a caller that omitted its
 * route's own 404s would get confident nonsense.
 *
 * Pass the result as the assertion's message: it costs nothing on a pass and is the
 * only thing standing between a reader and half an hour with Ably's error codes on a
 * failure.
 */
export function diagnoseRealtimePublishFailure(
	status: number,
	body: unknown,
	routeRefusals: readonly RouteRefusal[],
): string | undefined {
	const message = errorMessageOf(body);

	// The named classification is matched on its message, not its status, and this
	// is the one place the message is required rather than merely respected: 502 is
	// also what Melee and Scryfall failures are mapped to, and "check your Ably key"
	// is a wrong answer to either. A route answers this message for no reason of its
	// own, so no refusal list is consulted.
	if (status === REALTIME_PUBLISH_FAILED_STATUS && message === REALTIME_PUBLISH_FAILED_MESSAGE)
		return `${INTEGRATION_REALTIME_PUBLISH_FAILED_NOTICE} Observed: HTTP ${status} — ${message}.`;

	if (!CREDENTIAL_REJECTION_STATUSES.has(status))
		return undefined;

	// Matched as a pair. A route names the statuses it raises each refusal at, and a
	// message excused at every status in the band would excuse the provider for
	// echoing it — see `RouteRefusal`. Nitro's unrouted miss is status-agnostic
	// because it is not the route speaking at all.
	const isRouteRefusal = routeRefusals.some(
		refusal => refusal.statusCode === status && refusal.message === message,
	);
	if (message !== undefined && (isRouteRefusal || message.startsWith(UNROUTED_MESSAGE_PREFIX)))
		return undefined;

	const observed = message === undefined ? `HTTP ${status}` : `HTTP ${status} — ${message}`;
	return `${INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE} Observed: ${observed}.`;
}

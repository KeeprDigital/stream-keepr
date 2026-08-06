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
 *   - the Screen-command test fails `expected 404 to be 200`, because
 *     `publishScreenCommand` does reach Ably, which answers code 40400 — "no
 *     application found" — for a key whose application does not exist. Ably's
 *     `ErrorInfo` carries `statusCode: 404`, h3's `createError` adopts it, and the
 *     route answers 404 without ever saying whose 404 it was.
 *
 * That is the whole diagnosis sitting in plain sight and unspoken: a 404 on a route
 * whose own 404s are enumerable. `diagnoseRealtimePublishFailure` turns it into a
 * sentence, and the realtime assertions carry that sentence as their failure message.
 *
 * It reports rather than skips, deliberately. An absent key is a checkout that never
 * claimed to have realtime; a rejected key is a configuration that claims to and does
 * not. Skipping would let a rotated, revoked or mistyped key go green in CI forever,
 * which is the failure mode #223 was trying to get away from, wearing the other face.
 */

/**
 * Named in both notices, in `.env.example` and in `.dev.vars.example`.
 * Keep the four in step.
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
 * Every refusal the Screen-command route raises on its own terms.
 *
 * This list is what separates "the route said no" from "the provider said no", so it
 * has to stay exhaustive. `test/unit/integration/realtimeDiagnosis.test.ts` reads
 * `command.post.ts` and fails when the route grows a 404 this does not name.
 */
export const SCREEN_COMMAND_ROUTE_REFUSALS = ['Screen not found'];

/** Nitro's own miss, when no handler matched: a renamed route, not a rejected key. */
const UNROUTED_MESSAGE_PREFIX = 'Cannot find any route matching';

/**
 * The statuses Ably uses to refuse a key: 404/40400 for an application it does not
 * know, 401/403 for a key it knows and will not honour. A 5xx is the service being
 * unwell rather than the key being wrong, and gets no diagnosis.
 */
const CREDENTIAL_REJECTION_STATUSES = new Set([401, 403, 404]);

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
 * Pass it as the assertion's message: it costs nothing on a pass and is the only thing
 * standing between a reader and half an hour with Ably's error codes on a failure.
 */
export function diagnoseRealtimePublishFailure(status: number, body: unknown): string | undefined {
	if (!CREDENTIAL_REJECTION_STATUSES.has(status))
		return undefined;

	const message = errorMessageOf(body);
	if (message !== undefined && (SCREEN_COMMAND_ROUTE_REFUSALS.includes(message) || message.startsWith(UNROUTED_MESSAGE_PREFIX)))
		return undefined;

	const observed = message === undefined ? `HTTP ${status}` : `HTTP ${status} — ${message}`;
	return `${INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE} Observed: ${observed}.`;
}

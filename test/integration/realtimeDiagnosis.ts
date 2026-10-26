/**
 * What the realtime tests say about the Ably key they were given, absent or unusable.
 *
 * Only the empty string reads as absent, so a placeholder key leaves a half-green run:
 * the token test passes (`createTokenRequest` signs locally) while the Screen-command
 * test fails, because the publish reaches Ably. The diagnosis turns that into the
 * assertion's failure message. It reports rather than skips, so a revoked or mistyped
 * key cannot go green (#223, #242, #264).
 */

/** Also named in `.env.example` and `build/localConfiguration.ts`. */
export const INTEGRATION_ABLY_API_KEY_ENV = 'NUXT_ABLY_API_KEY';

export const INTEGRATION_REALTIME_SKIP_NOTICE
	= `[integration] realtime coverage skipped: ${INTEGRATION_ABLY_API_KEY_ENV} is not configured. `
		+ 'Every other test still runs; see .env.example. This is the expected state of a checkout without the secret.';

export const INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE
	= `[integration] realtime publish rejected: ${INTEGRATION_ABLY_API_KEY_ENV} is set to a key Ably does not accept. `
		+ 'The likely cause is a placeholder or fabricated value: only the empty string reads as absent here, so any '
		+ 'well-formed string counts as configured, and Ably answers 404 with code 40400 ("no application found") for a '
		+ 'key whose application does not exist. The realtime token test passing is not evidence against this — '
		+ 'createTokenRequest signs locally and never asks the service. '
		+ `Fix: put a real key from your Ably app in ${INTEGRATION_ABLY_API_KEY_ENV} — .env, which is what the test `
		+ 'suites read and what `pnpm preview` stages for wrangler runs; see .env.example — or clear it to the empty '
		+ 'string, which skips realtime coverage instead of failing it.';

/**
 * The server's own name for a refused publish, duplicated from
 * `server/utils/realtimePublishFailure.ts` because this file imports nothing; the unit
 * test runs a refusal through the real error mapping to keep the two joined.
 */
export const REALTIME_PUBLISH_FAILED_MESSAGE = 'Realtime publish failed';
const REALTIME_PUBLISH_FAILED_STATUS = 502;

export const INTEGRATION_REALTIME_PUBLISH_FAILED_NOTICE
	= '[integration] realtime publish refused: the server reached Ably and Ably would not accept the publish. '
		+ `The likely cause is ${INTEGRATION_ABLY_API_KEY_ENV} holding a placeholder or fabricated value — only the empty `
		+ 'string reads as absent here, so any well-formed string counts as configured, and Ably answers code 40400 '
		+ '("no application found") for a key whose application does not exist. The realtime token test passing is not '
		+ 'evidence against this — createTokenRequest signs locally and never asks the service. '
		+ 'The server said which it was: find the `realtime_publish_failed` line in the run output and read its '
		+ '`errorCode` and `reason` — 40400 is a key Ably does not know, 401/403 a key it will not honour, 5xx the '
		+ `service itself. Fix for the usual case: put a real key from your Ably app in ${INTEGRATION_ABLY_API_KEY_ENV} — `
		+ '.env, which is what the test suites read and what `pnpm preview` stages for wrangler runs; see .env.example — '
		+ 'or clear it to the empty string, which skips realtime coverage instead of failing it.';

/** A refusal a route raises on its own terms, matched on status and message together. */
export interface RouteRefusal {
	readonly statusCode: number;
	readonly message: string;
}

/**
 * Every refusal the Screen-command route raises itself, including the ones composed
 * around it by `event-exists.ts` and the `api-session.ts` boundary. Anything else in
 * the credential band reads as a rejected key.
 */
export const SCREEN_COMMAND_ROUTE_REFUSALS: readonly RouteRefusal[] = [
	{ statusCode: 404, message: 'Screen not found' },
	{ statusCode: 404, message: 'Event not found' },
	{ statusCode: 401, message: 'Authentication is required' },
];

/** Nitro's own miss, when no handler matched: a renamed route, not a rejected key. */
const UNROUTED_MESSAGE_PREFIX = 'Cannot find any route matching';

/** Ably refuses a key it does not know with 404, and one it will not honour with 401/403. */
const CREDENTIAL_REJECTION_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

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
 * the response is the route's own answer. Pass it as the assertion's message.
 * `routeRefusals` must name every refusal the route under test raises itself.
 */
export function diagnoseRealtimePublishFailure(
	status: number,
	body: unknown,
	routeRefusals: readonly RouteRefusal[],
): string | undefined {
	const message = errorMessageOf(body);

	// Matched on the message: Melee and Scryfall failures also answer 502.
	if (status === REALTIME_PUBLISH_FAILED_STATUS && message === REALTIME_PUBLISH_FAILED_MESSAGE)
		return `${INTEGRATION_REALTIME_PUBLISH_FAILED_NOTICE} Observed: HTTP ${status} — ${message}.`;

	if (!CREDENTIAL_REJECTION_STATUSES.has(status))
		return undefined;

	const isRouteRefusal = routeRefusals.some(
		refusal => refusal.statusCode === status && refusal.message === message,
	);
	if (message !== undefined && (isRouteRefusal || message.startsWith(UNROUTED_MESSAGE_PREFIX)))
		return undefined;

	const observed = message === undefined
		? `HTTP ${status}`
		: `HTTP ${status} — ${message}`;
	return `${INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE} Observed: ${observed}.`;
}

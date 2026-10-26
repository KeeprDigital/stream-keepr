import { describe, expect, it } from 'vitest';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';
import { RealtimePublishError } from '~~/server/utils/realtimePublishFailure';
import { providerRefusal } from '~~/test/helpers/providerRefusal';
import {
	diagnoseRealtimePublishFailure,
	INTEGRATION_ABLY_API_KEY_ENV,
	REALTIME_PUBLISH_FAILED_MESSAGE,
	SCREEN_COMMAND_ROUTE_REFUSALS,
} from '~~/test/integration/realtimeDiagnosis';

/** The dev-mode Nitro error envelope the integration suite reads. */
function nitroError(statusCode: number, message: string) {
	return { error: true, statusCode, statusMessage: 'Server Error', message };
}

function diagnose(status: number, body: unknown) {
	return diagnoseRealtimePublishFailure(status, body, SCREEN_COMMAND_ROUTE_REFUSALS);
}

describe('diagnosing a rejected realtime publish', () => {
	it.each([
		['Ably not knowing the application', 404, nitroError(404, 'No application found'), 'Observed: HTTP 404 — No application found.'],
		['a key Ably will not honour', 401, nitroError(401, 'Invalid key in request'), 'Observed: HTTP 401'],
		['a forbidden key', 403, nitroError(403, 'Forbidden'), 'Observed: HTTP 403'],
		['the sanitised body a non-dev run returns', 404, nitroError(404, 'Server Error'), 'Observed: HTTP 404'],
		['a refusal with no readable body', 404, null, 'Observed: HTTP 404.'],
		['a route refusal at a status the route does not raise it at', 401, nitroError(401, 'Screen not found'), 'Observed: HTTP 401'],
		['the server\'s own name for a refused publish', 502, nitroError(502, REALTIME_PUBLISH_FAILED_MESSAGE), 'realtime_publish_failed'],
	])('names the key for %s', (_, status, body, observed) => {
		const notice = diagnose(status, body);

		expect(notice).toContain(INTEGRATION_ABLY_API_KEY_ENV);
		expect(notice).toContain(observed);
	});

	it.each([
		['a success', 200, { ok: true }],
		...SCREEN_COMMAND_ROUTE_REFUSALS.map(refusal => [
			`the route's own "${refusal.message}"`,
			refusal.statusCode,
			nitroError(refusal.statusCode, refusal.message),
		] as const),
		['Nitro\'s unrouted miss', 404, nitroError(404, 'Cannot find any route matching /api/events/1/screens/2/command.')],
		['another gateway failure', 502, nitroError(502, 'Melee.gg is temporarily unavailable. Try again later.')],
		['a bare 502', 502, null],
		['a server error', 500, nitroError(500, 'Internal Server Error')],
		['an unconfigured key, which names the setting itself', 503, nitroError(503, `${INTEGRATION_ABLY_API_KEY_ENV} is not configured`)],
		['a conflict', 409, nitroError(409, 'Conflict')],
	])('says nothing about %s', (_, status, body) => {
		expect(diagnose(status, body)).toBeUndefined();
	});

	it('excuses only the refusals the caller names for its route', () => {
		const placementRefusal = nitroError(404, 'Layout placement not found');

		expect(diagnoseRealtimePublishFailure(404, placementRefusal, [
			{ statusCode: 404, message: 'Layout placement not found' },
		])).toBeUndefined();
		expect(diagnose(404, placementRefusal)).toBeDefined();
	});

	it('recognises the classification the server\'s error mapping gives a refused publish', () => {
		// The diagnosis matches a literal; this keeps it joined to the real mapping.
		const error = { statusCode: 500, message: 'Something went wrong', cause: new RealtimePublishError(providerRefusal()), unhandled: true };

		mapPublicNitroError(error);

		expect(diagnose(error.statusCode, nitroError(error.statusCode, error.message))).toBeDefined();
	});
});

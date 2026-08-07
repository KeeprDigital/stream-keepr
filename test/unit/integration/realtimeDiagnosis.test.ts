import type { RouteRefusal } from '~~/test/integration/realtimeDiagnosis';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';
import { RealtimePublishError } from '~~/server/utils/realtimePublishFailure';
import { providerRefusal } from '~~/test/helpers/providerRefusal';
import {
	CREDENTIAL_REJECTION_STATUSES,
	diagnoseRealtimePublishFailure,
	INTEGRATION_ABLY_API_KEY_ENV,
	INTEGRATION_REALTIME_PUBLISH_FAILED_NOTICE,
	INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE,
	INTEGRATION_REALTIME_SKIP_NOTICE,
	REALTIME_PUBLISH_FAILED_MESSAGE,
	SCREEN_COMMAND_ROUTE_REFUSALS,
} from '~~/test/integration/realtimeDiagnosis';

/**
 * That a fabricated Ably key is diagnosed rather than left to look like a lease bug.
 *
 * The integration suite is the only thing that can produce this evidence and the one
 * suite an implementer may not run, so the judgement is extracted here where it can be
 * exercised against every response shape the round-end run might actually see: Ably's
 * 404/40400, the route's own 404, Nitro's unrouted 404, and the sanitised body a
 * non-dev run returns. The wiring in `graphicsAuthoringLease.test.ts` is then a single
 * call, and everything that could be wrong about *what* it says is settled here.
 *
 * `SCREEN_COMMAND_ROUTE_REFUSALS` is the load-bearing list — it is the whole of what
 * separates "the route said no" from "the provider said no". The scan at the bottom is
 * what keeps it exhaustive, because the route growing a second refusal inside the
 * credential band would otherwise silently start attracting a notice about an Ably key
 * that is perfectly fine. #268: the scan filtered on 404 while the band was
 * {401, 403, 404}, so it kept the list exhaustive over a third of the band.
 */

const commandRoutePath = fileURLToPath(
	new URL('../../../server/api/events/[id]/screens/[screenId]/command.post.ts', import.meta.url),
);

/** The dev-mode Nitro error envelope, which is what the integration suite reads. */
function nitroError(statusCode: number, message: string) {
	return { error: true, statusCode, statusMessage: 'Server Error', message };
}

/** The diagnosis as the lease suite calls it: against the Screen-command route. */
function diagnose(status: number, body: unknown) {
	return diagnoseRealtimePublishFailure(status, body, SCREEN_COMMAND_ROUTE_REFUSALS);
}

describe('diagnosing a rejected realtime publish', () => {
	it('says nothing about a Screen command that succeeded', () => {
		expect(diagnose(200, { ok: true })).toBeUndefined();
	});

	it('names the variable, the cause and the fix when Ably does not know the application', () => {
		// Ably's 40400 for a well-formed key whose app does not exist. `ErrorInfo`
		// carries `statusCode: 404`, h3 adopts it, and the route answers 404.
		const notice = diagnose(404, nitroError(404, 'No application found'));

		expect(notice).toBeDefined();
		expect(notice).toContain(INTEGRATION_ABLY_API_KEY_ENV);
		expect(notice).toContain('placeholder or fabricated');
		expect(notice).toContain('40400');
		expect(notice).toContain('.dev.vars');
		expect(notice).toContain('Fix:');
	});

	it('warns that the passing token test is not evidence the key works', () => {
		// The half-green run is the whole reason this exists: a reader looking at a
		// green `createTokenRequest` test will not suspect the key without being told.
		const notice = diagnose(404, nitroError(404, 'No application found'));

		expect(notice).toContain('createTokenRequest signs locally');
	});

	it('carries the status and provider message it actually saw', () => {
		const notice = diagnose(404, nitroError(404, 'No application found'));

		expect(notice).toContain('Observed: HTTP 404 — No application found.');
	});

	it('leaves the route\'s own refusal to speak for itself', () => {
		// A missing Screen is a fixture problem. Blaming the key here would send the
		// reader to Ably's dashboard over a row that was never inserted.
		for (const refusal of SCREEN_COMMAND_ROUTE_REFUSALS)
			expect(diagnose(refusal.statusCode, nitroError(refusal.statusCode, refusal.message))).toBeUndefined();
	});

	it('excuses a refusal only at the status the route raises it with', () => {
		// #268: a refusal is a status and a message, not a message. Excusing the text
		// at any status in the band would let a genuine credential refusal that
		// happened to echo the route's own wording pass unremarked.
		expect(diagnose(401, nitroError(401, 'Screen not found'))).toBeDefined();
	});

	it('leaves another route\'s own refusals to speak for themselves too', () => {
		// The refusal list is the caller's argument rather than a default fixed to the
		// Screen-command route. A second realtime-backed assertion — layout placements
		// raises three distinct 404s — would otherwise inherit this route's list and
		// read every one of its legitimate refusals as a fabricated key.
		const placementRefusal = nitroError(404, 'Layout placement not found');
		const placementRefusals = [{ statusCode: 404, message: 'Layout placement not found' }];

		expect(diagnoseRealtimePublishFailure(404, placementRefusal, placementRefusals)).toBeUndefined();
		// The same body on a route that cannot raise it is still a diagnosis, so the
		// argument is doing the work rather than the message text happening to look safe.
		expect(diagnose(404, placementRefusal)).toBeDefined();
	});

	it('leaves a route\'s own 403 to speak for itself, once the list names it', () => {
		// #268: the band is {401, 403, 404}, so a route that grows a refusal of its
		// own at 401 or 403 needs the same excusing a 404 gets — and gets it only by
		// being named. Both directions, because a list that excused everything would
		// pass the first half of this on its own.
		const locked = nitroError(403, 'Screen is locked');

		expect(diagnose(403, locked)).toBeDefined();
		expect(diagnoseRealtimePublishFailure(403, locked, [{ statusCode: 403, message: 'Screen is locked' }]))
			.toBeUndefined();
	});

	it('leaves a renamed route to speak for itself', () => {
		// Nitro's own miss. The route file moving is not a credentials problem, and it
		// arrives wearing the same 404 as one.
		const unrouted = nitroError(404, 'Cannot find any route matching /api/events/1/screens/2/command.');

		expect(diagnose(404, unrouted)).toBeUndefined();
	});

	it('diagnoses a key Ably knows and will not honour', () => {
		// A revoked or wrong-secret key is refused at 401 rather than 404, and the
		// reader's question — "is my key good?" — is identical.
		expect(diagnose(401, nitroError(401, 'Invalid key in request'))).toBeDefined();
		expect(diagnose(403, nitroError(403, 'Forbidden'))).toBeDefined();
	});

	it('diagnoses the sanitised body a non-dev run returns', () => {
		// Nitro's production handler replaces an unhandled error's message with
		// "Server Error", so the message cannot be required for the notice to fire —
		// only for it to be suppressed.
		const sanitised = { error: true, statusCode: 404, statusMessage: 'Server Error', message: 'Server Error' };

		expect(diagnose(404, sanitised)).toContain(INTEGRATION_ABLY_API_KEY_ENV);
	});

	it('diagnoses a refusal that arrived with no readable body', () => {
		expect(diagnose(404, null)).toContain('Observed: HTTP 404.');
	});

	it('diagnoses the server\'s own name for a refused publish', () => {
		// #264: the Screen-command route no longer wears Ably's 404. A refused
		// publish is classified as this server's 502, so the diagnosis has to
		// recognise the classification or the round-end run gets a bare
		// `expected 502 to be 200` — worse than the 404 it replaced.
		const notice = diagnose(502, nitroError(502, REALTIME_PUBLISH_FAILED_MESSAGE));

		expect(notice).toBeDefined();
		expect(notice).toContain(INTEGRATION_ABLY_API_KEY_ENV);
		expect(notice).toContain('realtime_publish_failed');
		expect(notice).toContain('Observed: HTTP 502 — Realtime publish failed.');
	});

	it('sends the reader to the log line rather than only to the key', () => {
		// A 502 does not distinguish a fabricated key from Ably being unwell, and
		// the notice must not claim it does. The server log names which it was;
		// this says so, and keeps the key hypothesis as the likely one.
		const notice = diagnose(502, nitroError(502, REALTIME_PUBLISH_FAILED_MESSAGE));

		expect(notice).toContain('errorCode');
		expect(notice).toContain('40400');
	});

	it('says nothing about a 502 that is some other gateway failure', () => {
		// The message is load-bearing here in the way the refusal list is at 404:
		// Melee and Scryfall both answer 502 through the same mapper, and neither
		// is answered by "check your Ably key".
		expect(diagnose(502, nitroError(502, 'Melee.gg is temporarily unavailable. Try again later.'))).toBeUndefined();
		expect(diagnose(502, nitroError(502, 'Card data provider is temporarily unavailable. Try again later.'))).toBeUndefined();
		expect(diagnose(502, nitroError(502, 'Server Error'))).toBeUndefined();
		expect(diagnose(502, null)).toBeUndefined();
	});

	it('says nothing about a server error, which is not a rejected key', () => {
		// A 500 is the service being unwell. Since #267 the absent-key case is a 503
		// that names the setting outright — a better answer than this notice could
		// give, and one the reader can act on without knowing anything about Ably.
		// Neither is answered by "your key is fake".
		expect(diagnose(503, nitroError(503, `${INTEGRATION_ABLY_API_KEY_ENV} is not configured`))).toBeUndefined();
		expect(diagnose(500, nitroError(500, 'Internal Server Error'))).toBeUndefined();
		expect(diagnose(409, nitroError(409, 'Conflict'))).toBeUndefined();
	});
});

describe('the realtime notices', () => {
	it('name the environment variable in both halves of the mechanism', () => {
		// #223 named it for the absent key; #242 has to name it for the rejected one,
		// or the reader has to already know which variable the run is talking about.
		expect(INTEGRATION_REALTIME_SKIP_NOTICE).toContain(INTEGRATION_ABLY_API_KEY_ENV);
		expect(INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE).toContain(INTEGRATION_ABLY_API_KEY_ENV);
	});

	it('are told apart by what they say happened', () => {
		expect(INTEGRATION_REALTIME_SKIP_NOTICE).toContain('skipped');
		expect(INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE).toContain('rejected');
		expect(INTEGRATION_REALTIME_PUBLISH_FAILED_NOTICE).toContain('refused');
	});

	it('all three name the environment variable', () => {
		expect(INTEGRATION_REALTIME_PUBLISH_FAILED_NOTICE).toContain(INTEGRATION_ABLY_API_KEY_ENV);
	});
});

/**
 * The join between the server's classification and the diagnosis that reads it.
 *
 * The diagnosis keys on a status and a message string, and `realtimeDiagnosis`
 * imports nothing on purpose — so the string is a literal on this side of the
 * boundary, and a rename on the server side would silently stop it firing. This
 * asserts the two agree by running the mapping the request actually goes through,
 * rather than by comparing the constant with itself.
 */
describe('the classification the Screen-command route produces', () => {
	/** The error as h3 hands it to the plugin: a non-H3Error arrives unhandled. */
	function thrownFromTheRoute() {
		return {
			statusCode: 500,
			message: 'Something went wrong',
			cause: new RealtimePublishError(providerRefusal()),
			unhandled: true,
		};
	}

	it('is the one the diagnosis is looking for', () => {
		const error = thrownFromTheRoute();

		mapPublicNitroError(error);

		expect(diagnose(error.statusCode, nitroError(error.statusCode, error.message))).toBeDefined();
	});

	it('is not the route\'s own 404, which is the whole point of the change', () => {
		const error = thrownFromTheRoute();

		mapPublicNitroError(error);

		expect(error.statusCode).not.toBe(404);
		expect(SCREEN_COMMAND_ROUTE_REFUSALS.map(refusal => refusal.message)).not.toContain(error.message);
	});
});

describe('the variable is named where each runner looks', () => {
	function example(name: string): string {
		return readFileSync(fileURLToPath(new URL(`../../../${name}`, import.meta.url)), 'utf8');
	}

	// `.env` is what the test suites and `nuxt dev` read; `.dev.vars` is what Wrangler
	// reads for `pnpm preview` and the delivery acceptance harnesses. #242 was filed
	// because only the first example file named the key, so a wrangler run had nothing
	// to copy and no pointer to what was missing.
	//
	// An assignment rather than a mention: both files explain the variable in prose as
	// well, and prose is not something a reader can copy into a real one. Deleting the
	// assignment while leaving the comment behind is exactly the regression that would
	// otherwise pass — it did, on the first version of this test.
	it.each(['.env.example', '.dev.vars.example'])('%s assigns it, not just mentions it', (name) => {
		expect(example(name)).toMatch(new RegExp(`^${INTEGRATION_ABLY_API_KEY_ENV}=`, 'm'));
	});
});

/** Every `createError({ statusCode, message })` the route raises, as a pair. */
function routeRefusals(source: ts.SourceFile): RouteRefusal[] {
	const refusals: RouteRefusal[] = [];

	function visit(node: ts.Node) {
		if (
			ts.isCallExpression(node)
			&& ts.isIdentifier(node.expression)
			&& node.expression.text === 'createError'
			&& node.arguments[0] !== undefined
			&& ts.isObjectLiteralExpression(node.arguments[0])
		) {
			const literals = new Map<string, ts.Expression>();
			for (const property of node.arguments[0].properties) {
				if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name))
					literals.set(property.name.text, property.initializer);
			}

			const statusCode = literals.get('statusCode');
			const message = literals.get('message');
			if (statusCode !== undefined && ts.isNumericLiteral(statusCode)) {
				refusals.push({
					statusCode: Number(statusCode.text),
					message: message !== undefined && ts.isStringLiteral(message) ? message.text : '',
				});
			}
		}
		node.forEachChild(visit);
	}

	visit(source);
	return refusals;
}

/**
 * The refusals the diagnosis could actually misread: the ones inside the band.
 *
 * #268: this filtered on 404 while the band was {401, 403, 404}, so a route that
 * grew a 403 of its own gained a legitimate refusal the diagnosis would answer with
 * "check your Ably key" and nothing would fail. The band is imported rather than
 * restated, so the scan cannot drift from the check it is guarding.
 */
function inCredentialBand(refusals: readonly RouteRefusal[]): RouteRefusal[] {
	return refusals.filter(refusal => CREDENTIAL_REJECTION_STATUSES.has(refusal.statusCode));
}

/** The banded refusals `SCREEN_COMMAND_ROUTE_REFUSALS` does not account for. */
function unlistedRefusals(refusals: readonly RouteRefusal[]): RouteRefusal[] {
	return refusals.filter(refusal => !SCREEN_COMMAND_ROUTE_REFUSALS.some(
		known => known.statusCode === refusal.statusCode && known.message === refusal.message,
	));
}

describe('the Screen-command route\'s own refusals', () => {
	const source = ts.createSourceFile(
		commandRoutePath,
		readFileSync(commandRoutePath, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
	);
	const refusals = routeRefusals(source);

	it('are found by the scan at all', () => {
		// A scan that stops matching passes silently, which is the failure mode this
		// whole file exists to avoid one level up.
		expect(refusals.length).toBeGreaterThan(0);
	});

	it('are every one of them recognised as the route\'s own', () => {
		// The route growing a second refusal inside the band without this list
		// growing with it would make that new refusal read as a fabricated Ably key.
		const banded = inCredentialBand(refusals);

		expect(banded.length).toBeGreaterThan(0);
		expect(unlistedRefusals(banded)).toEqual([]);
	});
});

/**
 * What the scan holds the route to, checked against refusals the route does not
 * have yet — which is the only way to establish it would catch them.
 *
 * The real-file assertion above passes on a scan that filters on nothing at all and
 * on a scan that filters everything out. These say which refusals it is supposed to
 * demand a listing for, and — the half #268 was filed over — which it must not.
 */
describe('what the scan holds the route to', () => {
	it('catches a route-grown 403, which the diagnosis would otherwise misread', () => {
		const locked = [{ statusCode: 403, message: 'Screen is locked' }];

		expect(inCredentialBand(locked)).toEqual(locked);
		expect(unlistedRefusals(inCredentialBand(locked))).toEqual(locked);
	});

	it('catches a route-grown 404 the list does not name, as it always did', () => {
		const missing = [{ statusCode: 404, message: 'Event not found' }];

		expect(unlistedRefusals(inCredentialBand(missing))).toEqual(missing);
	});

	it('leaves a refusal outside the band alone, because no diagnosis can reach it', () => {
		// A 409 or a 422 is never mistaken for a credential rejection, so demanding
		// it be listed would make the list a catalogue of the route rather than of
		// what the diagnosis can get wrong — noise the next person would delete.
		expect(inCredentialBand([
			{ statusCode: 409, message: 'Screen was modified concurrently' },
			{ statusCode: 422, message: 'Unknown command' },
		])).toEqual([]);
	});

	it('excuses a banded refusal only at the status the list names it at', () => {
		expect(unlistedRefusals([{ statusCode: 404, message: 'Screen not found' }])).toEqual([]);
		expect(unlistedRefusals([{ statusCode: 401, message: 'Screen not found' }]))
			.toEqual([{ statusCode: 401, message: 'Screen not found' }]);
	});
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
	diagnoseRealtimePublishFailure,
	INTEGRATION_ABLY_API_KEY_ENV,
	INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE,
	INTEGRATION_REALTIME_SKIP_NOTICE,
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
 * what keeps it exhaustive, because the route growing a second 404 would otherwise
 * silently start attracting a notice about an Ably key that is perfectly fine.
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
			expect(diagnose(404, nitroError(404, refusal))).toBeUndefined();
	});

	it('leaves another route\'s own refusals to speak for themselves too', () => {
		// The refusal list is the caller's argument rather than a default fixed to the
		// Screen-command route. A second realtime-backed assertion — layout placements
		// raises three distinct 404s — would otherwise inherit this route's list and
		// read every one of its legitimate refusals as a fabricated key.
		const placementRefusal = nitroError(404, 'Layout placement not found');

		expect(diagnoseRealtimePublishFailure(404, placementRefusal, ['Layout placement not found'])).toBeUndefined();
		// The same body on a route that cannot raise it is still a diagnosis, so the
		// argument is doing the work rather than the message text happening to look safe.
		expect(diagnose(404, placementRefusal)).toBeDefined();
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

	it('says nothing about a server error, which is not a rejected key', () => {
		// A 500 is the absent-key case (`getAblyClient` throws a plain Error) or the
		// service being unwell. Neither is answered by "your key is fake".
		expect(diagnose(500, nitroError(500, 'Ably server API key is not configured'))).toBeUndefined();
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
function routeRefusals(source: ts.SourceFile): { statusCode: number; message: string }[] {
	const refusals: { statusCode: number; message: string }[] = [];

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
		// The route growing a second 404 without this list growing with it would make
		// that new refusal read as a fabricated Ably key.
		const notFound = refusals.filter(refusal => refusal.statusCode === 404).map(refusal => refusal.message);

		expect(notFound.length).toBeGreaterThan(0);
		expect(notFound.filter(message => !SCREEN_COMMAND_ROUTE_REFUSALS.includes(message))).toEqual([]);
	});
});

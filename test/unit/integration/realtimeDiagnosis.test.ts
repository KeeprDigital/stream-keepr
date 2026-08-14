import type { ScannedRefusal } from '~~/test/helpers/routeRefusalScan';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';
import { RealtimePublishError } from '~~/server/utils/realtimePublishFailure';
import { providerRefusal } from '~~/test/helpers/providerRefusal';
import {
	firstPartyPathAliases,
	scanRouteRefusals,
	scanSourceForRefusals,
	serverMiddlewareFiles,
} from '~~/test/helpers/routeRefusalScan';
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
 * {401, 403, 404}, so it kept the list exhaustive over a third of the band. #277: it
 * then read only refusals written as numeric literals in `command.post.ts`, so a status
 * held in a `const` and a refusal raised from an imported guard were both invisible —
 * the scan itself lives in `test/helpers/routeRefusalScan.ts` since.
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

/**
 * The refusals the diagnosis could actually misread: the ones inside the band.
 *
 * #268: this filtered on 404 while the band was {401, 403, 404}, so a route that
 * grew a 403 of its own gained a legitimate refusal the diagnosis would answer with
 * "check your Ably key" and nothing would fail. The band is imported rather than
 * restated, so the scan cannot drift from the check it is guarding.
 */
function inCredentialBand(refusals: readonly ScannedRefusal[]): ScannedRefusal[] {
	// #277: a status the scan could not read stays in. It cannot be ruled out of the
	// band, and dropping what the scan could not read is the defect this ticket closed.
	return refusals.filter(
		refusal => refusal.statusCode === undefined || CREDENTIAL_REJECTION_STATUSES.has(refusal.statusCode),
	);
}

/** The banded refusals `SCREEN_COMMAND_ROUTE_REFUSALS` does not account for. */
function unlistedRefusals(refusals: readonly ScannedRefusal[]): ScannedRefusal[] {
	// An unreadable half is `undefined`, which equals no listed half, so a refusal the
	// scan could not read reports as unaccounted-for rather than as excused.
	return refusals.filter(refusal => !SCREEN_COMMAND_ROUTE_REFUSALS.some(
		known => known.statusCode === refusal.statusCode && known.message === refusal.message,
	));
}

describe('the Screen-command route\'s own refusals', () => {
	const scan = scanRouteRefusals(commandRoutePath, serverMiddlewareFiles());

	it('are found by the scan at all', () => {
		// A scan that stops matching passes silently, which is the failure mode this
		// whole file exists to avoid one level up.
		expect(scan.refusals.length).toBeGreaterThan(0);
	});

	it('are read from the route\'s imports too, not from the route file alone', () => {
		// #277: the scan read `command.post.ts` and nothing else, so a 401/403 raised
		// from an imported guard was invisible — which is exactly what
		// `assertTrustedScreenCommandBoundary` becomes once ADR-0008's authentication
		// lands and that seam starts refusing requests. A graph that had quietly
		// collapsed back to one file would pass every other assertion here.
		expect(scan.files).toContain('server/api/events/[id]/screens/[screenId]/command.post.ts');
		expect(scan.files).toContain('server/utils/ably.ts');
		expect(scan.files).toContain('server/services/screen.ts');
	});

	it('are read from the middleware Nitro composes around it, which no import graph reaches', () => {
		// #292: Nitro composes `server/middleware/**` around a handler rather than
		// importing it, so every graph built from the route file alone missed
		// `event-exists.ts` — which answers 404 'Event not found' for any
		// `/api/events/:id/**` path, this route's included. Unlisted, that legitimate
		// refusal read as a fabricated Ably key, which is the confident nonsense the
		// whole diagnosis exists to prevent.
		expect(scan.files).toContain('server/middleware/event-exists.ts');
		expect(scan.refusals).toContainEqual(
			expect.objectContaining({ statusCode: 404, message: 'Event not found' }),
		);
	});

	it('are read from a middleware\'s own refusal helpers, not from its body alone', () => {
		// A middleware that refuses through an imported helper is the shape #277 closed
		// for routes, and it exists here: `request-body-limit.ts` raises nothing itself
		// and refuses through `payloadTooLarge`. Reading middleware bodies alone would
		// have been the cheaper fix and would have carried #277's defect back in.
		expect(scan.files).toContain('server/utils/payloadLimits.ts');
	});

	it('does not follow a middleware into the domain layer it only consults', () => {
		// The one narrowing #292 added, and it is the narrowing the scan's own policy
		// prescribes — a subtree excluded rather than the refusal list widened.
		// Middleware is global: every one of them is composed around every request, so
		// module reachability from a middleware drags the shared service layer into a
		// graph that is supposed to describe *this route*. Measured before the rule was
		// written: `event-exists.ts` reaches `featureMatch.ts`'s two banded 404s and one
		// unreadable 404 in `sequencedLiveState.ts` through `eventService()`, none of
		// which this route can answer, and listing them would have re-opened #268's hole
		// wholesale. A middleware consults the domain layer for a boolean and refuses on
		// its own terms; the routes that really call a service carry it in their own graph.
		expect(scan.files).not.toContain('server/services/featureMatch.ts');
		expect(scan.files).not.toContain('server/modules/graphics-author-session.ts');
	});

	it('leave no first-party import unfollowed', () => {
		// A module the scan could not reach is a hole in the exhaustiveness guarantee
		// that nothing else reports, so it fails here rather than being a caveat in a
		// comment. Third-party and virtual specifiers are excluded by design: a refusal
		// from `h3` or `hub:db` is not one this repository can list or rename.
		expect(scan.unfollowedImports).toEqual([]);
	});

	it('are every one of them recognised as the route\'s own', () => {
		// The route growing a second refusal inside the band without this list
		// growing with it would make that new refusal read as a fabricated Ably key.
		//
		// WHEN THIS FAILS, READ THE SITE IT NAMES BEFORE TOUCHING THE LIST. The scan is
		// an over-approximation — it counts a `createError` in any module the route
		// imports, including one the route never calls. Adding such a message to
		// `SCREEN_COMMAND_ROUTE_REFUSALS` silences the failure by teaching the diagnosis
		// to excuse that message at that status, so a genuine Ably 403 echoing it stops
		// being diagnosed: #268's hole, reopened. Add to the list only a refusal this
		// route really raises. Otherwise narrow the scan.
		//
		// #292 closed the last hole this comment used to record: the middleware Nitro
		// composes around the handler is scanned now, so 'Event not found' is a listed
		// refusal rather than an invisible one. What survives is the residual named in
		// the narrowing test above — a middleware refusing through the domain layer.
		const banded = inCredentialBand(scan.refusals);

		expect(banded.length).toBeGreaterThan(0);
		expect(unlistedRefusals(banded)).toEqual([]);
	});
});

/**
 * A scanned refusal, for the shapes no route in this repository has grown yet.
 *
 * `carriesCause` is fixed rather than a parameter: every fixture here is a credential-band
 * 4xx, and neither `inCredentialBand` nor `unlistedRefusals` reads that axis — a 4xx is
 * the authority answering this request and is never sanitized, so whether it names a
 * cause decides nothing. #339's axis is exercised where it decides something, against
 * source text below and against `server/` in
 * `test/unit/server/plugins/error-handler.test.ts`.
 */
function scanned(statusCode: number | undefined, message: string | undefined): ScannedRefusal {
	return { site: 'synthetic.ts:1', statusCode, message, carriesCause: false, source: 'createError({ ... })' };
}

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
		const locked = [scanned(403, 'Screen is locked')];

		expect(inCredentialBand(locked)).toEqual(locked);
		expect(unlistedRefusals(inCredentialBand(locked))).toEqual(locked);
	});

	it('catches a route-grown 404 the list does not name, as it always did', () => {
		// 'Round not found' rather than 'Event not found': #292 made the latter a real
		// listed refusal, and a fixture that collides with the list under test proves
		// the opposite of what it was written to prove.
		const missing = [scanned(404, 'Round not found')];

		expect(unlistedRefusals(inCredentialBand(missing))).toEqual(missing);
	});

	it('leaves a refusal outside the band alone, because no diagnosis can reach it', () => {
		// A 409 or a 422 is never mistaken for a credential rejection, so demanding
		// it be listed would make the list a catalogue of the route rather than of
		// what the diagnosis can get wrong — noise the next person would delete.
		expect(inCredentialBand([
			scanned(409, 'Screen was modified concurrently'),
			scanned(422, 'Unknown command'),
		])).toEqual([]);
	});

	it('excuses a banded refusal only at the status the list names it at', () => {
		expect(unlistedRefusals([scanned(404, 'Screen not found')])).toEqual([]);
		expect(unlistedRefusals([scanned(401, 'Screen not found')]))
			.toEqual([scanned(401, 'Screen not found')]);
	});

	it('holds a refusal it could not read to the same account as one it could', () => {
		// #277: the half that makes an unreadable refusal safe. Neither half can match a
		// listed pair, so the entry survives both filters and the check fails naming it.
		expect(unlistedRefusals(inCredentialBand([scanned(undefined, 'Screen not found')])))
			.toEqual([scanned(undefined, 'Screen not found')]);
		expect(unlistedRefusals(inCredentialBand([scanned(404, undefined)])))
			.toEqual([scanned(404, undefined)]);
	});
});

/**
 * What the scan can read out of a route's source, checked against source text rather
 * than against the route — the only way to exercise the shapes it has not grown.
 *
 * #277 was filed because the previous scan pushed an entry only where `statusCode` was
 * a numeric literal. `statusCode: FORBIDDEN` was not reported unlisted; it did not exist,
 * and the whole suite passed on a route carrying a 403 the diagnosis would have misread.
 * The invariant that replaces the gate is the last test here: one entry per `createError`,
 * readable or not.
 */
describe('what the scan can read out of a route', () => {
	function scan(body: string): ScannedRefusal[] {
		return scanSourceForRefusals('route.ts', body);
	}

	it('reads a refusal written as literals', () => {
		expect(scan('createError({ statusCode: 403, message: \'Screen is locked\' });'))
			.toEqual([expect.objectContaining({ statusCode: 403, message: 'Screen is locked' })]);
	});

	it('resolves a status held in a const, which used to be dropped entirely', () => {
		// #277's proving case, from #268's A1: byte-for-byte the refusal R26 kills as a
		// literal, and it survived the full runner set behind a `const`.
		const refusals = scan('const FORBIDDEN = 403;\ncreateError({ statusCode: FORBIDDEN, message: \'Screen is locked\' });');

		expect(refusals).toEqual([expect.objectContaining({ statusCode: 403, message: 'Screen is locked' })]);
		expect(unlistedRefusals(inCredentialBand(refusals))).toEqual(refusals);
	});

	it('resolves a message held in a const, or written as a template with nothing in it', () => {
		expect(scan('const LOCKED = \'Screen is locked\';\ncreateError({ statusCode: 403, message: LOCKED });')[0]?.message)
			.toBe('Screen is locked');
		expect(scan('createError({ statusCode: 403, message: `Screen is locked` });')[0]?.message)
			.toBe('Screen is locked');
	});

	it('reports a status it cannot read rather than dropping the site', () => {
		const refusals = scan('createError({ statusCode: statuses.forbidden, message: \'Screen is locked\' });');

		expect(refusals[0]?.statusCode).toBeUndefined();
		expect(refusals[0]?.source).toContain('statuses.forbidden');
		expect(unlistedRefusals(inCredentialBand(refusals))).toEqual(refusals);
	});

	it('reports a message it cannot read rather than reading it as empty', () => {
		// Pre-#277 this degraded to `''`, which failed loudly too — the safe direction,
		// and why it was never a defect. But `''` says the route raises an empty message,
		// where `undefined` says the scan could not read the one it raises, and the
		// difference is the whole of what the reader needs to act.
		// eslint-disable-next-line no-template-curly-in-string -- TypeScript source under scan, not a mis-typed template.
		const refusals = scan('createError({ statusCode: 404, message: `Screen ${id} not found` });');

		expect(refusals[0]?.message).toBeUndefined();
		expect(unlistedRefusals(inCredentialBand(refusals))).toEqual(refusals);
	});

	it('reports a refusal whose shape is hidden, whichever way it is hidden', () => {
		for (const hidden of [
			'createError(refusalFor(screen));',
			'createError({ ...base, message: \'Screen is locked\' });',
			'createError({ statusCode, message });',
		]) {
			const refusals = scan(hidden);

			expect(refusals, hidden).toHaveLength(1);
			expect(refusals[0]?.statusCode, hidden).toBeUndefined();
			expect(unlistedRefusals(inCredentialBand(refusals)), hidden).toEqual(refusals);
		}
	});

	it('gives h3\'s own defaults to the halves a refusal does not name', () => {
		// Absent is not unreadable: h3 answers 500 and `''`, and 500 is outside the band,
		// so a refusal naming no status is correctly nobody's problem here. The
		// distinction is load-bearing in one direction only — see the `status:` pin
		// below, where defaulting a status the scan simply failed to look for is how an
		// entry disappears.
		expect(scan('createError({ message: \'Screen is locked\' });')[0]?.statusCode).toBe(500);
		expect(scan('createError({ statusCode: 403 });')[0]?.message).toBe('');
		expect(inCredentialBand(scan('createError({ message: \'Screen is locked\' });'))).toEqual([]);
	});

	it('reads every key h3 composes a status and a message from', () => {
		// h3's `createError` reads `statusCode` and falls back to `status`
		// (1.15.11, dist/index.mjs:91-95); the message is `message ?? statusMessage`
		// (:71). Reading only the first of each pair made the route answer a real 403
		// while the scan saw no status, defaulted it to 500, and dropped the entry out
		// of the band before anything checked the listing — #277's own defect in
		// another spelling. h3 v2 makes `status` canonical, so this widens with time.
		expect(scan('createError({ status: 403, message: \'Screen is locked\' });')[0]?.statusCode).toBe(403);
		expect(scan('createError({ statusCode: 404, statusMessage: \'Screen not found\' });')[0]?.message)
			.toBe('Screen not found');
		// `statusCode` wins where both are named, as it does in h3.
		expect(scan('createError({ statusCode: 404, status: 403, message: \'x\' });')[0]?.statusCode).toBe(404);
	});

	it('reads a key written as a computed name, and reports one it cannot name', () => {
		// `['statusCode']: 403` satisfied neither arm of the property reader and was
		// skipped, leaving a call that named a status looking like one that named none.
		// A key the scan cannot name might BE the status key, so the call is unreadable
		// rather than a call with one property fewer.
		expect(scan('createError({ [\'statusCode\']: 403, message: \'Screen is locked\' });')[0]?.statusCode).toBe(403);

		const computed = scan('createError({ [statusKey]: 403, message: \'Screen is locked\' });');

		expect(computed[0]?.statusCode).toBeUndefined();
		expect(unlistedRefusals(inCredentialBand(computed))).toEqual(computed);
	});

	it('does not trust a name that is declared twice, or one that can be reassigned', () => {
		// The scan parses a file, it does not bind it. Picking one of two declarations
		// would be picking at random, and a `let` does not say what the route answers —
		// so both report rather than resolve.
		expect(scan('const S = 403;\nfunction other() { const S = 404; }\ncreateError({ statusCode: S, message: \'x\' });')[0]?.statusCode)
			.toBeUndefined();
		expect(scan('let status = 403;\ncreateError({ statusCode: status, message: \'x\' });')[0]?.statusCode)
			.toBeUndefined();
	});

	it('reads whether a refusal names a cause, which decides whether its 5xx keeps its words', () => {
		// #339's axis. `mapPublicNitroError` classifies a 5xx by its cause, so a 503
		// without one is answered 'Internal Server Error' however carefully the route
		// worded it. Presence rather than usefulness: whether the named expression is a
		// class the mapper recognises is a question about the mapper, asked next door in
		// `test/unit/server/plugins/error-handler.test.ts`.
		expect(scan('createError({ statusCode: 503, message: \'x\', cause: failure });')[0]?.carriesCause).toBe(true);
		expect(scan('createError({ statusCode: 503, message: \'x\', cause: new TemporarilyUnavailableError(\'x\') });')[0]?.carriesCause).toBe(true);
		expect(scan('createError({ statusCode: 503, message: \'x\' });')[0]?.carriesCause).toBe(false);
	});

	it('does not count a cause that names the key and supplies nothing', () => {
		// A real shape here: `templatePackageExportApi.ts` classifies its retryable half
		// and leaves the other undefined in the same call. Counting `cause: undefined`
		// would let the `server/`-wide census be satisfied by writing the word, which is
		// the census reduced to a spelling check.
		expect(scan('createError({ statusCode: 503, message: \'x\', cause: undefined });')[0]?.carriesCause).toBe(false);
		expect(scan('createError({ statusCode: 503, message: \'x\', cause: (undefined) });')[0]?.carriesCause).toBe(false);
	});

	it('reports a cause it could not look for, on a call whose shape is hidden', () => {
		// The same direction the other two halves take, and for the same reason: a spread
		// or a non-object argument can supply a cause the scan never sees, so `false`
		// there would be a claim the syntax does not support. `undefined` says the scan
		// could not look — and the census filters on a readable status, which no such
		// call has, so it reports as out of scope rather than as a violation.
		//
		// The shorthand `{ statusCode: 503, cause }` belongs here rather than with the
		// causes above, and the reason is worth knowing before writing one: a shorthand
		// anywhere in the literal makes the *whole* call unreadable, status included, so
		// such a site would be out of the census's scope entirely. No `createError` under
		// `server/` is written that way today.
		for (const hidden of [
			'createError({ ...base, statusCode: 503 });',
			'createError(refusalFor(screen));',
			'createError({ statusCode: 503, [causeKey]: failure });',
			'createError({ statusCode: 503, message: \'x\', cause });',
		]) {
			expect(scan(hidden)[0]?.carriesCause, hidden).toBeUndefined();
			expect(scan(hidden)[0]?.statusCode, hidden).toBeUndefined();
		}
	});

	it('records one entry per createError call it finds, readable or not', () => {
		// The invariant that replaces the `isNumericLiteral` gate. Every other assertion
		// here is about what an entry says; this is the one that says an entry exists.
		//
		// Per call it *finds*: the scan matches the callee by name, so a `createError`
		// reached through an alias, a namespace or a variable produces no entry at all.
		// No such call exists in this repository today.
		const refusals = scan([
			'createError({ statusCode: 404, message: \'Screen not found\' });',
			'createError({ statusCode: unknownStatus, message: \'Screen is locked\' });',
			'createError(somethingElse);',
		].join('\n'));

		expect(refusals).toHaveLength(3);
		expect(refusals.map(refusal => refusal.site)).toEqual(['route.ts:1', 'route.ts:2', 'route.ts:3']);
	});
});

/**
 * How far the scan reaches, on a fixture tree rather than on the real graph.
 *
 * #277 widened the scan from one file to the route's first-party import graph, and each
 * way of reaching a module is a separate line that can regress on its own. Pinning them
 * against whatever the Screen-command route happens to import would pin this
 * repository's structure rather than the walker — these modules exist to be reached.
 */
describe('the scan\'s reach through a route\'s imports', () => {
	const fixtures: Record<string, string> = {
		'entry.ts': [
			'import type { Ignored } from \'./type-only\';',
			'import { direct } from \'./direct\';',
			'export { reexported } from \'./re-exported\';',
			'export async function load() { return import(\'./dynamic\'); }',
			'createError({ statusCode: 404, message: \'the entry point\' });',
		].join('\n'),
		'direct.ts': 'export const direct = () => createError({ statusCode: 401, message: \'a direct import\' });',
		're-exported.ts': 'export const reexported = () => createError({ statusCode: 403, message: \'a re-export\' });',
		'dynamic.ts': 'export const dynamic = () => createError({ statusCode: 403, message: \'a dynamic import\' });',
		'type-only.ts': 'export interface Ignored { readonly x: number }\n'
			+ 'const unreachable = () => createError({ statusCode: 403, message: \'a type-only import\' });',
	};

	let root: string;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), 'issue277-scan-'));
		for (const [name, text] of Object.entries(fixtures))
			writeFileSync(join(root, name), text);
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it('follows a direct import, a re-export and a dynamic import', () => {
		// A refusal is reachable through any of the three. Reading only `import` would
		// leave two silent holes of exactly the kind this ticket closed.
		const messages = scanRouteRefusals(join(root, 'entry.ts')).refusals.map(refusal => refusal.message);

		expect(messages).toContain('the entry point');
		expect(messages).toContain('a direct import');
		expect(messages).toContain('a re-export');
		expect(messages).toContain('a dynamic import');
	});

	it('does not follow a type-only import, which cannot carry a throw', () => {
		// The one narrowing that is sound, and worth pinning because widening it would
		// drag the schema layer's whole closure in for nothing.
		const messages = scanRouteRefusals(join(root, 'entry.ts')).refusals.map(refusal => refusal.message);

		expect(messages).not.toContain('a type-only import');
	});

	it('reports a first-party import it cannot follow, rather than reaching less in silence', () => {
		// The guarantee is that the graph is complete. A specifier resolving to no file
		// shrinks it with nothing saying so — #277's defect wearing the import graph.
		const entry = join(root, 'broken.ts');
		writeFileSync(entry, 'import { gone } from \'./not-a-module\';\n');

		expect(scanRouteRefusals(entry).unfollowedImports).toEqual([expect.stringContaining('./not-a-module')]);
	});

	it('follows every path alias that reaches this repository, not only `~~/`', () => {
		// Every alias in `.nuxt/tsconfig.json` that reaches this repository's own source
		// is first-party. An unrecognised prefix fell through to the third-party branch,
		// which says nothing at all — so `#shared/x` would have shrunk the graph in
		// silence while "leave no first-party import unfollowed" still passed. Nothing
		// under `server/` or `shared/` imports through the other five today, which is
		// why nothing caught it.
		const entry = join(root, 'aliased.ts');
		writeFileSync(entry, 'import { screenRealtimeChannel } from \'#shared/utils/realtimeChannels\';\n');

		const scan = scanRouteRefusals(entry);

		expect(scan.files).toContain('shared/utils/realtimeChannels.ts');
		expect(scan.unfollowedImports).toEqual([]);
	});

	it('says nothing about a third-party or virtual specifier, which is not the route\'s code', () => {
		// A refusal raised inside `h3` or `hub:db` is not one this repository can list or
		// rename, so these are excluded by design rather than reported as holes. `#imports`
		// is Nuxt's virtual module and belongs with them, not with the real aliases.
		//
		// #292: these three are *named in the same `paths` map* the aliases are now read
		// from, so lifting that map wholesale would have made `h3` and `hub:db`
		// first-party and walked the scan into `node_modules`. They are excluded by
		// where their target resolves to, not by a list of names.
		const entry = join(root, 'third-party.ts');
		writeFileSync(entry, [
			'import { createError } from \'h3\';',
			'import { db } from \'hub:db\';',
			'import { useRuntimeConfig } from \'#imports\';',
		].join('\n'));

		expect(scanRouteRefusals(entry).unfollowedImports).toEqual([]);
	});
});

/**
 * Where the aliases come from, now that they are read rather than remembered.
 *
 * #292: the list was hardcoded. All six spellings that existed were handled, but an
 * alias added to `nuxt.config.ts` later — or the bare no-slash forms `#shared` and
 * `~~` — fell through to the third-party branch, which says nothing at all, so the
 * graph would have shrunk with nothing reporting it. The `paths` map Nuxt generates is
 * the source of truth for what this repository's own aliases are.
 *
 * It is also a trap, which is why these pin both directions: the same map names `h3`,
 * `ofetch`, `nitropack`, `hub:kv` and Nuxt's own virtual modules, so a map lifted
 * wholesale would have destroyed the deliberate `node_modules` exclusion and sent the
 * scan walking a dependency's refusals it can neither list nor rename.
 */
describe('the path aliases the scan follows', () => {
	it('reads this repository\'s own roots out of the generated tsconfig', () => {
		const prefixes = firstPartyPathAliases().map(alias => alias.prefix);

		// The wildcard forms, which is what every import in this repository uses.
		expect(prefixes).toEqual(expect.arrayContaining(['~~/', '@@/', '#shared/', '#server/', '~/', '@/']));
		// The bare forms, which the hardcoded list did not have and could not follow.
		expect(prefixes).toEqual(expect.arrayContaining(['~~', '@@', '#shared', '#server', '~', '@']));
	});

	it('excludes every alias that points outside this repository\'s own source', () => {
		const prefixes = firstPartyPathAliases().map(alias => alias.prefix);

		// Dependencies: following these is how the scan escapes into `node_modules`.
		for (const dependency of ['h3', 'ofetch', 'nitropack', 'consola', 'hub:db', 'hub:kv', '#ui', '#app'])
			expect(prefixes).not.toContain(dependency);
		// Nuxt's own generated virtual modules, which are not this repository's code
		// either — and which live under `.nuxt/`, inside the repository, so the rule
		// cannot be "is it under the repository root" alone.
		for (const virtual of ['#imports', '#build', '#components', '#app-manifest'])
			expect(prefixes).not.toContain(virtual);
	});

	it('resolves an alias to a directory that exists', () => {
		for (const alias of firstPartyPathAliases())
			expect(existsSync(alias.target), alias.prefix).toBe(true);
	});

	it('says what to run when the generated tsconfig is not there', () => {
		// `.nuxt/` is gitignored and written by `nuxt prepare`, so a fresh clone that has
		// not installed has no aliases to read. An empty map would shrink every graph to
		// the entry file and pass most of this suite in silence, which is the exact
		// defect class the scan exists to prevent — so it fails, and it says why.
		expect(() => firstPartyPathAliases(join(tmpdir(), 'issue292-absent', 'tsconfig.json')))
			.toThrow(/nuxt prepare/);
	});

	it('refuses a tsconfig whose paths name none of this repository\'s roots', () => {
		// The other way to end up with nothing: a `paths` map that parses fine and is
		// entirely third-party. Silently returning `[]` would leave `~~/` unresolved and
		// every first-party import reported as third-party — a graph of one file.
		const directory = mkdtempSync(join(tmpdir(), 'issue292-aliases-'));
		const tsconfig = join(directory, 'tsconfig.json');
		writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { paths: { h3: ['../node_modules/h3'] } } }));

		try {
			expect(() => firstPartyPathAliases(tsconfig)).toThrow(/first-party/);
		}
		finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

/**
 * The middleware entry points, enumerated rather than named.
 *
 * #292's second half. A hardcoded list of middleware would close today's hole and
 * re-open it the moment someone adds a middleware — the same defect as the hardcoded
 * aliases, one directory along. The directory is the list.
 */
describe('the middleware the scan is given as entry points', () => {
	it('is every middleware on disk, so a new one is scanned without anyone remembering', () => {
		const named = serverMiddlewareFiles().map(file => file.slice(file.lastIndexOf('/') + 1));

		expect(named).toContain('event-exists.ts');
		expect(named).toContain('graphics-author-session.ts');
		expect(named).toContain('request-body-limit.ts');
	});

	it('reaches a middleware one directory down, because Nitro\'s own scan does', () => {
		// Nitro globs this directory rather than listing it, so a nested middleware runs
		// on every request exactly as a top-level one does. A flat read would have missed
		// it and passed — the same silence the enumeration is here to remove. No nested
		// middleware exists today, which is precisely why this is a fixture.
		const directory = mkdtempSync(join(tmpdir(), 'issue292-nested-'));
		mkdirSync(join(directory, 'nested'));
		writeFileSync(join(directory, 'nested', 'deep.ts'), 'export default defineEventHandler(() => {});\n');
		writeFileSync(join(directory, 'shallow.d.ts'), 'export declare const nothing: number;\n');

		try {
			const found = serverMiddlewareFiles(directory);

			expect(found).toEqual([join(directory, 'nested', 'deep.ts')]);
		}
		finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('refuses a directory holding no middleware rather than scanning none', () => {
		// Nitro's middleware directory is a convention, not an import. If it is renamed
		// or emptied, an empty list scans nothing and every assertion above still passes.
		const directory = mkdtempSync(join(tmpdir(), 'issue292-middleware-'));

		try {
			expect(() => serverMiddlewareFiles(directory)).toThrow(/middleware/);
		}
		finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

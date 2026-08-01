/**
 * Delivery acceptance for the Graphics Asset Library.
 *
 * Proves, over HTTP against a running installation, that a pinned Graphic
 * Asset Revision is delivered with the semantics the library promises: full
 * and ranged reads, conditional requests, one strong validator per
 * representation, authorization on every public request rather than only the
 * first, revocation that outlives cached immutable bytes, same-origin-only
 * exposure, private canonical storage that is never addressable from outside,
 * and the settled unavailable, integrity, and denial outcomes.
 *
 * Usage:
 *   node scripts/run-graphics-delivery-acceptance.mjs [--deployed]
 *                                                     [--require-cache-hit]
 *                                                     [--arm <file>]
 *                                                     [--fault <name> --scenario <file>]
 *
 * The fault modes assert what an injected outage must look like from outside;
 * they do not inject it. `--arm` provisions and warms a scenario, the operator
 * injects the outage, and `--fault` resumes against the same identities. See
 * docs/operations/graphics-staging-acceptance.md.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import process from 'node:process';
import {
	checkCacheParity,
	checkCacheWarmed,
	checkCapabilityDenial,
	checkConditionalRead,
	checkContentSecurityPolicy,
	checkFullRead,
	checkNonRetryableIntegrity,
	checkNoStorageAddressing,
	checkOriginExposure,
	checkRangeRead,
	checkRetryableUnavailable,
	checkUnsatisfiableRange,
	checkValidatorStability,
} from './graphics-acceptance/assertions.mjs';
import { createAcceptanceEvidence, deliveryRouteLabel } from './graphics-acceptance/evidence.mjs';
import {
	acceptanceOrigin,
	openInstallation,
	provisionScreenOutputScenario,
} from './graphics-acceptance/installation.mjs';

const HARNESS = 'graphics-delivery-v1';
const FAULTS = new Set(['content-unavailable', 'd1-outage', 'r2-outage-authorized-cache']);

function flagValue(name) {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

const deployed = process.argv.includes('--deployed');
const requireCacheHit = process.argv.includes('--require-cache-hit');
const armPath = flagValue('--arm');
const fault = flagValue('--fault');
const scenarioPath = flagValue('--scenario');

if (fault && !FAULTS.has(fault))
	throw new Error(`Unknown fault. Expected one of: ${[...FAULTS].join(', ')}.`);
if (fault && !scenarioPath)
	throw new Error('A fault run resumes an armed scenario. Pass --scenario <file>.');

const origin = acceptanceOrigin({ deployed });
const session = await openInstallation(origin);
const evidence = createAcceptanceEvidence({
	harness: HARNESS,
	secrets: [session.authorCookie],
});

const failures = [];
const notes = [];
let checks = 0;

function record(found) {
	checks += 1;
	failures.push(...found);
}

function capabilityHeaders(capability, extra) {
	return { authorization: `Bearer ${capability}`, ...extra };
}

/**
 * The capability route's public expectations. Bytes stay out of any shared
 * cache and the response varies by the two ways a capability arrives.
 */
function capabilityExpectations(scenario, route) {
	return {
		route,
		bytes: scenario.content,
		contentType: scenario.contentType,
		cacheControl: 'private, no-store',
		vary: ['authorization', 'cookie'],
	};
}

function editorExpectations(scenario, route) {
	return {
		route,
		bytes: scenario.content,
		contentType: scenario.contentType,
		cacheControl: 'private, max-age=0, must-revalidate',
		vary: ['cookie'],
	};
}

async function runCapabilityRoute(scenario) {
	const path = scenario.capabilityContentPath();
	const route = deliveryRouteLabel(path);
	const byteLength = scenario.content.byteLength;

	// Before anything is authorized, the route must already refuse.
	const anonymous = await session.request(path);
	record(checkCapabilityDenial(anonymous, { route, body: anonymous.text() }));

	const full = await session.request(path, {
		headers: capabilityHeaders(scenario.capability),
	});
	record(checkFullRead(full, capabilityExpectations(scenario, route)));
	record(checkOriginExposure(full.headers, { route }));
	record(checkNoStorageAddressing(full.headers, { route }));
	record(checkContentSecurityPolicy(full.headers, { route }));
	const etag = full.headers.get('etag');

	const conditional = await session.request(path, {
		headers: capabilityHeaders(scenario.capability, { 'if-none-match': etag ?? '' }),
	});
	record(checkConditionalRead(conditional, { route, etag }));

	const range = await session.request(path, {
		headers: capabilityHeaders(scenario.capability, { range: 'bytes=8-15' }),
	});
	record(checkRangeRead(range, {
		route,
		start: 8,
		end: 15,
		byteLength,
		bytes: scenario.content.slice(8, 16),
	}));

	const suffix = await session.request(path, {
		headers: capabilityHeaders(scenario.capability, { range: 'bytes=-8' }),
	});
	record(checkRangeRead(suffix, {
		route,
		start: byteLength - 8,
		end: byteLength - 1,
		byteLength,
		bytes: scenario.content.slice(byteLength - 8),
	}));

	const beyond = await session.request(path, {
		headers: capabilityHeaders(scenario.capability, { range: `bytes=${byteLength}-` }),
	});
	record(checkUnsatisfiableRange(beyond, { route, byteLength }));

	// A second read is the same representation whether or not a cache answered
	// it. Only a deployed run has an edge cache that could have warmed.
	const repeated = await session.request(path, {
		headers: capabilityHeaders(scenario.capability),
	});
	record(checkCacheParity(full, repeated, { route }));
	record(checkValidatorStability([etag, repeated.headers.get('etag')], { route }));
	if (deployed) {
		const warmth = checkCacheWarmed(repeated, { route });
		if (requireCacheHit)
			record(warmth);
		else if (warmth.length > 0)
			notes.push({ code: 'delivery-cache-state-unreported', detail: { route } });
	}

	// Native media elements carry the capability as a path-scoped cookie, which
	// is a second public entry point and therefore a second authorization.
	const bootstrap = await session.request(
		`/api/screen-output/screens/${scenario.screenId}/asset-capability-session`,
		{ method: 'POST', headers: capabilityHeaders(scenario.capability) },
	);
	const sessionCookie = bootstrap.headers.getSetCookie().map(value => value.split(';', 1)[0])[0];
	if (bootstrap.status !== 204 || !sessionCookie) {
		record([{
			code: 'harness-precondition-unmet',
			detail: { route: deliveryRouteLabel(`/api/screen-output/screens/${scenario.screenId}/asset-capability-session`), actual: bootstrap.status },
		}]);
	}
	else {
		const viaCookie = await session.request(path, {
			headers: { cookie: sessionCookie, range: 'bytes=8-15' },
		});
		record(checkRangeRead(viaCookie, {
			route,
			start: 8,
			end: 15,
			byteLength,
			bytes: scenario.content.slice(8, 16),
		}));
	}

	// A revision this Screen Output never referenced is a settled integrity
	// result, not something to retry.
	const unknownRevision = await session.request(
		`/api/screen-output/screens/${scenario.screenId}/assets/${scenario.assetId}/revisions/gar-not-referenced/content`,
		{ headers: capabilityHeaders(scenario.capability) },
	);
	record(checkNonRetryableIntegrity(unknownRevision, { route }));

	// Cross-origin readers get nothing, not even a preflight grant.
	const preflight = await session.request(path, {
		method: 'OPTIONS',
		headers: {
			'origin': 'https://not-this-installation.invalid',
			'access-control-request-method': 'GET',
		},
	});
	checks += 1;
	if (preflight.headers.get('access-control-allow-origin'))
		failures.push({ code: 'cors-preflight-permitted', detail: { route } });

	return { route, etag };
}

/**
 * Rotation is the moment the two halves of the contract meet: the bytes are
 * immutable and may be cached forever, and the capability that reached them
 * must stop working immediately anyway.
 */
async function runRevocation(scenario, route) {
	const path = scenario.capabilityContentPath();
	const revoked = scenario.capability;
	const replacement = await scenario.rotateCapability();

	const staleRead = await session.request(path, { headers: capabilityHeaders(revoked) });
	checks += 1;
	if (staleRead.status === 200)
		failures.push({ code: 'delivery-revocation-ineffective', detail: { route } });
	else
		failures.push(...checkCapabilityDenial(staleRead, { route, body: staleRead.text() }));

	const staleBootstrap = await session.request(
		`/api/screen-output/screens/${scenario.screenId}/asset-capability-session`,
		{ method: 'POST', headers: capabilityHeaders(revoked) },
	);
	checks += 1;
	if (staleBootstrap.status !== 404)
		failures.push({ code: 'delivery-revocation-ineffective', detail: { route, actual: staleBootstrap.status } });

	// Warmed or not, an unauthorized read is still refused.
	const anonymous = await session.request(path);
	checks += 1;
	if (anonymous.status === 200)
		failures.push({ code: 'delivery-authorization-skipped', detail: { route } });

	const renewed = await session.request(path, { headers: capabilityHeaders(replacement) });
	record(checkFullRead(renewed, capabilityExpectations(scenario, route)));
	scenario.capability = replacement;
	evidence.addSecret(replacement);
}

async function runEditorRoute(scenario) {
	const path = scenario.editorContentPath();
	const route = deliveryRouteLabel(path);
	const byteLength = scenario.content.byteLength;

	const unauthenticated = await session.request(path);
	record(checkCapabilityDenial(unauthenticated, {
		route,
		body: unauthenticated.text(),
		expectedStatus: 401,
	}));

	const full = await session.request(path, { author: true });
	record(checkFullRead(full, editorExpectations(scenario, route)));
	record(checkOriginExposure(full.headers, { route }));
	record(checkNoStorageAddressing(full.headers, { route }));
	const etag = full.headers.get('etag');

	const conditional = await session.request(path, {
		author: true,
		headers: { 'if-none-match': etag ?? '' },
	});
	record(checkConditionalRead(conditional, { route, etag }));

	const range = await session.request(path, {
		author: true,
		headers: { range: 'bytes=8-15' },
	});
	record(checkRangeRead(range, {
		route,
		start: 8,
		end: 15,
		byteLength,
		bytes: scenario.content.slice(8, 16),
	}));

	const beyond = await session.request(path, {
		author: true,
		headers: { range: `bytes=${byteLength}-` },
	});
	record(checkUnsatisfiableRange(beyond, { route, byteLength }));

	const missing = await session.request(
		`/api/graphics-assets/${scenario.assetId}/revisions/gar-not-a-revision/content`,
		{ author: true },
	);
	record(checkNonRetryableIntegrity(missing, { route }));
}

async function runFault(scenario) {
	const path = scenario.capabilityContentPath();
	const route = deliveryRouteLabel(path);
	const read = await session.request(path, { headers: capabilityHeaders(scenario.capability) });

	if (fault === 'content-unavailable' || fault === 'd1-outage') {
		record(checkRetryableUnavailable(read, { route }));
		const editorRead = await session.request(scenario.editorContentPath(), { author: true });
		record(checkRetryableUnavailable(editorRead, { route: deliveryRouteLabel(scenario.editorContentPath()) }));
	}

	if (fault === 'd1-outage') {
		const bootstrap = await session.request(
			`/api/screen-output/screens/${scenario.screenId}/asset-capability-session`,
			{ method: 'POST', headers: capabilityHeaders(scenario.capability) },
		);
		record(checkRetryableUnavailable(bootstrap, {
			route: deliveryRouteLabel(`/api/screen-output/screens/${scenario.screenId}/asset-capability-session`),
		}));
	}

	if (fault === 'r2-outage-authorized-cache') {
		// The warmed representation still serves, byte for byte, because the
		// authorized cache holds it and authorization never went to R2.
		record(checkFullRead(read, capabilityExpectations(scenario, route)));
		record(checkNoStorageAddressing(read.headers, { route }));
		// A revision the cache never held has nowhere to come from, and says so
		// as a retryable outage rather than as a missing identity.
		const cold = await session.request(
			`/api/graphics-assets/${scenario.assetId}/revisions/${scenario.revisionId}/content`,
			{ author: true },
		);
		record(checkRetryableUnavailable(cold, {
			route: deliveryRouteLabel(scenario.editorContentPath()),
		}));
	}
}

function finish(mode) {
	for (const note of notes)
		process.stdout.write(`${evidence.report([note])} (reported, not enforced)\n`);
	if (failures.length > 0)
		throw new Error(`${HARNESS} acceptance failed:\n${evidence.report(failures)}`);
	process.stdout.write(`${evidence.passed({ checks, mode })}\n`);
}

if (fault) {
	const armed = JSON.parse(await readFile(scenarioPath, 'utf8'));
	evidence.addSecret(armed.capability);
	const scenario = {
		...armed,
		content: Uint8Array.from(armed.content),
		rotateCapability: () => {
			throw new Error('A fault run does not rotate capabilities.');
		},
		capabilityContentPath: () =>
			`/api/screen-output/screens/${armed.screenId}/assets/${armed.assetId}/revisions/${armed.revisionId}/content`,
		editorContentPath: () =>
			`/api/graphics-assets/${armed.assetId}/revisions/${armed.revisionId}/content`,
	};
	try {
		await runFault(scenario);
	}
	finally {
		await session.request(`/api/events/${armed.eventId}`, { method: 'DELETE', author: true })
			.catch(() => undefined);
		await rm(scenarioPath, { force: true });
	}
	finish(`fault:${fault}`);
}
else if (armPath) {
	const scenario = await provisionScreenOutputScenario(session, { label: 'Delivery Fault Injection' });
	evidence.addSecret(scenario.capability);
	// Warm whatever cache exists before the operator breaks the store behind it.
	await session.request(scenario.capabilityContentPath(), {
		headers: capabilityHeaders(scenario.capability),
	});
	await writeFile(armPath, JSON.stringify({
		eventId: scenario.eventId,
		screenId: scenario.screenId,
		assetId: scenario.assetId,
		revisionId: scenario.revisionId,
		capability: scenario.capability,
		contentType: scenario.contentType,
		content: [...scenario.content],
	}), { mode: 0o600 });
	checks += 1;
	finish(deployed ? 'armed-deployed' : 'armed-local');
}
else {
	const scenario = await provisionScreenOutputScenario(session, { label: 'Delivery Semantics' });
	evidence.addSecret(scenario.capability);
	try {
		const { route } = await runCapabilityRoute(scenario);
		await runRevocation(scenario, route);
		await runEditorRoute(scenario);
	}
	finally {
		await scenario.dispose();
	}
	finish(deployed ? 'deployed' : 'local');
}

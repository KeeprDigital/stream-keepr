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
	checkDenialIndistinguishableFromMissing,
	checkFullRead,
	checkIntegrityDisagreement,
	checkMissingIdentity,
	checkNoStorageAddressing,
	checkOriginExposure,
	checkRangeRead,
	checkRetryableUnavailable,
	checkUnsatisfiableRange,
	checkValidatorStability,
} from './graphics-acceptance/assertions.mjs';
import { AcceptanceFailure, deliveryRouteLabel } from './graphics-acceptance/evidence.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import {
	acceptanceOrigin,
	openInstallation,
	provisionScreenOutputScenario,
} from './graphics-acceptance/installation.mjs';
import { acceptanceRoutes } from './graphics-acceptance/routes.mjs';

const HARNESS = 'graphics-delivery-v1';
const FAULTS = new Set([
	'content-unavailable',
	'content-integrity-disagreement',
	'd1-outage',
	'r2-outage-authorized-cache',
]);

function flagValue(name) {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

const deployed = process.argv.includes('--deployed');
const requireCacheHit = process.argv.includes('--require-cache-hit');
const armPath = flagValue('--arm');
const fault = flagValue('--fault');
const scenarioPath = flagValue('--scenario');

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

await runAcceptanceHarness({
	harness: HARNESS,
	async run({ evidence, record, note, checks }) {
		if (fault && !FAULTS.has(fault))
			throw new AcceptanceFailure('harness-precondition-unmet', { reason: 'unknown fault' });
		if (fault && !scenarioPath)
			throw new AcceptanceFailure('harness-precondition-unmet', { reason: 'no armed scenario' });

		const origin = acceptanceOrigin({ deployed });
		const session = await openInstallation(origin);
		evidence.addSecret(session.authorCookie);

		async function runCapabilityRoute(scenario) {
			const path = scenario.capabilityContentPath();
			const route = deliveryRouteLabel(path);
			const byteLength = scenario.content.byteLength;

			// Before anything is authorized, the route must already refuse.
			const anonymous = await session.request(path);
			record(checkCapabilityDenial(anonymous, { route, body: anonymous.text() }));

			// And it must refuse an unreachable revision in exactly the same way,
			// or the refusal itself becomes a way to enumerate the Screen Output.
			const unreferenced = await session.request(
				acceptanceRoutes.capabilityContent(scenario.screenId, scenario.assetId, 'gar-not-referenced'),
				{ headers: capabilityHeaders(scenario.capability) },
			);
			record(checkMissingIdentity(unreferenced, { route }));
			record(checkDenialIndistinguishableFromMissing(anonymous, unreferenced, { route }));

			const full = await session.request(path, {
				headers: capabilityHeaders(scenario.capability),
			});
			record(checkFullRead(full, capabilityExpectations(scenario, route)));
			record(checkOriginExposure(full.headers, { route }));
			record(checkNoStorageAddressing(full.headers, { route }));
			record(checkContentSecurityPolicy(full.headers, { route, settled: 'absent' }));
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

			// A second read is the same representation whether or not a cache
			// answered it. Only a deployed run has an edge cache that could warm.
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
					note({ code: 'delivery-cache-state-unreported', detail: { route } });
			}

			// Native media elements carry the capability as a path-scoped cookie,
			// which is a second public entry point and a second authorization.
			const sessionRoute = deliveryRouteLabel(acceptanceRoutes.capabilitySession(scenario.screenId));
			const bootstrap = await session.request(
				acceptanceRoutes.capabilitySession(scenario.screenId),
				{ method: 'POST', headers: capabilityHeaders(scenario.capability) },
			);
			const sessionCookie = bootstrap.headers.getSetCookie().map(value => value.split(';', 1)[0])[0];
			if (bootstrap.status !== 204 || !sessionCookie) {
				record([{
					code: 'harness-precondition-unmet',
					detail: { route: sessionRoute, actual: bootstrap.status },
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

			// Cross-origin readers get nothing, not even a preflight grant.
			const preflight = await session.request(path, {
				method: 'OPTIONS',
				headers: {
					'origin': 'https://not-this-installation.invalid',
					'access-control-request-method': 'GET',
				},
			});
			record(preflight.headers.get('access-control-allow-origin')
				? [{ code: 'cors-preflight-permitted', detail: { route } }]
				: []);

			return { route };
		}

		/**
		 * The Screen Output document is where a policy would govern what an
		 * unattended output may load. It declares none today, and that is the
		 * settled behaviour this asserts — in both directions.
		 */
		async function runOutputDocument(scenario) {
			const path = acceptanceRoutes.screenOutputDocument(scenario.eventId, scenario.screenSlug);
			const route = deliveryRouteLabel(path);
			const document = await session.request(path, { headers: { accept: 'text/html' } });
			if (document.status !== 200) {
				record([{
					code: 'harness-precondition-unmet',
					detail: { route, actual: document.status },
				}]);
				return;
			}
			record(checkContentSecurityPolicy(document.headers, { route, settled: 'absent' }));
			record(checkOriginExposure(document.headers, { route }));
			record(checkNoStorageAddressing(document.headers, { route }));
		}

		/**
		 * Rotation is where the two halves of the contract meet: the bytes are
		 * immutable and may be cached forever, and the capability that reached
		 * them must stop working immediately anyway.
		 */
		async function runRevocation(scenario, route) {
			const path = scenario.capabilityContentPath();
			const revoked = scenario.capability;
			const replacement = await scenario.rotateCapability();

			const staleRead = await session.request(path, { headers: capabilityHeaders(revoked) });
			record(staleRead.status === 200
				? [{ code: 'delivery-revocation-ineffective', detail: { route } }]
				: checkCapabilityDenial(staleRead, { route, body: staleRead.text() }));

			const staleBootstrap = await session.request(
				acceptanceRoutes.capabilitySession(scenario.screenId),
				{ method: 'POST', headers: capabilityHeaders(revoked) },
			);
			record(staleBootstrap.status === 404
				? []
				: [{
						code: 'delivery-revocation-ineffective',
						detail: { route, actual: staleBootstrap.status },
					}]);

			// Warmed or not, an unauthorized read is still refused.
			const anonymous = await session.request(path);
			record(anonymous.status === 200
				? [{ code: 'delivery-authorization-skipped', detail: { route } }]
				: []);

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
			record(checkContentSecurityPolicy(full.headers, { route, settled: 'absent' }));
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
				acceptanceRoutes.editorContent(scenario.assetId, 'gar-not-a-revision'),
				{ author: true },
			);
			record(checkMissingIdentity(missing, { route }));
		}

		async function runFault(scenario) {
			const path = scenario.capabilityContentPath();
			const route = deliveryRouteLabel(path);
			const editorRoute = deliveryRouteLabel(scenario.editorContentPath());
			const read = await session.request(path, { headers: capabilityHeaders(scenario.capability) });

			if (fault === 'content-unavailable' || fault === 'd1-outage') {
				record(checkRetryableUnavailable(read, { route }));
				const editorRead = await session.request(scenario.editorContentPath(), { author: true });
				record(checkRetryableUnavailable(editorRead, { route: editorRoute }));
			}

			if (fault === 'content-integrity-disagreement') {
				// Bytes that disagree with their recorded facts are refused rather
				// than served, and the refusal invites a repair rather than
				// declaring the revision gone.
				record(checkIntegrityDisagreement(read, { route, bytes: scenario.content }));
				const editorRead = await session.request(scenario.editorContentPath(), { author: true });
				record(checkIntegrityDisagreement(editorRead, { route: editorRoute, bytes: scenario.content }));
			}

			if (fault === 'd1-outage') {
				const bootstrap = await session.request(
					acceptanceRoutes.capabilitySession(scenario.screenId),
					{ method: 'POST', headers: capabilityHeaders(scenario.capability) },
				);
				record(checkRetryableUnavailable(bootstrap, {
					route: deliveryRouteLabel(acceptanceRoutes.capabilitySession(scenario.screenId)),
				}));
			}

			if (fault === 'r2-outage-authorized-cache') {
				// The warmed representation still serves, byte for byte, because
				// the authorized cache holds it and authorization never went to R2.
				record(checkFullRead(read, capabilityExpectations(scenario, route)));
				record(checkNoStorageAddressing(read.headers, { route }));
				// A read the cache never held has nowhere to come from, and says so
				// as a retryable outage rather than as a missing identity.
				const cold = await session.request(scenario.editorContentPath(), { author: true });
				record(checkRetryableUnavailable(cold, { route: editorRoute }));
			}
		}

		if (fault) {
			const armed = JSON.parse(await readFile(scenarioPath, 'utf8'));
			evidence.addSecret(armed.capability);
			const scenario = {
				...armed,
				content: Uint8Array.from(armed.content),
				capabilityContentPath: () =>
					acceptanceRoutes.capabilityContent(armed.screenId, armed.assetId, armed.revisionId),
				editorContentPath: () => acceptanceRoutes.editorContent(armed.assetId, armed.revisionId),
			};
			try {
				await runFault(scenario);
			}
			finally {
				await session.request(acceptanceRoutes.event(armed.eventId), {
					method: 'DELETE',
					author: true,
				}).catch(() => undefined);
				await rm(scenarioPath, { force: true });
			}
			return { checks: checks(), mode: `fault:${fault}` };
		}

		if (armPath) {
			const scenario = await provisionScreenOutputScenario(session, {
				label: 'Delivery Fault Injection',
			});
			evidence.addSecret(scenario.capability);
			// Warm whatever cache exists before the operator breaks the store.
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
			record([]);
			return { mode: deployed ? 'armed-deployed' : 'armed-local' };
		}

		const scenario = await provisionScreenOutputScenario(session, { label: 'Delivery Semantics' });
		evidence.addSecret(scenario.capability);
		try {
			const { route } = await runCapabilityRoute(scenario);
			await runOutputDocument(scenario);
			await runRevocation(scenario, route);
			await runEditorRoute(scenario);
		}
		finally {
			await scenario.dispose();
		}
		return { mode: deployed ? 'deployed' : 'local' };
	},
});

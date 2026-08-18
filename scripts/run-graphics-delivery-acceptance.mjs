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
 * they do not inject it. `--arm` provisions the scenario, the operator injects
 * the outage, and `--fault` resumes against the same identities. See
 * docs/operations/graphics-staging-acceptance.md.
 *
 * Arming provisions **two** Screen Outputs, because the faults disagree about
 * what a cache should be holding and a single representation cannot satisfy
 * both. The warm one is read once through the capability route, so a deployed
 * edge cache holds its immutable response; the cold one is never read there at
 * all. `r2-outage-authorized-cache` then asserts the warm representation keeps
 * serving through a storage outage, and `content-unavailable` asserts the cold
 * one reports a retryable outage — which the warm one provably cannot do,
 * because serving it from an authorized cache is the settled correct
 * behaviour rather than a defect.
 */

import process from 'node:process';
import {
	armedRepresentation,
	readArmedScenario,
	releaseArmedScenario,
	restoreArmedRepresentation,
	writeArmedScenario,
} from './graphics-acceptance/armed-scenario.mjs';
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
	registerSessionSecrets,
	trashGraphicAssetBestEffort,
} from './graphics-acceptance/installation.mjs';
import { requireLocalAcceptanceConfiguration } from './graphics-acceptance/local-configuration.mjs';
import { acceptanceRoutes } from './graphics-acceptance/routes.mjs';

const HARNESS = 'graphics-delivery-v1';
const FAULTS = new Set([
	'content-unavailable',
	'content-integrity-disagreement',
	'd1-outage',
	'r2-outage-authorized-cache',
]);

function flagValue(argv, name) {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
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

export async function main(argv = process.argv) {
	const deployed = argv.includes('--deployed');
	const requireCacheHit = argv.includes('--require-cache-hit');
	const armPath = flagValue(argv, '--arm');
	const fault = flagValue(argv, '--fault');
	const scenarioPath = flagValue(argv, '--scenario');

	await runAcceptanceHarness({
		harness: HARNESS,
		async run({ evidence, record, note, checks, failed }) {
			if (fault && !FAULTS.has(fault))
				throw new AcceptanceFailure('harness-precondition-unmet', { reason: 'unknown fault' });
			if (fault && !scenarioPath)
				throw new AcceptanceFailure('harness-precondition-unmet', { reason: 'no armed scenario' });

			// Before the origin, because a local run without the signing key gets 503s
			// from capability minting and never reaches an assertion (#274).
			requireLocalAcceptanceConfiguration({ deployed });

			const origin = acceptanceOrigin({ deployed });
			const session = await openInstallation(origin, { deployed });
			registerSessionSecrets(evidence, session);

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
				if (bootstrap.status !== 200 || !sessionCookie) {
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

			/** Read one armed representation through both of its public routes. */
			async function readBothRoutes(representation) {
				return {
					route: deliveryRouteLabel(representation.capabilityContentPath()),
					editorRoute: deliveryRouteLabel(representation.editorContentPath()),
					capability: await session.request(representation.capabilityContentPath(), {
						headers: capabilityHeaders(representation.capability),
					}),
					editor: await session.request(representation.editorContentPath(), { author: true }),
				};
			}

			async function runFault({ warm, cold }) {
				if (fault === 'content-unavailable') {
					// Addressed at the cold representation on purpose. A warmed one
					// cannot report this outage and should not: its immutable response
					// is already held by an authorized cache, and serving it through a
					// storage outage is the behaviour `r2-outage-authorized-cache`
					// exists to confirm.
					const observed = await readBothRoutes(cold);
					record(checkRetryableUnavailable(observed.capability, { route: observed.route }));
					record(checkRetryableUnavailable(observed.editor, { route: observed.editorRoute }));

					// One missing object takes down one revision and nothing else.
					const unaffected = await readBothRoutes(warm);
					record(checkFullRead(
						unaffected.capability,
						capabilityExpectations(warm, unaffected.route),
					));
				}

				if (fault === 'content-integrity-disagreement') {
					// Bytes that disagree with their recorded facts are refused rather
					// than served, and the refusal invites a repair rather than
					// declaring the revision gone. Addressed at the cold representation
					// for the same reason as above.
					const observed = await readBothRoutes(cold);
					record(checkIntegrityDisagreement(observed.capability, { route: observed.route }));
					record(checkIntegrityDisagreement(observed.editor, { route: observed.editorRoute }));
				}

				if (fault === 'd1-outage') {
					// A catalogue that cannot answer fails closed everywhere, warm or
					// cold: authorization runs before any cache is consulted, so there
					// is no representation this outage should let through.
					for (const representation of [cold, warm]) {
						const observed = await readBothRoutes(representation);
						record(checkRetryableUnavailable(observed.capability, { route: observed.route }));
						record(checkRetryableUnavailable(observed.editor, { route: observed.editorRoute }));
					}
					const bootstrap = await session.request(
						acceptanceRoutes.capabilitySession(cold.screenId),
						{ method: 'POST', headers: capabilityHeaders(cold.capability) },
					);
					record(checkRetryableUnavailable(bootstrap, {
						route: deliveryRouteLabel(acceptanceRoutes.capabilitySession(cold.screenId)),
					}));
				}

				if (fault === 'r2-outage-authorized-cache') {
					// A read the cache never held has nowhere to come from, and says so
					// as a retryable outage rather than as a missing identity. True in
					// every environment, so it is asserted in every environment.
					const observed = await readBothRoutes(cold);
					record(checkRetryableUnavailable(observed.capability, { route: observed.route }));
					record(checkRetryableUnavailable(observed.editor, { route: observed.editorRoute }));

					// The warmed representation still serves, byte for byte, because the
					// authorized cache holds it and authorization never went to R2.
					// Deployed-only: `wrangler dev --local` has no edge cache to have
					// warmed, so locally this would assert an invariant the environment
					// cannot host.
					const warmed = await readBothRoutes(warm);
					// The editor route shares no cache with the capability route, so the
					// warmed representation reports the outage there in every
					// environment. This is the clause the runbook promises.
					record(checkRetryableUnavailable(warmed.editor, { route: warmed.editorRoute }));
					if (deployed) {
						record(checkFullRead(warmed.capability, capabilityExpectations(warm, warmed.route)));
						record(checkNoStorageAddressing(warmed.capability.headers, { route: warmed.route }));
					}
					else {
						// Distinct from `delivery-cache-state-unreported`, which means the
						// edge did not report warmth. This means there is no edge cache
						// here to report anything, so the assertion was never attempted.
						note({ code: 'delivery-cache-not-observable', detail: { route: warmed.route } });
					}
				}
			}

			if (fault) {
				const armed = await readArmedScenario(scenarioPath);
				const restore = (stored) => {
					evidence.addSecret(stored.capability);
					return restoreArmedRepresentation(stored);
				};

				let faultPassed = false;
				try {
					await runFault({ warm: restore(armed.warm), cold: restore(armed.cold) });
					faultPassed = !failed();
				}
				finally {
					// A failed run keeps everything it would need to be run again: the
					// scenario file holds the only copy of the bytes the operator has
					// just deleted, and the Events hold the identities that address
					// them. Tearing either down would leave the restore step in the
					// runbook impossible to follow.
					if (faultPassed) {
						for (const eventId of new Set([armed.warm.eventId, armed.cold.eventId])) {
							await session.request(acceptanceRoutes.event(eventId), {
								method: 'DELETE',
								author: true,
							}).catch(() => undefined);
						}
						// A passed run has nothing left to restore, so its two armed
						// pixels go with it (#375) — the Events above released their
						// references. A failed run keeps both, per the comment above.
						for (const assetId of new Set([armed.warm.assetId, armed.cold.assetId]))
							await trashGraphicAssetBestEffort(session, assetId);
					}
					const { kept } = await releaseArmedScenario(scenarioPath, { passed: faultPassed });
					if (kept) {
						// Printed outside the evidence formatter deliberately. This is a
						// path the operator typed on their own command line, not anything
						// derived from the installation, and withholding it would break
						// the restore path this file exists to protect.
						process.stderr.write(
							`${HARNESS} kept the armed scenario at ${scenarioPath} so the injected fault can be `
							+ 'restored and re-run; its acceptance Events were left in place for the same reason. '
							+ 'Delete both once you are done.\n',
						);
					}
				}
				return { checks: checks(), mode: `fault:${fault}` };
			}

			if (armPath) {
				// Two representations, because the faults disagree about what a cache
				// should be holding. See this file's header.
				const warm = await provisionScreenOutputScenario(session, {
					label: 'Delivery Fault Injection Warm',
				});
				const cold = await provisionScreenOutputScenario(session, {
					label: 'Delivery Fault Injection Cold',
				});
				evidence.addSecret(warm.capability);
				evidence.addSecret(cold.capability);

				// Warm whatever cache exists before the operator breaks the store, and
				// leave the cold one untouched on the capability route.
				await session.request(warm.capabilityContentPath(), {
					headers: capabilityHeaders(warm.capability),
				});

				await writeArmedScenario(armPath, {
					warm: armedRepresentation(warm),
					cold: armedRepresentation(cold),
				});
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
}

if (import.meta.main)
	await main();

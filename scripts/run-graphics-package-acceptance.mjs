/**
 * Template Package publication acceptance.
 *
 * A publication either happened or it did not. This harness proves both edges
 * of that against a running installation: nothing a package would create is
 * discoverable before installation commits, an interrupted attempt leaves no
 * half-published Template or orphaned asset behind, and retrying answers with
 * the result that already committed rather than publishing a second copy.
 *
 * It runs a real round trip — export this installation's own Template Package,
 * rewrite its manifest to claim an origin the installation has never seen, and
 * install it — so installation has to create identities rather than recognise
 * its own.
 *
 * Usage: node scripts/run-graphics-package-acceptance.mjs [--deployed]
 */

import process from 'node:process';
import { deliveryRouteLabel } from './graphics-acceptance/evidence.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import {
	acceptanceOrigin,
	openInstallation,
	provisionScreenOutputScenario,
} from './graphics-acceptance/installation.mjs';
import { requireLocalAcceptanceConfiguration } from './graphics-acceptance/local-configuration.mjs';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from './graphics-acceptance/repository-bridge.mjs';
import { acceptanceRoutes } from './graphics-acceptance/routes.mjs';

const HARNESS = 'graphics-package-v1';

/**
 * Re-address the packaged asset to an origin this installation has never seen,
 * so installation must publish a new identity instead of recognising the one
 * it exported a moment ago.
 */
function repointedPackage(archive, marker) {
	const parts = readTemplatePackageParts(archive);
	const packaged = parts.manifest.packagedAssets[0];
	const origin = {
		...packaged.origin,
		sourceAssetId: `gaa-unseen-${marker}`,
		sourceRevisionId: `gar-unseen-${marker}`,
	};
	parts.manifest.packagedAssets = [{
		...packaged,
		packagedId: 'packaged-asset-0001',
		name: 'Staging acceptance packaged asset',
		origin,
	}];
	parts.template = {
		...parts.template,
		frame: {
			...parts.template.frame,
			backgroundImage: {
				assetId: origin.sourceAssetId,
				revisionId: origin.sourceRevisionId,
			},
		},
	};
	return writeTemplatePackage(parts);
}

export async function main(argv = process.argv) {
	const deployed = argv.includes('--deployed');

	await runAcceptanceHarness({
		harness: HARNESS,
		async run({ evidence, record }) {
			// This harness provisions a Screen Output scenario, so it mints a
			// capability and needs the signing key the same way delivery does (#274).
			requireLocalAcceptanceConfiguration({ deployed });

			const origin = acceptanceOrigin({ deployed });
			const session = await openInstallation(origin);
			evidence.addSecret(session.authorCookie);

			async function listAssetIds() {
				const assets = await session.json(acceptanceRoutes.graphicsAssets(), { author: true });
				return new Set(assets.map(asset => asset.id));
			}

			async function receivePackage(archive, marker) {
				const initiated = await session.json(acceptanceRoutes.ingestionOperations(), {
					method: 'POST',
					author: true,
					body: {
						idempotencyKey: `staging-acceptance-package-${marker}`,
						source: 'template-package',
						sourceFileName: 'staging-acceptance.sklayout',
						declaredByteLength: archive.byteLength,
					},
				});
				const received = await session.json(acceptanceRoutes.ingestionContent(initiated.id), {
					method: 'PUT',
					author: true,
					body: archive,
				});
				if (received.stage !== 'awaiting-confirmation')
					return received;
				return await session.json(acceptanceRoutes.templatePackageConfirmation(received.id), {
					method: 'POST',
					author: true,
					body: { fingerprint: received.templatePackagePreflight.fingerprint },
				});
			}

			const installRoute = operationId =>
				deliveryRouteLabel(acceptanceRoutes.templatePackageInstallation(operationId));

			async function installPackage(operationId) {
				return await session.json(
					acceptanceRoutes.templatePackageInstallation(operationId),
					{ method: 'POST', author: true },
				);
			}

			/**
			 * Abandon one installation the way a dropped connection would.
			 *
			 * Aborting in the same tick as the call cancels the request before it
			 * ever reaches the wire, which proves nothing — so this warms the
			 * connection first, then lets the request go out before abandoning it.
			 *
			 * What the abort achieved is not knowable from the client: an abort and
			 * a slow response look identical from here. So the operation's own stage
			 * afterwards is the classifier, and the run reports it rather than
			 * claiming an interruption it cannot demonstrate. Either way the
			 * assertions that follow are the same, because the library must converge
			 * on exactly one committed result whatever the client did.
			 */
			async function interruptInstallation(operationId) {
				// A pooled connection means the abort races the installation rather
				// than the TCP handshake.
				await session.request(acceptanceRoutes.ingestionOperation(operationId), { author: true });

				const abort = new AbortController();
				async function abandon() {
					try {
						const response = await fetch(
							`${origin}${acceptanceRoutes.templatePackageInstallation(operationId)}`,
							{ method: 'POST', headers: { cookie: session.authorCookie }, signal: abort.signal },
						);
						try {
							await response.arrayBuffer();
							return 'answered';
						}
						catch {
							return 'cut-mid-body';
						}
					}
					catch (error) {
						return error?.name === 'AbortError' ? 'abandoned' : 'failed';
					}
				}

				const inflight = abandon();
				await new Promise(resolve => setTimeout(resolve, 15));
				abort.abort();
				const clientOutcome = await inflight;

				const observed = await session.json(acceptanceRoutes.ingestionOperation(operationId), {
					author: true,
				});
				return {
					stage: observed.stage,
					// `committed` means the installation ran to completion while the
					// client was already gone, which is the interruption worth having.
					outcome: observed.stage === 'completed' ? `${clientOutcome}-committed` : clientOutcome,
				};
			}

			const scenario = await provisionScreenOutputScenario(session, { label: 'Package Publication' });
			evidence.addSecret(scenario.capability);
			// What this run adds to the installation-wide library, so the way out
			// can trash whatever is trashable (#375). The successfully installed
			// package is not: an Installed Graphics Template is undeletable by
			// design (the FML library DELETE answers 409 "installed from a
			// Template Package and cannot be deleted here"), and its Graphic
			// Asset References keep the packaged asset in-use, so each completed
			// deployed run permanently adds one template and one asset. Recorded
			// on #375 as a residual needing a domain decision, not silently
			// retried here.
			const baselineAssets = await listAssetIds();
			let interruption;
			try {
				const exportRoute = acceptanceRoutes.featureMatchLayoutPackage(
					scenario.eventId,
					scenario.screenId,
				);
				const exported = await session.request(exportRoute, { author: true });
				if (exported.status !== 200) {
					record([{
						code: 'harness-precondition-unmet',
						detail: { route: deliveryRouteLabel(exportRoute), actual: exported.status },
					}]);
					return { mode: deployed ? 'deployed' : 'local' };
				}

				const marker = String(scenario.screenId);
				const archive = repointedPackage(exported.bytes, marker);

				const before = await listAssetIds();
				const received = await receivePackage(archive, marker);

				// Confirmation is not publication. Nothing the package would create may
				// be discoverable until installation commits.
				const during = await listAssetIds();
				record(during.size === before.size
					? []
					: [{ code: 'package-partial-assets-visible', detail: { stage: 'awaiting-installation' } }]);

				interruption = await interruptInstallation(received.id);
				// Whatever the abandoned attempt reached, the operation must be in one
				// of its two settled stages — never something in between.
				record(['awaiting-installation', 'completed'].includes(interruption.stage)
					? []
					: [{
							code: 'package-interrupted-result-exposed',
							detail: { route: installRoute(received.id), stage: interruption.stage },
						}]);
				// And it must not have published a partial result on the way out.
				const afterInterruption = await listAssetIds();
				record([...afterInterruption].filter(id => !before.has(id)).length > 1
					? [{ code: 'package-duplicate-commit', detail: { stage: 'interrupted' } }]
					: []);

				const completed = await installPackage(received.id);
				if (completed.stage !== 'completed') {
					record([{
						code: 'package-interrupted-result-exposed',
						detail: { route: installRoute(received.id), stage: completed.stage },
					}]);
				}
				else {
					const installation = completed.templatePackageInstallation;
					const after = await listAssetIds();
					const created = [...after].filter(id => !before.has(id));
					record(created.length === 1
						? []
						: [{
								code: 'package-duplicate-commit',
								detail: { expected: 1, actual: created.length },
							}]);

					// The Template and the asset it needs became visible together, and
					// the asset it names is really there.
					const template = await session.request(
						acceptanceRoutes.installedTemplate(installation.templateId),
						{ author: true },
					);
					record(template.status === 200
						? []
						: [{
								code: 'package-partial-assets-visible',
								detail: { stage: 'installed-template', actual: template.status },
							}]);

					const installed = installation.assets[0];
					const content = await session.request(
						acceptanceRoutes.editorContent(installed.assetId, installed.revisionId),
						{ author: true },
					);
					record(content.status === 200
						? []
						: [{
								code: 'package-partial-assets-visible',
								detail: { stage: 'installed-content', actual: content.status },
							}]);

					// Installing again answers with what already committed.
					const repeated = await installPackage(received.id);
					record(
						JSON.stringify(repeated.templatePackageInstallation) === JSON.stringify(installation)
							? []
							: [{ code: 'package-retry-not-idempotent', detail: { stage: 'reinstall' } }],
					);
					record((await listAssetIds()).size === after.size
						? []
						: [{ code: 'package-duplicate-commit', detail: { stage: 'reinstall' } }]);
				}

				// A package cancelled before installation publishes nothing, and asking
				// to install it afterwards reports the cancellation rather than reviving
				// a half-finished publication.
				const settled = await listAssetIds();
				const cancellable = await receivePackage(
					repointedPackage(exported.bytes, `${marker}-cancelled`),
					`${marker}-cancelled`,
				);
				await session.json(acceptanceRoutes.ingestionOperation(cancellable.id), {
					method: 'DELETE',
					author: true,
				});
				const attempted = await installPackage(cancellable.id);
				record(attempted.stage === 'cancelled' && attempted.templatePackageInstallation === undefined
					? []
					: [{
							code: 'package-interrupted-result-exposed',
							detail: { route: installRoute(cancellable.id), stage: attempted.stage },
						}]);
				record((await listAssetIds()).size === settled.size
					? []
					: [{ code: 'package-partial-assets-visible', detail: { stage: 'cancelled' } }]);
			}
			finally {
				// Best-effort, pass or fail: every asset this run added over the
				// baseline. The installed package's own asset answers in-use and
				// stays, per the comment above; what this catches is everything
				// else a partial or cancelled run can leave unpinned.
				try {
					const remaining = await listAssetIds();
					for (const assetId of remaining) {
						if (baselineAssets.has(assetId))
							continue;
						await session.request(acceptanceRoutes.assetLifecycleActions(assetId), {
							method: 'POST',
							author: true,
							body: { action: 'trash' },
						});
					}
				}
				catch {
					// A left-behind acceptance asset is noise, never a gate failure.
				}
				await scenario.dispose();
			}

			return {
				// Which situation the abandoned attempt actually caught, so a run that
				// only ever aborts before dispatch cannot masquerade as one that
				// interrupted a working installation.
				interrupted: interruption?.outcome ?? 'not-attempted',
				mode: deployed ? 'deployed' : 'local',
			};
		},
	});
}

if (import.meta.main)
	await main();

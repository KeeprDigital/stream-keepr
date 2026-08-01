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
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from './graphics-acceptance/domain-defaults.mjs';
import { createAcceptanceEvidence } from './graphics-acceptance/evidence.mjs';
import {
	acceptanceOrigin,
	openInstallation,
	provisionScreenOutputScenario,
} from './graphics-acceptance/installation.mjs';

const HARNESS = 'graphics-package-v1';

const deployed = process.argv.includes('--deployed');
const origin = acceptanceOrigin({ deployed });
const session = await openInstallation(origin);
const evidence = createAcceptanceEvidence({ harness: HARNESS, secrets: [session.authorCookie] });

const failures = [];
let checks = 0;

function record(found) {
	checks += 1;
	failures.push(...found);
}

async function listAssetIds() {
	const assets = await session.json('/api/graphics-assets', { author: true });
	return new Set(assets.map(asset => asset.id));
}

async function receivePackage(archive, marker) {
	const initiated = await session.json('/api/graphics-assets/ingestion-operations', {
		method: 'POST',
		author: true,
		body: {
			idempotencyKey: `staging-acceptance-package-${marker}`,
			source: 'template-package',
			sourceFileName: 'staging-acceptance.sklayout',
			declaredByteLength: archive.byteLength,
		},
	});
	const received = await session.json(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
		{ method: 'PUT', author: true, body: archive },
	);
	if (received.stage !== 'awaiting-confirmation')
		return received;
	return await session.json(
		`/api/graphics-assets/ingestion-operations/${received.id}/template-package-confirmation`,
		{
			method: 'POST',
			author: true,
			body: { fingerprint: received.templatePackagePreflight.fingerprint },
		},
	);
}

async function installPackage(operationId) {
	return await session.json(
		`/api/graphics-assets/ingestion-operations/${operationId}/template-package-installation`,
		{ method: 'POST', author: true },
	);
}

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

const scenario = await provisionScreenOutputScenario(session, { label: 'Package Publication' });
evidence.addSecret(scenario.capability);
try {
	const exported = await session.request(
		`/api/events/${scenario.eventId}/screens/${scenario.screenId}/template-packages/feature-match-layout`,
		{ author: true },
	);
	if (exported.status !== 200) {
		record([{
			code: 'harness-precondition-unmet',
			detail: { route: 'template-package export', actual: exported.status },
		}]);
	}
	else {
		const marker = String(scenario.screenId);
		const archive = repointedPackage(exported.bytes, marker);

		const before = await listAssetIds();
		const received = await receivePackage(archive, marker);

		// Confirmation is not publication. Nothing the package would create may
		// be discoverable until installation commits.
		const during = await listAssetIds();
		checks += 1;
		if (during.size !== before.size)
			failures.push({ code: 'package-partial-assets-visible', detail: { stage: 'awaiting-installation' } });

		// Abandon one attempt the way a dropped connection would, then retry.
		// Whatever the first attempt reached, the library must converge on
		// exactly one committed result.
		const abort = new AbortController();
		const interrupted = fetch(
			`${origin}/api/graphics-assets/ingestion-operations/${received.id}/template-package-installation`,
			{ method: 'POST', headers: { cookie: session.authorCookie }, signal: abort.signal },
		).catch(() => undefined);
		abort.abort();
		await interrupted;

		const completed = await installPackage(received.id);
		checks += 1;
		if (completed.stage !== 'completed') {
			failures.push({
				code: 'package-interrupted-result-exposed',
				detail: { stage: completed.stage },
			});
		}
		else {
			const installation = completed.templatePackageInstallation;
			const after = await listAssetIds();
			const created = [...after].filter(id => !before.has(id));
			checks += 1;
			if (created.length !== 1) {
				failures.push({
					code: 'package-duplicate-commit',
					detail: { expected: 1, actual: created.length },
				});
			}

			// The Template and the asset it needs became visible together, and
			// the asset it names is really there.
			const template = await session.request(
				`/api/graphics-assets/installed-templates/${installation.templateId}`,
				{ author: true },
			);
			checks += 1;
			if (template.status !== 200) {
				failures.push({
					code: 'package-partial-assets-visible',
					detail: { stage: 'installed-template', actual: template.status },
				});
			}
			const installed = installation.assets[0];
			const content = await session.request(
				`/api/graphics-assets/${installed.assetId}/revisions/${installed.revisionId}/content`,
				{ author: true },
			);
			checks += 1;
			if (content.status !== 200) {
				failures.push({
					code: 'package-partial-assets-visible',
					detail: { stage: 'installed-content', actual: content.status },
				});
			}

			// Installing again answers with what already committed.
			const repeated = await installPackage(received.id);
			checks += 1;
			if (JSON.stringify(repeated.templatePackageInstallation) !== JSON.stringify(installation))
				failures.push({ code: 'package-retry-not-idempotent', detail: { stage: 'reinstall' } });
			checks += 1;
			if ((await listAssetIds()).size !== after.size)
				failures.push({ code: 'package-duplicate-commit', detail: { stage: 'reinstall' } });
		}

		// A package cancelled before installation publishes nothing, and asking
		// to install it afterwards reports the cancellation rather than reviving
		// a half-finished publication.
		const settled = await listAssetIds();
		const cancellable = await receivePackage(repointedPackage(exported.bytes, `${marker}-cancelled`), `${marker}-cancelled`);
		await session.json(`/api/graphics-assets/ingestion-operations/${cancellable.id}`, {
			method: 'DELETE',
			author: true,
		});
		const attempted = await installPackage(cancellable.id);
		checks += 1;
		if (attempted.stage !== 'cancelled' || attempted.templatePackageInstallation !== undefined)
			failures.push({ code: 'package-interrupted-result-exposed', detail: { stage: attempted.stage } });
		checks += 1;
		if ((await listAssetIds()).size !== settled.size)
			failures.push({ code: 'package-partial-assets-visible', detail: { stage: 'cancelled' } });
	}
}
finally {
	await scenario.dispose();
}

if (failures.length > 0)
	throw new Error(`${HARNESS} acceptance failed:\n${evidence.report(failures)}`);
process.stdout.write(`${evidence.passed({ checks, mode: deployed ? 'deployed' : 'local' })}\n`);

/**
 * Safari VP9-alpha acceptance.
 *
 * The Graphic Asset Compatibility Profile restricts VP9 alpha to
 * Chromium-class Screen Outputs. This gate was first written expecting the
 * restriction to enforce itself — that Safari would refuse the content — and
 * the deployed run disproved that: Safari 26.5 decodes VP9 alpha and flattens
 * the alpha channel away. It plays, and plays wrongly, which is worse for a
 * graphic going to air than not playing at all.
 *
 * So what this harness proves is the product boundary, which is the half that
 * is enforceable: a Screen Output never hands a Safari user agent the bytes of
 * a restricted revision. Deployed mode publishes such a Screen Output, drives
 * Safari at it, and requires the settled `409 vp9-alpha-chromium-required`
 * refusal on the revision's own delivery route — while the capability session
 * itself opens, because refusing that cost the output every other asset the
 * Screen publishes rather than the one clip Safari would show wrongly (#98).
 *
 * What Safari does with the raw video is still observed, and still worth
 * having — it is the evidence for why the boundary must exist — but it is
 * recorded rather than judged. `substituted` is the expected fact on current
 * Safari and `refused` on older ones; only `transparency-rendered` is
 * remarkable, and even then it argues for revisiting the restriction rather
 * than failing this contract.
 *
 * Safari is driven through `safaridriver`, which speaks WebDriver over HTTP
 * and ships with macOS, so nothing is added to the dependency tree. Driving it
 * requires a one-time `sudo safaridriver --enable`; when that has not been
 * done the harness prints the manual observation to make instead, and says
 * which of the two paths ran.
 *
 * Usage: node scripts/run-safari-vp9-alpha-acceptance.mjs [--deployed] [--allow-manual]
 */

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { serveAcceptanceRoutes, verdictFailureCode } from './graphics-acceptance/chromium.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import {
	acceptanceOrigin,
	openInstallation,
	provisionRestrictedVideoScenario,
	registerSessionSecrets,
} from './graphics-acceptance/installation.mjs';

const HARNESS = 'vp9-alpha-safari-v1';
const ACCEPTANCE_PATH = '/_acceptance/vp9-alpha-safari-v1.html';
const DRIVER_PORT = Number(process.env.STREAM_KEEPR_SAFARIDRIVER_PORT ?? 7055);

async function startSafariDriver() {
	const child = spawn('safaridriver', ['-p', String(DRIVER_PORT)], {
		stdio: ['ignore', 'ignore', 'pipe'],
	});
	let stderr = '';
	child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
	const failedEarly = new Promise(resolve => child.once('exit', () => resolve('exited')));
	child.once('error', () => undefined);

	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		if (await Promise.race([failedEarly, Promise.resolve(undefined)]) === 'exited')
			return { available: false, detail: stderr.trim(), stop: () => undefined };
		const reachable = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`)
			.then(response => response.ok)
			.catch(() => false);
		if (reachable)
			return { available: true, stop: () => child.kill('SIGTERM') };
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	child.kill('SIGTERM');
	return { available: false, detail: stderr.trim(), stop: () => undefined };
}

async function observeSafariVerdict(url, { sessionUrl } = {}) {
	const base = `http://127.0.0.1:${DRIVER_PORT}`;
	const created = await fetch(`${base}/session`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'safari' } } }),
	}).then(response => response.json());
	const sessionId = created.value?.sessionId;
	// `safaridriver` answers on its port before Safari itself will accept
	// automation, so a refused session is the second half of "not enabled".
	if (!sessionId)
		return { outcome: 'unavailable', detail: created.value?.message || created.value?.error };
	const visit = async destination => await fetch(`${base}/session/${sessionId}/url`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ url: destination }),
	});
	try {
		// A graphics author session is issued on an ordinary page load, and the
		// page mints its own capability with it. Static assets do not pass through
		// the middleware that issues it, so visit the application first.
		if (sessionUrl) {
			await visit(sessionUrl);
			await new Promise(resolve => setTimeout(resolve, 750));
		}
		await visit(url);
		const deadline = Date.now() + 45_000;
		while (Date.now() < deadline) {
			const evaluated = await fetch(`${base}/session/${sessionId}/execute/sync`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					script: 'return JSON.stringify({ ...(document.body ? document.body.dataset : {}) })',
					args: [],
				}),
			}).then(response => response.json());
			const dataset = JSON.parse(evaluated.value ?? '{}');
			if (dataset.result === 'passed' || dataset.result === 'failed')
				return { outcome: dataset.result, code: dataset.code, dataset };
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		return { outcome: 'timed-out' };
	}
	finally {
		await fetch(`${base}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);
	}
}

async function serveLocally() {
	const file = async name => await readFile(new URL(`../public/_acceptance/${name}`, import.meta.url));
	return await serveAcceptanceRoutes({
		[ACCEPTANCE_PATH]: async () => ({
			body: await file('vp9-alpha-safari-v1.html'),
			type: 'text/html; charset=utf-8',
		}),
		'/_acceptance/vp9-alpha-v1.json': async () => ({
			body: await file('vp9-alpha-v1.json'),
			type: 'application/json',
		}),
	});
}

/**
 * What a person should do when the driver could not run.
 *
 * The page address is given without a Screen Output to try, deliberately. The
 * origin is the one the operator configured, so printing it discloses nothing
 * they did not supply — but an `?event=&screen=` pair is installation-derived
 * identity, which this gate prints nowhere else and will not start printing
 * here. A manual run therefore records the browser fact alone. That is not a
 * loss: the harness no longer provisions a Screen Output it has no driver to
 * point at, so there would be nothing for those identities to name.
 */
function manualInstructions(origin, reason) {
	return [
		`${HARNESS} manual check required: Safari automation is not available.`,
		reason ? `safaridriver said: ${reason}` : undefined,
		'Enable it once with: sudo safaridriver --enable',
		'and tick Develop > Allow Remote Automation in Safari.',
		`Otherwise open ${origin}${ACCEPTANCE_PATH} in Safari and read its verdict.`,
		'That records the browser fact alone — expect "substituted" on current',
		'Safari. It does not exercise the product boundary, which is the part that',
		'matters: only an automated run against a deployed installation can publish',
		'a Screen Output pinning restricted video and confirm the refusal.',
	].filter(Boolean).join('\n');
}

export async function main(argv = process.argv) {
	const deployed = argv.includes('--deployed');
	const allowManual = argv.includes('--allow-manual') || !deployed;

	await runAcceptanceHarness({
		harness: HARNESS,
		async run({ evidence, record, note, defer }) {
			const local = deployed ? undefined : await serveLocally();
			let scenario;
			try {
				const origin = deployed ? acceptanceOrigin({ deployed }) : local.origin;

				// The driver is settled before anything is provisioned. A Screen Output
				// nobody can drive a browser at is one more restricted asset in a real
				// installation, published for no reason and torn down before a person
				// could look at it.
				const driver = await startSafariDriver();
				if (!driver.available) {
					// A deployed gate that quietly downgrades to "someone should look at
					// this" is not a gate, so the fallback is opt-in there.
					if (!allowManual) {
						record([{ code: 'browser-driver-unavailable', detail: { driver: 'safaridriver' } }]);
						process.stderr.write(`${manualInstructions(origin, driver.detail)}\n`);
						return { path: 'safaridriver', mode: deployed ? 'deployed' : 'local' };
					}
					defer(
						{ path: 'manual-check-required', mode: deployed ? 'deployed' : 'local' },
						manualInstructions(origin, driver.detail),
					);
					return {};
				}

				// Only a deployed installation can hold a restricted Screen Output: the
				// video has to pass the silent-video validator, and the local Worker has
				// no service binding to reach it. Local runs therefore observe the
				// browser fact alone and say so rather than implying the boundary was
				// tested.
				let url = `${origin}${ACCEPTANCE_PATH}`;
				if (deployed) {
					const session = await openInstallation(origin, { deployed });
					registerSessionSecrets(evidence, session);
					const { webmBase64 } = JSON.parse(await readFile(
						new URL('../public/_acceptance/vp9-alpha-v1.json', import.meta.url),
						'utf8',
					));
					scenario = await provisionRestrictedVideoScenario(session, {
						label: 'Safari VP9 Alpha Boundary',
						webm: Uint8Array.from(Buffer.from(webmBase64, 'base64')),
					});
					// The exact revision travels with the Screen Output, because the
					// refusal being proved is per resolution request rather than per
					// capability session (#98) and the page has to ask for those bytes
					// by name.
					url = `${origin}${ACCEPTANCE_PATH}`
						+ `?event=${scenario.eventId}&screen=${scenario.screenId}`
						+ `&asset=${encodeURIComponent(scenario.assetId)}`
						+ `&revision=${encodeURIComponent(scenario.revisionId)}`;
				}

				let verdict;
				try {
					// The page mints its own capability through the author session an
					// ordinary page load issues, so nothing secret travels in the URL.
					verdict = await observeSafariVerdict(url, { sessionUrl: `${origin}/` });
				}
				finally {
					driver.stop();
				}

				if (verdict.outcome === 'unavailable') {
					if (!allowManual) {
						record([{ code: 'browser-driver-unavailable', detail: { driver: 'safaridriver' } }]);
						process.stderr.write(`${manualInstructions(origin, verdict.detail)}\n`);
						return { path: 'safaridriver', mode: deployed ? 'deployed' : 'local' };
					}
					defer(
						{ path: 'manual-check-required', mode: deployed ? 'deployed' : 'local' },
						manualInstructions(origin, verdict.detail),
					);
					return {};
				}

				record(verdict.outcome === 'passed'
					? []
					: [{ code: verdictFailureCode(verdict), detail: { driver: 'safaridriver' } }]);

				const boundary = verdict.dataset?.boundary ?? 'not-exercised';
				// The boundary is the whole reason for a deployed run, so reaching the
				// end without having exercised it is a failure rather than a footnote.
				// A page that fell through to its browser-fact-only branch would
				// otherwise report a pass having asserted nothing that matters.
				if (deployed) {
					record(boundary === 'exercised'
						? []
						: [{
								code: 'harness-precondition-unmet',
								detail: { reason: 'the product boundary was not exercised' },
							}]);
				}

				// A Safari that preserved the transparency would mean the premise of the
				// restriction had changed. That is not a defect in the current contract
				// — the boundary still held — but it is the one browser fact worth a
				// human deciding whether the restriction should be relaxed.
				if (verdict.dataset?.browserFact === 'transparency-rendered')
					note({ code: 'safari-vp9-alpha-transparency-rendered', detail: { driver: 'safaridriver' } });

				return {
					path: 'safaridriver',
					boundary,
					browserFact: verdict.dataset?.browserFact ?? 'unobserved',
					mode: deployed ? 'deployed' : 'local',
				};
			}
			finally {
				await scenario?.dispose();
				await local?.close();
			}
		},
	});
}

if (import.meta.main)
	await main();

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
 * is enforceable: a Screen Output pinning restricted video refuses to hand a
 * Safari user agent a capability session at all. Deployed mode publishes such
 * a Screen Output, drives Safari at it, and requires the settled
 * `409 vp9-alpha-chromium-required` refusal.
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
} from './graphics-acceptance/installation.mjs';

const HARNESS = 'vp9-alpha-safari-v1';
const ACCEPTANCE_PATH = '/_acceptance/vp9-alpha-safari-v1.html';
const DRIVER_PORT = Number(process.env.STREAM_KEEPR_SAFARIDRIVER_PORT ?? 7055);

const deployed = process.argv.includes('--deployed');
const allowManual = process.argv.includes('--allow-manual') || !deployed;

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

function manualInstructions(url, reason) {
	return [
		`${HARNESS} manual check required: Safari automation is not available.`,
		reason ? `safaridriver said: ${reason}` : undefined,
		'Enable it once with: sudo safaridriver --enable',
		'and tick Develop > Allow Remote Automation in Safari.',
		`Otherwise open this page in Safari and read its verdict: ${url}`,
		'Expected: the page reports passed, meaning the Screen Output refused this',
		'browser a capability session. A reported safari-vp9-alpha-not-blocked is a',
		'gate failure. Whatever the page records as its browser fact — substituted,',
		'refused — is an observation, not a verdict.',
	].filter(Boolean).join('\n');
}

await runAcceptanceHarness({
	harness: HARNESS,
	async run({ evidence, record, note, defer }) {
		const local = deployed ? undefined : await serveLocally();
		let scenario;
		try {
			const origin = deployed ? acceptanceOrigin({ deployed }) : local.origin;

			// Only a deployed installation can hold a restricted Screen Output: the
			// video has to pass the silent-video validator, and the local Worker has
			// no service binding to reach it. Local runs therefore observe the
			// browser fact alone and say so rather than implying the boundary was
			// tested.
			let url = `${origin}${ACCEPTANCE_PATH}`;
			if (deployed) {
				const session = await openInstallation(origin);
				evidence.addSecret(session.authorCookie);
				const { webmBase64 } = JSON.parse(await readFile(
					new URL('../public/_acceptance/vp9-alpha-v1.json', import.meta.url),
					'utf8',
				));
				scenario = await provisionRestrictedVideoScenario(session, {
					label: 'Safari VP9 Alpha Boundary',
					webm: Uint8Array.from(Buffer.from(webmBase64, 'base64')),
				});
				url = `${origin}${ACCEPTANCE_PATH}?event=${scenario.eventId}&screen=${scenario.screenId}`;
			}

			const driver = await startSafariDriver();
			let verdict = { outcome: 'unavailable', detail: driver.detail };
			if (driver.available) {
				try {
					// The page mints its own capability through the author session an
					// ordinary page load issues, so nothing secret travels in the URL.
					verdict = await observeSafariVerdict(url, { sessionUrl: `${origin}/` });
				}
				finally {
					driver.stop();
				}
			}

			if (verdict.outcome === 'unavailable') {
				// A deployed gate that quietly downgrades to "someone should look at
				// this" is not a gate, so the fallback is opt-in there.
				if (!allowManual) {
					record([{ code: 'browser-driver-unavailable', detail: { driver: 'safaridriver' } }]);
					process.stderr.write(`${manualInstructions(url, verdict.detail)}\n`);
					return { path: 'safaridriver', mode: deployed ? 'deployed' : 'local' };
				}
				defer(
					{ path: 'manual-check-required', mode: deployed ? 'deployed' : 'local' },
					manualInstructions(url, verdict.detail),
				);
				return {};
			}

			record(verdict.outcome === 'passed'
				? []
				: [{ code: verdictFailureCode(verdict), detail: { driver: 'safaridriver' } }]);

			// A Safari that preserved the transparency would mean the premise of the
			// restriction had changed. That is not a defect in the current contract
			// — the boundary still held — but it is the one browser fact worth a
			// human deciding whether the restriction should be relaxed.
			if (verdict.dataset?.browserfact === 'transparency-rendered')
				note({ code: 'safari-vp9-alpha-transparency-rendered', detail: { driver: 'safaridriver' } });

			return {
				path: 'safaridriver',
				boundary: verdict.dataset?.boundary ?? 'not-exercised',
				browserFact: verdict.dataset?.browserfact ?? 'unobserved',
				mode: deployed ? 'deployed' : 'local',
			};
		}
		finally {
			await scenario?.dispose();
			await local?.close();
		}
	},
});

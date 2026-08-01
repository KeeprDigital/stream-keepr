/**
 * Safari VP9-alpha acceptance.
 *
 * The Graphic Asset Compatibility Profile restricts VP9 alpha to
 * Chromium-class Screen Outputs. That restriction is only worth having if the
 * excluded browser refuses the content outright, so this harness drives real
 * Safari and fails if Safari either plays the transparency (the restriction is
 * stale) or plays it flattened (a wrong-looking graphic reaches air while
 * every capability check still says yes).
 *
 * Safari is driven through `safaridriver`, which speaks WebDriver over HTTP
 * and ships with macOS, so nothing is added to the dependency tree. Driving it
 * requires a one-time `sudo safaridriver --enable`; when that has not been
 * done the harness prints the manual observation to make instead, and says
 * which of the two paths ran.
 *
 * Usage: node scripts/run-safari-vp9-alpha-acceptance.mjs [--deployed] [--allow-manual]
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { serveAcceptanceRoutes, verdictFailureCode } from './graphics-acceptance/chromium.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import { acceptanceOrigin } from './graphics-acceptance/installation.mjs';

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

async function observeSafariVerdict(url) {
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
	try {
		await fetch(`${base}/session/${sessionId}/url`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ url }),
		});
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			const evaluated = await fetch(`${base}/session/${sessionId}/execute/sync`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					script: `return JSON.stringify({
						result: document.body && document.body.dataset.result,
						code: document.body && document.body.dataset.code,
					})`,
					args: [],
				}),
			}).then(response => response.json());
			const { result, code } = JSON.parse(evaluated.value ?? '{}');
			if (result === 'passed' || result === 'failed')
				return { outcome: result, code };
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		return { outcome: 'timed-out' };
	}
	finally {
		await fetch(`${base}/session/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);
	}
}

async function serveLocally() {
	const page = await readFile(new URL(`../public${ACCEPTANCE_PATH}`, import.meta.url));
	return await serveAcceptanceRoutes({
		[ACCEPTANCE_PATH]: async () => ({ body: page, type: 'text/html; charset=utf-8' }),
	});
}

function manualInstructions(url, reason) {
	return [
		`${HARNESS} manual check required: Safari automation is not available.`,
		reason ? `safaridriver said: ${reason}` : undefined,
		'Enable it once with: sudo safaridriver --enable',
		'and tick Develop > Allow Remote Automation in Safari.',
		`Otherwise open this page in Safari and read its verdict: ${url}`,
		'Expected: the page reports passed, meaning Safari refused VP9 alpha outright.',
		'A reported safari-vp9-alpha-not-blocked or safari-vp9-alpha-substituted is a gate failure.',
	].filter(Boolean).join('\n');
}

await runAcceptanceHarness({
	harness: HARNESS,
	async run({ record, defer }) {
		const local = deployed ? undefined : await serveLocally();
		try {
			const origin = deployed ? acceptanceOrigin({ deployed }) : local.origin;
			const url = `${origin}${ACCEPTANCE_PATH}`;
			const driver = await startSafariDriver();

			let verdict = { outcome: 'unavailable', detail: driver.detail };
			if (driver.available) {
				try {
					verdict = await observeSafariVerdict(url);
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
			return { path: 'safaridriver', mode: deployed ? 'deployed' : 'local' };
		}
		finally {
			await local?.close();
		}
	},
});

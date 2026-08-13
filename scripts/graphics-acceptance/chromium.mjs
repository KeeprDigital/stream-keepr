/**
 * The unattended Chromium the Screen Output acceptance harnesses drive.
 *
 * A Screen Output runs in an OBS browser source: headless Chromium, no user
 * gesture, no one watching. The gate has to observe the same thing, so it
 * drives a real browser and waits for the page to publish a verdict rather
 * than asking the browser what it claims it can play. A page reports through
 * `document.body.dataset.result`, and the detail it writes into `#result` is
 * treated as untrusted text: harnesses map it to a stable code themselves.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Translate a page's verdict into the stable code a harness prints.
 *
 * A page names its own failure; the harness refuses to invent one for a page
 * that said nothing, and never lets "the driver never ran" or "the page never
 * decided" wear a code suggesting the content itself was examined and found
 * wanting.
 */
export function verdictFailureCode(verdict) {
	if (verdict.outcome === 'unavailable')
		return 'browser-driver-unavailable';
	if (verdict.outcome === 'timed-out')
		return 'browser-acceptance-timed-out';
	return verdict.code || 'browser-acceptance-failed';
}

export function chromiumCandidates() {
	return [
		process.env.CHROME_BIN,
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'google-chrome-stable',
		'google-chrome',
		'chromium',
		'chromium-browser',
	].filter(Boolean);
}

/**
 * Serve a handful of files over loopback for the duration of one run.
 *
 * @param {Record<string, () => Promise<{ body: Uint8Array | string, type: string }>>} routes
 */
export async function serveAcceptanceRoutes(routes) {
	const server = createServer((request, response) => {
		const path = new URL(request.url, 'http://127.0.0.1').pathname;
		const route = routes[path];
		if (!route) {
			response.writeHead(404).end();
			return;
		}
		route().then(({ body, type }) => {
			response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
			response.end(body);
		}).catch(() => response.writeHead(500).end());
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Browser acceptance server did not expose a TCP port.');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () => new Promise((resolve, reject) =>
			server.close(error => error ? reject(error) : resolve())),
	};
}

async function connect(webSocketUrl) {
	const socket = new WebSocket(webSocketUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener('message', (message) => {
		const payload = JSON.parse(message.data);
		if (!payload.id)
			return;
		const handler = pending.get(payload.id);
		pending.delete(payload.id);
		handler?.(payload);
	});
	return {
		close: () => socket.close(),
		command: (method, params = {}) => new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, payload =>
				payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result));
			socket.send(JSON.stringify({ id, method, params }));
		}),
	};
}

async function launch(candidate, extraArgs) {
	if (candidate.includes('/') && !existsSync(candidate))
		return undefined;
	const profile = await mkdtemp(join(tmpdir(), 'stream-keepr-acceptance-'));
	const child = spawn(candidate, [
		'--headless=new',
		'--disable-gpu',
		'--no-sandbox',
		'--autoplay-policy=no-user-gesture-required',
		'--disable-background-media-suspend',
		'--remote-debugging-port=0',
		'--remote-allow-origins=*',
		`--user-data-dir=${profile}`,
		...extraArgs,
	], { stdio: ['ignore', 'ignore', 'pipe'] });
	const endpoint = await new Promise((resolve, reject) => {
		let errorOutput = '';
		const timeout = setTimeout(
			() => reject(new Error('Chrome DevTools endpoint timed out.')),
			15_000,
		);
		child.stderr.setEncoding('utf8').on('data', (chunk) => {
			errorOutput += chunk;
			const match = errorOutput.match(/DevTools listening on (ws:\/\/\S+)/);
			if (match) {
				clearTimeout(timeout);
				resolve(match[1]);
			}
		});
		child.once('error', (error) => {
			clearTimeout(timeout);
			if (error.code === 'ENOENT')
				resolve(undefined);
			else
				reject(error);
		});
		child.once('exit', (code) => {
			if (code !== 0) {
				clearTimeout(timeout);
				reject(new Error(`Chromium exited with ${code}.`));
			}
		});
	});
	if (!endpoint) {
		child.kill('SIGTERM');
		await rm(profile, { recursive: true, force: true });
		return undefined;
	}
	return {
		endpoint,
		async dispose() {
			// A signal to the launcher does not reliably reach the browser it
			// spawned, and an acceptance run that leaves orphan browsers behind
			// makes the next run flaky. Ask it to close over its own protocol
			// first, and keep the signal only as a backstop.
			const exited = new Promise(resolve => child.once('exit', resolve));
			await connect(endpoint)
				.then(browser => browser.command('Browser.close'))
				.catch(() => undefined);
			await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
			child.kill('SIGTERM');
			await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
			// Chromium keeps writing its profile until it is gone, so removing the
			// directory before it exits races with its own shutdown.
			await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
				.catch(() => undefined);
		},
	};
}

/**
 * Give the page the harness's own author session instead of one of its own.
 *
 * A Graphics Ingestion Operation belongs to the graphics author session that
 * created it, and every operation route matches that identity exactly
 * (ADR-0003). The harness stages the ingestion from Node, so the browser has to
 * arrive as the same author or it is reading somebody else's operation and is
 * answered `404`. Sending it to the application first to pick up a session did
 * the opposite of what it read as: an ordinary page load *mints* a session, so
 * the warm-up visit created the second identity it looked like it was avoiding,
 * and the `--library` gate could not pass by construction (#276).
 *
 * The cookie is installed in the browser's own jar before anything is
 * navigated, so the page is the initiator from its first request. Its
 * attributes mirror the ones the installation issues (`httpOnly`, path `/`,
 * `SameSite=Strict`, `Secure` over https), because a cookie the browser stores
 * under different rules is a different cookie for the requests that matter.
 *
 * @param {string} url The page the cookie has to reach, which decides its scope.
 * @param {string} authorCookie A `name=value` pair as the installation issued it.
 */
export function authorSessionCookie(url, authorCookie) {
	const separator = authorCookie.indexOf('=');
	if (separator < 1)
		throw new Error('An author session cookie is a name=value pair.');
	return {
		name: authorCookie.slice(0, separator),
		value: authorCookie.slice(separator + 1),
		url,
		path: '/',
		httpOnly: true,
		secure: new URL(url).protocol === 'https:',
		sameSite: 'Strict',
	};
}

async function installAuthorCookie(page, url, authorCookie) {
	await page.command('Network.enable');
	const { success } = await page.command('Network.setCookie', authorSessionCookie(url, authorCookie));
	// A browser that did not take the cookie is a browser that will read the
	// harness's own operation as somebody else's and be answered `404` — the
	// defect this replaced, wearing the fix's clothes. Said here rather than
	// left to surface as a font that would not load.
	if (success === false) {
		const refused = new Error('The acceptance browser refused the author session cookie.');
		refused.code = 'author-session-cookie-refused';
		throw refused;
	}
}

/**
 * Open one page in unattended Chromium and wait for its verdict.
 *
 * `authorCookie` is a `name=value` pair from an installation the harness has
 * already opened; given one, the page starts blank so the cookie is in place
 * before the first request, and is navigated afterwards.
 *
 * @returns {Promise<{
 *   outcome: 'passed' | 'failed' | 'timed-out' | 'unavailable',
 *   code?: string,
 *   detail?: string,
 * }>} The page's verdict, the stable code it named, and its own description of
 * what it observed.
 */
export async function observeChromiumVerdict({
	url,
	timeoutMs = 30_000,
	extraArgs = [],
	authorCookie,
}) {
	for (const candidate of chromiumCandidates()) {
		const browser = await launch(candidate, extraArgs);
		if (!browser)
			continue;
		try {
			const opened = authorCookie ? 'about:blank' : url;
			const target = await fetch(
				`http://${new URL(browser.endpoint).host}/json/new?${encodeURIComponent(opened)}`,
				{ method: 'PUT' },
			).then(response => response.json());
			const page = await connect(target.webSocketDebuggerUrl);
			try {
				if (authorCookie) {
					await installAuthorCookie(page, url, authorCookie);
					await page.command('Page.navigate', { url });
				}
				await page.command('Runtime.enable');
				const deadline = Date.now() + timeoutMs;
				while (Date.now() < deadline) {
					const evaluated = await page.command('Runtime.evaluate', {
						expression: `JSON.stringify({
							dataset: { ...(document.body?.dataset ?? {}) },
							detail: document.querySelector('#result')?.textContent,
						})`,
						returnByValue: true,
					});
					const { dataset = {}, detail } = JSON.parse(evaluated.result?.value ?? '{}');
					if (dataset.result === 'passed' || dataset.result === 'failed')
						return { outcome: dataset.result, code: dataset.code, detail, dataset };
					await new Promise(resolve => setTimeout(resolve, 100));
				}
				return { outcome: 'timed-out' };
			}
			finally {
				page.close();
			}
		}
		finally {
			await browser.dispose();
		}
	}
	return { outcome: 'unavailable' };
}

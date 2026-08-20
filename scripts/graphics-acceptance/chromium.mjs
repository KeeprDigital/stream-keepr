/**
 * The unattended Chromium the Screen Output acceptance harnesses drive.
 *
 * A Screen Output runs in an OBS browser source: headless Chromium, no user
 * gesture, no one watching. The gate has to observe the same thing, so it
 * drives a real browser and waits for the page to publish a verdict rather
 * than asking the browser what it claims it can play. A page reports through
 * `document.body.dataset.result`, names its own failure in
 * `document.body.dataset.code`, and describes it in `#result`. All three are
 * page text and none of them is forwarded as evidence: `verdictFailureCode`
 * resolves the name against the published registry here, so what a harness
 * prints is a code this contract owns rather than one a page chose.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { ACCEPTANCE_FAILURE_CODES } from './evidence.mjs';

const PUBLISHED_CODES = new Set(ACCEPTANCE_FAILURE_CODES);

/**
 * Translate a page's verdict into the stable code a harness prints.
 *
 * A page names its own failure; the harness refuses to invent one for a page
 * that said nothing, and never lets "the driver never ran" or "the page never
 * decided" wear a code suggesting the content itself was examined and found
 * wanting.
 *
 * The name a page offers is `document.body.dataset.code` — page text, and
 * therefore untrusted. It is looked up in the published registry rather than
 * forwarded: a name the registry publishes is the page's own word for what it
 * observed and is what prints, and anything else is the page failing without
 * naming a failure this contract knows, which is `browser-acceptance-failed`
 * exactly as a page that named nothing at all is. So no page-authored string
 * reaches the formatter, and the degradation the formatter keeps for an
 * unpublished code (`evidence-unknown-code`, #275) is no longer reachable from
 * a browser verdict — it stays for a harness that constructs a code itself.
 */
export function verdictFailureCode(verdict) {
	if (verdict.outcome === 'unavailable')
		return 'browser-driver-unavailable';
	if (verdict.outcome === 'timed-out')
		return 'browser-acceptance-timed-out';
	return PUBLISHED_CODES.has(verdict.code) ? verdict.code : 'browser-acceptance-failed';
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
 * Give the page the harness's own identities instead of ones of its own.
 *
 * Two cookies travel, and they answer different questions. The **operator
 * session** (#396) is what gets a request past the API boundary at all: every
 * library route the page reads is private, so a page without it is answered
 * `401` and no assertion in it can tell that from a broken route. The **author
 * cookie** says which Graphics Author owns the operation: a Graphics Ingestion
 * Operation belongs to the user who created it, and every
 * operation route matches that identity exactly (ADR-0003). The harness stages
 * the ingestion from Node, so the browser has to arrive as the same author or it
 * is reading somebody else's operation and is answered `404`. Sending it to the
 * application first to pick up a session did the opposite of what it read as: an
 * ordinary page load *mints* a session, so the warm-up visit created the second
 * identity it looked like it was avoiding, and the `--library` gate could not
 * pass by construction (#276).
 *
 * Each cookie is installed in the browser's own jar before anything is
 * navigated, so the page is the initiator from its first request. Its
 * attributes mirror the ones the installation issues (`httpOnly`, path `/`,
 * `SameSite=Strict`, `Secure` over https), because a cookie the browser stores
 * under different rules is a different cookie for the requests that matter.
 *
 * @param {string} url The page the cookie has to reach, which decides its scope.
 * @param {string} pair A `name=value` pair as the installation issued it.
 */
export function browserCookie(url, pair) {
	const separator = pair.indexOf('=');
	if (separator < 1)
		throw new Error('A browser cookie is a name=value pair.');
	return {
		name: pair.slice(0, separator),
		value: pair.slice(separator + 1),
		url,
		path: '/',
		httpOnly: true,
		secure: new URL(url).protocol === 'https:',
		sameSite: 'Strict',
	};
}

/**
 * Where a target is created, which is not always where it is going.
 *
 * A page created at its destination has already made its first request by the
 * time anything can be installed in the jar — as nobody, which is the identity
 * the whole fix exists to avoid. So a run carrying cookies starts blank and
 * navigates afterwards, and a run without any is created where it is going,
 * exactly as before #276.
 *
 * @param {string} url
 * @param {readonly string[]} [cookies]
 */
export function initialTarget(url, cookies) {
	return cookies !== undefined && cookies.length > 0 ? 'about:blank' : url;
}

/**
 * Bring one page to `url` carrying the identities it needs, ready to poll.
 *
 * Everything between "a target exists" and "the page is at the destination and
 * answering `Runtime.evaluate`" lives here, so the order is one reviewable
 * sequence rather than three statements interleaved with browser plumbing: the
 * cookies are installed, the page is navigated, and only then is the runtime
 * enabled. `page` is anything that answers `command(method, params)`.
 *
 * @param {{ command: (method: string, params?: object) => Promise<any> }} page
 * @param {{ url: string, cookies?: readonly string[] }} destination
 */
export async function openAuthoredPage(page, { url, cookies = [] }) {
	if (cookies.length > 0) {
		await page.command('Network.enable');
		for (const pair of cookies) {
			const { success } = await page.command('Network.setCookie', browserCookie(url, pair));
			// A browser that did not take a cookie is a browser that will be
			// answered `401` for the library route, or read the harness's own
			// operation as somebody else's and be answered `404` — the defect this
			// replaced, wearing the fix's clothes. Said here rather than left to
			// surface as a font that would not load.
			if (success === false) {
				const refused = new Error('The acceptance browser refused a session cookie.');
				refused.code = 'author-session-cookie-refused';
				throw refused;
			}
		}
		await page.command('Page.navigate', { url });
	}
	await page.command('Runtime.enable');
}

/**
 * Open one page in unattended Chromium and wait for its verdict.
 *
 * `cookies` are `name=value` pairs from an installation the harness has already
 * opened; given any, the page starts blank so they are in place before the first
 * request, and is navigated afterwards.
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
	cookies,
}) {
	return await withChromiumPage({ url, extraArgs, cookies }, async (page) => {
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
	});
}

/**
 * Open an application page in Chromium and wait until `expression` returns a
 * value. Returning `undefined` means the page is still settling; any other
 * serialisable value is the observation. This is for app-shell acceptance
 * where the page has no purpose-built `data-result` contract of its own.
 */
export async function observeChromiumValue({
	url,
	expression,
	timeoutMs = 30_000,
	extraArgs = [],
	cookies = [],
}) {
	return await withChromiumPage({ url, extraArgs, cookies }, async (page) => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const evaluated = await page.command('Runtime.evaluate', {
				expression,
				returnByValue: true,
			});
			if (evaluated.exceptionDetails) {
				return {
					outcome: 'failed',
					detail: evaluated.exceptionDetails.exception?.description
						?? evaluated.exceptionDetails.text,
				};
			}
			if (Object.hasOwn(evaluated.result ?? {}, 'value'))
				return { outcome: 'passed', value: evaluated.result.value };
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		return { outcome: 'timed-out' };
	});
}

/** Run one observation against the first available local Chromium. */
async function withChromiumPage({ url, extraArgs = [], cookies }, observe) {
	for (const candidate of chromiumCandidates()) {
		const browser = await launch(candidate, extraArgs);
		if (!browser)
			continue;
		try {
			const opened = initialTarget(url, cookies);
			const target = await fetch(
				`http://${new URL(browser.endpoint).host}/json/new?${encodeURIComponent(opened)}`,
				{ method: 'PUT' },
			).then(response => response.json());
			const page = await connect(target.webSocketDebuggerUrl);
			try {
				await openAuthoredPage(page, { url, cookies });
				return await observe(page);
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

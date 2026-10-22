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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { acceptanceProfilePrefix, checkoutProfileMarker } from './chromium-profile.mjs';
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
	const listeners = new Map();
	socket.addEventListener('message', (message) => {
		const payload = JSON.parse(message.data);
		if (!payload.id) {
			for (const listener of listeners.get(payload.method) ?? [])
				listener(payload.params);
			return;
		}
		const handler = pending.get(payload.id);
		pending.delete(payload.id);
		handler?.(payload);
	});
	return {
		close: () => socket.close(),
		on: (method, listener) => listeners.set(method, [...listeners.get(method) ?? [], listener]),
		command: (method, params = {}) => new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, payload =>
				payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result));
			socket.send(JSON.stringify({ id, method, params }));
		}),
	};
}

/** How many console messages and uncaught errors a page's diagnostics keep. */
const KEPT_PAGE_MESSAGES = 5;

/**
 * Keep what a page logged and threw uncaught while it was observed (#687).
 *
 * A failed browser gate used to say only that the page failed, so a flake
 * under load named no cause. The raw text is kept here, in Node; it is
 * page-authored, so a harness that prints it reduces it first
 * (`pageTextEvidence`). Only the newest few of each are kept. `page` is
 * anything answering `on(method, listener)` for CDP events, subscribed before
 * `Runtime.enable` so nothing the page says first is missed.
 *
 * @param {{ on: (method: string, listener: (params: any) => void) => void }} page
 */
export function collectPageDiagnostics(page) {
	const kept = { console: [], uncaught: [] };
	const keep = (list, text) => {
		list.push(text);
		list.splice(0, Math.max(0, list.length - KEPT_PAGE_MESSAGES));
	};
	page.on('Runtime.consoleAPICalled', ({ type, args = [] }) => {
		const text = args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ');
		keep(kept.console, `${type}: ${text}`);
	});
	page.on('Runtime.exceptionThrown', ({ exceptionDetails = {} }) => {
		keep(kept.uncaught, exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'unknown');
	});
	return {
		read: () => ({ console: [...kept.console], uncaught: [...kept.uncaught] }),
	};
}

const CHECKOUT_PROFILE_PREFIX = acceptanceProfilePrefix(
	checkoutProfileMarker(fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')),
);

/**
 * How long a browser is given at each step of being stopped (#687).
 *
 * `Browser.close` is the polite ask, SIGTERM the firm one, and SIGKILL the one
 * it cannot refuse. The browser #687 found leaked had ignored SIGTERM and was
 * spinning at 100% CPU for an hour and a half, so no step may wait forever and
 * the last one is never skipped.
 */
const CLOSE_GRACE_MS = 5_000;
const TERMINATE_GRACE_MS = 2_000;
const KILL_GRACE_MS = 2_000;

/** Every browser this process launched and has not yet seen exit. */
const liveBrowsers = new Set();

function running(child) {
	return child.exitCode === null && child.signalCode === null;
}

/** Resolves true once `child` has exited, or false after `ms`. */
function exitedWithin(child, ms) {
	if (!running(child))
		return Promise.resolve(true);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			child.off('exit', onExit);
			resolve(false);
		}, ms);
		function onExit() {
			clearTimeout(timer);
			resolve(true);
		}
		child.once('exit', onExit);
	});
}

function signal(child, name) {
	try {
		child.kill(name);
	}
	catch {
		// Already gone.
	}
}

/**
 * SIGTERM, then SIGKILL if it is still there after its grace. Resolves to what
 * stopped it, which a startup failure reports (#790): a browser that needed
 * SIGKILL was stuck, not merely slow.
 */
async function terminate(browser) {
	if (browser.child.pid === undefined)
		return 'never started';
	if (!running(browser.child))
		return 'already exited';
	signal(browser.child, 'SIGTERM');
	if (await exitedWithin(browser.child, browser.terminateGraceMs))
		return 'stopped by SIGTERM';
	signal(browser.child, 'SIGKILL');
	return await exitedWithin(browser.child, KILL_GRACE_MS)
		? 'stopped by SIGKILL'
		: 'still running after SIGKILL';
}

async function removeProfile(profile) {
	// Chromium keeps writing its profile until it is gone, so removing the
	// directory before it exits races with its own shutdown.
	await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
		.catch(() => undefined);
}

let stoppingOnSignal = false;
/** The signals something other than these hooks already listened for when they went in. */
const listenedBeforeHooks = new Set();

/**
 * A runner stopped by a signal takes its browsers with it (#687).
 *
 * `verify` stops a gate by signalling its process group, and Chrome is in that
 * group, but a signal reaches Chrome as a request it can sit on: a browser busy
 * on its main thread never gets round to it, and once the runner is gone nobody
 * follows up. So the runner follows up itself, escalating to SIGKILL, and then
 * dies of the signal it was sent — unless something else in the process
 * listens for it too, in which case that listener decides how the process ends.
 * "Something else" is read both when the hooks went in and when the signal
 * arrives, because a `process.once` listener has removed itself by the time
 * this runs. A second signal while the first is still being honoured skips the
 * grace: everything is killed and the runner goes at once.
 */
function stopOnSignal(name) {
	const othersListen = listenedBeforeHooks.has(name)
		|| process.listeners(name).some(listener => listener !== stopOnSignal);
	const end = () => {
		uninstallShutdownHooks();
		if (!othersListen)
			process.kill(process.pid, name);
	};
	if (stoppingOnSignal) {
		killOnExit();
		end();
		return;
	}
	stoppingOnSignal = true;
	void Promise.all([...liveBrowsers].map(async (browser) => {
		await terminate(browser);
		await removeProfile(browser.profile);
	})).finally(() => {
		stoppingOnSignal = false;
		end();
	});
}

/**
 * A runner that exits without disposing — `process.exit`, an uncaught throw —
 * can still kill synchronously on its way out, though not wait or tidy up.
 */
function killOnExit() {
	for (const browser of liveBrowsers)
		signal(browser.child, 'SIGKILL');
}

const SHUTDOWN_HOOKS = { SIGINT: stopOnSignal, SIGTERM: stopOnSignal, exit: killOnExit };

function installShutdownHooks() {
	listenedBeforeHooks.clear();
	for (const [event, hook] of Object.entries(SHUTDOWN_HOOKS)) {
		if (event !== 'exit' && process.listenerCount(event) > 0)
			listenedBeforeHooks.add(event);
		process.on(event, hook);
	}
}

function uninstallShutdownHooks() {
	for (const [event, hook] of Object.entries(SHUTDOWN_HOOKS))
		process.off(event, hook);
}

/** Track a browser until it exits, with the hooks in place only while any is live. */
function track(browser) {
	if (liveBrowsers.size === 0)
		installShutdownHooks();
	liveBrowsers.add(browser);
	browser.child.once('exit', () => {
		liveBrowsers.delete(browser);
		if (liveBrowsers.size === 0)
			uninstallShutdownHooks();
	});
}

/** How much of a browser's stderr a startup failure keeps, from the end. */
const STDERR_KEPT_CHARS = 4_000;
/** How long a stopped browser's last stderr is waited for before reporting. */
const STDERR_DRAIN_MS = 500;

/** A browser that did not start, before the launcher has gathered why. */
class StartupFailure extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

/**
 * Everything a CI log needs to tell a hung browser from a crashed one, or from
 * one that listened without saying so (#790): its state when the launcher gave
 * up, what it took to stop it, whether it had written its DevToolsActivePort
 * file, and the tail of what it printed. The first line stays the summary.
 */
function startupReport(failure, { candidate, pid, stopped, activePort, errorOutput }) {
	const printed = errorOutput.trim();
	return [
		failure.message,
		`  browser: ${candidate} (pid ${pid ?? 'none'})`,
		`  status: ${failure.status}; ${stopped}`,
		`  ${activePort}`,
		printed
			? `  stderr (at most the last ${STDERR_KEPT_CHARS} characters):\n${printed.split('\n').map(line => `    ${line}`).join('\n')}`
			: '  stderr: (nothing)',
	].join('\n');
}

/**
 * Start one unattended Chromium and wait for its DevTools endpoint.
 *
 * Resolves `undefined` when `candidate` is not installed, so a caller can try
 * the next one. From the moment it is spawned until it is seen to exit, the
 * browser is stopped however the run ends: `dispose()` on every path a harness
 * takes, a failed startup here, and the shutdown hooks above for a runner that
 * is signalled or exits. Its profile is named after this checkout
 * (`chromium-profile.mjs`), which is how `pnpm reap` finds one that escaped all
 * of that anyway.
 *
 * @param {string} candidate
 * @param {readonly string[]} extraArgs
 * @param {{ terminateGraceMs?: number, startupTimeoutMs?: number }} [options]
 */
export async function launchChromium(candidate, extraArgs, {
	terminateGraceMs = TERMINATE_GRACE_MS,
	startupTimeoutMs = 30_000,
} = {}) {
	if (candidate.includes('/') && !existsSync(candidate))
		return undefined;
	const profile = await mkdtemp(join(tmpdir(), CHECKOUT_PROFILE_PREFIX));
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
	const browser = { child, profile, terminateGraceMs };
	if (child.pid !== undefined)
		track(browser);

	const startedAt = Date.now();
	const stderrEnded = new Promise(resolve => child.stderr.once('end', resolve));
	let errorOutput = '';
	let endpoint;
	try {
		endpoint = await new Promise((resolve, reject) => {
			// Startup only, not an assertion: a cold Chrome on a CI runner that is
			// also serving `nuxt dev` has overrun 15s, and Chrome 156 30s, which is
			// why a suite like that warms one first (`warmChromium`, #790).
			const timeout = setTimeout(
				() => reject(new StartupFailure(
					'Chrome DevTools endpoint timed out.',
					`still running after ${startupTimeoutMs} ms`,
				)),
				startupTimeoutMs,
			);
			child.stderr.setEncoding('utf8').on('data', (chunk) => {
				errorOutput += chunk;
				const match = errorOutput.match(/DevTools listening on (ws:\/\/\S+)/);
				if (match) {
					clearTimeout(timeout);
					resolve(match[1]);
				}
				errorOutput = errorOutput.slice(-STDERR_KEPT_CHARS);
			});
			child.once('error', (error) => {
				clearTimeout(timeout);
				if (error.code === 'ENOENT')
					resolve(undefined);
				else
					reject(error);
			});
			// Any exit before the endpoint is a failed start, a clean one included:
			// nothing is left to announce it.
			child.once('exit', (code, signalName) => {
				clearTimeout(timeout);
				const status = signalName ? `killed by ${signalName}` : `exited with code ${code}`;
				reject(new StartupFailure(
					`Chromium ${status} before announcing its DevTools endpoint.`,
					`${status} after ${Date.now() - startedAt} ms`,
				));
			});
		});
	}
	catch (error) {
		// A browser too slow to announce itself is still a browser: left running,
		// it outlives the run that gave up on it.
		const stopped = await terminate(browser);
		if (!(error instanceof StartupFailure)) {
			await removeProfile(profile);
			throw error;
		}
		// `exit` can come before the last of stderr has been read.
		await Promise.race([stderrEnded, new Promise(resolve => setTimeout(resolve, STDERR_DRAIN_MS))]);
		const activePort = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(
			text => `DevToolsActivePort: ${text.trim().split('\n').join(' ')}`,
			() => 'no DevToolsActivePort',
		);
		await removeProfile(profile);
		throw new Error(startupReport(error, { candidate, pid: child.pid, stopped, activePort, errorOutput }));
	}
	if (!endpoint) {
		await terminate(browser);
		await removeProfile(profile);
		return undefined;
	}
	return {
		endpoint,
		pid: child.pid,
		profile,
		async dispose() {
			// A signal to the launcher does not reliably reach the browser it
			// spawned, and an acceptance run that leaves orphan browsers behind
			// makes the next run flaky. Ask it to close over its own protocol
			// first, bounded, because a browser that accepts the connection and
			// never answers is the busy one this exists for; then escalate.
			const closing = connect(endpoint)
				.then(session => session.command('Browser.close'))
				.then(() => exitedWithin(child, CLOSE_GRACE_MS), () => false);
			const closed = await Promise.race([
				closing,
				new Promise(resolve => setTimeout(resolve, CLOSE_GRACE_MS, false)),
			]);
			if (!closed)
				await terminate(browser);
			await removeProfile(profile);
		},
	};
}

/**
 * How long a browser's first launch on an idle machine may take. A bound, not
 * an assertion: Chrome 156 took 8.6 s on an idle fresh CI runner (#790).
 */
const WARM_STARTUP_TIMEOUT_MS = 120_000;

/**
 * Start and stop the first available browser once, so a fresh machine pays
 * Chrome's first-launch cost before anything competes with it (#790).
 *
 * A browser's first launch on a machine is far slower than every later one,
 * profile or no profile: on a fresh CI runner with Chrome 156 the first took
 * 8.6 s idle and every later one about 0.1 s. A suite that starts `nuxt dev`
 * first makes that cold launch compete with the dev server for the CPU and
 * disk, and it overran the 30 s startup bound on every runner that had 156.
 * Warming before the server starts moves the one-time cost to a quiet machine.
 * Resolves to the browser that was warmed, or `undefined` with none installed;
 * a browser that cannot start even now fails with `launchChromium`'s report.
 *
 * @param {{ extraArgs?: readonly string[], startupTimeoutMs?: number, terminateGraceMs?: number }} [options]
 */
export async function warmChromium({
	extraArgs = [],
	startupTimeoutMs = WARM_STARTUP_TIMEOUT_MS,
	terminateGraceMs,
} = {}) {
	for (const candidate of chromiumCandidates()) {
		const browser = await launchChromium(candidate, extraArgs, { startupTimeoutMs, terminateGraceMs });
		if (!browser)
			continue;
		await browser.dispose();
		return candidate;
	}
	return undefined;
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
 * operation route matches that identity exactly (ADR-0010). The harness stages
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
 * `SameSite=Strict`, `Secure` over https or under a `__Secure-` name), because
 * a cookie the browser stores under different rules is a different cookie for
 * the requests that matter. The name counts because a built Worker issues its
 * session cookie `__Secure-` and `Secure` even over plain http on loopback
 * (#451), and a browser refuses that name without `Secure`.
 *
 * @param {string} url The page the cookie has to reach, which decides its scope.
 * @param {string} pair A `name=value` pair as the installation issued it.
 */
export function browserCookie(url, pair) {
	const separator = pair.indexOf('=');
	if (separator < 1)
		throw new Error('A browser cookie is a name=value pair.');
	const name = pair.slice(0, separator);
	return {
		name,
		value: pair.slice(separator + 1),
		url,
		path: '/',
		httpOnly: true,
		secure: new URL(url).protocol === 'https:' || name.startsWith('__Secure-'),
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
 *
 * Every observation carries the page's `diagnostics` — its newest console text
 * and uncaught errors, raw — so a failure can say why, including one the page
 * reported in the value it published.
 */
export async function observeChromiumValue({
	url,
	expression,
	timeoutMs = 30_000,
	extraArgs = [],
	cookies = [],
}) {
	return await withChromiumPage({ url, extraArgs, cookies }, async (page, diagnostics) => {
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
					diagnostics: diagnostics.read(),
				};
			}
			if (Object.hasOwn(evaluated.result ?? {}, 'value'))
				return { outcome: 'passed', value: evaluated.result.value, diagnostics: diagnostics.read() };
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		return { outcome: 'timed-out', diagnostics: diagnostics.read() };
	});
}

/**
 * Run one observation against the first available local Chromium: open the page
 * and hand `observe` its DevTools session and the page's diagnostics
 * (`collectPageDiagnostics`). Exported for a harness that drives the page
 * itself — a screenshot, an emulation override — rather than polling one
 * expression. Resolves to whatever `observe` returns, or
 * `{ outcome: 'unavailable' }` with no browser.
 */
export async function withChromiumPage({ url, extraArgs = [], cookies }, observe) {
	for (const candidate of chromiumCandidates()) {
		const browser = await launchChromium(candidate, extraArgs);
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
				const diagnostics = collectPageDiagnostics(page);
				await openAuthoredPage(page, { url, cookies });
				return await observe(page, diagnostics);
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

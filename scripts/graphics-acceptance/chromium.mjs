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
			// Chromium keeps writing its profile until it is gone, so removing the
			// directory before it exits races with its own shutdown.
			const exited = new Promise(resolve => child.once('exit', resolve));
			child.kill('SIGTERM');
			await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
			await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
				.catch(() => undefined);
		},
	};
}

/**
 * Open one page in unattended Chromium and wait for its verdict.
 *
 * @returns {Promise<{
 *   outcome: 'passed' | 'failed' | 'timed-out' | 'unavailable',
 *   code?: string,
 *   detail?: string,
 * }>}
 */
export async function observeChromiumVerdict({
	url,
	timeoutMs = 30_000,
	extraArgs = [],
	sessionUrl,
}) {
	for (const candidate of chromiumCandidates()) {
		const browser = await launch(candidate, extraArgs);
		if (!browser)
			continue;
		try {
			// Visiting the installation first lets the page reach same-origin
			// routes as a graphics author would, exactly like an operator's browser.
			if (sessionUrl) {
				const warmup = await fetch(
					`http://${new URL(browser.endpoint).host}/json/new?${encodeURIComponent(sessionUrl)}`,
					{ method: 'PUT' },
				).then(response => response.json());
				const warmupSocket = await connect(warmup.webSocketDebuggerUrl);
				await new Promise(resolve => setTimeout(resolve, 750));
				warmupSocket.close();
			}
			const target = await fetch(
				`http://${new URL(browser.endpoint).host}/json/new?${encodeURIComponent(url)}`,
				{ method: 'PUT' },
			).then(response => response.json());
			const page = await connect(target.webSocketDebuggerUrl);
			try {
				await page.command('Runtime.enable');
				const deadline = Date.now() + timeoutMs;
				while (Date.now() < deadline) {
					const evaluated = await page.command('Runtime.evaluate', {
						expression: `JSON.stringify({
							result: document.body?.dataset.result,
							code: document.body?.dataset.code,
							detail: document.querySelector('#result')?.textContent,
						})`,
						returnByValue: true,
					});
					const { result, code, detail } = JSON.parse(evaluated.result?.value ?? '{}');
					if (result === 'passed' || result === 'failed')
						return { outcome: result, code, detail };
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

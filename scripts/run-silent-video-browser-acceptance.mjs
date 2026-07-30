import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const acceptancePath = '/_acceptance/silent-video-v1.html';
const localPage = new URL(`../public${acceptancePath}`, import.meta.url);
const deployed = process.argv.includes('--deployed');

function browserCandidates() {
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

async function localAcceptanceUrl() {
	const page = await readFile(localPage);
	const server = createServer((request, response) => {
		if (request.url !== acceptancePath) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
		});
		response.end(page);
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Browser acceptance server did not expose a TCP port.');
	return {
		url: `http://127.0.0.1:${address.port}${acceptancePath}`,
		close: () => new Promise((resolve, reject) =>
			server.close(error => error ? reject(error) : resolve())),
	};
}

function deployedAcceptanceUrl() {
	const baseUrl = process.env.STREAM_KEEPR_BROWSER_ACCEPTANCE_URL
		?? process.env.STREAM_KEEPR_DEPLOY_HEALTH_URL;
	if (!baseUrl)
		throw new Error('Set STREAM_KEEPR_BROWSER_ACCEPTANCE_URL to the deployed staging base URL.');
	return new URL(acceptancePath, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

async function runBrowser(candidate, url) {
	if (candidate.includes('/') && !existsSync(candidate))
		return;
	const profile = await mkdtemp(join(tmpdir(), 'stream-keepr-video-browser-'));
	const child = spawn(candidate, [
		'--headless=new',
		'--disable-gpu',
		'--no-sandbox',
		'--autoplay-policy=no-user-gesture-required',
		'--disable-background-media-suspend',
		'--remote-debugging-port=0',
		'--remote-allow-origins=*',
		`--user-data-dir=${profile}`,
	], { stdio: ['ignore', 'ignore', 'pipe'] });
	try {
		const browserWebSocket = await new Promise((resolve, reject) => {
			let errorOutput = '';
			const timeout = setTimeout(() => reject(new Error('Chrome DevTools endpoint timed out.')), 10_000);
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
					reject(new Error(`${candidate} exited with ${code}: ${errorOutput.trim()}`));
				}
			});
		});
		if (!browserWebSocket)
			return;
		const browserUrl = new URL(browserWebSocket);
		const target = await fetch(
			`http://${browserUrl.host}/json/new?${encodeURIComponent(url)}`,
			{ method: 'PUT' },
		).then(response => response.json());
		const socket = new WebSocket(target.webSocketDebuggerUrl);
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
		const command = (method, params = {}) => new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, payload => payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result));
			socket.send(JSON.stringify({ id, method, params }));
		});
		await command('Runtime.enable');
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			const result = await command('Runtime.evaluate', {
				expression: 'document.body?.dataset.result',
				returnByValue: true,
			});
			const status = result.result?.value;
			if (status === 'passed') {
				socket.close();
				return '<body data-result="passed">';
			}
			if (status === 'failed') {
				const detail = await command('Runtime.evaluate', {
					expression: 'document.querySelector("#result")?.textContent',
					returnByValue: true,
				});
				throw new Error(detail.result?.value ?? 'silent-video browser acceptance failed');
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		throw new Error('silent-video browser acceptance timed out');
	}
	finally {
		child.kill('SIGTERM');
		await rm(profile, { recursive: true, force: true });
	}
}

const local = deployed ? undefined : await localAcceptanceUrl();
try {
	const url = deployed ? deployedAcceptanceUrl() : local.url;
	let dom;
	for (const candidate of browserCandidates()) {
		dom = await runBrowser(candidate, url);
		if (dom !== undefined)
			break;
	}
	if (dom === undefined)
		throw new Error('Google Chrome or Chromium is required for browser acceptance.');
	if (!dom.includes('data-result="passed"'))
		throw new Error(`silent-video-v1 browser acceptance failed:\n${dom}`);
	process.stdout.write(`silent-video-v1 browser acceptance passed at ${url}\n`);
}
finally {
	await local?.close();
}

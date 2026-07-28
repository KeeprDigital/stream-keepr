import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import process from 'node:process';

const acceptancePath = '/_acceptance/still-image-v1.html';
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
	if (!baseUrl) {
		throw new Error(
			'Set STREAM_KEEPR_BROWSER_ACCEPTANCE_URL to the deployed staging base URL.',
		);
	}
	return new URL(acceptancePath, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

async function runBrowser(candidate, url) {
	if (candidate.includes('/') && !existsSync(candidate))
		return;
	return await new Promise((resolve, reject) => {
		const child = spawn(candidate, [
			'--headless=new',
			'--disable-gpu',
			'--no-sandbox',
			'--dump-dom',
			'--virtual-time-budget=10000',
			url,
		], { stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		let errorOutput = '';
		child.stdout.setEncoding('utf8').on('data', chunk => output += chunk);
		child.stderr.setEncoding('utf8').on('data', chunk => errorOutput += chunk);
		child.once('error', (error) => {
			if (error.code === 'ENOENT')
				resolve(undefined);
			else
				reject(error);
		});
		child.once('exit', (code) => {
			if (code !== 0) {
				reject(new Error(`${candidate} exited with ${code}: ${errorOutput.trim()}`));
				return;
			}
			resolve(output);
		});
	});
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
	if (!dom.includes('data-result="passed"')) {
		throw new Error(`still-image-v1 browser acceptance failed:\n${dom}`);
	}
	process.stdout.write(`still-image-v1 browser acceptance passed at ${url}\n`);
}
finally {
	await local?.close();
}

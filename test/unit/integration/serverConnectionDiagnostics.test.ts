import type { AddressInfo } from 'node:net';
import { Buffer } from 'node:buffer';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { installServerConnectionDiagnostics } from '~~/test/integration/serverConnectionDiagnostics.mjs';

/**
 * What an integration server says about a connection it dropped (#633).
 *
 * A multipart `complete` once died with ECONNRESET after 5.9 s and its server
 * wrote nothing: no layer of `nuxt dev` logs a socket it destroys or a proxy hop
 * that failed. These rows pin that the preload each server runs with writes one
 * line for each such event, and nothing for an ordinary exchange.
 */

const cleanups: Array<() => unknown> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse())
		await cleanup();
});

function diagnostics() {
	const lines: string[] = [];
	cleanups.push(installServerConnectionDiagnostics({ write: line => lines.push(line) }));
	return lines;
}

async function serve(handler: Parameters<typeof createServer>[1]) {
	const server = createServer(handler);
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(() => new Promise(resolve => server.close(resolve)));
	return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** Lines arrive from socket events, a turn or two after the client sees the outcome. */
async function settled<T>(lines: T[]) {
	await new Promise(resolve => setTimeout(resolve, 50));
	return lines;
}

/** An outgoing request through `node:http`, the client Nitro's dev proxy uses. */
function outgoing(origin: string, path: string, method = 'POST') {
	return new Promise<string>((resolve, reject) => {
		const request = httpRequest(`${origin}${path}`, { method }, (response) => {
			let body = '';
			response.setEncoding('utf8');
			response.on('data', (chunk: string) => body += chunk);
			response.on('end', () => resolve(body));
			response.on('error', reject);
			response.on('aborted', () => reject(new Error('aborted')));
		});
		request.on('error', reject);
		request.end();
	});
}

describe('the integration server\'s connection diagnostics', () => {
	it('names a request whose connection closed before its response finished, without its query', async () => {
		const lines = diagnostics();
		const { origin } = await serve((request) => {
			setTimeout(() => request.socket.destroy(), 20);
		});

		await expect(fetch(`${origin}/api/upload/complete?token=secret-value`, { method: 'POST' })).rejects.toThrow();

		const written = await settled(lines);
		expect(written).toHaveLength(1);
		expect(written[0]).toMatch(/^\[integration-server\] .*POST \/api\/upload\/complete: connection closed after \d+ms before the response finished/);
		expect(written.join('\n')).not.toContain('secret-value');
	});

	it('writes nothing for requests answered in full, on a fresh or a reused connection', async () => {
		const lines = diagnostics();
		const { origin } = await serve((_request, response) => {
			response.end('ok');
		});

		for (const method of ['GET', 'POST', 'PUT'])
			expect(await (await fetch(`${origin}/api/ordinary`, { method })).text()).toBe('ok');

		expect(await settled(lines)).toEqual([]);
	});

	it('says when a socket timed out with a request still in flight on it', async () => {
		const lines = diagnostics();
		const { origin, server } = await serve(() => {
			// Never answers: the server's own socket timeout is what ends it.
		});
		server.setTimeout(100);

		await expect(fetch(`${origin}/api/stalled`, { method: 'POST' })).rejects.toThrow();

		const written = await settled(lines);
		expect(written).toEqual([
			expect.stringMatching(/POST \/api\/stalled: socket timed out after \d+ms with the request in flight/),
			expect.stringMatching(/POST \/api\/stalled: connection closed after \d+ms before the response finished/),
		]);
	});

	it('says when the public listener\'s keep-alive timeout closed a connection, which the test client never leaves idle that long', async () => {
		const lines = diagnostics();
		const { origin, server } = await serve((_request, response) => {
			response.end('ok');
		});
		server.keepAliveTimeout = 100;
		server.keepAliveTimeoutBuffer = 0;

		const socket = connect(Number(new URL(origin).port), '127.0.0.1').resume();
		socket.write('GET /api/kept-alive?capability=secret-value HTTP/1.1\r\nHost: localhost\r\n\r\n');
		await new Promise(resolve => socket.once('close', resolve));

		const written = await settled(lines);
		expect(written).toEqual([
			expect.stringMatching(/main thread: keep-alive connection closed by its timeout \d+ms after its last response \(GET \/api\/kept-alive\)$/),
		]);
	});

	it('names an outgoing request that failed before any response, as a proxy hop to the dev worker would', async () => {
		const lines = diagnostics();
		const { origin } = await serve((request) => {
			request.socket.destroy();
		});

		await expect(outgoing(origin, '/api/proxied?capability=secret-value')).rejects.toThrow();

		const written = await settled(lines);
		expect(written).toContainEqual(
			expect.stringMatching(/outgoing POST 127\.0\.0\.1:\d+\/api\/proxied: failed after \d+ms \(ECONNRESET: socket hang up\)/),
		);
		expect(written.join('\n')).not.toContain('secret-value');
	});

	it('names an outgoing response that was cut off before it completed', async () => {
		const lines = diagnostics();
		const { origin } = await serve((_request, response) => {
			response.writeHead(200, { 'content-length': '100' });
			response.write('partial', () => response.socket?.destroy());
		});

		await expect(outgoing(origin, '/api/proxied', 'GET')).rejects.toThrow();

		const written = await settled(lines);
		expect(written).toContainEqual(
			expect.stringMatching(/outgoing GET 127\.0\.0\.1:\d+\/api\/proxied: response 200 ended after \d+ms before it completed/),
		);
	});

	it('reaches into a worker thread, where Nitro\'s dev worker serves the app, and says when one exits', async () => {
		const lines = diagnostics();
		const worker = new Worker(`
			const { createServer } = require('node:http');
			const { parentPort } = require('node:worker_threads');
			const server = createServer(request => request.socket.destroy());
			server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
		`, { eval: true, stderr: true });
		let workerOutput = '';
		worker.stderr.setEncoding('utf8');
		worker.stderr.on('data', (chunk: string) => workerOutput += chunk);
		const id = worker.threadId;
		const port = await new Promise<number>(resolve => worker.once('message', resolve));

		await expect(fetch(`http://127.0.0.1:${port}/api/in-worker`, { method: 'PUT' })).rejects.toThrow();
		await settled(lines);
		await worker.terminate();

		expect(workerOutput).toMatch(new RegExp(
			`^\\[integration-server\\] \\S+ worker thread ${id}: PUT /api/in-worker: connection closed after \\d+ms before the response finished`,
			'm',
		));
		expect(await settled(lines)).toEqual([
			expect.stringMatching(new RegExp(`main thread: started worker thread ${id} \\(eval\\)$`)),
			expect.stringMatching(new RegExp(`main thread: worker thread ${id} exited with code 1$`)),
		]);
	});

	it('says when the thread\'s event loop stalled, since a stalled loop runs a socket\'s timeout before reading what arrived on it', async () => {
		const lines = diagnostics();
		await new Promise(resolve => setTimeout(resolve, 600));
		expect(lines).toEqual([]);

		const blockedUntil = Date.now() + 1_500;
		while (Date.now() < blockedUntil) {
			// Synchronous work, as a stalled thread does it.
		}
		await new Promise(resolve => setTimeout(resolve, 600));

		expect(lines).toEqual([
			expect.stringMatching(/main thread: event loop stalled for 1[5-9]\d\dms$/),
		]);
	});

	it('writes nothing when only the rest of a body fails after its whole answer arrived', async () => {
		const lines = diagnostics();
		const { origin } = await serve((request, response) => {
			// Answers without the body, stops reading it, and later drops the connection.
			request.on('data', () => {});
			request.pause();
			response.end('ok', () => setTimeout(() => request.socket.destroy(), 50));
		});

		const failedAfterAnswer = await new Promise<boolean>((resolve) => {
			let answered = false;
			const request = httpRequest(`${origin}/api/parts/1`, { method: 'PUT', headers: { 'content-length': String(64 * 1024 * 1024) } }, (response) => {
				response.resume();
				response.on('end', () => answered = true);
			});
			request.on('error', () => resolve(answered));
			request.end(Buffer.alloc(64 * 1024 * 1024));
		});
		expect(failedAfterAnswer).toBe(true);

		expect((await settled(lines)).filter(line => line.includes('outgoing'))).toEqual([]);
	});

	it('writes nothing for an outgoing exchange answered in full', async () => {
		const lines = diagnostics();
		const { origin } = await serve((_request, response) => {
			response.end('ok');
		});

		expect(await outgoing(origin, '/api/proxied')).toBe('ok');

		expect(await settled(lines)).toEqual([]);
	});
});

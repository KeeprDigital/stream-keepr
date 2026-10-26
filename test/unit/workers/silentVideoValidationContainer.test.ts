import type { ChildProcess } from 'node:child_process';
import type { Socket } from 'node:net';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The silent-video validation Container admits one validation at a time
 * (#698). These run the Container's own HTTP server as a child process and
 * talk to it over TCP, the way the Workflow does, so what is proven is the
 * server's admission, not a model of it.
 *
 * No media tooling is needed: every validation here ends before ffprobe, by a
 * digest mismatch, a transfer that fails, or tooling the server cannot find.
 */

const SERVER = fileURLToPath(new URL('../../../workers/silent-video-validator/container/server.mjs', import.meta.url));

const SOURCE = Buffer.from('not really a video');

interface ValidationRequest {
	sourceDigest: string;
	sourceByteLength: number;
	sourceContentType: string;
	format: string;
	codec: string;
	width: number;
	height: number;
	durationSeconds: number;
	frameCount: number;
	posterTimeSeconds: number;
	hasAlpha: boolean;
	posterWidth: number;
	posterHeight: number;
	maxPosterBytes: number;
}

function validationRequest(overrides: Partial<ValidationRequest> = {}): ValidationRequest {
	return {
		sourceDigest: createHash('sha256').update(SOURCE).digest('hex'),
		sourceByteLength: SOURCE.byteLength,
		sourceContentType: 'video/webm',
		format: 'webm',
		codec: 'vp9',
		width: 16,
		height: 16,
		durationSeconds: 1,
		frameCount: 1,
		posterTimeSeconds: 0,
		hasAlpha: false,
		posterWidth: 16,
		posterHeight: 16,
		maxPosterBytes: 1024,
		...overrides,
	};
}

/** A request the server admits and rejects on its declared digest. */
const MISMATCHED = validationRequest({
	sourceDigest: 'f'.repeat(64),
});

interface Response {
	status: number;
	body: string;
}

let root: string;
let workspaceRoot: string;
let server: ChildProcess | undefined;
let port: number;
const sockets = new Set<Socket>();

async function freePort(): Promise<number> {
	const probe = createServer();
	await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
	const address = probe.address();
	await new Promise(resolve => probe.close(resolve));
	if (!address || typeof address === 'string')
		throw new Error('no port');
	return address.port;
}

/** Start the Container's server, its temporary files under `workspaceRoot`. */
async function startServer(env: Record<string, string> = {}) {
	port = await freePort();
	const child = spawn(process.execPath, [SERVER], {
		env: {
			...process.env,
			SILENT_VIDEO_VALIDATOR_PORT: String(port),
			TMPDIR: workspaceRoot,
			...env,
		},
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	server = child;
	await new Promise<void>((resolve, reject) => {
		let output = '';
		child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
			output += chunk;
			if (output.includes('listening'))
				resolve();
		});
		child.once('exit', code => reject(new Error(`server exited with ${code}`)));
	});
}

/** A connected socket to the server, not yet carrying a request. */
async function openConnection(): Promise<Socket> {
	const socket = connect(port, '127.0.0.1');
	sockets.add(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', resolve);
		socket.once('error', reject);
	});
	return socket;
}

function validationHead(request: ValidationRequest, contentLength: number) {
	const header = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
	return 'POST /validate HTTP/1.1\r\n'
		+ `host: 127.0.0.1:${port}\r\n`
		+ 'connection: close\r\n'
		+ `content-type: ${request.sourceContentType}\r\n`
		+ `content-length: ${contentLength}\r\n`
		+ `x-validation-request: ${header}\r\n`
		+ '\r\n';
}

function decodeBody(head: string, body: Buffer): string {
	if (!/^transfer-encoding:\s*chunked/im.test(head))
		return body.toString('utf8');
	const parts: Buffer[] = [];
	let offset = 0;
	while (offset < body.length) {
		const lineEnd = body.indexOf('\r\n', offset);
		const size = Number.parseInt(body.subarray(offset, lineEnd).toString('ascii'), 16);
		if (!size)
			break;
		parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
		offset = lineEnd + 2 + size + 2;
	}
	return Buffer.concat(parts).toString('utf8');
}

/** The one response the server writes on `socket`, once it closes. */
function responseOn(socket: Socket): Promise<Response> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		socket.on('data', (chunk: Buffer) => chunks.push(chunk));
		socket.once('error', reject);
		socket.once('close', () => {
			const raw = Buffer.concat(chunks);
			const split = raw.indexOf('\r\n\r\n');
			if (split < 0) {
				reject(new Error('connection closed without a response'));
				return;
			}
			const head = raw.subarray(0, split).toString('utf8');
			resolve({
				status: Number(head.match(/^HTTP\/1\.1 (\d{3})/)?.[1]),
				body: decodeBody(head, raw.subarray(split + 4)),
			});
		});
	});
}

/** `promise`'s value, or `'pending'` if it has none within `withinMs`. */
function withinOrPending<T>(promise: Promise<T>, withinMs: number): Promise<T | 'pending'> {
	return Promise.race([
		promise,
		new Promise<'pending'>(resolve => setTimeout(resolve, withinMs, 'pending')),
	]);
}

/** One complete validation request, sent and answered. */
async function validate(request: ValidationRequest, body: Buffer = SOURCE): Promise<Response> {
	const socket = await openConnection();
	const response = responseOn(socket);
	socket.write(Buffer.concat([
		Buffer.from(validationHead(request, body.byteLength)),
		body,
	]));
	return response;
}

/** A validation the server has admitted and is now receiving the source for. */
async function heldValidation(request: ValidationRequest = MISMATCHED) {
	const socket = await openConnection();
	const response = responseOn(socket);
	socket.write(validationHead(request, SOURCE.byteLength));
	// An admitted validation's first act is creating its workspace.
	const deadline = Date.now() + 10_000;
	while ((await readdir(workspaceRoot)).length === 0 && Date.now() < deadline)
		await new Promise(resolve => setTimeout(resolve, 20));
	await expect(withinOrPending(validate(MISMATCHED), 5_000)).resolves.toMatchObject({ status: 409 });
	return {
		response,
		finish: () => socket.write(SOURCE),
		abort: () => socket.destroy(),
	};
}

/**
 * The server admits a new validation: it answers it instead of 409. A caller
 * can hear an ending validation's outcome before its cleanup has finished and
 * released the Container, so it is asked again, as the Workflow would retry.
 */
async function expectAdmitsAnother() {
	const deadline = Date.now() + 15_000;
	let answered = await withinOrPending(validate(MISMATCHED), 5_000);
	while (answered !== 'pending' && answered.status === 409 && Date.now() < deadline) {
		await new Promise(resolve => setTimeout(resolve, 50));
		answered = await withinOrPending(validate(MISMATCHED), 5_000);
	}
	expect(answered).toEqual({
		status: 200,
		body: JSON.stringify({
			outcome: 'rejected',
			stage: 'metadata',
			detail: 'Source bytes do not match the declared digest and length',
		}),
	});
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'silent-video-container-test-'));
	workspaceRoot = join(root, 'tmp');
	await mkdir(workspaceRoot);
});

afterEach(async () => {
	for (const socket of sockets)
		socket.destroy();
	sockets.clear();
	if (server && server.exitCode === null) {
		const exited = new Promise(resolve => server!.once('exit', resolve));
		server.kill('SIGKILL');
		await exited;
	}
	server = undefined;
	await chmod(workspaceRoot, 0o755).catch(() => undefined);
	await rm(root, { recursive: true, force: true });
});

describe('silent-video validation Container admission', { timeout: 60_000 }, () => {
	it('answers one of two overlapping validations busy, and validates the other', async () => {
		await startServer();
		const first = await openConnection();
		const second = await openConnection();
		const responses = [
			responseOn(first),
			responseOn(second),
		];
		// Both heads reach the server together, so the second arrives while the
		// first is still setting up its workspace.
		first.write(validationHead(MISMATCHED, SOURCE.byteLength));
		second.write(validationHead(MISMATCHED, SOURCE.byteLength));
		// The busy answer does not wait for either source to arrive.
		const early = await withinOrPending(Promise.race(responses), 10_000);
		first.write(SOURCE);
		second.write(SOURCE);
		const statuses = (await Promise.all(responses)).map(response => response.status);
		expect(statuses.toSorted()).toEqual([200, 409]);
		expect(early).toMatchObject({
			status: 409,
			body: JSON.stringify({ error: 'validation already in progress' }),
		});
	});

	it('keeps a validation reserved through other requests turned away while it runs', async () => {
		await startServer();
		const held = await heldValidation();
		const malformed = await openConnection();
		const malformedResponse = responseOn(malformed);
		malformed.write(`POST /validate HTTP/1.1\r\nhost: x\r\nconnection: close\r\nx-validation-request: ${Buffer.from('{').toString('base64')}\r\ncontent-length: 0\r\n\r\n`);
		await expect(malformedResponse).resolves.toMatchObject({ status: 409 });
		const media = await fetch(`http://127.0.0.1:${port}/media/${'0'.repeat(32)}/page`);
		expect(media.status).toBe(404);
		await expect(validate(MISMATCHED)).resolves.toMatchObject({ status: 409 });
		held.finish();
		await expect(held.response).resolves.toMatchObject({ status: 200 });
		await expectAdmitsAnother();
	});

	it('admits a later validation after the workspace could not be created', async () => {
		await startServer();
		await rm(workspaceRoot, { recursive: true });
		await expect(validate(MISMATCHED)).resolves.toMatchObject({ status: 500 });
		await mkdir(workspaceRoot);
		await expectAdmitsAnother();
	});

	it('admits a later validation after a malformed validation request', async () => {
		await startServer();
		const malformed = await openConnection();
		const response = responseOn(malformed);
		malformed.write(`POST /validate HTTP/1.1\r\nhost: x\r\nconnection: close\r\nx-validation-request: ${Buffer.from('{').toString('base64')}\r\ncontent-length: 0\r\n\r\n`);
		await expect(response).resolves.toMatchObject({ status: 400 });
		await expectAdmitsAnother();
	});

	it('admits a later validation after an oversized source transfer', async () => {
		await startServer();
		// The server stops reading at the declared length and drops the
		// connection, which the Workflow's fetch sees as a retryable failure.
		await expect(validate(MISMATCHED, Buffer.concat([SOURCE, SOURCE])))
			.rejects
			.toThrow('connection closed without a response');
		await expectAdmitsAnother();
	});

	it('admits a later validation after the caller abandons the source transfer', async () => {
		await startServer();
		const held = await heldValidation();
		held.abort();
		await expect(held.response).rejects.toThrow('connection closed without a response');
		await expectAdmitsAnother();
	});

	it('admits a later validation after validation itself fails', async () => {
		// The digest matches, so the server goes on to ffprobe, which it cannot find.
		await startServer({
			PATH: join(root, 'no-tooling'),
		});
		const response = await validate(validationRequest());
		expect(response.status).toBe(500);
		await expectAdmitsAnother();
	});

	it('admits a later validation after its workspace could not be removed', async () => {
		await startServer();
		const held = await heldValidation();
		await chmod(workspaceRoot, 0o555);
		held.finish();
		const response = await held.response;
		await chmod(workspaceRoot, 0o755);
		expect(response.status).toBe(500);
		expect(await readdir(workspaceRoot)).toHaveLength(1);
		await expectAdmitsAnother();
	});
});

import type { Socket } from 'node:net';
import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { beforeAll, describe, expect, it } from 'vitest';
import { GRAPHICS_MULTIPART_PART_BYTES } from '../../shared/utils/graphicsAssetCompatibility';
import { $fetch, fetch, operatorSessionCookie, url } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { expectResponseStatus } from './responseStatus';

/**
 * A connection an integration server answered early must not trap the next
 * request (#633).
 *
 * The route answers a part it already holds without reading the body sent with
 * it. `nuxt dev`'s public listener then stops reading that body and keeps the
 * connection alive. Node's `fetch` reuses a connection once it has written a
 * whole body, which on CI's larger loopback buffers can happen before the answer
 * arrives: the multipart `complete` it sent next sat behind the unread bytes and
 * died with `read ECONNRESET` when the listener's keep-alive timeout (5 s plus
 * Node's 1 s buffer) fired, 6.0 s after the duplicate's answer, with nothing
 * logged. `fetch` cannot be made to reuse it on demand, so this writes the
 * bytes itself on one socket, as that client did.
 */

let cookie = '';

beforeAll(async () => {
	cookie = await operatorSessionCookie();
});

/** One raw HTTP/1.1 connection to this worker's server. */
function rawConnection() {
	const { hostname, port } = new URL(url('/'));
	const socket: Socket = connect(Number(port), hostname);
	let received = Buffer.alloc(0);
	let ended = false;
	socket.on('data', (chunk: Buffer) => received = Buffer.concat([received, chunk]));
	socket.on('error', () => {});
	socket.once('close', () => ended = true);

	/**
	 * The next whole response, or `closed` if the connection ended first, or
	 * `silent` if neither happened within `milliseconds`.
	 */
	async function nextResponse(milliseconds: number): Promise<{ status: number; headers: string } | 'closed' | 'silent'> {
		const deadline = Date.now() + milliseconds;
		while (Date.now() < deadline) {
			const headerEnd = received.indexOf('\r\n\r\n');
			if (headerEnd !== -1) {
				const headers = received.subarray(0, headerEnd).toString('latin1');
				const length = Number(/^content-length:\s*(\d+)/im.exec(headers)?.[1] ?? 0);
				if (received.length >= headerEnd + 4 + length) {
					received = received.subarray(headerEnd + 4 + length);
					return { status: Number(headers.split(' ', 2)[1]), headers };
				}
			}
			if (ended)
				return 'closed';
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		return 'silent';
	}

	function send(method: string, path: string, body: Uint8Array = new Uint8Array(0)) {
		socket.write(`${method} ${path} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nCookie: ${cookie}\r\nContent-Length: ${body.byteLength}\r\n\r\n`, 'latin1');
		if (body.byteLength)
			socket.write(body);
	}

	return { send, nextResponse, close: () => socket.destroy() };
}

describe('an early answer\'s connection', () => {
	it('answers or closes, but never strands, a request sent after a duplicate part', async () => {
		const bytes = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 1);
		const firstPart = bytes.subarray(0, GRAPHICS_MULTIPART_PART_BYTES);
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: { cookie },
			body: graphicsIngestionRequest({
				idempotencyKey: 'integration-early-answer-connection',
				name: 'Early answer connection',
				declaredMime: 'image/png',
				browserDecodeEvidence: { outcome: 'rejected', sourceDigest: createHash('sha256').update(bytes).digest('hex') },
				declaredByteLength: bytes.byteLength,
			}),
		});
		const base = `/api/graphics-assets/ingestion-operations/${initiated.id}`;
		await $fetch(`${base}/multipart`, { method: 'POST', headers: { cookie } });
		await expectResponseStatus(await fetch(`${base}/multipart/parts/1`, { method: 'PUT', headers: { cookie }, body: firstPart }), 200);

		const connection = rawConnection();
		try {
			connection.send('PUT', `${base}/multipart/parts/1`, firstPart);
			expect(await connection.nextResponse(10_000)).toMatchObject({ status: 200 });

			// The next request on the same connection, written as soon as the answer
			// is in, as a reusing client writes it.
			connection.send('PUT', `${base}/multipart/parts/2`, bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES));
			const next = await connection.nextResponse(3_000);
			expect(['closed', 200]).toContain(typeof next === 'object' ? next.status : next);
		}
		finally {
			connection.close();
			// Leave no staged transfer behind for the next file on this server.
			await $fetch(base, { method: 'DELETE', headers: { cookie } });
		}
	}, 30_000);
});

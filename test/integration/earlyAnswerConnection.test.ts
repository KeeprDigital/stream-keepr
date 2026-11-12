import type { Socket } from 'node:net';
import { Buffer } from 'node:buffer';
import { connect } from 'node:net';
import { beforeAll, describe, expect, it } from 'vitest';
import { operatorSessionCookie, url } from './client';

/**
 * A connection an integration server answered early must not trap the next
 * request (#633).
 *
 * A route that answers without reading the body sent with it (a multipart part
 * it already holds, or here a body over its limit) leaves `nuxt dev`'s public
 * listener holding the unread bytes on a connection it keeps alive. Node's
 * `fetch` reuses a connection once it has written a whole body, which on CI's
 * larger loopback buffers can happen before the answer arrives: the request it
 * sent next sat behind the unread bytes and died with `read ECONNRESET` when the
 * listener's keep-alive timeout (5 s plus Node's 1 s buffer) fired, with nothing
 * logged. `fetch` cannot be made to reuse it on demand, so this writes the bytes
 * itself on one socket, as that client did.
 *
 * The drain itself is unit-tested in `test/unit/integration/earlyAnswerDrain.test.ts`;
 * this is the proof that the spawned servers carry it.
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
	 * `silent` if neither happened within `milliseconds`. The route's answers
	 * carry a Content-Length; anything else fails loudly rather than misparse.
	 */
	async function nextResponse(milliseconds: number): Promise<{ status: number; headers: string } | 'closed' | 'silent'> {
		const deadline = Date.now() + milliseconds;
		while (Date.now() < deadline) {
			const headerEnd = received.indexOf('\r\n\r\n');
			if (headerEnd !== -1) {
				const headers = received.subarray(0, headerEnd).toString('latin1');
				const declared = /^content-length:\s*(\d+)/im.exec(headers)?.[1];
				if (declared === undefined)
					throw new Error(`This reader takes only answers with a Content-Length; got:\n${headers}`);
				const length = Number(declared);
				if (received.length >= headerEnd + 4 + length) {
					received = received.subarray(headerEnd + 4 + length);
					return {
						status: Number(headers.split(' ', 2)[1]),
						headers,
					};
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

	return {
		send,
		nextResponse,
		close: () => socket.destroy(),
	};
}

describe('an early answer\'s connection', () => {
	// The body-limit refusal answers 413 on the declared length, without reading
	// the body. `requestBodyLimits.test.ts` once retried every request for it
	// (#396), because its next request on a reused connection died with EPIPE or
	// ECONNRESET 6 s after a 413.
	it('answers a request sent on the same connection after a 413 on the declared length', async () => {
		const connection = rawConnection();
		try {
			connection.send('POST', '/api/_test/bounded-raw-mutation', new Uint8Array(2 * 1024 * 1024 + 1));
			expect(await connection.nextResponse(10_000)).toMatchObject({ status: 413 });

			connection.send('GET', '/api/time');
			expect(await connection.nextResponse(3_000)).toMatchObject({ status: 200 });
		}
		finally {
			connection.close();
		}
	}, 30_000);
});

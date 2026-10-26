import type { AddressInfo } from 'node:net';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { installEarlyAnswerDrain } from '~~/test/integration/earlyAnswerDrain.mjs';

/**
 * What an integration server does with a body it answered without reading (#633).
 *
 * Nitro's dev proxy pipes a request into its hop to the dev worker. When the
 * worker answers before the body is in (a multipart part the library already
 * holds), that pipe stops, and Node keeps the connection alive with the rest of
 * the body unread: the next request sent on it waits until the keep-alive
 * timeout resets it, 6 s later. These rows pin that the integration servers read
 * such a body to its end instead, as Node does for one nobody started reading.
 */

const cleanups: Array<() => unknown> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse())
		await cleanup();
});

async function serve(handler: Parameters<typeof createServer>[1]) {
	cleanups.push(installEarlyAnswerDrain());
	const server = createServer(handler);
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(() => new Promise(resolve => server.close(resolve)));
	return (server.address() as AddressInfo).port;
}

/** One raw connection, so the test decides which bytes go out on it and when. */
function connection(port: number) {
	const socket = connect(port, '127.0.0.1');
	let received = '';
	socket.setEncoding('utf8');
	socket.on('data', (chunk: string) => received += chunk);
	socket.on('error', () => {});
	cleanups.push(() => socket.destroy());
	const answers = async (count: number, milliseconds: number) => {
		const deadline = Date.now() + milliseconds;
		while (received.split('HTTP/1.1 200 OK').length - 1 < count && Date.now() < deadline)
			await new Promise(resolve => setTimeout(resolve, 10));
		return received.split('HTTP/1.1 200 OK').length - 1;
	};
	return { socket, answers };
}

describe('an integration server\'s early answer', () => {
	it('reads the rest of a body its handler stopped forwarding, so the next request on the connection is answered', async () => {
		const port = await serve((request, response) => {
			if (request.url === '/api/parts/1') {
				// A hop that never drains, as Nitro's proxy is once the worker has answered.
				request.pipe(new Writable({
					highWaterMark: 1,
					write: () => {},
				}));
				response.end('already held');
				return;
			}
			request.resume();
			request.on('end', () => response.end('stored'));
		});
		const { socket, answers } = connection(port);

		socket.write('PUT /api/parts/1 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4194304\r\n\r\n');
		socket.write(Buffer.alloc(4 * 1024 * 1024));
		expect(await answers(1, 2_000)).toBe(1);
		socket.write('PUT /api/parts/2 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1\r\n\r\nx');

		expect(await answers(2, 2_000)).toBe(2);
	});

	it('leaves alone a body its handler read to the end', async () => {
		const port = await serve((request, response) => {
			let length = 0;
			request.on('data', (chunk: Buffer) => length += chunk.byteLength);
			request.on('end', () => response.end(String(length)));
		});
		const { socket, answers } = connection(port);

		socket.write('PUT /api/parts/1 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\n\r\nabcd');
		expect(await answers(1, 2_000)).toBe(1);
		socket.write('GET /api/parts HTTP/1.1\r\nHost: localhost\r\n\r\n');

		expect(await answers(2, 2_000)).toBe(2);
	});
});

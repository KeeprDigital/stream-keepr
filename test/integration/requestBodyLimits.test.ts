import { fetch } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

const GENERAL_LIMIT_BYTES = 1024 * 1024;
const RAW_TRANSFER_LIMIT_BYTES = 2 * 1024 * 1024;

function chunkedBody(...chunkSizes: number[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunkSize of chunkSizes)
				controller.enqueue(new Uint8Array(chunkSize));
			controller.close();
		},
	});
}

function streamingMutation(method: 'DELETE' | 'PATCH' | 'POST' | 'PUT', body: ReadableStream<Uint8Array>): RequestInit {
	return {
		method,
		body,
		duplex: 'half',
	} as RequestInit & { duplex: 'half' };
}

describe('request body limits', () => {
	it('accepts a raw mutation stream above the general limit when the route declares a larger limit', async () => {
		const receivedBytes = GENERAL_LIMIT_BYTES + 1;

		const response = await fetch(
			'/api/_test/bounded-raw-mutation',
			streamingMutation('POST', chunkedBody(GENERAL_LIMIT_BYTES, 1)),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ receivedBytes });
	});

	it('rejects a raw mutation whose declared length exceeds its route limit', async () => {
		const response = await fetch('/api/_test/bounded-raw-mutation', {
			method: 'POST',
			body: new Uint8Array(RAW_TRANSFER_LIMIT_BYTES + 1),
		});

		expect(response.status).toBe(413);
	});

	it('rejects a raw mutation when unknown-length streamed bytes exceed its route limit', async () => {
		const response = await fetch(
			'/api/_test/bounded-raw-mutation',
			streamingMutation('POST', chunkedBody(RAW_TRANSFER_LIMIT_BYTES, 1)),
		);

		expect(response.status).toBe(413);
	});

	it.each(['DELETE', 'PATCH', 'POST', 'PUT'] as const)(
		'keeps the general limit on ordinary %s mutations',
		async (method) => {
			const response = await fetch(
				'/api/_test/ordinary-mutation',
				streamingMutation(method, chunkedBody(GENERAL_LIMIT_BYTES, 1)),
			);

			expect(response.status).toBe(413);
		},
	);

	it('does not apply a registered limit to another method at the same path', async () => {
		const response = await fetch('/api/_test/bounded-raw-mutation', {
			method: 'PUT',
			body: new Uint8Array(GENERAL_LIMIT_BYTES + 1),
		});

		expect(response.status).toBe(413);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetRequestHeader = vi.fn();
const mockGetRequestWebStream = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRequestHeader', mockGetRequestHeader);
vi.stubGlobal('getRequestWebStream', mockGetRequestWebStream);
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; message: string }) => Object.assign(
	new Error(input.message),
	input,
));

const handler = (await import('~~/server/middleware/request-body-limit')).default;

describe('request body limit middleware', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetRequestHeader.mockReturnValue(null);
		mockGetRequestWebStream.mockReturnValue(undefined);
	});

	it('rejects a declared oversized request before exposing its body to a route', () => {
		mockGetRequestHeader.mockReturnValue(String(1024 * 1024 + 1));

		expect(() => handler({ method: 'POST' } as any)).toThrowError(
			expect.objectContaining({ statusCode: 413 }),
		);
		expect(mockGetRequestWebStream).not.toHaveBeenCalled();
	});

	it('rejects an unknown-length body as soon as streamed bytes cross the limit', async () => {
		mockGetRequestWebStream.mockReturnValue(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(1024 * 1024));
				controller.enqueue(new Uint8Array(1));
				controller.close();
			},
		}));
		const event = { method: 'PATCH' } as any;

		handler(event);
		const reader = (event._requestBody as ReadableStream<Uint8Array>).getReader();
		await expect((async () => {
			while (!(await reader.read()).done) {
				// Drain until the limiting transform rejects.
			}
		})()).rejects.toMatchObject({ statusCode: 413 });
	});

	it('leaves bodyless read requests untouched', () => {
		handler({ method: 'GET' } as any);

		expect(mockGetRequestHeader).not.toHaveBeenCalled();
		expect(mockGetRequestWebStream).not.toHaveBeenCalled();
	});
});

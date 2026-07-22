import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; message: string }) => Object.assign(
	new Error(input.message),
	input,
));

const mockGetRequestHeader = vi.fn();
const mockGetRequestWebStream = vi.fn();
const mockReadBody = vi.fn();
vi.stubGlobal('getRequestHeader', mockGetRequestHeader);
vi.stubGlobal('getRequestWebStream', mockGetRequestWebStream);
vi.stubGlobal('readBody', mockReadBody);

const { assertJsonPayloadSize, jsonPayloadByteLength, readJsonPayloadLimited } = await import('~~/server/utils/payloadLimits');

describe('json payload limits', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetRequestHeader.mockReturnValue(null);
		mockGetRequestWebStream.mockReturnValue(undefined);
	});

	it('counts encoded bytes rather than UTF-16 code units', () => {
		expect(jsonPayloadByteLength('😀')).toBe(6); // two JSON quotes plus four UTF-8 bytes
	});

	it('throws a 413 for oversized persisted payloads', () => {
		expect(() => assertJsonPayloadSize({ value: 'x'.repeat(100) }, 16, 'Config')).toThrowError(
			expect.objectContaining({ statusCode: 413, statusMessage: 'Payload Too Large' }),
		);
	});

	it('rejects a declared oversized body before reading it', async () => {
		mockGetRequestHeader.mockReturnValue('1025');

		await expect(readJsonPayloadLimited({} as any, 1024, 'Config')).rejects.toMatchObject({
			statusCode: 413,
		});
		expect(mockGetRequestWebStream).not.toHaveBeenCalled();
	});

	it('stops a chunked request when its streamed bytes cross the limit', async () => {
		const encoder = new TextEncoder();
		mockGetRequestWebStream.mockReturnValue(new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('{"value":"'));
				controller.enqueue(encoder.encode('x'.repeat(64)));
				controller.close();
			},
		}));

		await expect(readJsonPayloadLimited({} as any, 32, 'Config')).rejects.toMatchObject({
			statusCode: 413,
		});
	});

	it('parses valid JSON from the bounded byte stream', async () => {
		const encoder = new TextEncoder();
		mockGetRequestWebStream.mockReturnValue(new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('{"label":"😀"}'));
				controller.close();
			},
		}));

		await expect(readJsonPayloadLimited({} as any, 64, 'Config')).resolves.toEqual({ label: '😀' });
	});

	it('prefers the middleware bounded stream over H3\'s original web request body', async () => {
		const encoder = new TextEncoder();
		const boundedStream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('{"bounded":true}'));
				controller.close();
			},
		});
		mockGetRequestWebStream.mockImplementation(() => {
			throw new TypeError('original request body is locked');
		});

		await expect(
			readJsonPayloadLimited({ _requestBody: boundedStream } as any, 64, 'Config'),
		).resolves.toEqual({ bounded: true });
		expect(mockGetRequestWebStream).not.toHaveBeenCalled();
	});
});

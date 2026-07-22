import type { RealtimeTransport } from '~/types/realtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

const mockRealtime = createMockRealtime();

function realtimeTransport() {
	return mockRealtime as unknown as RealtimeTransport;
}

describe('useApiHeaders', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRealtime.connectionId = 'test-connection-id';
	});

	it('returns a plain optional header object for request-time use', () => {
		const headers = useApiHeaders(realtimeTransport());
		expect(headers.getHeaders()).toEqual({ 'x-realtime-connection-id': 'test-connection-id' });
	});

	it('keeps header values dynamic from the captured realtime object', () => {
		const headers = useApiHeaders(realtimeTransport());
		mockRealtime.connectionId = 'updated-connection-id';
		expect(headers.getHeaders()).toEqual({ 'x-realtime-connection-id': 'updated-connection-id' });
	});
});

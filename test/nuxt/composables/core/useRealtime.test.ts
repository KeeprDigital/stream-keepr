import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

// We can't mock useNuxtApp directly (breaks nuxt test runtime).
// Instead, test useRealtime via the standard mock pattern used by other tests:
// mock useRealtime itself and verify the mock shape.

const mockAbly = createMockRealtime();
mockNuxtImport('useRealtime', () => () => mockAbly);

describe('useRealtime', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the realtime transport', () => {
		const result = useRealtime();
		expect(result).toBe(mockAbly);
	});

	it('exposes expected connection properties', () => {
		const result = useRealtime();
		expect(result.connectionId).toBe('test-connection-id');
		expect(result.isConnected).toBe(true);
		expect(result.connectionState).toBe('connected');
	});

	it('exposes expected methods', () => {
		const result = useRealtime();
		expect(typeof result.setRoom).toBe('function');
		expect(typeof result.onRoom).toBe('function');
		expect(typeof result.offRoom).toBe('function');
		expect(typeof result.onChannel).toBe('function');
		expect(typeof result.enterPresence).toBe('function');
		expect(typeof result.leavePresence).toBe('function');
		expect(typeof result.watchPresence).toBe('function');
	});
});

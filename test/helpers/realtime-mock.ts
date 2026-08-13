/**
 * Mock for the realtime transport provided by the realtime plugin ($realtime).
 *
 * Usage in Nuxt test files:
 *   import { createMockRealtime } from '~~/test/helpers/realtime-mock'
 *   mockNuxtImport('useRealtime', () => () => createMockRealtime())
 */

import { vi } from 'vitest';

export interface MockRealtime {
	// State
	isConnected: boolean;
	connectionState: string;
	error: null | Error;
	/** Set only when the token for the active Event could not be minted (#307). */
	tokenError: null | Error;
	connectionId: string;

	// Room lifecycle
	setRoom: ReturnType<typeof vi.fn>;
	onRoom: ReturnType<typeof vi.fn>;
	offRoom: ReturnType<typeof vi.fn>;

	// Channel transport
	onChannel: ReturnType<typeof vi.fn>;

	// Presence
	enterPresence: ReturnType<typeof vi.fn>;
	leavePresence: ReturnType<typeof vi.fn>;
	watchPresence: ReturnType<typeof vi.fn>;
}

export function createMockRealtime(): MockRealtime {
	return {
		// State
		isConnected: true,
		connectionState: 'connected',
		error: null,
		tokenError: null,
		connectionId: 'test-connection-id',

		// Room lifecycle
		setRoom: vi.fn(),
		onRoom: vi.fn(),
		offRoom: vi.fn(),

		// Channel transport
		onChannel: vi.fn().mockReturnValue(() => {}),

		// Presence
		enterPresence: vi.fn().mockResolvedValue(undefined),
		leavePresence: vi.fn().mockResolvedValue(undefined),
		watchPresence: vi.fn().mockReturnValue(() => {}),
	};
}

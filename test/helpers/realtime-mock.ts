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
	onContinuityLost: ReturnType<typeof vi.fn>;
	onceAttached: ReturnType<typeof vi.fn>;

	// Presence
	enterPresence: ReturnType<typeof vi.fn>;
	leavePresence: ReturnType<typeof vi.fn>;
	updatePresence: ReturnType<typeof vi.fn>;
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
		onContinuityLost: vi.fn().mockReturnValue(() => {}),
		onceAttached: vi.fn().mockReturnValue(() => {}),

		// Presence
		enterPresence: vi.fn().mockResolvedValue(undefined),
		leavePresence: vi.fn().mockResolvedValue(undefined),
		updatePresence: vi.fn().mockResolvedValue(undefined),
		watchPresence: vi.fn().mockReturnValue(() => {}),
	};
}

/**
 * The transport's lost-continuity signal, for a stand-in transport: spread
 * `onContinuityLost` into it, and `reattach` a channel to signal it attached
 * again having lost continuity — the moment Reconnect Resync re-reads (#641).
 */
export function createContinuitySignal() {
	const handlers = new Map<string, Set<() => void>>();
	return {
		onContinuityLost: vi.fn((channel: string, handler: () => void) => {
			if (!handlers.has(channel))
				handlers.set(channel, new Set());
			handlers.get(channel)!.add(handler);
			return () => {
				handlers.get(channel)!.delete(handler);
			};
		}),
		reattach(channel: string) {
			for (const handler of [...handlers.get(channel) ?? []])
				handler();
		},
	};
}

/**
 * The transport's next-attach signal, for a stand-in transport: spread
 * `onceAttached` into it, and `attach` a channel to signal its attach — a
 * channel `attach`ed once counts as attached for every later registration, as
 * the transport's does (#727).
 */
export function createAttachSignal() {
	const waiting = new Map<string, Set<() => void>>();
	const attached = new Set<string>();
	return {
		onceAttached: vi.fn((channel: string, handler: () => void) => {
			if (attached.has(channel))
				return () => {};
			if (!waiting.has(channel))
				waiting.set(channel, new Set());
			const once = () => handler();
			waiting.get(channel)!.add(once);
			return () => {
				waiting.get(channel)?.delete(once);
			};
		}),
		attach(channel: string) {
			attached.add(channel);
			const handlers = [...waiting.get(channel) ?? []];
			waiting.delete(channel);
			for (const handler of handlers)
				handler();
		},
		/** The channel detached: the next registration waits on its next attach. */
		detach(channel: string) {
			attached.delete(channel);
		},
	};
}

/**
 * Mock for the realtime transport provided by the realtime plugin ($realtime).
 *
 * Usage in Nuxt test files:
 *   import { createMockRealtime } from '~~/test/helpers/realtime-mock'
 *   mockNuxtImport('useRealtime', () => () => createMockRealtime())
 */

import type { RealtimeConnectionState } from '~/types/realtime';
import { vi } from 'vitest';
import { reactive } from 'vue';

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
			for (const handler of [
				...handlers.get(channel) ?? [],
			])
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
			// Its own entry, as the transport's: one handler can wait twice.
			const once = () => handler();
			waiting.get(channel)!.add(once);
			return () => {
				waiting.get(channel)?.delete(once);
			};
		}),
		attach(channel: string) {
			attached.add(channel);
			const handlers = [
				...waiting.get(channel) ?? [],
			];
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

export type FakeChannelHandler = (message: Record<string, unknown>) => void;

/**
 * A stand-in transport whose Event channels the test drives: `deliver` a
 * message, `attach`/`reattach` a channel, flip `transport.connectionState`.
 * Pass `transport` where a composable takes one, or return it from a mocked
 * `useRealtime`/`tryUseRealtime`. Event id defaults to 1 throughout.
 */
export function createFakeEventChannel() {
	const handlers = new Map<string, Set<FakeChannelHandler>>();
	const continuity = createContinuitySignal();
	const attachment = createAttachSignal();
	const transport = reactive({
		connectionState: 'connected' as RealtimeConnectionState['connectionState'],
		tokenError: null as Error | null,
		onChannel: vi.fn((channel: string, type: string, handler: FakeChannelHandler) => {
			const key = `${channel}|${type}`;
			if (!handlers.has(key))
				handlers.set(key, new Set());
			handlers.get(key)!.add(handler);
			return () => handlers.get(key)!.delete(handler);
		}),
		onContinuityLost: continuity.onContinuityLost,
		onceAttached: attachment.onceAttached,
	});
	return {
		transport,
		/** An Event message of `type`, as the Event channel delivers it (`eventId` merged in). */
		deliver(type: string, payload: Record<string, unknown> = {}, eventId = 1) {
			for (const handler of [
				...handlers.get(`event:${eventId}|${type}`) ?? [],
			])
				handler({ eventId, ...payload });
		},
		/** The Event channel attached: the first time, or again after a detach. */
		attach: (eventId = 1) => attachment.attach(`event:${eventId}`),
		/** The Event channel attached again having lost continuity. */
		reattach: (eventId = 1) => continuity.reattach(`event:${eventId}`),
		/** How many channel handlers are registered now, across every channel and type. */
		listeners: () => [
			...handlers.values(),
		].reduce((total, set) => total + set.size, 0),
		/** Back to connected with no token error; registrations are kept. */
		reset() {
			transport.connectionState = 'connected';
			transport.tokenError = null;
		},
	};
}

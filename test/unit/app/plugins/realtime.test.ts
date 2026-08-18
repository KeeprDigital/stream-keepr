import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MessageHandler = (message: { data: unknown }) => void;
type PresenceHandler = () => void;

class MockChannel {
	publish = vi.fn().mockResolvedValue(undefined);
	detach = vi.fn();

	private handlers = new Map<string, Set<MessageHandler>>();
	private presenceHandlers = new Map<string, Set<PresenceHandler>>();
	private presenceMembers: unknown[] = [];
	private subscribeResult: Promise<unknown> | undefined;
	private presenceSubscribeResult: Promise<unknown> | undefined;

	presence = {
		enter: vi.fn().mockResolvedValue(undefined),
		leave: vi.fn().mockResolvedValue(undefined),
		get: vi.fn(async () => this.presenceMembers),
		subscribe: vi.fn((event: string, handler: PresenceHandler) => {
			const handlers = this.presenceHandlers.get(event) ?? new Set<PresenceHandler>();
			handlers.add(handler);
			this.presenceHandlers.set(event, handlers);
			return this.presenceSubscribeResult;
		}),
		unsubscribe: vi.fn((event: string, handler: PresenceHandler) => {
			this.presenceHandlers.get(event)?.delete(handler);
		}),
	};

	subscribe = vi.fn((messageType: string, handler: MessageHandler) => {
		const handlers = this.handlers.get(messageType) ?? new Set<MessageHandler>();
		handlers.add(handler);
		this.handlers.set(messageType, handlers);
		return this.subscribeResult;
	});

	unsubscribe = vi.fn((messageType: string, handler: MessageHandler) => {
		this.handlers.get(messageType)?.delete(handler);
	});

	emit(messageType: string, data: unknown) {
		for (const handler of this.handlers.get(messageType) ?? []) {
			handler({ data });
		}
	}

	emitPresence(event: string) {
		for (const handler of this.presenceHandlers.get(event) ?? []) {
			handler();
		}
	}

	setPresenceMembers(members: unknown[]) {
		this.presenceMembers = members;
	}

	setSubscribeResult(result: Promise<unknown>) {
		this.subscribeResult = result;
	}

	setPresenceSubscribeResult(result: Promise<unknown>) {
		this.presenceSubscribeResult = result;
	}
}

const channels = new Map<string, MockChannel>();
const connectionHandlers = new Map<string, (stateChange?: unknown) => void>();
const mockConnection = {
	id: 'connection-1',
	on: vi.fn((state: string, handler: (stateChange?: unknown) => void) => {
		connectionHandlers.set(state, handler);
	}),
	connect: vi.fn(),
	close: vi.fn(),
};

const mockChannels = {
	get: vi.fn((name: string) => {
		if (!channels.has(name)) {
			channels.set(name, new MockChannel());
		}
		return channels.get(name);
	}),
};

const realtimeInstances: MockRealtime[] = [];

class MockRealtime {
	connection = mockConnection;
	channels = mockChannels;
	auth = { authorize: vi.fn() };

	constructor(public options: unknown) {
		realtimeInstances.push(this);
	}
}

vi.mock('ably', () => ({
	default: { Realtime: MockRealtime },
}));

vi.stubGlobal('defineNuxtPlugin', vi.fn(handler => handler));
vi.stubGlobal('randomUuid', vi.fn(() => 'uuid-1'));
vi.stubGlobal('ref', vi.fn(value => ({ value })));
vi.stubGlobal('$fetch', vi.fn());
/**
 * `location.hash` is where a Screen Output keeps its Screen Output Asset
 * Capability, and since #397 the auth callback reads it to decide which credential
 * this document has. Stubbed empty by default — the operator's own pages carry no
 * fragment — and set per test where the bearer arm is what is being read.
 */
vi.stubGlobal('window', { addEventListener: vi.fn(), location: { hash: '' } });

async function createTransport() {
	vi.resetModules();
	const plugin = (await import('~~/app/plugins/realtime.client')).default as any;
	const result = plugin.setup();
	return result.provide.realtime;
}

/** Flush the microtasks between a subscribe request and its coverage-gated attempt. */
async function settle() {
	for (let i = 0; i < 5; i++)
		await Promise.resolve();
}

describe('realtime plugin', () => {
	beforeEach(() => {
		channels.clear();
		connectionHandlers.clear();
		realtimeInstances.length = 0;
		mockConnection.id = 'connection-1';
		mockConnection.on.mockClear();
		mockConnection.connect.mockClear();
		mockConnection.close.mockClear();
		mockChannels.get.mockClear();
		vi.mocked(window.addEventListener).mockClear();
		vi.mocked(randomUuid).mockReturnValue('uuid-1');
		vi.mocked($fetch).mockReset();
		window.location.hash = '';
	});

	it('connects immediately and updates exposed connection state from Ably events', async () => {
		const realtime = await createTransport();

		expect(mockConnection.connect).toHaveBeenCalledOnce();
		expect(realtime.connectionState).toBe('initialized');
		expect(realtime.isConnected).toBe(false);

		connectionHandlers.get('connected')?.();

		expect(realtime.connectionState).toBe('connected');
		expect(realtime.isConnected).toBe(true);
		expect(realtime.error).toBeNull();

		connectionHandlers.get('disconnected')?.({ reason: 'network lost' });

		expect(realtime.connectionState).toBe('disconnected');
		expect(realtime.isConnected).toBe(false);
		expect(realtime.error).toEqual(new Error('network lost'));
	});

	it('waits for an event before requesting the initial token, then scopes it to the first room', async () => {
		// Typed against the plain signature rather than the route table: matching a
		// resolved value against `$fetch`'s route-conditional return type exhausts
		// the type comparison depth limit.
		vi.mocked($fetch as unknown as (path: string) => Promise<unknown>)
			.mockResolvedValueOnce({ token: 'token-request' });
		const realtime = await createTransport();
		const callback = vi.fn();

		const authCallbackPromise = (realtimeInstances[0]!.options as any).authCallback({}, callback);

		// No event chosen yet (e.g. the event-less index page) — must not
		// fetch a token or surface an error while waiting.
		await Promise.resolve();
		expect($fetch).not.toHaveBeenCalled();
		expect(callback).not.toHaveBeenCalled();

		realtime.setRoom('event:7');
		await authCallbackPromise;

		expect($fetch).toHaveBeenCalledWith('/api/realtime/token', {
			query: { eventId: 7 },
			// No fragment on an operator's page, so no bearer to present: the session
			// cookie rides along and the token route reads that arm instead (#397).
			headers: undefined,
		});
		expect(callback).toHaveBeenCalledWith(null, { token: 'token-request' });
		expect(realtimeInstances[0]!.auth.authorize).not.toHaveBeenCalled();
	});

	/**
	 * The Screen Output's half of #397's dual grant.
	 *
	 * An output has no session, so the capability in its URL fragment is the only
	 * thing that can get it a token — and the grant it comes back with is narrowed to
	 * its own Screen. Presenting nothing here would have taken every Screen Output's
	 * realtime down the moment the route stopped issuing anonymously, which is the
	 * one failure in this ticket that reaches program.
	 */
	it('presents the capability in its fragment, which is a Screen Output\'s only credential', async () => {
		window.location.hash = '#asset-capability=a-screen-output-capability-token';
		vi.mocked($fetch as unknown as (path: string) => Promise<unknown>)
			.mockResolvedValueOnce({ token: 'token-request' });
		const realtime = await createTransport();
		const callback = vi.fn();

		const authCallbackPromise = (realtimeInstances[0]!.options as any).authCallback({}, callback);
		realtime.setRoom('event:7');
		await authCallbackPromise;

		expect($fetch).toHaveBeenCalledWith('/api/realtime/token', {
			query: { eventId: 7 },
			headers: { authorization: 'Bearer a-screen-output-capability-token' },
		});
	});

	it('presents nothing when the fragment carries no capability it can read', async () => {
		// A mistyped or truncated fragment is no credential rather than a bad one: the
		// document falls back to whatever session it has, which for a real output is
		// none — and an output with no media is a better failure than one that cannot
		// connect at all.
		window.location.hash = '#asset-capability=too-short';
		vi.mocked($fetch as unknown as (path: string) => Promise<unknown>)
			.mockResolvedValueOnce({ token: 'token-request' });
		const realtime = await createTransport();
		const callback = vi.fn();

		const authCallbackPromise = (realtimeInstances[0]!.options as any).authCallback({}, callback);
		realtime.setRoom('event:7');
		await authCallbackPromise;

		expect($fetch).toHaveBeenCalledWith('/api/realtime/token', {
			query: { eventId: 7 },
			headers: undefined,
		});
	});

	it('declares no clientId of its own, because the token pins one', async () => {
		// Ably refuses a connection whose declared `clientId` conflicts with its
		// token's, and #397 pins the identity in the token — the userId for an
		// operator, `screen-output:<screenId>` for an output. Declaring one here would
		// break every connection rather than merely duplicate a value.
		await createTransport();

		expect(realtimeInstances[0]!.options).not.toHaveProperty('clientId');
	});

	it('re-mints a newly scoped token when a room for a different event is set', async () => {
		const realtime = await createTransport();
		realtime.setRoom('event:7');
		await settle();
		realtimeInstances[0]!.auth.authorize.mockClear();

		realtime.setRoom('event:9');
		await settle();

		expect(realtimeInstances[0]!.auth.authorize).toHaveBeenCalledOnce();
	});

	it('does not re-mint when subscribing within the already covered event', async () => {
		const realtime = await createTransport();
		realtime.setRoom('event:7');
		await settle();
		realtimeInstances[0]!.auth.authorize.mockClear();

		realtime.onChannel('screen:7:2', 'screen:command:debug', vi.fn());
		await settle();

		expect(realtimeInstances[0]!.auth.authorize).not.toHaveBeenCalled();
	});

	it('coalesces concurrent subscribes for the same new event onto one in-flight mint', async () => {
		const realtime = await createTransport();
		realtime.setRoom('event:7');
		await settle();

		let resolveAuthorize!: () => void;
		realtimeInstances[0]!.auth.authorize.mockReset().mockReturnValue(new Promise<void>((resolve) => {
			resolveAuthorize = resolve;
		}));

		const handler = vi.fn();
		realtime.onChannel('screen:9:1', 'screen:command:debug', handler);
		realtime.onChannel('screen:9:2', 'screen:command:debug', handler);
		await settle();

		expect(realtimeInstances[0]!.auth.authorize).toHaveBeenCalledOnce();
		expect(channels.get('screen:9:1')?.subscribe ?? vi.fn()).not.toHaveBeenCalled();

		resolveAuthorize();
		await settle();

		channels.get('screen:9:1')!.emit('screen:command:debug', { screenId: 1 });
		channels.get('screen:9:2')!.emit('screen:command:debug', { screenId: 2 });
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it('does not subscribe to a room until the event token mint resolves, and never for a superseded mint', async () => {
		const realtime = await createTransport();
		const handler = vi.fn();
		realtime.onRoom('player', { 'player:updated': handler });

		const mints: Array<() => void> = [];
		realtimeInstances[0]!.auth.authorize.mockImplementation(
			() => new Promise<void>(resolve => mints.push(resolve)),
		);

		realtime.setRoom('event:1');
		await Promise.resolve();
		await Promise.resolve();

		// Mint for event 1 is still pending — the subscribe must not have run.
		expect(channels.get('event:1')?.subscribe ?? vi.fn()).not.toHaveBeenCalled();

		// A newer event supersedes the pending mint before it lands.
		realtime.setRoom('event:2');
		mints[0]!();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		// The stale mint must never subscribe the old event's room.
		expect(channels.get('event:1')?.subscribe ?? vi.fn()).not.toHaveBeenCalled();

		mints[1]!();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		channels.get('event:2')!.emit('player:updated', { player: { id: 2 } });
		expect(handler).toHaveBeenCalledWith({ player: { id: 2 } }, expect.any(Object));
	});

	it('defers direct channel subscription until its event token is minted', async () => {
		const realtime = await createTransport();
		const handler = vi.fn();

		let resolveMint!: () => void;
		realtimeInstances[0]!.auth.authorize.mockImplementation(
			() => new Promise<void>((resolve) => {
				resolveMint = resolve;
			}),
		);

		realtime.onChannel('screen:1:2', 'screen:command:debug', handler);
		await Promise.resolve();
		await Promise.resolve();

		expect(channels.get('screen:1:2')?.subscribe ?? vi.fn()).not.toHaveBeenCalled();

		resolveMint();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		channels.get('screen:1:2')!.emit('screen:command:debug', { screenId: 2 });
		expect(handler).toHaveBeenCalledOnce();
	});

	/**
	 * One failed token mint used to kill every subscription for the event being
	 * switched to, permanently, with a console warning as the only trace.
	 *
	 * The mechanism was a single line: `activeEventId` was assigned before the
	 * authorize attempt, so after the attempt failed the event *looked* covered.
	 * Every later subscribe took the already-covered fast path and attached on the
	 * old event's token, which Ably denies — and a denied attach is handled by the
	 * same permanent unsubscribe. Nothing retried, nothing told the operator, and
	 * only a full page reload recovered (#307).
	 */
	describe('a token mint that fails during an event switch', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		/** Let the mint's retry timers and the subscribe they gate run to completion. */
		async function settleRetries() {
			await vi.advanceTimersByTimeAsync(30_000);
		}

		it('retries, and the new event\'s subscriptions attach and deliver', async () => {
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			const handler = vi.fn();
			realtimeInstances[0]!.auth.authorize
				.mockRejectedValueOnce(new Error('network blip'))
				.mockResolvedValue(undefined);

			realtime.onChannel('screen:9:1', 'screen:command:debug', handler);
			await settleRetries();

			channels.get('screen:9:1')!.emit('screen:command:debug', { screenId: 1 });
			expect(handler).toHaveBeenCalledOnce();
		});

		it('leaves the event uncovered, so a later subscribe mints again instead of using the old token', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			await settleRetries();
			expect(channels.get('screen:9:1')?.subscribe ?? vi.fn()).not.toHaveBeenCalled();

			realtimeInstances[0]!.auth.authorize.mockReset().mockResolvedValue(undefined);
			const handler = vi.fn();
			realtime.onChannel('screen:9:2', 'screen:command:debug', handler);
			await settleRetries();

			expect(realtimeInstances[0]!.auth.authorize).toHaveBeenCalled();
			channels.get('screen:9:2')!.emit('screen:command:debug', { screenId: 2 });
			expect(handler).toHaveBeenCalledOnce();
			consoleSpy.mockRestore();
		});

		it('reports a persistent failure on the transport, and clears it once a mint lands', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();
			expect(realtime.tokenError).toBeNull();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			await settleRetries();

			// The operator has to be able to see this. A console warning is not a
			// surface anyone running a show is looking at.
			expect(realtime.tokenError).toBeInstanceOf(Error);

			realtimeInstances[0]!.auth.authorize.mockReset().mockResolvedValue(undefined);
			realtime.onChannel('screen:9:2', 'screen:command:debug', vi.fn());
			await settleRetries();

			expect(realtime.tokenError).toBeNull();
			consoleSpy.mockRestore();
		});

		it('drops the fault when the operator goes back to an event this client still covers', async () => {
			// Covered means a token for that event is in hand, so nothing is wrong with
			// this client any more. Left standing, the fault outlives the event it was
			// about and tells an operator their working page is broken.
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			await settleRetries();
			expect(realtime.tokenError).toBeInstanceOf(Error);

			const handler = vi.fn();
			realtime.onChannel('screen:7:1', 'screen:command:debug', handler);
			await settleRetries();

			expect(realtime.tokenError).toBeNull();
			// And it really is covered: the subscription attached without a new mint.
			channels.get('screen:7:1')!.emit('screen:command:debug', { screenId: 1 });
			expect(handler).toHaveBeenCalledOnce();
			consoleSpy.mockRestore();
		});
	});

	it('does not expose authorizeForEvent — token scope is owned by the transport', async () => {
		const realtime = await createTransport();

		expect((realtime as Record<string, unknown>).authorizeForEvent).toBeUndefined();
	});

	it('keeps independent room owners for the same message type', async () => {
		const realtime = await createTransport();
		const firstHandler = vi.fn();
		const secondHandler = vi.fn();

		realtime.setRoom('event:1');
		realtime.onRoom('player', { 'player:updated': firstHandler });
		realtime.onRoom('metagame', { 'player:updated': secondHandler });
		await settle();

		channels.get('event:1')!.emit('player:updated', { player: { id: 1 } });

		expect(firstHandler).toHaveBeenCalledOnce();
		expect(secondHandler).toHaveBeenCalledOnce();
	});

	it('moves room subscriptions when the active room changes', async () => {
		const realtime = await createTransport();
		const handler = vi.fn();

		realtime.onRoom('player', { 'player:updated': handler });
		realtime.setRoom('event:1');
		realtime.setRoom('event:2');
		await settle();

		channels.get('event:1')!.emit('player:updated', { player: { id: 1 } });
		channels.get('event:2')!.emit('player:updated', { player: { id: 2 } });

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith({ player: { id: 2 } }, expect.any(Object));
	});

	it('keeps room handlers registered while no room is active and resubscribes later', async () => {
		const realtime = await createTransport();
		const handler = vi.fn();

		realtime.setRoom('event:1');
		realtime.onRoom('player', { 'player:updated': handler });
		await settle();
		realtime.setRoom(null);
		channels.get('event:1')!.emit('player:updated', { player: { id: 1 } });

		realtime.setRoom('event:2');
		await settle();
		channels.get('event:2')!.emit('player:updated', { player: { id: 2 } });

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith({ player: { id: 2 } }, expect.any(Object));
	});

	it('direct channel subscription returns a working unsubscribe function', async () => {
		const realtime = await createTransport();
		const handler = vi.fn();

		const unsubscribe = realtime.onChannel('screen:1:2', 'screen:command:debug', handler);
		await settle();
		channels.get('screen:1:2')!.emit('screen:command:debug', { screenId: 2 });
		unsubscribe();
		channels.get('screen:1:2')!.emit('screen:command:debug', { screenId: 2 });

		expect(handler).toHaveBeenCalledOnce();
	});

	it('presence methods use arbitrary channel names', async () => {
		const realtime = await createTransport();
		const channel = channels.get('screen:1:2') ?? new MockChannel();
		channels.set('screen:1:2', channel);
		channel.setPresenceMembers([{ clientId: 'a' }, { clientId: 'b' }]);
		const callback = vi.fn();

		await realtime.enterPresence('screen:1:2', { screenId: 2 });
		const unsubscribe = realtime.watchPresence('screen:1:2', callback);
		await realtime.leavePresence('screen:1:2');
		unsubscribe();

		expect(channel.presence.enter).toHaveBeenCalledWith({ screenId: 2 });
		expect(callback).toHaveBeenCalledWith([{ clientId: 'a' }, { clientId: 'b' }]);
		expect(channel.presence.leave).toHaveBeenCalledOnce();
		expect(channel.presence.unsubscribe).toHaveBeenCalledTimes(3);
	});

	it('keeps presence subscriptions synchronous while cleaning up attach failures', async () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const channel = new MockChannel();
		channels.set('screen:1:2', channel);
		channel.setPresenceSubscribeResult(Promise.reject(new Error('presence attach failed')));
		const realtime = await createTransport();

		const unsubscribe = realtime.watchPresence('screen:1:2', vi.fn());
		expect(unsubscribe).toEqual(expect.any(Function));

		await settle();

		expect(channel.presence.unsubscribe).toHaveBeenCalledWith('enter', expect.any(Function));
		expect(channel.presence.unsubscribe).toHaveBeenCalledWith('leave', expect.any(Function));
		expect(channel.presence.unsubscribe).toHaveBeenCalledWith('update', expect.any(Function));
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Failed to subscribe to presence enter on screen:1:2'),
			expect.any(Error),
		);

		consoleSpy.mockRestore();
	});
});

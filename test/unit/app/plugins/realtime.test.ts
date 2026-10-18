import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MessageHandler = (message: { data: unknown }) => void;
type PresenceHandler = () => void;

class MockChannel {
	publish = vi.fn().mockResolvedValue(undefined);
	detach = vi.fn();
	/** Only `failed` changes anything here: ably@2.29 refuses a subscribe on a failed channel until it is attached again. */
	state = 'initialized';
	attach = vi.fn(async () => {
		this.state = 'attached';
	});

	/** Arrays, as Ably's emitter keeps them: a listener added twice is called twice. */
	private handlers = new Map<string, MessageHandler[]>();
	private presenceHandlers = new Map<string, PresenceHandler[]>();
	private presenceMembers: unknown[] = [];
	private subscribeResult: Promise<unknown> | undefined;
	private presenceSubscribeResult: Promise<unknown> | undefined;

	presence = {
		enter: vi.fn().mockResolvedValue(undefined),
		leave: vi.fn().mockResolvedValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		get: vi.fn(async () => this.presenceMembers),
		subscribe: vi.fn((event: string, handler: PresenceHandler) => {
			if (this.state === 'failed')
				return Promise.reject(new Error('channel failed'));
			this.presenceHandlers.set(event, [...(this.presenceHandlers.get(event) ?? []), handler]);
			return this.presenceSubscribeResult;
		}),
		unsubscribe: vi.fn((event: string, handler: PresenceHandler) => {
			this.presenceHandlers.set(event, (this.presenceHandlers.get(event) ?? []).filter(each => each !== handler));
		}),
	};

	subscribe = vi.fn((messageType: string, handler: MessageHandler) => {
		if (this.state === 'failed')
			return Promise.reject(new Error('channel failed'));
		this.handlers.set(messageType, [...(this.handlers.get(messageType) ?? []), handler]);
		return this.subscribeResult;
	});

	unsubscribe = vi.fn((messageType: string, handler: MessageHandler) => {
		this.handlers.set(messageType, (this.handlers.get(messageType) ?? []).filter(each => each !== handler));
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

	/**
	 * What the next subscribe settles with. A refusal set here may wait a whole
	 * recovery delay before an attach awaits it, so it is marked handled up front.
	 */
	setSubscribeResult(result: Promise<unknown>) {
		result.catch(() => {});
		this.subscribeResult = result;
	}

	setPresenceSubscribeResult(result: Promise<unknown>) {
		result.catch(() => {});
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

/**
 * Let a mint's retry timers and the subscribes they gate run to completion: long
 * past the quick retries (250 + 1,000 + 3,000 + 4,000 ms). Fake timers only.
 */
async function settleRetries() {
	await vi.advanceTimersByTimeAsync(30_000);
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

	it('does not connect at setup — the first connect belongs to the first Event\'s mint (#474)', async () => {
		// An eager connect with no Event in hand parks the authCallback, and Ably
		// times a parked token request out (10s) into a disconnected/retry cycle:
		// console spam and a fault indicator on pages with nothing to connect to.
		await createTransport();

		expect((realtimeInstances[0]!.options as { autoConnect?: boolean }).autoConnect).toBe(false);
		expect(mockConnection.connect).not.toHaveBeenCalled();
	});

	it('updates exposed connection state from Ably events', async () => {
		const realtime = await createTransport();

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

	it('reflects closed and closing transitions, which the resync layer reads as disconnections', async () => {
		// useReconnectResync counts `closed` among the out-of-touch states, but the
		// plugin never published it: a connection Ably closed kept reporting whatever
		// state it last passed through, and no surface could see it had gone.
		const realtime = await createTransport();
		connectionHandlers.get('connected')?.();
		expect(realtime.isConnected).toBe(true);

		connectionHandlers.get('closing')?.();
		expect(realtime.connectionState).toBe('closing');
		expect(realtime.isConnected).toBe(false);

		connectionHandlers.get('closed')?.();
		expect(realtime.connectionState).toBe('closed');
		expect(realtime.isConnected).toBe(false);
		expect(realtime.error).toBeNull();
	});

	it('fails the auth callback rather than parking it when no Event is active', async () => {
		// Parking is what #474 diagnosed: Ably times a parked token request out
		// (10s) into a disconnected/retry cycle. With connect deferred until an
		// Event is known this callback cannot fire event-less — but if a stray
		// connect ever reaches it, a fast failure beats a silent timeout loop.
		await createTransport();
		const callback = vi.fn();

		await (realtimeInstances[0]!.options as any).authCallback({}, callback);

		expect($fetch).not.toHaveBeenCalled();
		expect(callback).toHaveBeenCalledWith(expect.stringContaining('no active Event'), null);
	});

	it('mints the first token through authorize, which also makes the first connection', async () => {
		// One mint path for first connection and event switch alike: with
		// autoConnect off, `authorize()` initiates the connection itself from
		// `initialized` (RTC8c; verified against ably@2.27.0 on #474).
		const realtime = await createTransport();

		realtime.setRoom('event:7');
		await settle();

		expect(realtimeInstances[0]!.auth.authorize).toHaveBeenCalledOnce();
	});

	it('scopes the token to the Event of the room being minted for', async () => {
		// Typed against the plain signature rather than the route table: matching a
		// resolved value against `$fetch`'s route-conditional return type exhausts
		// the type comparison depth limit.
		vi.mocked($fetch as unknown as (path: string) => Promise<unknown>)
			.mockResolvedValueOnce({ token: 'token-request' });
		const realtime = await createTransport();
		realtime.setRoom('event:7');
		const callback = vi.fn();

		await (realtimeInstances[0]!.options as any).authCallback({}, callback);

		expect($fetch).toHaveBeenCalledWith('/api/realtime/token', {
			query: { eventId: 7 },
			// No fragment on an operator's page, so no bearer to present: the session
			// cookie rides along and the token route reads that arm instead (#397).
			headers: undefined,
		});
		expect(callback).toHaveBeenCalledWith(null, { token: 'token-request' });
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

		realtime.setRoom('event:7');
		await (realtimeInstances[0]!.options as any).authCallback({}, callback);

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

		realtime.setRoom('event:7');
		await (realtimeInstances[0]!.options as any).authCallback({}, callback);

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
			const unsubscribeEvent9 = realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			await settleRetries();
			expect(realtime.tokenError).toBeInstanceOf(Error);

			// Going back unmounts what the operator had open on Event 9.
			unsubscribeEvent9();
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

	/**
	 * The first connection's half of the "coverage only on success" contract.
	 *
	 * Since #474 the first mint runs through the same authorize() path as an
	 * event switch (autoConnect off; the mint makes the first connection), so
	 * one mechanism holds the contract — this pins that the very first Event
	 * gets it too: tokenError published, nothing subscribed, next subscribe
	 * mints again and recovers.
	 */
	describe('the first mint after connection', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('publishes tokenError when the very first mint keeps failing, and the next subscribe recovers', async () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const realtime = await createTransport();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.setRoom('event:7');
			realtime.onChannel('screen:7:1', 'screen:command:debug', vi.fn());
			await settleRetries();

			expect(channels.get('screen:7:1')?.subscribe ?? vi.fn()).not.toHaveBeenCalled();
			expect(realtime.tokenError).toBeInstanceOf(Error);

			// Uncovered means the next subscribe mints again — and recovers.
			realtimeInstances[0]!.auth.authorize.mockReset().mockResolvedValue(undefined);
			const handler = vi.fn();
			realtime.onChannel('screen:7:2', 'screen:command:debug', handler);
			await settleRetries();

			expect(realtimeInstances[0]!.auth.authorize).toHaveBeenCalled();
			expect(realtime.tokenError).toBeNull();
			channels.get('screen:7:2')!.emit('screen:command:debug', { screenId: 2 });
			expect(handler).toHaveBeenCalledOnce();
			consoleSpy.mockRestore();
		});
	});

	/**
	 * A Realtime Subscription outlives a token outage (#609).
	 *
	 * #307 made a failed mint retry and report; it still answered exhaustion by
	 * unsubscribing every subscription that had been waiting on the mint. Coverage
	 * could come back later — a fresh subscribe cleared the fault — but the room and
	 * Screen handlers the page had registered were gone, and with no fresh subscribe
	 * nothing even tried again. Only a remount recovered.
	 */
	describe('a token outage that outlasts the mint\'s retries', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.spyOn(console, 'warn').mockImplementation(() => {});
		});

		afterEach(() => {
			vi.mocked(console.warn).mockRestore();
			vi.useRealTimers();
		});

		it('reattaches the original room handlers once the token service is back, with nothing re-registered', async () => {
			const realtime = await createTransport();
			const handler = vi.fn();
			realtime.onRoom('player', { 'player:updated': handler });
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.setRoom('event:9');
			await settleRetries();
			expect(realtime.tokenError).toBeInstanceOf(Error);

			realtimeInstances[0]!.auth.authorize.mockReset().mockResolvedValue(undefined);
			await settleRetries();

			expect(realtime.tokenError).toBeNull();
			channels.get('event:9')!.emit('player:updated', { player: { id: 9 } });
			expect(handler).toHaveBeenCalledOnce();
			expect(handler).toHaveBeenCalledWith({ player: { id: 9 } }, expect.any(Object));
		});

		it('reaches the original room handlers in the reported sequence: restore, then a new Screen subscription', async () => {
			// Review F07 step for step. The new subscription is what used to clear the
			// fault while the room handlers stayed gone.
			const realtime = await createTransport();
			const handler = vi.fn();
			realtime.onRoom('player', { 'player:updated': handler });
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.setRoom('event:9');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockReset().mockResolvedValue(undefined);
			realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			await settleRetries();

			expect(realtime.tokenError).toBeNull();
			channels.get('event:9')!.emit('player:updated', { player: { id: 9 } });
			expect(handler).toHaveBeenCalledOnce();
		});

		it('reattaches the original Screen command and presence handlers too', async () => {
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			const commandHandler = vi.fn();
			const presenceCallback = vi.fn();
			realtime.setRoom('event:9');
			realtime.onChannel('screen:9:1', 'screen:command:debug', commandHandler);
			realtime.watchPresence('screen:9:1', presenceCallback);
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockReset().mockResolvedValue(undefined);
			await settleRetries();

			const channel = channels.get('screen:9:1')!;
			channel.emit('screen:command:debug', { screenId: 1 });
			expect(commandHandler).toHaveBeenCalledOnce();

			presenceCallback.mockClear();
			channel.setPresenceMembers([{ data: { screenId: 1 } }]);
			channel.emitPresence('enter');
			await vi.advanceTimersByTimeAsync(0);
			expect(presenceCallback).toHaveBeenCalledWith([{ data: { screenId: 1 } }]);
		});

		it('keeps the fault standing through failed re-attempts, even beside an Event still covered', async () => {
			// The fault is about the subscriptions still waiting. A subscribe that works
			// on the Event the token does cover says nothing about them.
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			await settleRetries();
			realtime.onChannel('screen:7:1', 'screen:command:debug', vi.fn());
			await vi.advanceTimersByTimeAsync(5 * 60_000);

			expect(realtime.tokenError).toBeInstanceOf(Error);
		});

		it('stops re-attempting, and drops the fault, once everything that waited is disposed', async () => {
			const realtime = await createTransport();
			realtime.onRoom('player', { 'player:updated': vi.fn() });
			realtime.setRoom('event:7');
			await settleRetries();

			const authorize = realtimeInstances[0]!.auth.authorize;
			authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.setRoom('event:9');
			const unsubscribe = realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			await settleRetries();
			expect(realtime.tokenError).toBeInstanceOf(Error);

			realtime.offRoom('player');
			realtime.setRoom(null);
			unsubscribe();
			// At once, not when the backed-off wait would have ended.
			await vi.advanceTimersByTimeAsync(0);
			expect(realtime.tokenError).toBeNull();

			const attemptsAtDisposal = authorize.mock.calls.length;
			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(authorize).toHaveBeenCalledTimes(attemptsAtDisposal);
		});

		it('keeps the fault standing until what waited has attached, retrying a refused attach on its own', async () => {
			// A token in hand is not yet a show receiving. Until the subscriptions the
			// outage held have attached, the fault is still the truth about this client
			// — and with the connection up throughout, no reconnect will retry them.
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			const channel = new MockChannel();
			channels.set('screen:9:1', channel);
			const handler = vi.fn();
			realtime.onChannel('screen:9:1', 'screen:command:debug', handler);
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockReset().mockResolvedValue(undefined);
			channel.setSubscribeResult(Promise.reject(new Error('attach refused')));
			await settleRetries();
			expect(realtime.tokenError).toBeInstanceOf(Error);

			channel.setSubscribeResult(Promise.resolve());
			await vi.advanceTimersByTimeAsync(60_000);

			expect(realtime.tokenError).toBeNull();
			channel.emit('screen:command:debug', { screenId: 1 });
			expect(handler).toHaveBeenCalledOnce();
		});

		it('holds a Screen Output\'s presence entry through the outage and enters it once a mint lands', async () => {
			// A Screen Output enters presence on load and only then stops loading, so the
			// entry must not wait out the outage — but control surfaces count outputs by
			// presence, and one that never re-enters is one they report missing.
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			await settleRetries();

			// Asked mid-recovery, it answers at once rather than on the next attempt.
			const entered = vi.fn();
			void realtime.enterPresence('screen:9:1', { screenId: 1, cardData: 'complete' }).then(entered);
			await vi.advanceTimersByTimeAsync(0);
			expect(entered).toHaveBeenCalled();
			await realtime.updatePresence('screen:9:1', { screenId: 1, cardData: 'degraded' });
			const channel = channels.get('screen:9:1')!;
			expect(channel.presence.enter).not.toHaveBeenCalled();
			expect(channel.presence.update).not.toHaveBeenCalled();

			realtimeInstances[0]!.auth.authorize.mockReset().mockResolvedValue(undefined);
			await vi.advanceTimersByTimeAsync(60_000);

			expect(channel.presence.enter).toHaveBeenCalledOnce();
			expect(channel.presence.enter).toHaveBeenCalledWith({ screenId: 1, cardData: 'degraded' });
		});

		it('never enters a held presence entry its output has already left', async () => {
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			const entering = realtime.enterPresence('screen:9:1', { screenId: 1 });
			await settleRetries();
			await entering;
			await realtime.leavePresence('screen:9:1');

			realtimeInstances[0]!.auth.authorize.mockReset().mockResolvedValue(undefined);
			await vi.advanceTimersByTimeAsync(60_000);

			const channel = channels.get('screen:9:1')!;
			expect(channel.presence.enter).not.toHaveBeenCalled();
			expect(channel.presence.leave).not.toHaveBeenCalled();
		});

		it('keeps the listener through a refused attach, for the channel Ably re-attaches by itself', async () => {
			// A channel whose attach timed out is suspended, and Ably re-attaches a
			// suspended channel on its own timer, connected or not. Whatever listens
			// then is what hears the Event, so the listener has to still be there.
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			const channel = new MockChannel();
			channels.set('screen:7:1', channel);
			channel.setSubscribeResult(Promise.reject(new Error('attach timed out')));
			const handler = vi.fn();
			realtime.onChannel('screen:7:1', 'screen:command:debug', handler);
			await vi.advanceTimersByTimeAsync(0);

			channel.emit('screen:command:debug', { screenId: 1 });
			expect(handler).toHaveBeenCalledOnce();
		});

		it('retries a refused attach on a covered Event while the connection stays up', async () => {
			// Nothing reconnects, so no reconnect can be what retries it — and a failed
			// channel keeps no listener for Ably to deliver to by itself.
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			const channel = new MockChannel();
			channels.set('screen:7:1', channel);
			channel.state = 'failed';
			channel.attach.mockRejectedValueOnce(new Error('attach refused'));
			const handler = vi.fn();
			realtime.onChannel('screen:7:1', 'screen:command:debug', handler);
			await settleRetries();

			channel.emit('screen:command:debug', { screenId: 1 });
			expect(handler).toHaveBeenCalledOnce();
		});

		it('re-attaches a refused subscription once the connection is back, delivering once', async () => {
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			const channel = new MockChannel();
			channels.set('screen:7:1', channel);
			channel.setSubscribeResult(Promise.reject(new Error('attach timed out')));
			const handler = vi.fn();
			realtime.onChannel('screen:7:1', 'screen:command:debug', handler);
			await vi.advanceTimersByTimeAsync(0);

			channel.setSubscribeResult(Promise.resolve());
			connectionHandlers.get('connected')?.();
			await vi.advanceTimersByTimeAsync(0);

			channel.emit('screen:command:debug', { screenId: 1 });
			expect(handler).toHaveBeenCalledOnce();
		});

		it('attaches a failed channel again before re-subscribing, since Ably will not subscribe on one', async () => {
			// ably@2.29: from `failed` only an explicit attach recovers a channel, and
			// a subscribe there is refused before its listener is even added.
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			const channel = new MockChannel();
			channels.set('screen:7:1', channel);
			channel.state = 'failed';
			const handler = vi.fn();
			realtime.onChannel('screen:7:1', 'screen:command:debug', handler);
			await vi.advanceTimersByTimeAsync(0);

			connectionHandlers.get('connected')?.();
			await vi.advanceTimersByTimeAsync(0);

			expect(channel.attach).toHaveBeenCalled();
			channel.emit('screen:command:debug', { screenId: 1 });
			expect(handler).toHaveBeenCalledOnce();
		});

		it('points Ably\'s own token renewals back at the covered Event once a recovery stops', async () => {
			// Ably re-mints by itself on reconnect and before expiry, for whichever
			// Event the transport last asked about. Left on the abandoned one, that
			// renewal would trade the working token for one that cannot be minted.
			vi.mocked($fetch as unknown as (path: string) => Promise<unknown>).mockResolvedValue({ token: 'token-request' });
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			realtimeInstances[0]!.auth.authorize.mockRejectedValue(new Error('token endpoint down'));
			const unsubscribe = realtime.onChannel('screen:9:1', 'screen:command:debug', vi.fn());
			await settleRetries();
			unsubscribe();
			await vi.advanceTimersByTimeAsync(0);

			await (realtimeInstances[0]!.options as any).authCallback({}, vi.fn());
			expect($fetch).toHaveBeenLastCalledWith('/api/realtime/token', expect.objectContaining({ query: { eventId: 7 } }));
		});

		it('backs off to one attempt every 30 seconds for as long as the outage lasts', async () => {
			const realtime = await createTransport();
			realtime.setRoom('event:7');
			await settleRetries();

			const authorize = realtimeInstances[0]!.auth.authorize;
			authorize.mockRejectedValue(new Error('token endpoint down'));
			realtime.setRoom('event:9');
			await vi.advanceTimersByTimeAsync(60 * 60_000);
			authorize.mockClear();

			await vi.advanceTimersByTimeAsync(5 * 60_000);

			expect(authorize).toHaveBeenCalledTimes(10);
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

	it('keeps channel subscriptions to the same channel and type independent', async () => {
		// Not replacement semantics: onChannel hands each caller its own unsubscribe,
		// and a second subscription to the same channel+type must not evict the
		// first. The old bookkeeping *read* as replacement — a "unsubscribe
		// previous" lookup keyed by a fresh counter — and could never fire (#466).
		const realtime = await createTransport();
		const firstHandler = vi.fn();
		const secondHandler = vi.fn();

		const unsubscribeFirst = realtime.onChannel('screen:1:2', 'screen:command:debug', firstHandler);
		realtime.onChannel('screen:1:2', 'screen:command:debug', secondHandler);
		await settle();

		channels.get('screen:1:2')!.emit('screen:command:debug', { screenId: 2 });
		expect(firstHandler).toHaveBeenCalledOnce();
		expect(secondHandler).toHaveBeenCalledOnce();

		unsubscribeFirst();
		channels.get('screen:1:2')!.emit('screen:command:debug', { screenId: 2 });
		expect(firstHandler).toHaveBeenCalledOnce();
		expect(secondHandler).toHaveBeenCalledTimes(2);
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

	it('updates presence only on a channel this client already holds', async () => {
		const realtime = await createTransport();
		const channel = new MockChannel();
		channels.set('screen:1:2', channel);

		// Never entered anywhere: an update must not create the channel and enter it.
		await realtime.updatePresence('screen:9:9', { cardData: 'degraded' });
		expect(channels.has('screen:9:9')).toBe(false);

		await realtime.enterPresence('screen:1:2', { screenId: 2, cardData: 'complete' });
		await realtime.updatePresence('screen:1:2', { screenId: 2, cardData: 'degraded' });

		expect(channel.presence.update).toHaveBeenCalledWith({ screenId: 2, cardData: 'degraded' });
	});

	it('keeps presence subscriptions synchronous and desired through attach failures', async () => {
		// A refused attach no longer ends the watch (#609): only its consumer does.
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const channel = new MockChannel();
		channels.set('screen:1:2', channel);
		channel.setPresenceSubscribeResult(Promise.reject(new Error('presence attach failed')));
		const realtime = await createTransport();

		const unsubscribe = realtime.watchPresence('screen:1:2', vi.fn());
		expect(unsubscribe).toEqual(expect.any(Function));

		await settle();

		expect(channel.presence.unsubscribe).not.toHaveBeenCalled();
		unsubscribe();
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

import type { MessageType } from '~~/shared/types/messages';
import type {
	RealtimeConnectionState,
	RealtimeHandler,
	RealtimePresenceCallback,
	RealtimePresenceData,
	RealtimePresenceMessage,
	RealtimeRoomHandlers,
} from '~/types/realtime';
import Ably from 'ably';
import { realtimeChannelEventId } from '~~/shared/utils/realtimeChannels';
import {
	screenOutputAssetCapabilityFromHash,
	screenOutputCapabilityHeaders,
} from '~~/shared/utils/screenOutput';
import { createGuardedSequence } from '~/utils/guardedSequence';

type Unsubscribe = () => void;

export default defineNuxtPlugin({
	name: 'realtime',
	setup() {
		/**
		 * No `clientId` of our own any more (#397).
		 *
		 * It used to be `client-<uuid>` here, permitted by a token granting
		 * `clientId: '*'` — a wildcard that let the holder claim any identity on the
		 * channels it was granted. ADR-0010 pins the identity in the token instead: a
		 * signed-in operator connects as their userId, a Screen Output as
		 * `screen-output:<screenId>`. Ably refuses a connection whose declared
		 * `clientId` conflicts with its token's, so declaring one here would break
		 * every connection rather than merely duplicate the value.
		 *
		 * Nothing depended on the old one. It was written at construction and read
		 * nowhere else, and no presence consumer reads `member.clientId` — they read
		 * `member.data`. Two outputs of one Screen
		 * still appear as two presence members, because presence is per connection
		 * rather than per identity.
		 */

		// The token is scoped to a single event's channels (see
		// server/api/realtime/token.get.ts), so the auth flow needs to know
		// which event is active before it can request one. `activeEventId` is
		// read fresh on every auth attempt. Until an event is chosen (e.g. on
		// the event-less index page) the client does not connect at all — an
		// authCallback that parks instead is timed out by Ably after 10s
		// (realtimeRequestTimeout) into a disconnected/retry cycle: console
		// errors every ~25s and a fault on the status indicator, on a page
		// with nothing to connect to (#474).
		let activeEventId: number | null = null;
		/**
		 * The Event the token in hand actually covers.
		 *
		 * Held apart from `activeEventId`, which is only the Event the next mint will
		 * ask for. Conflating the two is what made a single transient authorize failure
		 * permanent: the assignment happened before the attempt, so a failed switch left
		 * the new Event looking covered, every later subscribe took the already-covered
		 * fast path and attached on the previous Event's token, and Ably denied each one
		 * into the same permanent unsubscribe. Nothing short of a page reload recovered
		 * (#307).
		 */
		let coveredEventId: number | null = null;
		let pendingAuthorize: { eventId: number; verdict: Promise<boolean> } | null = null;

		const ably = new Ably.Realtime({
			// The first connect is `recoverEvent`'s: `auth.authorize()` initiates
			// the connection itself from the `initialized` state (RTC8c; verified
			// against ably@2.27.0 on #474), so every connection attempt — first,
			// reconnect, event switch — starts with an Event in hand and the
			// authCallback never runs without one.
			autoConnect: false,
			authCallback: async (_tokenParams, callback) => {
				try {
					const eventId = activeEventId;
					if (eventId == null) {
						// Unreachable while the only connect path is a coverage mint,
						// which sets `activeEventId` first. Failing fast keeps a future
						// stray connect from re-creating #474's parked-callback timeout.
						throw new Error('Realtime token requested with no active Event');
					}
					// Whichever credential this document has. A Screen Output holds its
					// capability in the URL fragment and has no session; an operator's
					// page has the session cookie and no fragment. The token route reads
					// both and issues the grant that belongs to the one presented
					// (#397) — read fresh per attempt, because a token is re-minted on
					// reconnect and on every Event switch.
					const tokenRequest = await $fetch('/api/realtime/token', {
						query: { eventId },
						headers: screenOutputCapabilityHeaders(
							screenOutputAssetCapabilityFromHash(window.location.hash),
						),
					});
					callback(null, tokenRequest);
				}
				catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					callback(message, null);
				}
			},
		});

		const coverageFlights = createGuardedSequence();

		/**
		 * How long to wait before each re-attempt at minting a token.
		 *
		 * Short enough that the ordinary cause — a few hundred milliseconds of network
		 * loss while an operator switches Events mid-show — is absorbed before anyone
		 * notices, and finite because a mint that has failed for eight seconds is not a
		 * blip and the operator needs telling rather than waiting.
		 */
		const AUTHORIZE_RETRY_DELAYS_MS = [250, 1_000, 3_000, 4_000];

		/**
		 * How long to wait before each re-attempt once the failure has been reported.
		 *
		 * The outage is no longer a blip, so the attempts back off, and the last delay
		 * repeats for as long as a Realtime Subscription still waits on the Event: a
		 * token service that comes back after an hour must still find the page's
		 * handlers waiting, without anyone remounting it (#609, ADR-0023).
		 */
		const RECOVERY_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000];

		const tokenError = ref<Error | null>(null);

		function toError(err: unknown) {
			return err instanceof Error ? err : new Error(String(err));
		}

		/**
		 * A Realtime Subscription not yet attached to its channel.
		 *
		 * It waits here for a token covering its Event, or after its channel refused an
		 * attach, and leaves only by attaching or by its consumer disposing it. A failure
		 * is never a reason to forget one: a forgotten subscription is a handler a page
		 * still believes is listening (#609). `attach` resolves to why the channel
		 * refused, or to `null` once nothing is left to attach.
		 */
		interface PendingSubscription {
			readonly eventId: number | null;
			attach: () => Promise<Error | null>;
		}

		const pendingSubscriptions = new Set<PendingSubscription>();

		/** Attach whatever is pending on the matching Events: the first refusal, or `null` once all attached. */
		async function attachPending(predicate: (eventId: number | null) => boolean) {
			const refusals = await Promise.all(
				[...pendingSubscriptions]
					.filter(subscription => predicate(subscription.eventId))
					.map(subscription => subscription.attach()),
			);
			return refusals.find(refusal => refusal !== null) ?? null;
		}

		/**
		 * The one place coverage is ever claimed — the "only on success" contract
		 * this file exists to hold (#307, #466). Every path that reaches it has a
		 * token for the Event actually in hand.
		 */
		function claimCoverage(eventId: number) {
			coveredEventId = eventId;
		}

		function wait(ms: number) {
			return new Promise<void>(resolve => setTimeout(resolve, ms));
		}

		/** Ends the recovery wait in progress early. Only `supersedeMint` and `stopRecoveryIfUnwanted` call it. */
		let cancelRecoveryWait: (() => void) | null = null;

		function recoveryWait(ms: number) {
			return new Promise<void>((resolve) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const finish = () => {
					clearTimeout(timer);
					if (cancelRecoveryWait === finish)
						cancelRecoveryWait = null;
					resolve();
				};
				timer = setTimeout(finish, ms);
				cancelRecoveryWait = finish;
			});
		}

		/**
		 * Supersede the mint in flight, ending a recovery wait it is in now rather than
		 * when it would have woken to find itself stale.
		 */
		function supersedeMint() {
			coverageFlights.supersede();
			cancelRecoveryWait?.();
		}

		/**
		 * Bring one Event's Realtime Subscriptions up: mint a token covering it unless
		 * one is in hand, then attach everything waiting on it — re-attempting either
		 * for as long as something still waits.
		 *
		 * Coverage is claimed only on success, and the failure is published rather than
		 * only logged once the quick retries are spent: a client that cannot receive
		 * for the Event an operator is running has no realtime, and the console is not
		 * a surface anyone running a show is looking at. The fault then stands until
		 * everything waiting has attached, or the last of it is disposed.
		 *
		 * `giveVerdict` answers whoever cannot wait out an outage: `true` when the token
		 * lands, `false` when the fault is published. The subscriptions wait past it.
		 */
		async function recoverEvent(
			eventId: number,
			flight: { readonly stale: boolean; readonly current: boolean },
			giveVerdict: (covered: boolean) => void,
		) {
			// A recovery that stops without landing hands Ably's own re-mints (on
			// reconnect, before expiry) back to the Event the token in hand covers. Left
			// on this one, they would trade a working token for one that cannot be minted.
			const stop = () => {
				if (flight.current && coveredEventId != null)
					activeEventId = coveredEventId;
				return false;
			};

			const attempt = async () => {
				if (coveredEventId !== eventId) {
					await ably.auth.authorize();
					if (flight.stale)
						return null;
					claimCoverage(eventId);
					giveVerdict(true);
				}
				return attachPending(pendingEventId => pendingEventId === eventId);
			};

			for (let attemptIndex = 0; ; attemptIndex++) {
				let failure: Error | null;
				try {
					failure = await attempt();
				}
				catch (err) {
					failure = toError(err);
				}
				if (flight.stale)
					return false;
				if (failure === null) {
					tokenError.value = null;
					return true;
				}

				const quickDelay = AUTHORIZE_RETRY_DELAYS_MS[attemptIndex];
				if (quickDelay !== undefined) {
					await wait(quickDelay);
					if (flight.stale)
						return false;
					continue;
				}

				if (attemptIndex === AUTHORIZE_RETRY_DELAYS_MS.length) {
					if (coveredEventId !== eventId)
						console.warn('Failed to authorize realtime token for event switch:', failure);
					tokenError.value = failure;
					giveVerdict(false);
					// Nothing desired waits — the mint was for an action, which has its answer now.
					if (!awaitsRecovery(eventId))
						return stop();
				}

				const backedOff = attemptIndex - AUTHORIZE_RETRY_DELAYS_MS.length;
				await recoveryWait(RECOVERY_RETRY_DELAYS_MS[Math.min(backedOff, RECOVERY_RETRY_DELAYS_MS.length - 1)]!);
				if (flight.stale)
					return false;
				if (!awaitsRecovery(eventId)) {
					// Everything that waited on this Event was disposed, so nothing is
					// failing for anyone any more.
					tokenError.value = null;
					return stop();
				}
			}
		}

		/** Stop the recovery in progress if nothing desired waits on its Event any more. */
		function stopRecoveryIfUnwanted() {
			if (pendingAuthorize && !awaitsRecovery(pendingAuthorize.eventId))
				cancelRecoveryWait?.();
		}

		function beginRecovery(eventId: number): Promise<boolean> {
			activeEventId = eventId;
			supersedeMint();
			const flight = coverageFlights.begin();
			// One mint path for first connection, event switch, and recovery alike:
			// authorize() connects a not-yet-connected client as part of the mint,
			// so a first-connection blip heals the same way an event-switch blip does.
			let giveVerdict!: (covered: boolean) => void;
			const verdict = new Promise<boolean>((resolve) => {
				giveVerdict = resolve;
			});
			const pending = { eventId, verdict };
			pendingAuthorize = pending;
			void recoverEvent(eventId, flight, giveVerdict)
				.then(giveVerdict, () => giveVerdict(false))
				.finally(() => {
					if (pendingAuthorize === pending)
						pendingAuthorize = null;
				});
			return verdict;
		}

		/**
		 * Ensure the token covers the given channel's Event before subscribing.
		 * Returns `true` synchronously when already covered (so established
		 * subscriptions stay synchronous), or the mint's verdict: `true` once it
		 * lands, `false` once it is superseded or its quick retries are spent. A
		 * Realtime Subscription ignores the verdict and waits to be attached by the
		 * recovery, however long the outage. Channels that carry no Event
		 * (unrecognized shapes) need no scoping and pass through.
		 *
		 * A recovery something still waits on keeps re-attempting past its verdict,
		 * so a later subscribe for the same Event joins it. An Event whose recovery
		 * did stop is deliberately not remembered as attempted: the next subscribe
		 * mints again, which is why a failure can no longer outlive the condition
		 * that caused it.
		 */
		function ensureChannelCoverage(channelName: string): true | Promise<boolean> {
			const eventId = realtimeChannelEventId(channelName);
			if (eventId == null)
				return true;

			if (eventId === coveredEventId) {
				// Covered means a token for this Event is in hand, so whatever failed to
				// mint for the Event the operator tried in between is no longer a fact
				// about them. Without this, switching away and back leaves a fault
				// standing on a client that is working perfectly. Not while a recovery is
				// still running, though: something is still waiting on it, and the fault
				// is about that.
				if (!pendingAuthorize)
					tokenError.value = null;
				return true;
			}

			// A mint for this same Event may still be in flight; wait on it instead of
			// subscribing before the token upgrade actually lands.
			if (pendingAuthorize?.eventId === eventId)
				return pendingAuthorize.verdict;

			return beginRecovery(eventId);
		}

		let connectionSnapshot: RealtimeConnectionState = {
			isConnected: false,
			connectionState: 'initialized',
			error: null,
		};

		const connectionState = ref<RealtimeConnectionState>(connectionSnapshot);
		const channels = new Map<string, Ably.RealtimeChannel>();
		const roomHandlers = new Map<string, Map<string, RealtimeHandler<any>>>();
		const roomSubscriptions = new Map<string, Unsubscribe>();
		const channelSubscriptions = new Map<string, Unsubscribe>();
		const presenceSubscriptions = new Map<string, Unsubscribe>();

		/** A presence entry this client wants on a channel, whether entered yet or held. */
		interface PresenceEntry {
			data: RealtimePresenceData;
			entered: boolean;
			dispose: Unsubscribe;
		}

		const presenceEntries = new Map<string, PresenceEntry>();

		let currentRoom: string | null = null;
		let channelSubscriptionId = 0;
		let presenceSubscriptionId = 0;

		/**
		 * Whether anything still waits on this Event's recovery: the room until a token
		 * covers it, or a Realtime Subscription not yet attached.
		 */
		function awaitsRecovery(eventId: number) {
			if (eventId !== coveredEventId && currentRoom != null && realtimeChannelEventId(currentRoom) === eventId)
				return true;
			for (const subscription of pendingSubscriptions) {
				if (subscription.eventId === eventId)
					return true;
			}
			return false;
		}

		/**
		 * Whether each channel's message continuity has held since this client first
		 * asked for it: `unstarted` until its first attach, `held` once attached, and
		 * `lost` for one the connection dropped before it ever attached.
		 */
		const continuity = new Map<string, 'unstarted' | 'held' | 'lost'>();
		const continuityLostHandlers = new Map<string, Set<() => void>>();

		/**
		 * Ably reports an attach that did not resume continuity as `attached` from any
		 * other state, or as `update` on a channel still attached (RTL12). Either way,
		 * whatever was published since continuity broke was never delivered, and only
		 * now is anything listening for what comes next. A first attach on an unbroken
		 * connection missed nothing anyone had yet.
		 */
		function watchContinuity(channelName: string, channel: Ably.RealtimeChannel) {
			continuity.set(channelName, 'unstarted');
			const onAttached = (stateChange: Ably.ChannelStateChange) => {
				const before = continuity.get(channelName);
				continuity.set(channelName, 'held');
				if (stateChange.resumed || before === 'unstarted')
					return;
				for (const handler of [...continuityLostHandlers.get(channelName) ?? []])
					handler();
			};
			channel.on('attached', onAttached);
			channel.on('update', onAttached);
		}

		function getChannel(channelName: string): Ably.RealtimeChannel {
			if (!channels.has(channelName)) {
				const channel = ably.channels.get(channelName);
				watchContinuity(channelName, channel);
				channels.set(channelName, channel);
			}
			return channels.get(channelName)!;
		}

		/** Call `handler` each time `channelName` is attached again after losing message continuity. */
		function onContinuityLost(channelName: string, handler: () => void): Unsubscribe {
			getChannel(channelName);
			if (!continuityLostHandlers.has(channelName))
				continuityLostHandlers.set(channelName, new Set());
			const handlers = continuityLostHandlers.get(channelName)!;
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		}

		function updateConnectionState(state: Ably.ConnectionState, err?: Error | null) {
			// A channel not yet attached when the link dropped has missed whatever was
			// published meanwhile, so its first attach is a loss like any other.
			if (state === 'disconnected' || state === 'suspended' || state === 'failed') {
				for (const [channelName, held] of continuity) {
					if (held === 'unstarted')
						continuity.set(channelName, 'lost');
				}
			}
			connectionSnapshot = {
				isConnected: state === 'connected',
				connectionState: state,
				error: err ?? null,
			};
			connectionState.value = connectionSnapshot;
		}

		ably.connection.on('disconnected', (stateChange) => {
			updateConnectionState('disconnected', new Error(String(stateChange.reason)));
		});

		ably.connection.on('failed', (stateChange) => {
			updateConnectionState('failed', new Error(String(stateChange.reason)));
		});

		ably.connection.on('connected', () => {
			updateConnectionState('connected');
			// A channel that refused an attach while the link was down gets another go
			// now it is back, on the token in hand — the only retry a channel carrying
			// no Event gets. An Event the token does not cover is its recovery's to attach.
			void attachPending(eventId => eventId == null || eventId === coveredEventId);
		});

		ably.connection.on('suspended', (stateChange) => {
			updateConnectionState('suspended', new Error(String(stateChange.reason)));
		});

		// Closing/closed carry no error: a close is deliberate (ours or Ably's),
		// not a fault. The resync layer still counts `closed` as out of touch.
		ably.connection.on('closing', () => {
			updateConnectionState('closing');
		});

		ably.connection.on('closed', () => {
			updateConnectionState('closed');
		});

		function disconnect() {
			if (connectionSnapshot.connectionState === 'closed' || connectionSnapshot.connectionState === 'closing')
				return;

			try {
				ably.connection.close();
			}
			catch (err) {
				const error = err instanceof Error ? err : new Error('Disconnection failed');
				updateConnectionState('failed', error);
				throw error;
			}
		}

		function unsubscribeMapEntries(map: Map<string, Unsubscribe>, predicate?: (key: string) => boolean) {
			for (const [key, unsubscribe] of [...map]) {
				if (!predicate || predicate(key)) {
					unsubscribe();
					map.delete(key);
				}
			}
		}

		function roomSubscriptionKey(owner: string, type: string) {
			return `room:${owner}:${type}`;
		}

		// Unique per call, never looked up by shape: a channel subscription is not
		// replaced by a later one for the same channel and type — each caller holds
		// its own unsubscribe, and the map exists only so cleanup() can drain them.
		function channelSubscriptionKey(channel: string, type: string) {
			return `channel:${++channelSubscriptionId}:${channel}:${type}`;
		}

		interface SubscriptionSpec {
			/** Names the subscription in the warning a refused attach leaves. */
			label: string;
			channelName: string;
			/** Put the listener on (or the entry in); settles with the attach. */
			subscribe: (channel: Ably.RealtimeChannel) => unknown;
			/** Take the listener off again. */
			detach: (channel: Ably.RealtimeChannel) => void;
		}

		interface HeldSubscription {
			/** The consumer's disposal: the only thing that ends a Realtime Subscription. */
			dispose: Unsubscribe;
			/** Resolves at the first attach's outcome, or once its Event's verdict is that it must wait. */
			settled: Promise<void>;
		}

		/**
		 * Hold one Realtime Subscription on a channel, attaching it once its Event is
		 * covered.
		 *
		 * Until then it is pending, and its Event's recovery attaches it: the mint that
		 * lands may be one nothing re-subscribed for, so the original handler is the one
		 * that attaches. A refused attach leaves the listener where Ably keeps it,
		 * because Ably re-attaches a suspended channel by itself, and puts the
		 * subscription back to pending for its Event's recovery to retry. The retry
		 * takes the listener off before subscribing again, so nothing is delivered
		 * twice (#609, ADR-0023).
		 */
		function holdSubscription(spec: SubscriptionSpec): HeldSubscription {
			const channel = getChannel(spec.channelName);
			let active = true;
			let refused = false;
			let settle!: () => void;
			const settled = new Promise<void>((resolve) => {
				settle = resolve;
			});

			const subscription: PendingSubscription = {
				eventId: realtimeChannelEventId(spec.channelName),
				async attach() {
					pendingSubscriptions.delete(subscription);
					if (!active)
						return null;

					if (refused)
						spec.detach(channel);
					try {
						// From `failed` Ably refuses a subscribe outright; only an explicit
						// attach recovers the channel (ably@2.29).
						if (channel.state === 'failed')
							await channel.attach();
						await spec.subscribe(channel);
						refused = false;
						return null;
					}
					catch (err) {
						if (!active)
							return null;

						refused = true;
						pendingSubscriptions.add(subscription);
						console.warn(`Failed to subscribe to ${spec.label}:`, err);
						// Refused on a covered Event with no recovery running: nothing else
						// would retry it while the connection stays up.
						const eventId = subscription.eventId;
						if (eventId != null && eventId === coveredEventId && !pendingAuthorize)
							void beginRecovery(eventId);
						return toError(err);
					}
					finally {
						settle();
					}
				},
			};

			const coverage = ensureChannelCoverage(spec.channelName);
			if (coverage === true) {
				void subscription.attach();
			}
			else {
				pendingSubscriptions.add(subscription);
				void coverage.then((covered) => {
					if (!covered)
						settle();
				});
			}

			return {
				dispose: () => {
					if (!active)
						return;

					active = false;
					spec.detach(channel);
					pendingSubscriptions.delete(subscription);
					settle();
					stopRecoveryIfUnwanted();
				},
				settled,
			};
		}

		function subscribeRoomHandler<T extends MessageType>(
			owner: string,
			type: T,
			handler: RealtimeHandler<T>,
		) {
			if (!currentRoom)
				return;

			const key = roomSubscriptionKey(owner, type);
			roomSubscriptions.get(key)?.();
			roomSubscriptions.delete(key);

			const messageHandler = (message: Ably.Message) => {
				handler(message.data, message);
			};

			const { dispose } = holdSubscription({
				label: `${type} on ${currentRoom}`,
				channelName: currentRoom,
				subscribe: channel => channel.subscribe(type, messageHandler),
				detach: channel => channel.unsubscribe(type, messageHandler),
			});

			roomSubscriptions.set(key, () => {
				dispose();
				roomSubscriptions.delete(key);
			});
		}

		function subscribeOwnerToRoom(owner: string) {
			const handlers = roomHandlers.get(owner);
			if (!handlers || !currentRoom)
				return;

			for (const [type, handler] of handlers) {
				subscribeRoomHandler(owner, type as MessageType, handler);
			}
		}

		function setRoom(room: string | null) {
			if (currentRoom === room)
				return;

			unsubscribeMapEntries(roomSubscriptions);
			currentRoom = room;

			if (currentRoom) {
				// Kick the token mint even before any handlers register — the room
				// is declared intent, and handlers registered later gate on the
				// same coverage.
				const coverage = ensureChannelCoverage(currentRoom);
				if (coverage !== true)
					void coverage.catch(() => {});
				for (const owner of roomHandlers.keys()) {
					subscribeOwnerToRoom(owner);
				}
			}

			// The room left behind may have been all that waited on a recovering mint.
			stopRecoveryIfUnwanted();
		}

		function onRoom(owner: string, handlers: Partial<RealtimeRoomHandlers>) {
			offRoom(owner);

			const filteredHandlers = new Map(
				Object.entries(handlers)
					.filter((entry): entry is [MessageType, RealtimeHandler<MessageType>] => entry[1] !== undefined),
			);

			roomHandlers.set(owner, filteredHandlers);
			subscribeOwnerToRoom(owner);
		}

		function offRoom(owner: string) {
			unsubscribeMapEntries(roomSubscriptions, key => key.startsWith(`room:${owner}:`));
			roomHandlers.delete(owner);
		}

		function onChannel<T extends MessageType>(
			channelName: string,
			type: T,
			handler: RealtimeHandler<T>,
		): Unsubscribe {
			const key = channelSubscriptionKey(channelName, type);
			const messageHandler = (message: Ably.Message) => {
				handler(message.data, message);
			};

			const { dispose } = holdSubscription({
				label: `${type} on ${channelName}`,
				channelName,
				subscribe: channel => channel.subscribe(type, messageHandler),
				detach: channel => channel.unsubscribe(type, messageHandler),
			});

			const unsubscribe = () => {
				dispose();
				channelSubscriptions.delete(key);
			};

			channelSubscriptions.set(key, unsubscribe);
			return unsubscribe;
		}

		/**
		 * Enter a channel's presence, or hold the entry until it can be entered.
		 *
		 * The entry is a Realtime Subscription like any other: an outage holds it, and
		 * once its Event's token lands it enters with the latest data, so control
		 * surfaces count the output again without it remounting. Resolves once entered
		 * or held, never waiting out an outage, because a Screen Output stops loading
		 * only when this returns. `leavePresence` withdraws the entry either way.
		 */
		async function enterPresence(channelName: string, data: RealtimePresenceData): Promise<void> {
			if (presenceEntries.has(channelName))
				return updatePresence(channelName, data);

			const entry: PresenceEntry = { data, entered: false, dispose: () => {} };
			presenceEntries.set(channelName, entry);
			const held = holdSubscription({
				label: `presence entry on ${channelName}`,
				channelName,
				subscribe: async (channel) => {
					await channel.presence.enter(entry.data);
					entry.entered = true;
				},
				// An entry has no listener; leaving is `leavePresence`'s, and only once entered.
				detach: () => {},
			});
			entry.dispose = held.dispose;
			await held.settled;
		}

		async function leavePresence(channelName: string): Promise<void> {
			const entry = presenceEntries.get(channelName);
			if (!entry)
				return;

			presenceEntries.delete(channelName);
			entry.dispose();
			if (entry.entered)
				await getChannel(channelName).presence.leave();
		}

		async function updatePresence(channelName: string, data: RealtimePresenceData): Promise<void> {
			// Only an entry this client holds: Ably's presence.update on a channel not
			// entered would enter it, and entering is enterPresence's job with its own
			// coverage check. A held entry enters with whatever data is latest.
			const entry = presenceEntries.get(channelName);
			if (!entry)
				return;

			entry.data = data;
			if (entry.entered)
				await getChannel(channelName).presence.update(data);
		}

		function watchPresence<Data extends RealtimePresenceData>(
			channelName: string,
			callback: RealtimePresenceCallback<Data>,
		): Unsubscribe {
			const channel = getChannel(channelName);
			const key = `presence:${++presenceSubscriptionId}:${channelName}`;
			let active = true;

			const handlePresenceChange = async () => {
				try {
					const members = await channel.presence.get();
					if (!active)
						return;

					// The one place the presence payload is asserted rather than checked:
					// the wire carries whatever a member entered with, and this is the
					// boundary it arrives at. Declared partial, so every reader still has
					// to look before it reads a field.
					callback(members as RealtimePresenceMessage<Data>[]);
				}
				catch (err) {
					console.warn(`Failed to refresh presence for ${channelName}:`, err);
				}
			};

			const disposals = (['enter', 'leave', 'update'] as const).map(action => holdSubscription({
				label: `presence ${action} on ${channelName}`,
				channelName,
				subscribe: channel => channel.presence.subscribe(action, handlePresenceChange),
				detach: channel => channel.presence.unsubscribe(action, handlePresenceChange),
			}).dispose);

			const unsubscribe = () => {
				if (!active)
					return;

				active = false;
				disposals.forEach(dispose => dispose());
				presenceSubscriptions.delete(key);
			};

			presenceSubscriptions.set(key, unsubscribe);
			void handlePresenceChange();

			return unsubscribe;
		}

		function cleanup() {
			unsubscribeMapEntries(roomSubscriptions);
			unsubscribeMapEntries(channelSubscriptions);
			unsubscribeMapEntries(presenceSubscriptions);
			for (const entry of presenceEntries.values())
				entry.dispose();
			presenceEntries.clear();
			roomHandlers.clear();
			currentRoom = null;
			supersedeMint();

			for (const channel of channels.values()) {
				try {
					void channel.detach();
				}
				catch {
				// Ignore detach errors during browser teardown.
				}
			}
			channels.clear();
			continuity.clear();
			continuityLostHandlers.clear();

			void disconnect();
		}

		window.addEventListener('beforeunload', cleanup);

		return {
			provide: {
				realtime: {
					get connectionId() { return ably.connection.id; },
					get connectionState() { return connectionState.value.connectionState; },
					get isConnected() { return connectionState.value.isConnected; },
					get error() { return connectionState.value.error; },
					get tokenError() { return tokenError.value; },
					setRoom,
					onRoom,
					offRoom,
					onChannel,
					onContinuityLost,
					enterPresence,
					leavePresence,
					updatePresence,
					watchPresence,
				},
			},
		};
	},
});

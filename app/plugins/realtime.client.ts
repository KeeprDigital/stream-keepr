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
		 * `member.data` (`useScreenOutputVideoTargets.ts`). Two outputs of one Screen
		 * still appear as two presence members, because presence is per connection
		 * rather than per identity.
		 */

		// The token is scoped to a single event's channels (see
		// server/api/realtime/token.get.ts), so the auth flow needs to know
		// which event is active before it can request one. `activeEventId` is
		// read fresh on every auth attempt; until an event is chosen (e.g. on
		// the event-less index page) authCallback waits on `eventIdReady`
		// instead of erroring, so the initial connection just stays pending —
		// no failed/suspended state, no reconnect spam.
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
		let eventIdReady: Promise<number> | null = null;
		let resolveEventIdReady: ((eventId: number) => void) | null = null;
		let pendingAuthorize: { eventId: number; promise: Promise<boolean> } | null = null;

		const ably = new Ably.Realtime({
			authCallback: async (_tokenParams, callback) => {
				try {
					if (activeEventId == null) {
						eventIdReady ??= new Promise<number>((resolve) => {
							resolveEventIdReady = resolve;
						});
					}
					const eventId = activeEventId ?? await eventIdReady!;
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

		const tokenError = ref<Error | null>(null);

		function wait(ms: number) {
			return new Promise<void>(resolve => setTimeout(resolve, ms));
		}

		/**
		 * Mint a token covering one Event, re-attempting a failure before giving up.
		 *
		 * Coverage is claimed only on success, and the failure is published rather than
		 * only logged: a token this client cannot mint means no realtime for the Event
		 * an operator is running, and the console is not a surface anyone running a
		 * show is looking at.
		 */
		async function mintTokenFor(eventId: number, flight: { readonly stale: boolean; readonly current: boolean }) {
			for (let attempt = 0; ; attempt++) {
				if (flight.stale)
					return false;

				try {
					await ably.auth.authorize();
					if (flight.stale)
						return false;
					coveredEventId = eventId;
					tokenError.value = null;
					return true;
				}
				catch (err) {
					const delay = AUTHORIZE_RETRY_DELAYS_MS[attempt];
					if (delay === undefined) {
						console.warn('Failed to authorize realtime token for event switch:', err);
						if (flight.current)
							tokenError.value = err instanceof Error ? err : new Error(String(err));
						return false;
					}
					await wait(delay);
				}
			}
		}

		/**
		 * Ensure the token covers the given channel's Event before subscribing.
		 * Returns `true` synchronously when already covered (so established
		 * subscriptions stay synchronous), or a promise resolving to whether
		 * the mint is still the latest — a superseded or failed mint resolves
		 * `false` and the caller must not subscribe. Channels that carry no
		 * Event (unrecognized shapes) need no scoping and pass through.
		 *
		 * An Event whose mint failed is deliberately not remembered as attempted: the
		 * next subscribe mints again. That is the second thing that heals a blip, after
		 * the retries inside one mint, and it is why a failure can no longer outlive
		 * the condition that caused it.
		 */
		function ensureChannelCoverage(channelName: string): true | Promise<boolean> {
			const eventId = realtimeChannelEventId(channelName);
			if (eventId == null)
				return true;

			// A mint for this same Event may still be in flight; wait on it instead of
			// subscribing before the token upgrade actually lands.
			if (pendingAuthorize?.eventId === eventId)
				return pendingAuthorize.promise;

			if (eventId === coveredEventId) {
				// Covered means a token for this Event is in hand, so whatever failed to
				// mint for the Event the operator tried in between is no longer a fact
				// about them. Without this, switching away and back leaves a fault
				// standing on a client that is working perfectly.
				tokenError.value = null;
				return true;
			}

			activeEventId = eventId;
			const flight = coverageFlights.begin();

			const promise = (async () => {
				if (resolveEventIdReady) {
					// The initial connection's authCallback is waiting for an event
					// to be chosen; releasing it fetches a token for this event.
					const resolve = resolveEventIdReady;
					resolveEventIdReady = null;
					eventIdReady = null;
					resolve(eventId);
					if (flight.stale)
						return false;
					coveredEventId = eventId;
					return true;
				}

				return await mintTokenFor(eventId, flight);
			})();

			pendingAuthorize = { eventId, promise };
			void promise
				.finally(() => {
					if (pendingAuthorize?.promise === promise)
						pendingAuthorize = null;
				})
				.catch(() => {});
			return promise;
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

		let currentRoom: string | null = null;
		let channelSubscriptionId = 0;
		let presenceSubscriptionId = 0;

		function getChannel(channelName: string): Ably.RealtimeChannel {
			if (!channels.has(channelName)) {
				channels.set(channelName, ably.channels.get(channelName));
			}
			return channels.get(channelName)!;
		}

		function updateConnectionState(state: Ably.ConnectionState, err?: Error | null) {
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
		});

		ably.connection.on('suspended', (stateChange) => {
			updateConnectionState('suspended', new Error(String(stateChange.reason)));
		});

		function connect() {
			if (connectionSnapshot.isConnected)
				return;

			try {
				ably.connection.connect();
			}
			catch (err) {
				const error = err instanceof Error ? err : new Error('Connection failed');
				updateConnectionState('failed', error);
				throw error;
			}
		}

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

		function channelSubscriptionKey(channel: string, type: string) {
			return `channel:${++channelSubscriptionId}:${channel}:${type}`;
		}

		function observeSubscription(
			label: string,
			channelName: string,
			subscribe: () => unknown,
			isActive: () => boolean,
			unsubscribe: Unsubscribe,
		) {
			const handleFailure = (err: unknown) => {
				if (!isActive())
					return;

				unsubscribe();
				console.warn(`Failed to subscribe to ${label}:`, err);
			};

			if (!isActive())
				return;

			const attempt = () => {
				if (!isActive())
					return;

				try {
					void Promise.resolve(subscribe()).catch(handleFailure);
				}
				catch (err) {
					handleFailure(err);
				}
			};

			const coverage = ensureChannelCoverage(channelName);
			if (coverage === true) {
				attempt();
				return;
			}

			void coverage
				.then((covered) => {
					// A superseded or failed mint never subscribes; the failure
					// itself was already warned by the mint.
					if (!covered) {
						unsubscribe();
						return;
					}
					attempt();
				})
				.catch(handleFailure);
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

			const channel = getChannel(currentRoom);
			const messageHandler = (message: Ably.Message) => {
				handler(message.data, message);
			};

			let active = true;
			const unsubscribe = () => {
				if (!active)
					return;

				active = false;
				channel.unsubscribe(type, messageHandler);
				roomSubscriptions.delete(key);
			};

			roomSubscriptions.set(key, unsubscribe);
			observeSubscription(
				`${type} on ${currentRoom}`,
				currentRoom,
				() => channel.subscribe(type, messageHandler),
				() => active,
				unsubscribe,
			);
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
			channelSubscriptions.get(key)?.();
			channelSubscriptions.delete(key);

			const channel = getChannel(channelName);
			const messageHandler = (message: Ably.Message) => {
				handler(message.data, message);
			};

			let active = true;
			const unsubscribe = () => {
				if (!active)
					return;

				active = false;
				channel.unsubscribe(type, messageHandler);
				channelSubscriptions.delete(key);
			};

			channelSubscriptions.set(key, unsubscribe);
			observeSubscription(
				`${type} on ${channelName}`,
				channelName,
				() => channel.subscribe(type, messageHandler),
				() => active,
				unsubscribe,
			);
			return unsubscribe;
		}

		async function enterPresence(channelName: string, data: RealtimePresenceData): Promise<void> {
			const coverage = ensureChannelCoverage(channelName);
			if (coverage !== true && !(await coverage))
				throw new Error(`Realtime token does not cover ${channelName}`);

			await getChannel(channelName).presence.enter(data);
		}

		async function leavePresence(channelName: string): Promise<void> {
			const channel = channels.get(channelName);
			if (channel) {
				await channel.presence.leave();
			}
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

			const unsubscribe = () => {
				if (!active)
					return;

				active = false;
				channel.presence.unsubscribe('enter', handlePresenceChange);
				channel.presence.unsubscribe('leave', handlePresenceChange);
				channel.presence.unsubscribe('update', handlePresenceChange);
				presenceSubscriptions.delete(key);
			};

			presenceSubscriptions.set(key, unsubscribe);
			observeSubscription(
				`presence enter on ${channelName}`,
				channelName,
				() => channel.presence.subscribe('enter', handlePresenceChange),
				() => active,
				unsubscribe,
			);
			observeSubscription(
				`presence leave on ${channelName}`,
				channelName,
				() => channel.presence.subscribe('leave', handlePresenceChange),
				() => active,
				unsubscribe,
			);
			observeSubscription(
				`presence update on ${channelName}`,
				channelName,
				() => channel.presence.subscribe('update', handlePresenceChange),
				() => active,
				unsubscribe,
			);
			void handlePresenceChange();

			return unsubscribe;
		}

		function cleanup() {
			unsubscribeMapEntries(roomSubscriptions);
			unsubscribeMapEntries(channelSubscriptions);
			unsubscribeMapEntries(presenceSubscriptions);
			roomHandlers.clear();
			currentRoom = null;

			for (const channel of channels.values()) {
				try {
					void channel.detach();
				}
				catch {
				// Ignore detach errors during browser teardown.
				}
			}
			channels.clear();

			void disconnect();
		}

		connect();

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
					enterPresence,
					leavePresence,
					watchPresence,
				},
			},
		};
	},
});

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
			// The first connect is `mintTokenFor`'s: `auth.authorize()` initiates
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
		 * repeats for as long as a desired registration still waits on the Event: a
		 * token service that comes back after an hour must still find the page's
		 * handlers waiting, without anyone remounting it (#609).
		 */
		const RECOVERY_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000];

		const tokenError = ref<Error | null>(null);

		/**
		 * A desired registration not yet attached to its channel.
		 *
		 * It waits here for a token covering its Event, or after its channel refused an
		 * attach, and leaves only by attaching or by its consumer disposing it. A failure
		 * is never a reason to forget one: a forgotten registration is a handler a page
		 * still believes is listening (#609).
		 */
		interface PendingAttachment {
			readonly eventId: number | null;
			attach: () => void;
		}

		const pendingAttachments = new Set<PendingAttachment>();

		function attachPending(predicate: (eventId: number | null) => boolean) {
			for (const attachment of [...pendingAttachments]) {
				if (predicate(attachment.eventId))
					attachment.attach();
			}
		}

		/**
		 * The one place coverage is ever claimed — the "only on success" contract
		 * this file exists to hold (#307, #466). Every path that reaches it has a
		 * token for the Event actually in hand, so it is also where everything
		 * waiting on that Event attaches.
		 */
		function claimCoverage(eventId: number) {
			coveredEventId = eventId;
			tokenError.value = null;
			attachPending(pendingEventId => pendingEventId === eventId);
		}

		function wait(ms: number) {
			return new Promise<void>(resolve => setTimeout(resolve, ms));
		}

		/** Ends the recovery wait in progress early, so a mint nothing waits on stops now. */
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
		 * Mint a token covering one Event, re-attempting a failure for as long as
		 * something desired waits on it.
		 *
		 * Coverage is claimed only on success, and the failure is published rather than
		 * only logged once the quick retries are spent: a token this client cannot mint
		 * means no realtime for the Event an operator is running, and the console is not
		 * a surface anyone running a show is looking at. The fault then stands until the
		 * mint lands or the last registration waiting on it is disposed.
		 *
		 * `reportFailure` gives the verdict to whoever cannot wait out an outage, at the
		 * moment the fault is published; the registrations keep waiting past it.
		 */
		async function mintTokenFor(
			eventId: number,
			flight: { readonly stale: boolean; readonly current: boolean },
			reportFailure: () => void,
		) {
			const attemptMint = async () => {
				await ably.auth.authorize();
				if (flight.stale)
					return false;
				claimCoverage(eventId);
				return true;
			};

			let failure: unknown;
			for (const delay of [...AUTHORIZE_RETRY_DELAYS_MS, null]) {
				if (flight.stale)
					return false;

				try {
					return await attemptMint();
				}
				catch (err) {
					failure = err;
					if (delay !== null)
						await wait(delay);
				}
			}

			console.warn('Failed to authorize realtime token for event switch:', failure);
			if (flight.current)
				tokenError.value = failure instanceof Error ? failure : new Error(String(failure));
			reportFailure();

			// Nothing desired waits — the mint was for an action such as entering
			// presence, which has its answer now.
			if (!awaitsCoverage(eventId))
				return false;

			for (let attempt = 0; ; attempt++) {
				await recoveryWait(RECOVERY_RETRY_DELAYS_MS[Math.min(attempt, RECOVERY_RETRY_DELAYS_MS.length - 1)]!);
				if (flight.stale)
					return false;
				if (!awaitsCoverage(eventId))
					break;

				try {
					return await attemptMint();
				}
				catch {
					// Still down. The fault already says so, and stays standing.
				}
			}

			// Everything that waited on this Event was disposed, so nothing is failing
			// for anyone any more.
			if (flight.current)
				tokenError.value = null;
			return false;
		}

		/** Stop the recovery in progress if nothing desired waits on its Event any more. */
		function reviewRecovery() {
			if (pendingAuthorize && !awaitsCoverage(pendingAuthorize.eventId))
				cancelRecoveryWait?.();
		}

		/**
		 * Ensure the token covers the given channel's Event before subscribing.
		 * Returns `true` synchronously when already covered (so established
		 * subscriptions stay synchronous), or the mint's verdict: `true` once it
		 * lands, `false` once it is superseded or its quick retries are spent. An
		 * action such as entering presence answers by that verdict; a registration
		 * ignores it and waits for `claimCoverage`, however long the outage. Channels
		 * that carry no Event (unrecognized shapes) need no scoping and pass through.
		 *
		 * A mint something desired still waits on keeps re-attempting past its
		 * verdict, so a later subscribe for the same Event joins it. An Event whose
		 * mint did stop is deliberately not remembered as attempted: the next
		 * subscribe mints again, which is why a failure can no longer outlive the
		 * condition that caused it.
		 */
		function ensureChannelCoverage(channelName: string): true | Promise<boolean> {
			const eventId = realtimeChannelEventId(channelName);
			if (eventId == null)
				return true;

			// A mint for this same Event may still be in flight; wait on it instead of
			// subscribing before the token upgrade actually lands.
			if (pendingAuthorize?.eventId === eventId)
				return pendingAuthorize.verdict;

			if (eventId === coveredEventId) {
				// Covered means a token for this Event is in hand, so whatever failed to
				// mint for the Event the operator tried in between is no longer a fact
				// about them. Without this, switching away and back leaves a fault
				// standing on a client that is working perfectly. Not while that mint is
				// still recovering, though: something desired is still waiting on it, and
				// the fault is about that.
				if (!pendingAuthorize)
					tokenError.value = null;
				return true;
			}

			activeEventId = eventId;
			const flight = coverageFlights.begin();
			// The superseded mint's recovery would only find itself stale; stop its wait now.
			cancelRecoveryWait?.();
			// One mint path for first connection, event switch, and recovery alike:
			// authorize() connects a not-yet-connected client as part of the mint,
			// so a first-connection blip heals the same way an event-switch blip does.
			let giveVerdict!: (covered: boolean) => void;
			const verdict = new Promise<boolean>((resolve) => {
				giveVerdict = resolve;
			});
			const pending = { eventId, verdict };
			pendingAuthorize = pending;
			void mintTokenFor(eventId, flight, () => giveVerdict(false))
				.then(giveVerdict, () => giveVerdict(false))
				.finally(() => {
					if (pendingAuthorize === pending)
						pendingAuthorize = null;
				});
			return verdict;
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

		/** Whether anything desired still waits on a token for this Event: the room, or a registration. */
		function awaitsCoverage(eventId: number) {
			if (currentRoom != null && realtimeChannelEventId(currentRoom) === eventId)
				return true;
			for (const attachment of pendingAttachments) {
				if (attachment.eventId === eventId)
					return true;
			}
			return false;
		}

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
			// A channel that refused an attach while the link was down gets another go
			// now it is back, on the token in hand: an Event it does not cover is the
			// recovering mint's to attach.
			attachPending(eventId => eventId == null || eventId === coveredEventId);
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

		/**
		 * Attach one desired registration to its channel once its Event is covered.
		 *
		 * Until then it is pending, and `claimCoverage` attaches it: the mint that
		 * lands may be one nothing re-registered for, so the original handler is the
		 * one that attaches. A refused attach takes the listener off (`detach`, so the
		 * retry cannot deliver twice) and puts the registration back to pending.
		 * Returns the release its consumer's disposal must call, the only thing that
		 * ends a registration (#609).
		 */
		function observeSubscription(
			label: string,
			channelName: string,
			subscribe: () => unknown,
			detach: () => void,
			isActive: () => boolean,
		): Unsubscribe {
			const attachment: PendingAttachment = {
				eventId: realtimeChannelEventId(channelName),
				attach() {
					pendingAttachments.delete(attachment);
					if (!isActive())
						return;

					try {
						void Promise.resolve(subscribe()).catch(handleFailure);
					}
					catch (err) {
						handleFailure(err);
					}
				},
			};

			function handleFailure(err: unknown) {
				if (!isActive())
					return;

				detach();
				pendingAttachments.add(attachment);
				console.warn(`Failed to subscribe to ${label}:`, err);
			}

			if (ensureChannelCoverage(channelName) === true)
				attachment.attach();
			else
				pendingAttachments.add(attachment);

			return () => {
				pendingAttachments.delete(attachment);
				reviewRecovery();
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

			const channel = getChannel(currentRoom);
			const messageHandler = (message: Ably.Message) => {
				handler(message.data, message);
			};

			let active = true;
			const detach = () => channel.unsubscribe(type, messageHandler);
			const release = observeSubscription(
				`${type} on ${currentRoom}`,
				currentRoom,
				() => channel.subscribe(type, messageHandler),
				detach,
				() => active,
			);

			roomSubscriptions.set(key, () => {
				if (!active)
					return;

				active = false;
				detach();
				roomSubscriptions.delete(key);
				release();
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
			reviewRecovery();
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
			const channel = getChannel(channelName);
			const messageHandler = (message: Ably.Message) => {
				handler(message.data, message);
			};

			let active = true;
			const detach = () => channel.unsubscribe(type, messageHandler);
			const release = observeSubscription(
				`${type} on ${channelName}`,
				channelName,
				() => channel.subscribe(type, messageHandler),
				detach,
				() => active,
			);

			const unsubscribe = () => {
				if (!active)
					return;

				active = false;
				detach();
				channelSubscriptions.delete(key);
				release();
			};

			channelSubscriptions.set(key, unsubscribe);
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

		async function updatePresence(channelName: string, data: RealtimePresenceData): Promise<void> {
			// Only a channel this client already holds: Ably's presence.update on a
			// fresh channel would enter it, and entering is enterPresence's job with
			// its own coverage check.
			const channel = channels.get(channelName);
			if (channel) {
				await channel.presence.update(data);
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

			const releases = (['enter', 'leave', 'update'] as const).map(action => observeSubscription(
				`presence ${action} on ${channelName}`,
				channelName,
				() => channel.presence.subscribe(action, handlePresenceChange),
				() => channel.presence.unsubscribe(action, handlePresenceChange),
				() => active,
			));

			const unsubscribe = () => {
				if (!active)
					return;

				active = false;
				channel.presence.unsubscribe('enter', handlePresenceChange);
				channel.presence.unsubscribe('leave', handlePresenceChange);
				channel.presence.unsubscribe('update', handlePresenceChange);
				presenceSubscriptions.delete(key);
				releases.forEach(release => release());
			};

			presenceSubscriptions.set(key, unsubscribe);
			void handlePresenceChange();

			return unsubscribe;
		}

		function cleanup() {
			unsubscribeMapEntries(roomSubscriptions);
			unsubscribeMapEntries(channelSubscriptions);
			unsubscribeMapEntries(presenceSubscriptions);
			roomHandlers.clear();
			currentRoom = null;
			coverageFlights.supersede();
			cancelRecoveryWait?.();

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
					updatePresence,
					watchPresence,
				},
			},
		};
	},
});

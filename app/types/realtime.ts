import type { CompleteMessage, MessageType } from '~~/shared/types/messages';

export type MessageData<T extends MessageType> = CompleteMessage<T>;

export type RealtimeHandler<T extends MessageType = MessageType> = (
	data: MessageData<T>,
	rawMessage: unknown,
) => void;

export type RealtimeRoomHandlers = {
	[K in MessageType]?: RealtimeHandler<K>;
};

export interface RealtimeConnectionState {
	isConnected: boolean;
	connectionState: 'initialized' | 'connecting' | 'connected' | 'disconnected' | 'suspended' | 'closing' | 'closed' | 'failed';
	error: Error | null;
}

export type RealtimePresenceData = object;

/**
 * One member of a presence set, as this application reads one.
 *
 * Only `data` is declared: it is the only part any consumer reads, and the rest of a
 * presence message belongs to whichever transport delivered it. Carrying the payload's
 * own shape here is what keeps it out of every consumer — untyped, each one cast, and
 * a cast is a claim nobody checks.
 *
 * The payload is partial because it is the member's own claim about itself, made when
 * it entered and carried over the wire. A member that entered with an older shape, or
 * with an optional field it had nothing to put in, is a member with fields missing —
 * so a reader has to look, and the type is what makes it.
 */
export interface RealtimePresenceMessage<Data extends RealtimePresenceData = RealtimePresenceData> {
	data?: Partial<Data>;
}

export type RealtimePresenceCallback<Data extends RealtimePresenceData = RealtimePresenceData>
	= (members: RealtimePresenceMessage<Data>[]) => void;

export interface RealtimeTransport {
	readonly connectionId?: string;
	readonly connectionState: RealtimeConnectionState['connectionState'];
	readonly isConnected: boolean;
	readonly error: Error | null;
	setRoom: (room: string | null) => void;
	onRoom: (owner: string, handlers: Partial<RealtimeRoomHandlers>) => void;
	offRoom: (owner: string) => void;
	onChannel: <T extends MessageType>(
		channel: string,
		type: T,
		handler: RealtimeHandler<T>,
	) => () => void;
	enterPresence: (channel: string, data: RealtimePresenceData) => Promise<void>;
	leavePresence: (channel: string) => Promise<void>;
	/**
	 * Watch one channel's presence set.
	 *
	 * The payload shape is the caller's to name, because only the caller knows what
	 * enters the channel it is watching. The transport asserts it once, where the wire
	 * really is untyped, rather than leaving every reader to.
	 */
	watchPresence: <Data extends RealtimePresenceData>(
		channel: string,
		callback: RealtimePresenceCallback<Data>,
	) => () => void;
}

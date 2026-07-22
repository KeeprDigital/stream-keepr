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
export type RealtimePresenceMessage = unknown;
export type RealtimePresenceCallback = (members: RealtimePresenceMessage[]) => void;

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
	watchPresence: (channel: string, callback: RealtimePresenceCallback) => () => void;
}

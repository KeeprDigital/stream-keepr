import type { H3Event } from 'h3';
import type {
	MessagePayload,
	MessageType,
} from '../types/messages';
import Ably from 'ably';
import { eventRealtimeChannel, screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createMessage, screenCommandMessageTypes } from '../types/messages';

let ablyClient: Ably.Rest | null = null;

export function getAblyClient(): Ably.Rest {
	if (!ablyClient) {
		const config = useRuntimeConfig();

		const serverApiKey = config.ablyApiKey;

		if (!serverApiKey) {
			throw new Error('Ably server API key is not configured');
		}

		ablyClient = new Ably.Rest(serverApiKey);
	}

	return ablyClient;
}

export function getOriginConnectionId(event: H3Event): string | undefined {
	return getHeader(event, 'x-realtime-connection-id') || undefined;
}

// Overload for messages with payload
export async function publishMessage<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload: MessagePayload<T> extends undefined ? never : MessagePayload<T>,
	originConnectionId?: string,
): Promise<void>;

// Overload for messages without payload (undefined)
export async function publishMessage<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload?: MessagePayload<T> extends undefined ? undefined : never,
	originConnectionId?: string,
): Promise<void>;

// Implementation
export async function publishMessage<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload?: MessagePayload<T>,
	originConnectionId?: string,
): Promise<void> {
	try {
		const client = getAblyClient();
		const channel = client.channels.get(eventRealtimeChannel(eventId));
		const messageData = createMessage(eventId, messageType, payload, originConnectionId);
		await channel.publish(messageType, messageData);
	}
	catch {
		// SDK errors can retain request metadata. Log only the bounded routing
		// identifiers; realtime delivery is best-effort for this API.
		console.error(JSON.stringify({
			message: 'realtime_publish_failed',
			eventId,
			messageType,
		}));
	}
}

/**
 * Publish an Event message while preserving delivery failures for callers that
 * need to distinguish committed persistence from realtime notification state.
 * The default publishMessage API intentionally retains its legacy log-and-
 * swallow behavior for unrelated callers.
 */
export async function publishMessageStrict<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload: MessagePayload<T>,
	originConnectionId?: string,
): Promise<void> {
	const client = getAblyClient();
	const channel = client.channels.get(eventRealtimeChannel(eventId));
	const messageData = createMessage(eventId, messageType, payload, originConnectionId);

	await channel.publish(messageType, messageData);
}

export async function publishScreenCommand(
	eventId: number,
	screenId: number,
	command: ScreenCommand,
): Promise<void> {
	const client = getAblyClient();
	const channel = client.channels.get(screenRealtimeChannel(eventId, screenId));
	const messageType = screenCommandMessageTypes[command];

	await channel.publish(messageType, createMessage(eventId, messageType, { screenId }));
}

import type { H3Event } from 'h3';
import type {
	MessagePayload,
	MessageType,
} from '../types/messages';
import Ably from 'ably';
import { eventRealtimeChannel, screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createMessage, MAX_REALTIME_MESSAGE_BYTES, realtimeMessageBytes, screenCommandMessageTypes } from '../types/messages';

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

/**
 * Say so when a message is too large to be delivered, before handing it over.
 *
 * The provider refuses an oversized publish, and this API's failure handling logs
 * `realtime_publish_failed` and carries on — which is correct for best-effort
 * delivery and useless for diagnosis, because the message never says the size was
 * the reason. #95 went unnoticed for exactly that long: writes kept succeeding and
 * only the notification stopped, on the largest shows and nowhere else.
 *
 * It reports rather than refuses. The write this announces has already committed,
 * and the account's actual ceiling may be higher than the documented floor this
 * compares against, so refusing here would invent a failure the provider might not
 * have had.
 */
function reportOversizedMessage<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload?: MessagePayload<T>,
	originConnectionId?: string,
): void {
	const bytes = realtimeMessageBytes(eventId, messageType, payload, originConnectionId);
	if (bytes <= MAX_REALTIME_MESSAGE_BYTES)
		return;

	console.error(JSON.stringify({
		message: 'realtime_publish_oversized',
		eventId,
		messageType,
		bytes,
		limit: MAX_REALTIME_MESSAGE_BYTES,
	}));
}

/**
 * How much of a failure's own message the log will carry.
 *
 * The provider's message is usually a short phrase ("No application found"), but
 * the transport's fallback for a response it cannot decode as an Ably error is
 * `'Error response received from server: ' + status + ' body was: ' + body` — so
 * an intermediary answering with an HTML page would otherwise put the whole page
 * in a log line. Bounded rather than dropped: the phrase is the diagnosis.
 */
export const MAX_PUBLISH_FAILURE_REASON_CHARS = 200;

// The finiteness half of this guard is belt-and-braces: the transport can build
// a code of `NaN` from an absent `x-ably-errorcode` header, and `JSON.stringify`
// would render that as null anyway. It is here so the declared `number | null`
// is true of the value and not merely of how this one caller serialises it.
function finiteNumberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * What a failed publish is allowed to say about why it failed.
 *
 * The provider throws `ErrorInfo`, which carries `statusCode`, `code` and
 * `message` (ably 2.25.0, ably.d.ts) — a rejected key arrives as 404 / 40400
 * "No application found", the server-side witness of the failure #242 had to
 * diagnose from the client. #253: the log used to discard all three, so a
 * revoked or fabricated key spent an outbound request per Screen mutation and
 * said nothing about it.
 *
 * The fields are named, not copied. `ErrorInfo` also carries `href`, `detail`
 * and `cause`, which is the request metadata the previous comment here was
 * right to keep out; none of them is read. Nothing named can carry the API key:
 * it reaches the provider in an Authorization header, and the SDK's own
 * key-shaped errors ("No key specified", "Invalid key specified: the key has no
 * colon-separated secret") interpolate nothing into their message.
 *
 * Total by construction. `code` and `statusCode` are optional and nullable on
 * the SDK's `PartialErrorInfo`, and the transport can build a code of `NaN` from
 * an absent `x-ably-errorcode` header, so both are validated rather than
 * trusted; a throw that is not an Error, or one whose properties refuse to be
 * read, yields nulls. The caller is a catch block that must not itself throw —
 * a failure here would turn a deliberately swallowed publish into a 500 on a
 * route whose write has already committed.
 */
function publishFailureFields(error: unknown) {
	try {
		const info = error as { statusCode?: unknown; code?: unknown; message?: unknown } | null | undefined;
		return {
			statusCode: finiteNumberOrNull(info?.statusCode),
			errorCode: finiteNumberOrNull(info?.code),
			errorName: error instanceof Error ? error.name : null,
			reason: typeof info?.message === 'string'
				? info.message.slice(0, MAX_PUBLISH_FAILURE_REASON_CHARS)
				: null,
		};
	}
	catch {
		return { statusCode: null, errorCode: null, errorName: null, reason: null };
	}
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
		reportOversizedMessage(eventId, messageType, payload, originConnectionId);
		await channel.publish(messageType, messageData);
	}
	catch (error) {
		// SDK errors can retain request metadata. Log the bounded routing
		// identifiers and the provider's own account of the refusal, and nothing
		// else; realtime delivery is best-effort for this API, so this line is the
		// only witness that the publish was attempted and refused.
		console.error(JSON.stringify({
			message: 'realtime_publish_failed',
			eventId,
			messageType,
			...publishFailureFields(error),
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
	reportOversizedMessage(eventId, messageType, payload, originConnectionId);

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

import type { H3Event } from 'h3';
import type {
	MessagePayload,
	MessageType,
} from '../types/messages';
import Ably from 'ably';
import { eventRealtimeChannel, screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createMessage, MAX_REALTIME_MESSAGE_BYTES, realtimeMessageBytes, screenCommandMessageTypes } from '../types/messages';
import { ServiceConfigurationError } from './errors';
import { publishFailureFields, RealtimePublishError } from './realtimePublishFailure';

/** The environment name behind `runtimeConfig.ablyApiKey`, as the operator sets it. */
const ABLY_API_KEY_SETTING = 'NUXT_ABLY_API_KEY';

let ablyClient: Ably.Rest | null = null;

/**
 * The realtime client, or the name of the setting that would have produced one.
 *
 * A `ServiceConfigurationError` rather than a bare throw because of where this
 * failure is read: an unset key is an unfinished deployment, and the only person
 * who can finish it is the one holding the response. A plain `Error` matches no
 * branch of `mapPublicNitroError`, so the 5xx sanitizer rewrote it to 'Internal
 * Server Error' and the operator got a stack-free 500 for a one-line environment
 * change — the exact #233 symptom, one setting over (#267). The classification is
 * what makes the message public: it names a setting and never a value.
 */
export function getAblyClient(): Ably.Rest {
	if (!ablyClient) {
		const config = useRuntimeConfig();

		const serverApiKey = config.ablyApiKey;

		if (!serverApiKey) {
			throw new ServiceConfigurationError(ABLY_API_KEY_SETTING, 'is not configured');
		}

		ablyClient = new Ably.Rest(serverApiKey);
	}

	return ablyClient;
}

/**
 * Ably connection ids are short base64url-style tokens (connection keys add
 * `!`). Generous against the observed ~14 characters, tight against the header
 * being an arbitrary channel: the value rides inside every message published
 * with it, so an unbounded one inflates published bytes on someone else's dime.
 */
const ORIGIN_CONNECTION_ID_SHAPE = /^[\w!-]{1,64}$/;

/**
 * The origin connection id the client self-reports so the echo filter can drop
 * its own updates. Client-supplied and unverifiable, so the one thing this does
 * is refuse to relay a value the provider could never have issued — malformed or
 * oversized reads as no origin at all, which only costs that client its echo
 * suppression.
 */
export function getOriginConnectionId(event: H3Event): string | undefined {
	const raw = getHeader(event, 'x-realtime-connection-id');
	if (!raw || !ORIGIN_CONNECTION_ID_SHAPE.test(raw))
		return undefined;
	return raw;
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

/**
 * Send a Screen a command, and say whose failure it was when it does not arrive.
 *
 * The one publish in this file that neither swallows nor propagates raw. Its
 * caller has no local effect to fall back on — the command *is* the request — so
 * a refusal has to reach the caller, and #242 recorded that contract
 * deliberately. What it must not do is reach the caller as the provider's own
 * error: h3 adopts `statusCode` from anything thrown, so Ably's 404 became the
 * route's 404 and read as the Screen not existing. `RealtimePublishError` is the
 * classification that separates the two, and the log line beside it is the only
 * place the provider's own account of the refusal is written down.
 *
 * The wrap is around the publish alone. `getAblyClient` failing is a key that was
 * never configured, which is a deployment that is not finished rather than a
 * service that said no, and it keeps its own answer: a 503 naming the setting
 * since #267, where this one said 'Internal Server Error' and nothing else.
 */
export async function publishScreenCommand(
	eventId: number,
	screenId: number,
	command: ScreenCommand,
): Promise<void> {
	const client = getAblyClient();
	const channel = client.channels.get(screenRealtimeChannel(eventId, screenId));
	const messageType = screenCommandMessageTypes[command];

	try {
		await channel.publish(messageType, createMessage(eventId, messageType, { screenId }));
	}
	catch (error) {
		console.error(JSON.stringify({
			message: 'realtime_publish_failed',
			eventId,
			screenId,
			messageType,
			...publishFailureFields(error),
		}));
		throw new RealtimePublishError(error);
	}
}

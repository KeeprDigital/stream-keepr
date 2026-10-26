import type { MessagePayload, MessageType } from '~~/shared/types/messages';
import type { RealtimeRoomHandlers } from '~/types/realtime';
import { createMessage } from '~~/shared/types/messages';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { useRealtimeMessageGate } from '~/composables/core/useRealtimeMessageGate';
import { createEventRealtimeHandlers } from '~/modules/realtime-event-session/handlers';
import { useEventStore } from '~/stores/event';

/** This client's connection id; `createMockRealtime()` reports the same one. */
export const OWN_CONNECTION_ID = 'test-connection-id';
const PEER_CONNECTION_ID = 'peer-connection-id';

/**
 * The Realtime Event Session's real handler map behind the real message gate,
 * as `useEventRealtimeSession` assembles it, so a store test drives the edge
 * production does. Built on first use, so it may be called at module scope.
 * `deliver` sends a peer's message; `fromSelf: true` sends this client's own.
 */
export function realtimeHandlersFor({ connectionId = OWN_CONNECTION_ID } = {}) {
	let built: RealtimeRoomHandlers | undefined;
	function handlers(): RealtimeRoomHandlers {
		built ??= createEventRealtimeHandlers({
			accept: useRealtimeMessageGate(connectionId).accept,
			eventStore: useEventStore(),
			realtime: createMockRealtime() as unknown as Parameters<typeof createEventRealtimeHandlers>[0]['realtime'],
		});
		return built;
	}
	return {
		handlers,
		deliver<T extends MessageType>(type: T, payload: MessagePayload<T>, { eventId = 1, fromSelf = false } = {}) {
			const handler = handlers()[type] as ((data: unknown, raw: unknown) => void) | undefined;
			if (!handler)
				throw new Error(`The Realtime Event Session has no handler for "${type}"`);
			handler(createMessage(eventId, type, payload, fromSelf ? connectionId : PEER_CONNECTION_ID), undefined);
		},
	};
}

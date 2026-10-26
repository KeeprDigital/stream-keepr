import type { MessageType, screenCommandMessageTypes } from '~~/shared/types/messages';
import type { AcceptRealtimeMessage } from './types';
import type { RealtimeHandler } from '~/types/realtime';
import { createBroadcastDeckListRealtimeHandlers } from './broadcastDeckListHandlers';
import { createBroadcastGraphicsRealtimeHandlers } from './broadcastGraphicsHandlers';
import { createEventTalentRealtimeHandlers } from './eventTalentHandlers';
import { createFeatureMatchRealtimeHandlers } from './featureMatchHandlers';
import { createMeleeRealtimeHandlers } from './meleeHandlers';
import { createPlayerMetagameRealtimeHandlers } from './playerMetagameHandlers';
import { createScreenCardRealtimeHandlers } from './screenCardHandlers';
import { createTournamentStructureRealtimeHandlers } from './tournamentStructureHandlers';

export type { AcceptRealtimeMessage } from './types';

interface EventRealtimeSessionHandlerOptions {
	accept: AcceptRealtimeMessage;
	eventStore: ReturnType<typeof useEventStore>;
	realtime: ReturnType<typeof useRealtime>;
}

type DirectChannelMessageType = (typeof screenCommandMessageTypes)[keyof typeof screenCommandMessageTypes];

/** Every message on the Event room has a handler; Screen commands travel on their own channel. */
type EventRoomHandlers = { [K in Exclude<MessageType, DirectChannelMessageType>]: RealtimeHandler<K> };

/**
 * Realtime Event Session module seam.
 *
 * The composable owns session lifecycle; this module assembles domain handlers
 * that keep message routing and invalidation policies local to the domain.
 */
export function createEventRealtimeHandlers(options: EventRealtimeSessionHandlerOptions) {
	return {
		...createEventTalentRealtimeHandlers(options),
		...createPlayerMetagameRealtimeHandlers(options),
		...createTournamentStructureRealtimeHandlers(options),
		...createFeatureMatchRealtimeHandlers(options),
		...createScreenCardRealtimeHandlers(options),
		...createBroadcastGraphicsRealtimeHandlers(options),
		...createBroadcastDeckListRealtimeHandlers(options),
		...createMeleeRealtimeHandlers(options),
	} satisfies EventRoomHandlers;
}

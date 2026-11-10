import type { MessageType, screenCommandMessageTypes, screenOutputMessageTypes } from '~~/shared/types/messages';
import type { AcceptRealtimeMessage } from './types';
import type { RealtimeHandler } from '~/types/realtime';
import { createBroadcastDeckListRealtimeHandlers } from './broadcastDeckListHandlers';
import { createBroadcastGraphicsRealtimeHandlers } from './broadcastGraphicsHandlers';
import { createEventTalentRealtimeHandlers } from './eventTalentHandlers';
import { createFeatureMatchRealtimeHandlers } from './featureMatchHandlers';
import { createMeleeRealtimeHandlers } from './meleeHandlers';
import { createPlayerMetagameRealtimeHandlers } from './playerMetagameHandlers';
import { createScreenCardRealtimeHandlers } from './screenCardHandlers';
import { createTcgPlusRealtimeHandlers } from './tcgPlusHandlers';
import { createTournamentStructureRealtimeHandlers } from './tournamentStructureHandlers';

export type { AcceptRealtimeMessage } from './types';

interface EventRealtimeSessionHandlerOptions {
	accept: AcceptRealtimeMessage;
	eventStore: ReturnType<typeof useEventStore>;
	realtime: ReturnType<typeof useRealtime>;
}

type DirectChannelMessageType
	= | (typeof screenCommandMessageTypes)[keyof typeof screenCommandMessageTypes]
		| (typeof screenOutputMessageTypes)[number];

/** Every message on the Event room has a handler; Screen commands and a Screen Output's own messages travel on the Screen's channel. */
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
		...createTcgPlusRealtimeHandlers(options),
	} satisfies EventRoomHandlers;
}

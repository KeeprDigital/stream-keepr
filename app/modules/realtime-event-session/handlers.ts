import type { AcceptRealtimeMessage } from './types';
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
		...createMeleeRealtimeHandlers(options),
	};
}

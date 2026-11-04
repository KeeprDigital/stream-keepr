import type { AcceptRealtimeMessage } from './types';
import { clearPlayerDeckCache } from '~/composables/data/usePlayerDeckCache';

interface Options {
	accept: AcceptRealtimeMessage;
}

/**
 * A TCG+ Import (ADR-0074) announces its Players and Deck Lists as a count, as
 * a Melee Sync does, so an operator reloads the Players. The Archetypes it
 * created and the Slots it corrected arrive as their own messages. A
 * rendering of a Screen has no operator Session, so it skips the reload.
 */
export function createTcgPlusRealtimeHandlers({ accept }: Options) {
	const eventStore = useEventStore();

	return {
		'tcgplus:imported': accept('tcgplus:imported', async (data) => {
			if (!eventStore.event)
				return;
			useMetagameStore().applyRemoteInvalidated();
			clearPlayerDeckCache();
			await usePlayerStore().loadPlayersByEventId(data.eventId);
		}),
	};
}

import type { AcceptRealtimeMessage } from './types';
import { resetAllEventStores } from '~/utils/eventStores';

interface Options {
	accept: AcceptRealtimeMessage;
	eventStore: ReturnType<typeof useEventStore>;
	realtime: ReturnType<typeof useRealtime>;
}

export function createEventTalentRealtimeHandlers({ accept, eventStore, realtime }: Options) {
	return {
		'event:updated': accept('event:updated', data => eventStore.applyRemoteUpdated(data)),
		'event:deleted': accept('event:deleted', async (data) => {
			if (data.eventId !== eventStore.eventId)
				return;

			realtime.setRoom(null);
			resetAllEventStores();
			await navigateTo('/');
		}),
		'talent:created': accept('talent:created', data => eventStore.applyRemoteTalentCreated(data)),
		'talent:updated': accept('talent:updated', data => eventStore.applyRemoteTalentUpdated(data)),
		'talent:deleted': accept('talent:deleted', data => eventStore.applyRemoteTalentDeleted(data)),
	};
}

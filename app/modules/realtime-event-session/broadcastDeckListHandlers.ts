import type { AcceptRealtimeMessage } from './types';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createBroadcastDeckListRealtimeHandlers({ accept }: Options) {
	return {
		'broadcastDeckList:created': accept('broadcastDeckList:created', data => useBroadcastDeckListStore().applyRemoteCreated(data)),
		'broadcastDeckList:updated': accept('broadcastDeckList:updated', data => useBroadcastDeckListStore().applyRemoteUpdated(data)),
		'broadcastDeckList:deleted': accept('broadcastDeckList:deleted', data => useBroadcastDeckListStore().applyRemoteDeleted(data)),
	};
}

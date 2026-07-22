import type { AcceptRealtimeMessage } from './types';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createScreenCardRealtimeHandlers({ accept }: Options) {
	return {
		'screen:created': accept('screen:created', data => useScreenStore().applyRemoteCreated(data)),
		'screen:updated': accept('screen:updated', data => useScreenStore().applyRemoteUpdated(data)),
		'screen:deleted': accept('screen:deleted', data => useScreenStore().applyRemoteDeleted(data)),

		'card:updated': accept('card:updated', data => useCardStore().applyRemoteUpdated(data)),
		'card:preview': accept('card:preview', data => useCardStore().applyRemotePreview(data)),
		'card:cleared': accept('card:cleared', data => useCardStore().applyRemoteCleared(data)),
		'card:timeout': accept('card:timeout', data => useCardStore().applyRemoteTimeout(data)),
		'card:timeout:cancel': accept('card:timeout:cancel', data => useCardStore().applyRemoteTimeoutCancel(data)),
	};
}

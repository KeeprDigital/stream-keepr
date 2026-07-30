import type { AcceptRealtimeMessage } from './types';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createBroadcastGraphicsRealtimeHandlers({ accept }: Options) {
	return {
		'broadcastGraphicsLiveSession:commandApplied': accept(
			'broadcastGraphicsLiveSession:commandApplied',
			data => useBroadcastGraphicsLiveSessionStore().applyRemoteCommand(data),
		),
	};
}

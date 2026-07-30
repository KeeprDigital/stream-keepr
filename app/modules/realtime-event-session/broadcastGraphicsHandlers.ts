import type { AcceptRealtimeMessage } from './types';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createBroadcastGraphicsRealtimeHandlers({ accept }: Options) {
	return {
		'broadcastGraphicsSession:commandApplied': accept(
			'broadcastGraphicsSession:commandApplied',
			data => useBroadcastGraphicsSessionStore().applyRemoteCommand(data),
		),
	};
}

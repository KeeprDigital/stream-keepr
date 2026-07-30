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
		// An epoch ending is not a command and carries no state to apply: the store
		// discards what it holds for that Screen and reloads the authority.
		'broadcastGraphicsLiveSession:epochEnded': accept(
			'broadcastGraphicsLiveSession:epochEnded',
			data => useBroadcastGraphicsLiveSessionStore().applyEpochEnded(data),
		),
	};
}

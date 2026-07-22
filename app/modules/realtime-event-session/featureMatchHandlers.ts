import type { AcceptRealtimeMessage } from './types';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createFeatureMatchRealtimeHandlers({ accept }: Options) {
	return {
		'featureMatch:created': accept('featureMatch:created', data => useFeatureMatchStore().applyRemoteCreated(data)),
		'featureMatch:updated': accept('featureMatch:updated', data => useFeatureMatchStore().applyRemoteUpdated(data)),
		'featureMatch:deleted': accept('featureMatch:deleted', data => useFeatureMatchStore().applyRemoteDeleted(data)),
		'featureMatch:reordered': accept('featureMatch:reordered', data => useFeatureMatchStore().applyRemoteReordered(data)),
		'featureMatchSession:eventApplied': accept('featureMatchSession:eventApplied', data => useFeatureMatchStateStore().applyRemoteSessionEvent(data)),
	};
}

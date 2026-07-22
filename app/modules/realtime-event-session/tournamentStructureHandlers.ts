import type { AcceptRealtimeMessage } from './types';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createTournamentStructureRealtimeHandlers({ accept }: Options) {
	return {
		'phase:created': accept('phase:created', data => usePhaseStore().applyRemoteCreated(data)),
		'phase:updated': accept('phase:updated', data => usePhaseStore().applyRemoteUpdated(data)),
		'phase:deleted': accept('phase:deleted', data => usePhaseStore().applyRemoteDeleted(data)),

		'round:created': accept('round:created', data => useRoundStore().applyRemoteCreated(data)),
		'round:updated': accept('round:updated', data => useRoundStore().applyRemoteUpdated(data)),
		'round:deleted': accept('round:deleted', data => useRoundStore().applyRemoteDeleted(data)),
		'round:matchesRefreshed': accept('round:matchesRefreshed', data => useMatchStore().applyRemoteMatchesRefreshed(data)),

		'match:created': accept('match:created', data => useMatchStore().applyRemoteCreated(data)),
		'match:updated': accept('match:updated', data => useMatchStore().applyRemoteUpdated(data)),
		'match:deleted': accept('match:deleted', data => useMatchStore().applyRemoteDeleted(data)),
	};
}

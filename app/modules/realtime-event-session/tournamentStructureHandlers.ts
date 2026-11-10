import type { AcceptRealtimeMessage } from './types';

interface Options {
	accept: AcceptRealtimeMessage;
}

export function createTournamentStructureRealtimeHandlers({ accept }: Options) {
	const { refreshAfterPhaseDelete, refreshAfterRoundDelete } = useTournamentStructureRefresh();
	const eventStore = useEventStore();

	/**
	 * A delete's cascade is re-read through the operator's private reads, which a
	 * rendering of a Screen — holding only its output Event context — skips (#604).
	 */
	async function forOperator(refresh: (eventId: number) => Promise<void>, eventId: number) {
		if (eventStore.event)
			await refresh(eventId);
	}

	return {
		'phase:created': accept('phase:created', data => usePhaseStore().applyRemoteCreated(data)),
		'phase:updated': accept('phase:updated', data => usePhaseStore().applyRemoteUpdated(data)),
		'phase:deleted': accept('phase:deleted', async (data) => {
			usePhaseStore().applyRemoteDeleted(data);
			await forOperator(refreshAfterPhaseDelete, data.eventId);
		}),

		'round:created': accept('round:created', data => useRoundStore().applyRemoteCreated(data)),
		'round:updated': accept('round:updated', data => useRoundStore().applyRemoteUpdated(data)),
		'round:deleted': accept('round:deleted', async (data) => {
			useRoundStore().applyRemoteDeleted(data);
			await forOperator(refreshAfterRoundDelete, data.eventId);
		}),
		'round:matchesRefreshed': accept('round:matchesRefreshed', data => useMatchStore().applyRemoteMatchesRefreshed(data)),

		'match:created': accept('match:created', data => useMatchStore().applyRemoteCreated(data)),
		'match:updated': accept('match:updated', data => useMatchStore().applyRemoteUpdated(data)),
		'match:deleted': accept('match:deleted', data => useMatchStore().applyRemoteDeleted(data)),
	};
}

/**
 * Re-read what a Phase or Round delete reached beyond itself. The server
 * cascades the delete — a Phase's Rounds, a Round's Matches, the Match a
 * Feature Match Slot showed — and announces only the Phase or Round, so the
 * deleting client and its peers both re-read the rest. Only what a store
 * already holds is re-read; nothing held has nothing stale.
 */
export function useTournamentStructureRefresh() {
	const roundStore = useRoundStore();
	const featureMatchStore = useFeatureMatchStore();
	const { refreshCurrentMatchScope } = useMeleeDataRefresh();

	async function refreshAfterRoundDelete(eventId: number) {
		await Promise.all([
			featureMatchStore.isLoaded && featureMatchStore.loadFeatureMatchesByEventId(eventId),
			refreshCurrentMatchScope(eventId),
		]);
	}

	async function refreshAfterPhaseDelete(eventId: number) {
		// Rounds first: the Match scope to re-read depends on which Rounds remain.
		if (roundStore.isLoaded)
			await roundStore.loadRoundsByEventId(eventId);
		await refreshAfterRoundDelete(eventId);
	}

	return { refreshAfterPhaseDelete, refreshAfterRoundDelete };
}

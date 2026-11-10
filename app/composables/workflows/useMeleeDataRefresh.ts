import { clearPlayerDeckCache } from '~/composables/data/usePlayerDeckCache';

/**
 * Keep local Melee-derived projections aligned after aggregate server changes.
 * Aggregate realtime messages are origin-gated, so callers also use these
 * refreshes directly after their own successful requests.
 */
export function useMeleeDataRefresh() {
	const phaseStore = usePhaseStore();
	const roundStore = useRoundStore();
	const matchStore = useMatchStore();
	const playerStore = usePlayerStore();
	const playerDeckStore = usePlayerDeckStore();
	const featureMatchStore = useFeatureMatchStore();
	const metagameStore = useMetagameStore();

	/**
	 * Re-read the Matches held, in the scope they are held in. Answers what the
	 * load answered, `null` when it did not land, and nothing when none are held.
	 */
	async function refreshCurrentMatchScope(eventId: number) {
		if (!matchStore.isLoaded)
			return;

		if (matchStore.loadedRoundId != null && roundStore.rounds.some(round => round.id === matchStore.loadedRoundId))
			return await matchStore.loadMatchesByRoundId(eventId, matchStore.loadedRoundId);

		return await matchStore.loadMatchesByEventId(eventId);
	}

	async function refreshMeleeStructureData(eventId: number) {
		// A deck collection's phaseIds are derived from the current Melee format
		// mapping, so structure reconciliation invalidates that cached projection.
		clearPlayerDeckCache();
		await Promise.all([
			phaseStore.loadPhasesByEventId(eventId),
			roundStore.loadRoundsByEventId(eventId),
		]);
		await Promise.all([
			featureMatchStore.loadFeatureMatchesByEventId(eventId),
			refreshCurrentMatchScope(eventId),
		]);
	}

	async function refreshAfterMeleeReset(eventId: number) {
		metagameStore.applyRemoteInvalidated();
		clearPlayerDeckCache();

		await Promise.all([
			phaseStore.loadPhasesByEventId(eventId),
			// Rounds first: the Match scope to re-read depends on which Rounds the
			// reset kept, and a kept manual Round keeps its Matches (ADR-0040).
			roundStore.loadRoundsByEventId(eventId).then(async () => await refreshCurrentMatchScope(eventId)),
			playerStore.loadPlayersByEventId(eventId),
			playerDeckStore.loadByEventId(eventId),
			featureMatchStore.loadFeatureMatchesByEventId(eventId),
		]);
	}

	return {
		refreshCurrentMatchScope,
		refreshMeleeStructureData,
		refreshAfterMeleeReset,
	};
}

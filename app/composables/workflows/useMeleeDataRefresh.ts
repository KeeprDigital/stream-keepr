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

	async function refreshCurrentMatchScope(eventId: number) {
		if (!matchStore.isLoaded)
			return;

		if (matchStore.loadedRoundId != null) {
			if (!roundStore.rounds.some(round => round.id === matchStore.loadedRoundId)) {
				await matchStore.loadMatchesByEventId(eventId);
				return;
			}
			await matchStore.loadMatchesByRoundId(eventId, matchStore.loadedRoundId);
			return;
		}

		await matchStore.loadMatchesByEventId(eventId);
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
			roundStore.loadRoundsByEventId(eventId),
			matchStore.loadMatchesByEventId(eventId),
			playerStore.loadPlayersByEventId(eventId),
			playerDeckStore.loadByEventId(eventId),
			featureMatchStore.loadFeatureMatchesByEventId(eventId),
		]);
	}

	return {
		refreshMeleeStructureData,
		refreshAfterMeleeReset,
	};
}

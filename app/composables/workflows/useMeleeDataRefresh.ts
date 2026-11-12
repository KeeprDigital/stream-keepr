import type { EventDataLoadOptions } from '~/modules/event-data/lifecycle';
import { clearPlayerDeckCache } from '~/composables/data/usePlayerDeckCache';

/** The load options a refresh was given, passed on to each Event Data reload as given. */
type GivenLoadOptions = [load?: EventDataLoadOptions];

/** Waits for every reload, so one that fails holds none back, then raises the first failure. */
async function settleThenRaise(reloads: Array<Promise<unknown>>) {
	const failed = (await Promise.allSettled(reloads)).find(reload => reload.status === 'rejected');
	if (failed)
		throw failed.reason;
}

/**
 * Keep local Melee-derived projections aligned after aggregate server changes.
 * Aggregate realtime messages are origin-gated, so callers also use these
 * refreshes directly after their own successful requests.
 *
 * A failed Event Data reload is its store's to show, and the refresh answers as if
 * it had landed. A caller that tells the operator its own command committed but
 * the reload did not passes `{ failure: 'raise' }`, and the refresh raises the
 * failure once every reload has settled.
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
	async function refreshCurrentMatchScope(eventId: number, ...load: GivenLoadOptions) {
		if (!matchStore.isLoaded)
			return;

		if (matchStore.loadedRoundId != null && roundStore.rounds.some(round => round.id === matchStore.loadedRoundId))
			return await matchStore.loadMatchesByRoundId(eventId, matchStore.loadedRoundId, ...load);

		return await matchStore.loadMatchesByEventId(eventId, ...load);
	}

	async function refreshMeleeStructureData(eventId: number, ...load: GivenLoadOptions) {
		// A deck collection's phaseIds are derived from the current Melee format
		// mapping, so structure reconciliation invalidates that cached projection.
		clearPlayerDeckCache();
		const structure = [
			phaseStore.loadPhasesByEventId(eventId, ...load),
			roundStore.loadRoundsByEventId(eventId, ...load),
		];
		await Promise.allSettled(structure);
		await settleThenRaise([
			...structure,
			featureMatchStore.loadFeatureMatchesByEventId(eventId, ...load),
			refreshCurrentMatchScope(eventId, ...load),
		]);
	}

	async function refreshAfterMeleeReset(eventId: number, ...load: GivenLoadOptions) {
		metagameStore.applyRemoteInvalidated();
		clearPlayerDeckCache();

		await settleThenRaise([
			phaseStore.loadPhasesByEventId(eventId, ...load),
			// Rounds first: the Match scope to re-read depends on which Rounds the
			// reset kept, and a kept manual Round keeps its Matches (ADR-0040).
			roundStore.loadRoundsByEventId(eventId, ...load).finally(async () => await refreshCurrentMatchScope(eventId, ...load)),
			playerStore.loadPlayersByEventId(eventId, ...load),
			playerDeckStore.loadByEventId(eventId),
			featureMatchStore.loadFeatureMatchesByEventId(eventId, ...load),
		]);
	}

	return {
		refreshCurrentMatchScope,
		refreshMeleeStructureData,
		refreshAfterMeleeReset,
	};
}

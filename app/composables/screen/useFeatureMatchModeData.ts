import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { FeatureMatch } from '~/types';

export function useFeatureMatchModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('feature-match');

	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();

	const displayData = useBroadcastDisplayData<null>({ initialData: null });
	const loading = displayData.loading;
	const error = displayData.error;

	const match = computed<FeatureMatch | null>(() => {
		if (!config.value.featureMatchId)
			return null;
		return featureMatchStore.featureMatches.find(m => m.id === config.value.featureMatchId) ?? null;
	});

	const matchState = computed<FeatureMatchState | null>(() => {
		if (!config.value.featureMatchId)
			return null;
		return featureMatchStateStore.featureMatchStates.get(config.value.featureMatchId) ?? null;
	});

	async function loadFeatureMatchData(matchId: number) {
		const evtId = eventId.value;
		if (!evtId) {
			error.value = 'No event loaded';
			displayData.clear();
			return;
		}

		await displayData.refresh(async () => {
			if (featureMatchStore.currentEventId !== evtId || !featureMatchStore.isLoaded) {
				await featureMatchStore.loadFeatureMatchesByEventId(evtId);
			}

			if (featureMatchStateStore.currentEventId !== evtId || !featureMatchStateStore.featureMatchStates.has(matchId)) {
				await featureMatchStateStore.loadState(evtId, matchId);
			}

			return null;
		}, 'Failed to load feature match data');
	}

	watch(
		() => [eventId.value, config.value.featureMatchId] as const,
		async ([evtId, matchId]) => {
			if (!matchId) {
				displayData.clear();
				return;
			}

			if (!evtId) {
				error.value = 'No event loaded';
				displayData.clear();
				return;
			}

			await loadFeatureMatchData(matchId);
		},
		{ immediate: true },
	);

	/**
	 * Feature Match Session state missed while this client was suspended is never
	 * delivered late, so what is on screen sits at the last command that arrived
	 * until the next one does — which on a slow match can be minutes (#307).
	 *
	 * `loadState` rather than `loadFeatureMatchData`: the loader above skips the
	 * fetch for a match whose state is already cached, which is right on a config
	 * change and exactly wrong here, since the cached state is the stale thing being
	 * corrected. The store's own loader always re-reads.
	 */
	useReconnectResync(() => {
		const evtId = eventId.value;
		const matchId = config.value.featureMatchId;
		if (!evtId || !matchId)
			return;

		void featureMatchStateStore.loadState(evtId, matchId);
	});

	return {
		config,
		match,
		matchState,
		loading,
		error,
	};
}

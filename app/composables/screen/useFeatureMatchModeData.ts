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

	return {
		config,
		match,
		matchState,
		loading,
		error,
	};
}

import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { FeatureMatch } from '~/types';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';

export function useFeatureMatchModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('feature-match');

	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const outputReads = useScreenOutputReads();
	onScopeDispose(featureMatchStateStore.readSessionsAsScreenOutput(outputReads.featureMatchSession));

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

	/**
	 * The Slot and its Session come through the Screen (#604), and are held in
	 * the stores so `featureMatch:updated` and Session events keep them live.
	 */
	async function loadFeatureMatchData(matchId: number) {
		if (!outputReads.scope.value) {
			error.value = 'No event loaded';
			displayData.clear();
			return;
		}

		await displayData.refresh(async () => {
			const { slot } = await outputReads.featureMatchSlot(matchId);
			featureMatchStore.holdFeatureMatch(slot);
			return null;
		}, 'Failed to load feature match data');
	}

	watch(
		() => [eventId.value, config.value.featureMatchId, outputReads.scopeKey.value] as const,
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
	 * The store's `loadState` re-reads the Session through the Screen reader this
	 * composable installed, the same read a sequence gap takes.
	 */
	useReconnectResync(() => {
		const evtId = eventId.value;
		const matchId = config.value.featureMatchId;
		if (!evtId || !matchId)
			return;

		void featureMatchStateStore.loadState(evtId, matchId);
	}, () => eventId.value ? eventRealtimeChannel(eventId.value) : null);

	return {
		config,
		match,
		matchState,
		loading,
		error,
	};
}

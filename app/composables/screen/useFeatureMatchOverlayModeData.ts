import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatch, Match } from '~/types';

export function useFeatureMatchOverlayModeData() {
	const { eventId, previewGuides } = useScreenContext();
	const storedConfig = useScreenModeConfig('feature-match-overlay');
	const previewConfigOverride = ref<FeatureMatchOverlayModeConfig | null>(null);
	const config = computed(() => previewGuides?.value && previewConfigOverride.value ? previewConfigOverride.value : storedConfig.value);
	const eventStore = useEventStore();
	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const phaseStore = usePhaseStore();
	const roundStore = useRoundStore();
	const matchRepo = useMatchRepository();
	const sourceMatch = ref<Match | null>(null);

	const displayData = useBroadcastDisplayData<null>({ initialData: null });
	const loading = displayData.loading;
	const error = displayData.error;

	function isPreviewConfigMessage(message: MessageEvent): message is MessageEvent<{ type: 'feature-match-overlay:preview-config'; config: FeatureMatchOverlayModeConfig }> {
		return message.origin === window.location.origin
			&& message.source === window.parent
			&& typeof message.data === 'object'
			&& message.data !== null
			&& message.data.type === 'feature-match-overlay:preview-config'
			&& typeof message.data.config === 'object'
			&& message.data.config !== null;
	}

	function handlePreviewConfigMessage(message: MessageEvent) {
		if (!previewGuides?.value || !isPreviewConfigMessage(message))
			return;

		previewConfigOverride.value = message.data.config;
	}

	onMounted(() => {
		window.addEventListener('message', handlePreviewConfigMessage);
	});

	onBeforeUnmount(() => {
		window.removeEventListener('message', handlePreviewConfigMessage);
	});

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

	const round = computed(() => sourceMatch.value ? roundStore.getRoundById(sourceMatch.value.roundId) : undefined);
	const phase = computed(() => round.value ? phaseStore.getPhaseById(round.value.phaseId) : undefined);

	watch(
		() => [eventId.value, config.value.featureMatchId, match.value?.matchId] as const,
		async ([evtId, matchId, sourceMatchId]) => {
			if (!evtId) {
				error.value = 'No event loaded';
				displayData.clear();
				return;
			}

			await displayData.refresh(async () => {
				if (featureMatchStore.currentEventId !== evtId || !featureMatchStore.isLoaded) {
					await featureMatchStore.loadFeatureMatchesByEventId(evtId);
				}
				if (matchId && (featureMatchStateStore.currentEventId !== evtId || !featureMatchStateStore.featureMatchStates.has(matchId))) {
					await featureMatchStateStore.loadState(evtId, matchId);
				}
				if (!roundStore.isLoaded)
					await roundStore.loadRoundsByEventId(evtId);
				if (!phaseStore.isLoaded)
					await phaseStore.loadPhasesByEventId(evtId);
				sourceMatch.value = sourceMatchId ? await matchRepo.getById(evtId, sourceMatchId) : null;
				return null;
			}, 'Failed to load broadcast layout data');
		},
		{ immediate: true },
	);

	return { config, match, matchState, sourceMatch, round, phase, event: computed(() => eventStore.event), loading, error };
}

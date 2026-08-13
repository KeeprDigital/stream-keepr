import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatch, Match } from '~/types';
import { isFromExpectedSender } from '~/modules/graphics/previewMessages';

export function useFeatureMatchOverlayModeData() {
	const { eventId, isPreview } = useScreenContext();
	const storedConfig = useScreenModeConfig('feature-match-overlay');
	const previewConfigOverride = ref<FeatureMatchOverlayModeConfig | null>(null);
	/**
	 * An embedded editor preview renders the working configuration the editor
	 * pushes in; a live Screen Output renders the stored one.
	 *
	 * Gated on being a preview rather than on the guides switch: whether an author
	 * is looking at item guides has nothing to do with whether they are looking at
	 * their unsaved edits, and reading the guides flag here meant switching guides
	 * off silently swapped the preview back to the saved configuration.
	 */
	const config = computed(() => isPreview?.value && previewConfigOverride.value ? previewConfigOverride.value : storedConfig.value);
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
		if (!isFromExpectedSender(message, { origin: window.location.origin, source: window.parent }))
			return false;

		const data = message.data as Record<string, unknown>;
		return data.type === 'feature-match-overlay:preview-config'
			&& typeof data.config === 'object'
			&& data.config !== null;
	}

	function handlePreviewConfigMessage(message: MessageEvent) {
		if (!isPreview?.value || !isPreviewConfigMessage(message))
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

	/**
	 * Whether this rendering stands in the canonical Feature Match sample dataset
	 * for the Feature Match it does not have.
	 *
	 * Both halves are necessary. A preview with a Slot selected shows that Slot's
	 * real data, because an author checking a name plate against the actual finalists
	 * is checking something the sample cannot tell them. And a live Screen Output
	 * never substitutes at all, whatever its Slot holds: an unassigned Overlay
	 * renders empty on air, which is the one behaviour sample data must never
	 * change.
	 */
	const usesSampleDataset = computed(() => Boolean(isPreview?.value) && !config.value.featureMatchId);

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

	/**
	 * The Overlay's half of the same rule the Feature Match Screen holds: nothing
	 * arrives late after a suspended connection, so the only way to find out what
	 * was missed is to ask (#307).
	 *
	 * Forced past the `has(matchId)` guard in the loader above for the same reason —
	 * the cached state is what is stale.
	 */
	useReconnectResync(() => {
		const evtId = eventId.value;
		const matchId = config.value.featureMatchId;
		if (!evtId || !matchId)
			return;

		void featureMatchStateStore.loadState(evtId, matchId);
	});

	return { config, match, matchState, sourceMatch, round, phase, event: computed(() => eventStore.event), usesSampleDataset, loading, error };
}

import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatch, Match, Phase, Round } from '~/types';
import { isFeatureMatchOverlayPreviewConfigMessage } from '~/modules/feature-match-overlay/previewMessages';

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
	const outputReads = useScreenOutputReads();
	onScopeDispose(featureMatchStateStore.readSessionsAsScreenOutput(outputReads.featureMatchSession));
	const sourceMatch = ref<Match | null>(null);

	const displayData = useBroadcastDisplayData<null>({ initialData: null });
	const loading = displayData.loading;
	const error = displayData.error;

	function handlePreviewConfigMessage(message: MessageEvent) {
		if (!isPreview?.value || !isFeatureMatchOverlayPreviewConfigMessage(message, {
			origin: window.location.origin,
			source: window.parent,
		})) {
			return;
		}

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

	const round = ref<Round | undefined>(undefined);
	const phase = ref<Phase | undefined>(undefined);

	/**
	 * The Slot, its Session, and the Match, Round and Phase it follows come
	 * through the Screen in one read (#604). The Slot is held in the stores so
	 * `featureMatch:updated` and Session events keep it live; the Slot's Match
	 * changing re-reads the rest.
	 */
	watch(
		() => [eventId.value, config.value.featureMatchId, match.value?.matchId, outputReads.scopeKey.value] as const,
		async ([evtId, matchId]) => {
			if (!evtId || !outputReads.scope.value) {
				error.value = 'No event loaded';
				displayData.clear();
				return;
			}

			await displayData.refresh(async () => {
				if (!matchId) {
					sourceMatch.value = null;
					round.value = undefined;
					phase.value = undefined;
					return null;
				}
				const context = await outputReads.featureMatchSlot(matchId);
				featureMatchStore.holdFeatureMatch(context.slot);
				sourceMatch.value = context.match;
				round.value = context.round ?? undefined;
				phase.value = context.phase ?? undefined;
				return null;
			}, 'Failed to load broadcast layout data');
		},
		{ immediate: true },
	);

	/**
	 * The Overlay's half of the same rule the Feature Match Screen holds: nothing
	 * arrives late after a suspended connection, so the only way to find out what
	 * was missed is to ask (#307), through the Screen reader installed above.
	 */
	useReconnectResync(() => {
		const evtId = eventId.value;
		const matchId = config.value.featureMatchId;
		if (!evtId || !matchId)
			return;

		void featureMatchStateStore.loadState(evtId, matchId);
	}, eventId);

	return { config, match, matchState, sourceMatch, round, phase, event: computed(() => eventStore.displayEvent), usesSampleDataset, loading, error };
}

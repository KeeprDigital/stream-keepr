import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { Match, Phase, Round } from '~/types';
import { isFeatureMatchOverlayPreviewConfigMessage } from '~/modules/feature-match-overlay/previewMessages';

/** What the Overlay keeps of its Slot's read: the Match the Slot follows, and its Round and Phase. */
interface OverlaySlotContext {
	sourceMatch: Match | null;
	round: Round | undefined;
	phase: Phase | undefined;
}

export function useFeatureMatchOverlayModeData() {
	const { isPreview } = useScreenContext();
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
	const config = computed(() => isPreview?.value && previewConfigOverride.value
		? previewConfigOverride.value
		: storedConfig.value);
	const eventStore = useEventStore();

	/**
	 * The Slot, its Session, and the Match, Round and Phase it follows come
	 * through the Screen in one read (#604). The stores hold the Slot and its
	 * Session, which follows through the Live State Follower (#592); the Match,
	 * Round and Phase are held here, and re-read when a message touches them.
	 */
	const slotData = useScreenFeatureMatchSlot<OverlaySlotContext>({
		slotId: () => config.value.featureMatchId,
		keep: read => ({ sourceMatch: read.match, round: read.round ?? undefined, phase: read.phase ?? undefined }),
		initialData: { sourceMatch: null, round: undefined, phase: undefined },
		errorMessage: 'Failed to load broadcast layout data',
		dependsOn: {
			'featureMatch:updated': ({ featureMatch }, held) =>
				featureMatch.id === config.value.featureMatchId && (featureMatch.matchId ?? null) !== (held.sourceMatch?.id ?? null),
			'match:updated': ({ match }, held) => match.id === held.sourceMatch?.id,
			'round:updated': ({ round }, held) => round.id === held.round?.id,
			'phase:updated': ({ phase }, held) => phase.id === held.phase?.id,
		},
	});
	const { slot: match, state: matchState, loading, error } = slotData;
	const sourceMatch = computed(() => slotData.data.value.sourceMatch);
	const round = computed(() => slotData.data.value.round);
	const phase = computed(() => slotData.data.value.phase);

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

	return {
		config,
		match,
		matchState,
		sourceMatch,
		round,
		phase,
		event: computed(() => eventStore.displayEvent),
		usesSampleDataset,
		loading,
		error,
	};
}

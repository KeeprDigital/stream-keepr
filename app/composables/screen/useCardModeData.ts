import type { CardDisplayConfig } from '~~/shared/types/screenConfig';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';

export function useCardModeData() {
	const config = useScreenModeConfig('card');
	const { screen, eventId, cardDataHealth } = useScreenContext();
	const cardStore = useCardStore();
	const outputReads = useScreenOutputReads();
	// A rendering of the Screen reads its Card through the Screen (#604).
	onScopeDispose(cardStore.readActiveCardAsScreenOutput(() => outputReads.card()));

	// Card-screen deck-source loads report their Scryfall degradation through
	// the same seam the Deck List mode uses (#465, #471): the host carries the report
	// to control surfaces via presence instead of showing it on program. The ref
	// is optional — operator-side consumers of the same store have no
	// ScreenContext and load with no health reporting.
	if (cardDataHealth) {
		watch(() => cardStore.cardDataDegraded, (degraded) => {
			cardDataHealth.value = degraded ? 'degraded' : 'complete';
		}, { immediate: true });
		onScopeDispose(() => {
			// A degraded report must not outlive the rendering that measured it.
			cardDataHealth.value = 'complete';
		});
	}

	// Screen ID from context
	const screenId = computed<number | null>(() => screen.value?.id ?? null);

	// Display config strips mode-level properties (matchId)
	// CardDisplay only needs scale + animation settings
	const displayConfig = computed<CardDisplayConfig>(() => {
		const { featureMatchId: _featureMatchId, ...rest } = config.value;
		return rest;
	});

	// Selecting a Screen clears the Card held for the last one, so it happens only
	// when the Screen changes: every other re-read holds program until it answers.
	watch(screenId, id => cardStore.setActiveScreen(id), { immediate: true });

	// The store follows the Card's own messages; this owns re-reading it on
	// reconnection and while realtime is degraded (#610).
	const freshness = useScreenModeFreshness<null>({
		eventId,
		source: () => screenId.value === null
			? null
			: String(screenId.value),
		// A failed read is this module's to retry, so it fails here too (#726). A
		// superseded one does not: something newer already reached the Card.
		read: async () => {
			if (await cardStore.loadActiveCard() === 'failed')
				throw new Error(cardStore.error ?? 'Failed to load card data');
			return null;
		},
		initialData: null,
		errorMessage: 'Failed to load card data',
		dependsOn: {},
	});
	const loading = freshness.loading;
	const error = freshness.error;

	return {
		config,
		displayConfig,
		screenId,
		loading,
		error,
	};
}

import type { CardDisplayConfig } from '~~/shared/types/screenConfig';

export function useCardModeData() {
	const config = useScreenModeConfig('card');
	const { screen, cardDataHealth } = useScreenContext();
	const cardStore = useCardStore();

	// Card-screen deck-source loads report their Scryfall degradation through
	// the same seam the Deck mode uses (#465, #471): the host carries the report
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

	const displayData = useBroadcastDisplayData<null>({ initialData: null });
	const loading = displayData.loading;
	const error = displayData.error;

	// Screen ID from context
	const screenId = computed<number | null>(() => screen.value?.id ?? null);

	// Display config strips mode-level properties (matchId)
	// CardDisplay only needs scale + animation settings
	const displayConfig = computed<CardDisplayConfig>(() => {
		const { featureMatchId: _featureMatchId, ...rest } = config.value;
		return rest;
	});

	async function loadCard() {
		if (!screenId.value) {
			displayData.clear();
			return;
		}

		cardStore.setActiveScreen(screenId.value);
		await displayData.refresh(async () => {
			await cardStore.loadActiveCard();
			return null;
		}, 'Failed to load card data');
	}

	// Reload when screenId changes
	watch(
		() => screenId.value,
		async () => {
			if (!import.meta.client)
				return;
			await loadCard();
		},
	);

	// Initial load
	onMounted(async () => {
		await loadCard();
	});

	return {
		config,
		displayConfig,
		screenId,
		loading,
		error,
	};
}

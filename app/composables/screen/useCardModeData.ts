import type { CardDisplayConfig } from '~~/shared/types/screenConfig';

export function useCardModeData() {
	const config = useScreenModeConfig('card');
	const { screen } = useScreenContext();
	const cardStore = useCardStore();

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

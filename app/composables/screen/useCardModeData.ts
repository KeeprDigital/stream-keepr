import type { Ref } from 'vue';
import type { CardDisplayConfig } from '~~/shared/types/screenConfig';
import type { MtgCard } from '~/types/card/mtg';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';

const CARD_LOAD_FAILED = 'Failed to load card data';

export function useCardModeData() {
	const config = useScreenModeConfig('card');
	const { screen, sampleDataset } = useScreenContext();

	// Screen ID from context
	const screenId = computed<number | null>(() => screen.value?.id ?? null);

	// Display config strips mode-level properties (matchId)
	// CardDisplay only needs the animation settings
	const displayConfig = computed<CardDisplayConfig>(() => {
		const { featureMatchId: _featureMatchId, ...rest } = config.value;
		return rest;
	});

	const { card, loading, error } = sampleDataset
		? holdSampleCard()
		: followScreenCard(screenId);

	return {
		config,
		displayConfig,
		screenId,
		card,
		loading,
		error,
	};
}

/**
 * A Theme preview's Screen Card: the sample's, read once and held here. The
 * Card store holds the loaded Event's Card, and a preview has no Event.
 */
function holdSampleCard() {
	const outputReads = useScreenOutputReads();
	const card = ref<MtgCard | null>(null);
	const error = ref<string | null>(null);
	const loading = ref(true);
	outputReads.card().then(
		(state) => {
			card.value = state.card;
		},
		() => {
			error.value = CARD_LOAD_FAILED;
		},
	).finally(() => {
		loading.value = false;
	});
	return {
		card: computed(() => card.value),
		loading: computed(() => loading.value),
		error: computed(() => error.value),
	};
}

/** The Screen's Card, held by the Card store and kept fresh as it changes. */
function followScreenCard(screenId: Readonly<Ref<number | null>>) {
	const { eventId, cardDataHealth } = useScreenContext();
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
				throw new Error(cardStore.error ?? CARD_LOAD_FAILED);
			return null;
		},
		initialData: null,
		errorMessage: CARD_LOAD_FAILED,
		dependsOn: {},
	});

	return {
		card: computed(() => cardStore.activeCard),
		loading: freshness.loading,
		error: freshness.error,
	};
}

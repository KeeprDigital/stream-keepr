import type { DeckCompanion } from '~~/shared/types/deckCompanion';
import type { DeckListStats } from '~~/shared/types/deckList';
import type { CounterTypeConfig } from '~~/shared/types/game';
import type { HighlanderDeckSummary } from '~~/shared/types/highlander';
import type { PlayerDeckResponse } from '~~/shared/types/metagame';
import type { Player } from '~/types';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { getCounterTypeConfigs } from '~~/shared/config/games';
import { counterConfigsForDeckCounterTypes } from '~~/shared/utils/deckCounters';
import { createDeckLookupCards } from '~~/shared/utils/playerDeck';

interface DeckDisplayState {
	version: number;
	playerId: number;
	/**
	 * When this deck's source record last changed, as epoch milliseconds — the
	 * same freshness signal the deck cache keys on. It is how a still-degraded
	 * rebuild can tell "identical placeholder rendering, keep program" from
	 * "the deck itself changed mid-outage, swap it in" (#465 review).
	 */
	sourceUpdatedAt: number | null;
	playerName: string;
	deckName: string;
	deckColors: string;
	companion: DeckCompanion | null;
	highlander: HighlanderDeckSummary | null;
	deckCounters: CounterTypeConfig[];
	deckStats: Array<{ type: string; count: number }>;
	mainboard: DeckListCardWithData[];
	sideboard: DeckListCardWithData[];
}

function computeDeckStats(cards: Array<{ quantity: number; compartment: string; cardType: string }>): Array<{ type: string; count: number }> {
	const stats: DeckListStats = { creatures: 0, instants: 0, sorceries: 0, enchantments: 0, artifacts: 0, planeswalkers: 0, lands: 0, other: 0 };

	for (const card of cards) {
		if (card.compartment !== 'mainboard') {
			continue;
		}

		const type = card.cardType.toLowerCase();
		if (type.includes('creature')) {
			stats.creatures += card.quantity;
		}
		else if (type.includes('instant')) {
			stats.instants += card.quantity;
		}
		else if (type.includes('sorcery')) {
			stats.sorceries += card.quantity;
		}
		else if (type.includes('enchantment')) {
			stats.enchantments += card.quantity;
		}
		else if (type.includes('artifact')) {
			stats.artifacts += card.quantity;
		}
		else if (type.includes('planeswalker')) {
			stats.planeswalkers += card.quantity;
		}
		else if (type.includes('land')) {
			stats.lands += card.quantity;
		}
		else if (type) {
			stats.other += card.quantity;
		}
	}

	const result: Array<{ type: string; count: number }> = [];
	if (stats.creatures > 0)
		result.push({ type: 'Creatures', count: stats.creatures });
	if (stats.instants > 0)
		result.push({ type: 'Instants', count: stats.instants });
	if (stats.sorceries > 0)
		result.push({ type: 'Sorceries', count: stats.sorceries });
	if (stats.enchantments > 0)
		result.push({ type: 'Enchantments', count: stats.enchantments });
	if (stats.artifacts > 0)
		result.push({ type: 'Artifacts', count: stats.artifacts });
	if (stats.planeswalkers > 0)
		result.push({ type: 'Planeswalkers', count: stats.planeswalkers });
	if (stats.lands > 0)
		result.push({ type: 'Lands', count: stats.lands });
	if (stats.other > 0)
		result.push({ type: 'Other', count: stats.other });

	return result;
}

function deckSourceStamp(updatedAt: Date | string | null | undefined): number | null {
	return updatedAt == null ? null : new Date(updatedAt).getTime();
}

function preloadDeckImage(url: string): Promise<void> {
	return new Promise((resolve) => {
		const image = new Image();
		let settled = false;

		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			resolve();
		};

		image.onload = () => {
			if (typeof image.decode === 'function') {
				image.decode().catch(() => {}).finally(finish);
				return;
			}
			finish();
		};

		image.onerror = finish;
		image.src = url;

		if (image.complete) {
			if (typeof image.decode === 'function') {
				image.decode().catch(() => {}).finally(finish);
				return;
			}
			finish();
		}
	});
}

async function preloadDeckImages(cards: DeckListCardWithData[]) {
	if (!import.meta.client) {
		return;
	}

	const imageUrls = [...new Set(
		cards
			.map(card => card.mtgCard?.imageData?.front?.normal)
			.filter((url): url is string => !!url),
	)];

	await Promise.allSettled(imageUrls.map(preloadDeckImage));
}

export function useDeckModeData() {
	const { eventId, cardDataHealth } = useScreenContext();
	const config = useScreenModeConfig('deck');

	const playerStore = usePlayerStore();
	const deckCache = usePlayerDeckCache();
	const { fetchScryfallCards, buildDeckListArrays } = useScryfallBatch();

	const loading = ref(false);
	const error = ref<string | null>(null);
	const displayedDeck = ref<DeckDisplayState | null>(null);
	const pendingDeck = ref<DeckDisplayState | null>(null);
	const pendingSwapVersion = ref(0);
	let deckVersion = 0;
	let lastRequestedPlayerId: number | null = null;

	/**
	 * The reload-free recovery path (#465): a degraded deck re-fetches itself on
	 * a slow cadence until a load resolves completely, the selection changes, or
	 * the surface goes away. Program keeps the degraded rendering the whole time
	 * — the recovered deck arrives through the ordinary staged swap. Degradation
	 * is deliberately not `error`: an output on program never blanks for missing
	 * card images, and the report lets a control surface say so while the
	 * broadcast output does not.
	 */
	const degradedRefetch = useDegradedRefetch<DeckDisplayState>({
		refetch: () => {
			if (lastRequestedPlayerId !== null) {
				void loadPlayerDeck(lastRequestedPlayerId);
			}
		},
		// Identity is what is on program: a rebuild of the same player's deck
		// whose source record has not changed since carries nothing new.
		isUnchanged: next =>
			displayedDeck.value?.playerId === next.playerId
			&& displayedDeck.value.sourceUpdatedAt === next.sourceUpdatedAt,
		report: (degraded) => {
			if (cardDataHealth) {
				cardDataHealth.value = degraded ? 'degraded' : 'complete';
			}
		},
	});

	const playerName = computed(() => displayedDeck.value?.playerName ?? '');
	const deckName = computed(() => displayedDeck.value?.deckName ?? '');
	const deckColors = computed(() => displayedDeck.value?.deckColors ?? '');
	const companion = computed(() => displayedDeck.value?.companion ?? null);
	const highlander = computed(() => displayedDeck.value?.highlander ?? null);
	const deckCounters = computed(() => displayedDeck.value?.deckCounters ?? []);
	const deckStats = computed(() => displayedDeck.value?.deckStats ?? []);
	const mainboard = computed(() => displayedDeck.value?.mainboard ?? []);
	const sideboard = computed(() => displayedDeck.value?.sideboard ?? []);
	const displayedDeckVersion = computed(() => displayedDeck.value?.version ?? 0);
	const hasDisplayedDeck = computed(() => displayedDeck.value !== null);

	onScopeDispose(() => {
		degradedRefetch.cancel();
		// A degraded report must not outlive the rendering that measured it.
		if (cardDataHealth) {
			cardDataHealth.value = 'complete';
		}
	});

	function clearDeck() {
		displayedDeck.value = null;
		pendingDeck.value = null;
		error.value = null;
	}

	function queuePendingDeck(nextDeck: DeckDisplayState | null) {
		pendingDeck.value = nextDeck;
		pendingSwapVersion.value++;
	}

	function commitPendingDeck() {
		displayedDeck.value = pendingDeck.value;
		pendingDeck.value = null;
		if (displayedDeck.value) {
			error.value = null;
		}
	}

	async function buildDeckDisplayState(player: Player, deckResponse: PlayerDeckResponse): Promise<{ deck: DeckDisplayState; degraded: boolean }> {
		// Map PlayerDeckCardEntry → DeckListCard-compatible shape for Scryfall batch
		const deckCards = deckResponse.cards.map(c => ({
			name: c.name,
			setCode: null as string | null,
			quantity: c.quantity,
			compartment: c.compartment as 'mainboard' | 'sideboard',
			cardType: c.cardType ?? '',
			scryfallId: c.scryfallId,
			deckCounterTypes: c.deckCounterTypes,
			highlanderPoints: c.highlanderPoints,
		}));
		const lookupCards = createDeckLookupCards(deckCards, deckResponse.companion);

		const { cards: cardDataMap, degraded } = await fetchScryfallCards(lookupCards);
		const arrays = buildDeckListArrays(deckCards, cardDataMap);
		const deckCounters = counterConfigsForDeckCounterTypes(
			deckCards.flatMap(card => card.deckCounterTypes ?? []),
			getCounterTypeConfigs('mtg'),
		);
		await preloadDeckImages([...arrays.mainboard, ...arrays.sideboard]);

		return {
			deck: {
				version: ++deckVersion,
				playerId: player.id,
				sourceUpdatedAt: deckSourceStamp(player.updatedAt),
				playerName: player.name,
				deckName: deckResponse.name,
				deckColors: deckResponse.colors,
				companion: deckResponse.companion ?? null,
				highlander: deckResponse.highlander ?? null,
				deckCounters,
				deckStats: computeDeckStats(deckCards),
				mainboard: arrays.mainboard,
				sideboard: arrays.sideboard,
			},
			degraded,
		};
	}

	async function loadPlayerDeck(playerId: number) {
		const flight = degradedRefetch.begin();
		lastRequestedPlayerId = playerId;
		const evtId = eventId.value;
		if (!evtId) {
			if (!displayedDeck.value) {
				error.value = 'No event loaded';
			}
			return;
		}

		error.value = null;

		try {
			const player = await playerStore.getPlayerById(evtId, playerId);
			if (flight.stale) {
				return;
			}

			if (!player) {
				// A degraded rendering keeps re-fetching even when one attempt finds
				// nothing to build from.
				degradedRefetch.keepCadence();
				if (!displayedDeck.value) {
					error.value = 'Player not found';
				}
				return;
			}

			const deckResponse = await deckCache.fetchDeck(playerId, evtId, player.updatedAt);
			if (flight.stale) {
				return;
			}

			if (!deckResponse || deckResponse.cards.length === 0) {
				degradedRefetch.keepCadence();
				if (!displayedDeck.value) {
					error.value = 'Player has no deck list';
				}
				return;
			}

			const { deck: nextDeck, degraded } = await buildDeckDisplayState(player, deckResponse);
			if (flight.stale) {
				return;
			}

			// A still-degraded re-fetch of the unchanged deck keeps the rendering
			// rather than cross-fading to an identical placeholder deck on every
			// cadence tick. A rebuild whose source has since changed carries new
			// cards and must still reach program.
			if (degradedRefetch.completeLoad(degraded, nextDeck) === 'keep') {
				return;
			}

			if (!displayedDeck.value) {
				displayedDeck.value = nextDeck;
				return;
			}

			queuePendingDeck(nextDeck);
		}
		catch (err) {
			console.error('Failed to load player deck:', err);
			if (flight.stale) {
				return;
			}

			degradedRefetch.keepCadence();

			if (!displayedDeck.value) {
				error.value = 'Failed to load deck';
			}
		}
	}

	// Watch for config changes (player ID)
	watch(
		() => config.value.playerId,
		async (newPlayerId) => {
			if (newPlayerId) {
				await loadPlayerDeck(newPlayerId);
			}
			else {
				error.value = null;
				degradedRefetch.settle();
				if (displayedDeck.value) {
					queuePendingDeck(null);
				}
				else {
					clearDeck();
				}
			}
		},
		{ immediate: true },
	);

	return {
		config,
		playerName,
		deckName,
		deckColors,
		companion,
		highlander,
		deckCounters,
		deckStats,
		mainboard,
		sideboard,
		loading,
		error,
		cardDataDegraded: degradedRefetch.degraded,
		hasDisplayedDeck,
		displayedDeckVersion,
		pendingSwapVersion: readonly(pendingSwapVersion),
		commitPendingDeck,
	};
}

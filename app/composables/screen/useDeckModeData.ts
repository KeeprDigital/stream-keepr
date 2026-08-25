import type { BroadcastDeckListEntryResponse, BroadcastDeckListResponse } from '~~/shared/types/broadcastDeckList';
import type { DeckCompanion } from '~~/shared/types/deckCompanion';
import type { DeckListStats } from '~~/shared/types/deckList';
import type { CounterTypeConfig } from '~~/shared/types/game';
import type { HighlanderDeckSummary } from '~~/shared/types/highlander';
import type { PlayerDeckResponse } from '~~/shared/types/metagame';
import type { DeckSource } from '~~/shared/types/screenConfig';
import type { Player } from '~/types';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { getCounterTypeConfigs } from '~~/shared/config/games';
import { counterConfigsForDeckCounterTypes } from '~~/shared/utils/deckCounters';
import { createDeckLookupCards } from '~~/shared/utils/playerDeck';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { DECK_CARD_DATA_REFETCH_MS } from '~/composables/data/useScryfallBatch';

interface DeckDisplayState {
	version: number;
	sourceType: DeckSource['type'];
	sourceKey: string;
	/**
	 * The source's authoritative revision: a Player's update timestamp or a
	 * Broadcast Deck List revision. It is how a still-degraded
	 * rebuild can tell "identical placeholder rendering, keep program" from
	 * "the deck itself changed mid-outage, swap it in" (#465 review).
	 */
	sourceRevision: number | null;
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

function computeDeckStats(cards: Array<{ quantity: number; compartment: string; cardType: string | null }>): Array<{ type: string; count: number }> {
	const stats: DeckListStats = { creatures: 0, instants: 0, sorceries: 0, enchantments: 0, artifacts: 0, planeswalkers: 0, lands: 0, other: 0 };

	for (const card of cards) {
		if (card.compartment !== 'mainboard') {
			continue;
		}

		const type = card.cardType?.toLowerCase() ?? '';
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
	const { screen, eventId, assetCapability, cardDataHealth } = useScreenContext();
	const config = useScreenModeConfig('deck');

	const playerStore = usePlayerStore();
	const deckCache = usePlayerDeckCache();
	const broadcastDeckLists = useScreenOutputBroadcastDeckListRepository();
	const { fetchScryfallCards, buildDeckListArrays } = useScryfallBatch();
	const realtime = tryUseRealtime();

	const loading = ref(false);
	const error = ref<string | null>(null);
	const displayedDeck = ref<DeckDisplayState | null>(null);
	const pendingDeck = ref<DeckDisplayState | null>(null);
	const pendingSwapVersion = ref(0);
	let deckVersion = 0;
	let canonicalRetryTimer: ReturnType<typeof setTimeout> | null = null;

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
			void reloadSelectedSource();
		},
		// Identity is what is on program: a rebuild of the same source whose
		// authoritative revision has not changed carries nothing new.
		isUnchanged: next =>
			displayedDeck.value?.sourceKey === next.sourceKey
			&& displayedDeck.value.sourceRevision === next.sourceRevision,
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
	const sourceType = computed(() => displayedDeck.value?.sourceType ?? null);
	const displayedDeckVersion = computed(() => displayedDeck.value?.version ?? 0);
	const hasDisplayedDeck = computed(() => displayedDeck.value !== null);

	onScopeDispose(() => {
		clearCanonicalRetry();
		degradedRefetch.cancel();
		// A degraded report must not outlive the rendering that measured it.
		if (cardDataHealth) {
			cardDataHealth.value = 'complete';
		}
	});

	function clearDeck() {
		clearCanonicalRetry();
		displayedDeck.value = null;
		pendingDeck.value = null;
		error.value = null;
	}

	function clearCanonicalRetry() {
		if (canonicalRetryTimer !== null) {
			clearTimeout(canonicalRetryTimer);
			canonicalRetryTimer = null;
		}
	}

	function scheduleCanonicalRetry() {
		if (degradedRefetch.keepCadence())
			return;
		clearCanonicalRetry();
		canonicalRetryTimer = setTimeout(() => {
			canonicalRetryTimer = null;
			void reloadSelectedSource();
		}, DECK_CARD_DATA_REFETCH_MS);
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

	interface DeckDisplayInput {
		sourceType: DeckSource['type'];
		sourceKey: string;
		sourceRevision: number | null;
		playerName: string;
		deckName: string;
		deckColors: string;
		cards: Array<{
			name: string;
			setCode: string | null;
			quantity: number;
			compartment: 'mainboard' | 'sideboard';
			cardType: string | null;
			scryfallId: string | null;
			deckCounterTypes?: string[];
			highlanderPoints?: number | null;
		}>;
		companion: DeckCompanion | null;
		highlander: HighlanderDeckSummary | null;
	}

	async function buildDeckDisplayState(input: DeckDisplayInput): Promise<{ deck: DeckDisplayState; degraded: boolean }> {
		const lookupCards = createDeckLookupCards(input.cards, input.companion);
		const { cards: cardDataMap, degraded } = await fetchScryfallCards(lookupCards);
		const arrays = buildDeckListArrays(input.cards, cardDataMap);
		const deckCounters = counterConfigsForDeckCounterTypes(
			input.cards.flatMap(card => card.deckCounterTypes ?? []),
			getCounterTypeConfigs('mtg'),
		);
		await preloadDeckImages([...arrays.mainboard, ...arrays.sideboard]);

		return {
			deck: {
				version: ++deckVersion,
				sourceType: input.sourceType,
				sourceKey: input.sourceKey,
				sourceRevision: input.sourceRevision,
				playerName: input.playerName,
				deckName: input.deckName,
				deckColors: input.deckColors,
				companion: input.companion,
				highlander: input.highlander,
				deckCounters,
				deckStats: computeDeckStats(input.cards),
				mainboard: arrays.mainboard,
				sideboard: arrays.sideboard,
			},
			degraded,
		};
	}

	function playerDisplayInput(player: Player, deckResponse: PlayerDeckResponse): DeckDisplayInput {
		const cards = deckResponse.cards.map(c => ({
			name: c.name,
			setCode: null as string | null,
			quantity: c.quantity,
			compartment: c.compartment as 'mainboard' | 'sideboard',
			cardType: c.cardType ?? '',
			scryfallId: c.scryfallId,
			deckCounterTypes: c.deckCounterTypes,
			highlanderPoints: c.highlanderPoints,
		}));
		return {
			sourceType: 'player',
			sourceKey: `player:${player.id}`,
			sourceRevision: deckSourceStamp(player.updatedAt),
			playerName: player.name,
			deckName: deckResponse.name,
			deckColors: deckResponse.colors,
			cards,
			companion: deckResponse.companion ?? null,
			highlander: deckResponse.highlander ?? null,
		};
	}

	function broadcastDisplayInput(list: BroadcastDeckListResponse): DeckDisplayInput {
		const cards = list.entries
			.filter((entry): entry is BroadcastDeckListEntryResponse & { compartment: 'mainboard' | 'sideboard' } =>
				entry.compartment !== 'companion')
			.map(entry => ({
				name: entry.canonicalName,
				setCode: entry.setCode,
				quantity: entry.quantity,
				compartment: entry.compartment,
				cardType: entry.cardType,
				scryfallId: entry.scryfallId,
				deckCounterTypes: entry.deckCounterTypes,
				highlanderPoints: null,
			}));
		const companionEntry = list.entries.find(entry => entry.compartment === 'companion');
		const companion: DeckCompanion | null = companionEntry
			? {
					cardId: companionEntry.id,
					name: companionEntry.canonicalName,
					scryfallId: companionEntry.scryfallId,
					oracleId: companionEntry.oracleId,
					source: 'manual',
					usesExistingSideboardSlot: false,
				}
			: null;

		return {
			sourceType: 'broadcast',
			sourceKey: `broadcast:${list.id}`,
			sourceRevision: list.revision,
			playerName: list.name,
			deckName: list.archetypeLabel ?? '',
			deckColors: list.colors ?? '',
			cards,
			companion,
			highlander: null,
		};
	}

	function stageLoadedDeck(nextDeck: DeckDisplayState, degraded: boolean) {
		clearCanonicalRetry();
		if (degradedRefetch.completeLoad(degraded, nextDeck) === 'keep')
			return;
		if (!displayedDeck.value) {
			displayedDeck.value = nextDeck;
			return;
		}
		queuePendingDeck(nextDeck);
	}

	async function loadPlayerDeck(playerId: number) {
		const flight = degradedRefetch.begin();
		clearCanonicalRetry();
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

			const { deck: nextDeck, degraded } = await buildDeckDisplayState(playerDisplayInput(player, deckResponse));
			if (flight.stale) {
				return;
			}

			// A still-degraded re-fetch of the unchanged deck keeps the rendering
			// rather than cross-fading to an identical placeholder deck on every
			// cadence tick. A rebuild whose source has since changed carries new
			// cards and must still reach program.
			stageLoadedDeck(nextDeck, degraded);
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

	async function loadBroadcastDeck() {
		const flight = degradedRefetch.begin();
		clearCanonicalRetry();
		const evtId = eventId.value;
		const screenId = screen.value?.id;
		if (!evtId || !screenId) {
			if (!displayedDeck.value)
				error.value = 'No Screen loaded';
			scheduleCanonicalRetry();
			return;
		}

		error.value = null;
		try {
			const detail = await broadcastDeckLists.getSelected(evtId, screenId, assetCapability?.value);
			if (flight.stale)
				return;
			const { deck: nextDeck, degraded } = await buildDeckDisplayState(broadcastDisplayInput(detail));
			if (flight.stale)
				return;
			stageLoadedDeck(nextDeck, degraded);
		}
		catch (err) {
			console.error('Failed to load Broadcast Deck List:', err);
			if (flight.stale)
				return;
			scheduleCanonicalRetry();
			if (!displayedDeck.value)
				error.value = 'Failed to load deck';
		}
	}

	function reloadSelectedSource() {
		const source = config.value.deckSource;
		if (source.type === 'broadcast')
			return loadBroadcastDeck();
		if (source.playerId !== null)
			return loadPlayerDeck(source.playerId);
	}

	watch(
		() => config.value.deckSource,
		async (source) => {
			if (source.type === 'broadcast') {
				await loadBroadcastDeck();
			}
			else if (source.playerId !== null) {
				await loadPlayerDeck(source.playerId);
			}
			else {
				clearCanonicalRetry();
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

	let unsubscribeFromBroadcastUpdates: (() => void) | null = null;
	watch(eventId, (evtId) => {
		unsubscribeFromBroadcastUpdates?.();
		unsubscribeFromBroadcastUpdates = null;
		if (!realtime || !evtId)
			return;
		unsubscribeFromBroadcastUpdates = realtime.onChannel(
			eventRealtimeChannel(evtId),
			'broadcastDeckList:updated',
			(message) => {
				const source = config.value.deckSource;
				if (source.type === 'broadcast' && source.broadcastDeckListId === message.listId)
					void loadBroadcastDeck();
			},
		);
	}, { immediate: true });

	useReconnectResync(() => {
		void reloadSelectedSource();
	}, realtime);

	onScopeDispose(() => {
		unsubscribeFromBroadcastUpdates?.();
	});

	return {
		config,
		sourceType,
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

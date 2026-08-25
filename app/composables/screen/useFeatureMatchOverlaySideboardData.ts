import type { Ref } from 'vue';
import type { PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayDeckData } from '~/modules/feature-match-overlay/tokenValues';
import type { GraphicsDeckListCard } from '~/modules/graphics/renderModel';
import type { FeatureMatch } from '~/types';

const PLAYER_SIDES = ['player1', 'player2'] as const;

/** What one side's load needs, snapshotted per load so a flight is comparable. */
interface SideRequest {
	playerId: number;
	/** The active session snapshot's deck pin for this player, when it has one. */
	deckId: number | null;
}

interface SideboardSourceState {
	sideboards: FeatureMatchOverlayDeckData;
	/**
	 * Per-side source identity: player, source-record freshness, and the deck the
	 * fetch actually resolved. It is how a still-degraded rebuild can tell
	 * "identical placeholder rendering, keep it" from "the source changed
	 * mid-outage, swap it in" — the Deck Screen Mode's rule (#465), held per side.
	 */
	stamps: Record<PlayerSide, string | null>;
}

/**
 * Whether the composition holds at least one Deck List Graphic Item bound to
 * this side, at the top level or inside a Graphic Group. Authored presence is
 * the whole test — deliberately independent of `sideboardRevealed`, so a
 * hidden-but-authored item keeps the cache warm and a reveal never cold-fetches
 * Scryfall on air.
 */
function hasDeckListItem(config: FeatureMatchOverlayModeConfig, side: PlayerSide): boolean {
	for (const item of config.layout.composition.items) {
		if (item.type === 'deck-list' && item.playerSide === side)
			return true;
		if (item.type === 'group' && item.children.some(child => child.type === 'deck-list' && child.playerSide === side))
			return true;
	}
	return false;
}

/**
 * The deck the active Feature Match Session pinned for this player, matched by
 * player rather than by side: the snapshot's sides are swap-aware while the
 * Slot's are not, and the deck belongs to the player either way.
 */
function snapshotDeckId(match: FeatureMatch | null, playerId: number): number | null {
	const snapshot = match?.activeSession?.sourceSnapshot;
	if (!snapshot)
		return null;

	for (const entry of [snapshot.player1, snapshot.player2]) {
		if (entry?.playerId === playerId)
			return entry.data?.deckId ?? null;
	}
	return null;
}

/**
 * Real sideboard card data for the Feature Match Overlay output (#491),
 * resolved client-side through the Deck screen's stack: `usePlayerDeckCache` +
 * `useScryfallBatch` + `useDegradedRefetch`. The server contract is untouched —
 * `FeatureMatchOverlayHostStateInput` stays summary-only, and this joins at the
 * token-values seam via `featureMatchGraphicsContext`'s deck data parameter.
 *
 * Fetch scoping: a side is fetched only while the composition holds at least
 * one `deck-list` item for it. No item, no fetch. Live-follow rides the
 * store-held player record — `player:updated` replaces it, `updatedAt` rolls
 * the deck-cache key, and the watch below re-runs the load.
 *
 * Deck selection ladder: the session snapshot's `deckId` first, because the
 * snapshot pins what this session is actually playing; a pin the collection no
 * longer holds falls back to the cache's own ladder (selected → primary →
 * first). Whole-fetch failure is `null`, an empty sideboard is `[]`, and a card
 * without art carries `imageUrl: null` — three states the render model keeps
 * distinct.
 */
export function useFeatureMatchOverlaySideboardData(
	config: Ref<FeatureMatchOverlayModeConfig>,
	match: Ref<FeatureMatch | null>,
) {
	const { eventId, cardDataHealth } = useScreenContext();
	const playerStore = usePlayerStore();
	const deckCache = usePlayerDeckCache();
	const { fetchScryfallCards, buildDeckListArrays } = useScryfallBatch();

	const sideboards = ref<FeatureMatchOverlayDeckData>({ player1: null, player2: null });
	let displayed: SideboardSourceState = { sideboards: { player1: null, player2: null }, stamps: { player1: null, player2: null } };

	const requests = computed<Record<PlayerSide, SideRequest | null>>(() => {
		const result: Record<PlayerSide, SideRequest | null> = { player1: null, player2: null };
		for (const side of PLAYER_SIDES) {
			const playerId = side === 'player1' ? match.value?.player1Id : match.value?.player2Id;
			if (playerId == null || !hasDeckListItem(config.value, side))
				continue;
			result[side] = { playerId, deckId: snapshotDeckId(match.value, playerId) };
		}
		return result;
	});

	/**
	 * The reload-free recovery path (#465), shared cadence with the Deck Screen
	 * Mode: a degraded rendering re-fetches itself every `DECK_CARD_DATA_REFETCH_MS`
	 * until a load resolves completely, the sources change, or the surface goes
	 * away. Degradation is reported through the screen context's card-data health,
	 * never shown on program.
	 */
	const degradedRefetch = useDegradedRefetch<SideboardSourceState>({
		refetch: () => {
			void load();
		},
		isUnchanged: next =>
			next.stamps.player1 === displayed.stamps.player1
			&& next.stamps.player2 === displayed.stamps.player2,
		report: (degraded) => {
			if (cardDataHealth) {
				cardDataHealth.value = degraded ? 'degraded' : 'complete';
			}
		},
	});

	async function resolveSide(
		evtId: number,
		request: SideRequest | null,
	): Promise<{ cards: ReadonlyArray<GraphicsDeckListCard> | null; degraded: boolean; stamp: string | null }> {
		if (!request)
			return { cards: null, degraded: false, stamp: null };

		const player = playerStore.players.find(p => p.id === request.playerId)
			?? await playerStore.getPlayerById(evtId, request.playerId);
		if (!player)
			return { cards: null, degraded: false, stamp: `${request.playerId}::none` };

		const updatedAtMs = new Date(player.updatedAt).getTime();
		const deck = await deckCache.fetchDeck(player.id, evtId, player.updatedAt, request.deckId != null ? { deckId: request.deckId } : {})
			// A pinned deck the collection no longer holds falls back to the
			// cache's own selection ladder rather than rendering nothing.
			?? (request.deckId != null ? await deckCache.fetchDeck(player.id, evtId, player.updatedAt) : null);
		if (!deck)
			return { cards: null, degraded: false, stamp: `${request.playerId}:${updatedAtMs}:none` };

		const stamp = `${request.playerId}:${updatedAtMs}:${deck.id}`;
		const sideboardCards = deck.cards
			.filter(card => card.compartment === 'sideboard')
			.map(card => ({
				name: card.name,
				setCode: null as string | null,
				quantity: card.quantity,
				compartment: 'sideboard' as const,
				cardType: card.cardType ?? '',
				scryfallId: card.scryfallId,
			}));
		if (sideboardCards.length === 0)
			return { cards: [], degraded: false, stamp };

		const { cards: cardDataMap, degraded } = await fetchScryfallCards(
			sideboardCards.map(card => ({ name: card.name, scryfallId: card.scryfallId })),
		);
		const { sideboard } = buildDeckListArrays(sideboardCards, cardDataMap);

		return {
			cards: sideboard.map(card => ({
				name: card.name,
				quantity: card.quantity,
				// Deck-screen parity: the Scryfall front face at `normal` size.
				imageUrl: card.mtgCard?.imageData?.front?.normal ?? null,
			})),
			degraded,
			stamp,
		};
	}

	async function load() {
		const flight = degradedRefetch.begin();
		const evtId = eventId.value;
		const current = requests.value;

		if (!evtId || (!current.player1 && !current.player2)) {
			// Nothing to fetch: settle the recovery lifecycle rather than leaving a
			// degraded report or a pending re-fetch standing for a cleared surface.
			degradedRefetch.settle();
			displayed = { sideboards: { player1: null, player2: null }, stamps: { player1: null, player2: null } };
			sideboards.value = displayed.sideboards;
			return;
		}

		try {
			// The store-held roster is the live-follow source: `player:updated`
			// replaces records in it, which rolls the freshness key below.
			if (!playerStore.isLoaded)
				await playerStore.loadPlayersByEventId(evtId);
			if (flight.stale)
				return;

			const [player1, player2] = await Promise.all([
				resolveSide(evtId, current.player1),
				resolveSide(evtId, current.player2),
			]);
			if (flight.stale)
				return;

			const next: SideboardSourceState = {
				sideboards: { player1: player1.cards, player2: player2.cards },
				stamps: { player1: player1.stamp, player2: player2.stamp },
			};

			// A still-degraded re-fetch of unchanged sources has nothing better to
			// show than the identical placeholder rendering already up (#465).
			if (degradedRefetch.completeLoad(player1.degraded || player2.degraded, next) === 'keep')
				return;

			displayed = next;
			sideboards.value = next.sideboards;
		}
		catch (err) {
			console.error('Failed to load Feature Match Overlay sideboard data:', err);
			if (flight.stale)
				return;

			// A failed attempt must not end a degraded rendering's recovery cadence,
			// and program keeps what it has rather than blanking on a fetch error.
			degradedRefetch.keepCadence();
		}
	}

	watch(
		() => {
			const current = requests.value;
			const parts: string[] = [String(eventId.value ?? '')];
			for (const side of PLAYER_SIDES) {
				const request = current[side];
				const player = request ? playerStore.players.find(p => p.id === request.playerId) : undefined;
				parts.push(request ? `${request.playerId}:${request.deckId ?? ''}:${player?.updatedAt ?? ''}` : '');
			}
			return parts.join('|');
		},
		() => {
			void load();
		},
		{ immediate: true },
	);

	/**
	 * The deck path's half of the Reconnect Resync rule (#307): a `player:updated`
	 * published while this client was suspended is simply gone, so coming back
	 * re-reads the roster. A record the reload replaces rolls `updatedAt`, which
	 * the watch below keys on; an unchanged roster refetches nothing.
	 */
	useReconnectResync(() => {
		const evtId = eventId.value;
		const current = requests.value;
		if (!evtId || (!current.player1 && !current.player2))
			return;

		void playerStore.loadPlayersByEventId(evtId);
	});

	onScopeDispose(() => {
		degradedRefetch.cancel();
		// A degraded report must not outlive the rendering that measured it.
		if (cardDataHealth) {
			cardDataHealth.value = 'complete';
		}
	});

	return {
		// A computed rather than `readonly()`: the deep-readonly projection would
		// change the card element type the token-values seam consumes.
		sideboards: computed(() => sideboards.value),
		cardDataDegraded: degradedRefetch.degraded,
	};
}

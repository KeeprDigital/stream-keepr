import type { Ref } from 'vue';
import type { PlayerSide } from '~~/shared/types/enums';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlaySideboards } from '~/modules/feature-match-overlay/tokenValues';
import type { GraphicsDeckListCard } from '~/modules/graphics/renderModel';
import type { FeatureMatch } from '~/types';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { selectPlayerDeck } from '~/composables/data/usePlayerDeckCache';

const PLAYER_SIDES = ['player1', 'player2'] as const;

/** What one side's load needs, snapshotted per load so a flight is comparable. */
interface SideRequest {
	playerId: number;
	/** The active session snapshot's deck pin for this player, when it has one. */
	deckId: number | null;
}

interface SideboardSourceState {
	sideboards: FeatureMatchOverlaySideboards;
	/**
	 * Per-side source identity: player, the deck the fetch actually resolved,
	 * and its sideboard — a resolved deck card rewrites that without moving the
	 * Player's revision (#648), and a Player's revision moves without it. It is
	 * how a rebuild tells "identical rendering, keep it" from "the source
	 * changed, swap it in" — the Deck Screen Mode's rule (#465), held per side.
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
 * resolved client-side through the Deck screen's stack: the Screen Output
 * Player read (#604) + `useScryfallBatch` + `useDegradedRefetch`. The server contract is untouched —
 * `FeatureMatchOverlayHostStateInput` stays summary-only, and this joins at the
 * token-values seam via `featureMatchGraphicsContext`'s deck data parameter.
 *
 * Fetch scoping: a side is fetched only while the composition holds at least
 * one `deck-list` item for it. No item, no fetch. Live-follow rides
 * `player:updated`: a revision other than the one last read re-runs the load,
 * as does a `playerDeck:cardsResolved` naming either side's Player.
 *
 * Deck selection ladder: the session snapshot's `deckId` first, because the
 * snapshot pins what this session is actually playing; a pin the collection no
 * longer holds falls back to the collection's own ladder (selected → primary →
 * first). Whole-fetch failure is `null`, an empty sideboard is `[]`, and a card
 * without art carries `imageUrl: null` — three states the render model keeps
 * distinct. One deliberate narrowing of the failure rule: a load that throws
 * once a rendering is already up keeps that rendering rather than nulling it — an
 * output on program never blanks for a fetch error, the same stance the Deck
 * Screen Mode takes — so `null` describes a side that never resolved, not one
 * that failed most recently.
 */
export function useFeatureMatchOverlaySideboardData(
	config: Ref<FeatureMatchOverlayModeConfig>,
	match: Ref<FeatureMatch | null>,
) {
	const { eventId, cardDataHealth } = useScreenContext();
	const outputReads = useScreenOutputReads();
	const realtime = tryUseRealtime();
	const { fetchScryfallCards, buildDeckListArrays } = useScryfallBatch();

	const sideboards = ref<FeatureMatchOverlaySideboards>({ player1: null, player2: null });
	let displayed: SideboardSourceState = {
		sideboards: { player1: null, player2: null },
		stamps: { player1: null, player2: null },
	};
	/** The Player revision each side last read, which `player:updated` is judged against. */
	let readRevisions: Record<PlayerSide, number | null> = { player1: null, player2: null };

	const requests = computed<Record<PlayerSide, SideRequest | null>>(() => {
		const result: Record<PlayerSide, SideRequest | null> = { player1: null, player2: null };
		for (const side of PLAYER_SIDES) {
			const playerId = side === 'player1'
				? match.value?.player1Id
				: match.value?.player2Id;
			if (playerId == null || !hasDeckListItem(config.value, side))
				continue;
			result[side] = {
				playerId,
				deckId: snapshotDeckId(match.value, playerId),
			};
		}
		return result;
	});

	function showsSameSources(next: SideboardSourceState) {
		return next.stamps.player1 === displayed.stamps.player1
			&& next.stamps.player2 === displayed.stamps.player2;
	}

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
		isUnchanged: next => showsSameSources(next),
		report: (degraded) => {
			if (cardDataHealth) {
				cardDataHealth.value = degraded ? 'degraded' : 'complete';
			}
		},
	});

	async function resolveSide(
		request: SideRequest | null,
	): Promise<{ cards: ReadonlyArray<GraphicsDeckListCard> | null; degraded: boolean; stamp: string | null; revision: number | null }> {
		if (!request) {
			return {
				cards: null,
				degraded: false,
				stamp: null,
				revision: null,
			};
		}

		// The Player and their decks come through the Screen (#604).
		const read = await outputReads.playerDecks(request.playerId, request.deckId != null
			? { deckId: request.deckId }
			: {})
			.catch(() => null);
		if (!read) {
			return {
				cards: null,
				degraded: false,
				stamp: `${request.playerId}::none`,
				revision: null,
			};
		}

		const revision = new Date(read.player.updatedAt).getTime();
		// A pinned deck the collection no longer holds falls back to the
		// collection's own selection ladder rather than rendering nothing.
		const deck = selectPlayerDeck(read.decks, request.deckId != null
			? { deckId: request.deckId }
			: {})
		?? (request.deckId != null
			? selectPlayerDeck(read.decks)
			: null);
		if (!deck) {
			return {
				cards: null,
				degraded: false,
				stamp: `${request.playerId}:none`,
				revision,
			};
		}

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
		const stamp = `${request.playerId}:${deck.id}:${JSON.stringify(sideboardCards)}`;
		if (sideboardCards.length === 0) {
			return {
				cards: [],
				degraded: false,
				stamp,
				revision,
			};
		}

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
			revision,
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
			displayed = {
				sideboards: { player1: null, player2: null },
				stamps: { player1: null, player2: null },
			};
			readRevisions = { player1: null, player2: null };
			sideboards.value = displayed.sideboards;
			return;
		}

		try {
			const [player1, player2] = await Promise.all([
				resolveSide(current.player1),
				resolveSide(current.player2),
			]);
			if (flight.stale)
				return;

			readRevisions = { player1: player1.revision, player2: player2.revision };
			const next: SideboardSourceState = {
				sideboards: { player1: player1.cards, player2: player2.cards },
				stamps: { player1: player1.stamp, player2: player2.stamp },
			};

			// A still-degraded re-fetch of unchanged sources has nothing better to
			// show than the identical placeholder rendering already up (#465), and
			// a complete one of unchanged sources has nothing new to show unless
			// it recovers a degraded rendering.
			const wasDegraded = degradedRefetch.degraded.value;
			const outcome = degradedRefetch.completeLoad(player1.degraded || player2.degraded, next);
			if (outcome === 'keep' || (!wasDegraded && showsSameSources(next)))
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
			const parts: string[] = [
				String(eventId.value ?? ''),
			];
			for (const side of PLAYER_SIDES) {
				const request = current[side];
				parts.push(request
					? `${request.playerId}:${request.deckId ?? ''}`
					: '');
			}
			return parts.join('|');
		},
		() => {
			void load();
		},
		{ immediate: true },
	);

	/**
	 * Live-follow of both sides: a `player:updated` whose revision differs from
	 * the one last read re-reads, including one announced while a read is still in
	 * flight, and so does a resolved deck card of either side's Player (#648).
	 * Heard on the Event channel itself, because an output holds no roster for the
	 * message to replace a record in (#604).
	 */
	let unsubscribeFromDeckChanges: Array<() => void> = [];
	watch(eventId, (evtId) => {
		unsubscribeFromDeckChanges.forEach(unsubscribe => unsubscribe());
		unsubscribeFromDeckChanges = [];
		if (!realtime || !evtId)
			return;
		const channel = eventRealtimeChannel(evtId);
		unsubscribeFromDeckChanges.push(realtime.onChannel(channel, 'player:updated', ({ player }) => {
			for (const side of PLAYER_SIDES) {
				if (requests.value[side]?.playerId !== player.id)
					continue;
				if (new Date(player.updatedAt).getTime() !== readRevisions[side]) {
					void load();
					return;
				}
			}
		}));
		unsubscribeFromDeckChanges.push(realtime.onChannel(channel, 'playerDeck:cardsResolved', ({ playerIds }) => {
			const shown = PLAYER_SIDES.flatMap(side => requests.value[side]?.playerId ?? []);
			if (shown.some(playerId => playerIds.includes(playerId)))
				void load();
		}));
	}, { immediate: true });

	/**
	 * The deck path's half of the Reconnect Resync rule (#307): a `player:updated`
	 * published while this client was suspended is simply gone, so coming back
	 * re-reads both sides through the Screen. So does the Event channel's first
	 * attach: the first read goes out as the rendering mounts, before that channel
	 * listens, and an edit published in between was heard by nothing (#733).
	 */
	function reread() {
		const current = requests.value;
		if (!eventId.value || (!current.player1 && !current.player2))
			return;

		void load();
	}
	useReconnectResync(reread, eventId, realtime, { onFirstAttach: reread });

	onScopeDispose(() => {
		unsubscribeFromDeckChanges.forEach(unsubscribe => unsubscribe());
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

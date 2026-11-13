import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import type { DeckModeConfig } from '~~/shared/screenModeConfigs/deck';
import type { ScreenSettingsContext } from '~~/shared/screenModeConfigs/fields';
import type { Seat } from '~~/shared/types/enums';
import type { PlayerDeckResponse } from '~~/shared/types/metagame';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { eventKind } from '~~/shared/config/games';
import { getMtgGameData, getOpGameData } from '~~/shared/utils/gameData';
import { withFollowedFeatureMatchSession } from '~/utils/featureMatchFollowedSession';

/** How many cards each board of a Deck List lays out. */
export type DeckBoardCards = NonNullable<ScreenSettingsContext['deckBoardCards']>;

/**
 * A Magic: The Gathering Deck List's cards per board, as its display lays them
 * out: one per entry, and a shown companion first among the sideboard's, not
 * listed twice.
 */
function magicBoardCards(
	entries: readonly { name: string; compartment: string }[],
	companion: string | null,
): DeckBoardCards {
	const sideboard = entries.filter(entry => entry.compartment === 'sideboard');
	return {
		mainboard: entries.filter(entry => entry.compartment === 'mainboard').length,
		sideboard: companion === null
			? sideboard.length
			: 1 + sideboard.filter(entry => entry.name !== companion).length,
	};
}

/** A One Piece Card Game Deck List, held by reference: its Mainboard's copies, and no sideboard. */
function onePieceBoardCards(reference: { mainboardCount: number } | null | undefined): DeckBoardCards | undefined {
	return reference
		? { mainboard: reference.mainboardCount, sideboard: 0 }
		: undefined;
}

/**
 * How many cards each board of a Deck List Screen lays out, as its settings
 * page knows them, so a board's columns run no further than its cards
 * (ADR-0054). It reads only what the page already holds or already reads, and
 * follows the Deck Source and its Deck List live.
 *
 * A card is one Deck List entry, a grid cell, never a copy. Where the page
 * holds only copies, the count is those: looser, and never under the cells.
 *
 * - **A Magic Player:** the Deck List the Screen shows, read through the deck
 *   cache, as the board toggles read it.
 * - **A Broadcast Deck List:** its entries where the list is loaded at its
 *   summary's revision; otherwise its summary's copies.
 * - **A Feature Match Slot side, or a One Piece Player:** the Mainboard copies
 *   their Deck List reference carries.
 *
 * `undefined` while no Deck List is resolved: nothing selected, still being
 * read, or a read that failed.
 */
export function useDeckBoardCards(
	config: MaybeRefOrGetter<Partial<DeckModeConfig>>,
	eventId: MaybeRefOrGetter<number>,
): ComputedRef<DeckBoardCards | undefined> {
	const eventStore = useEventStore();
	const playerStore = usePlayerStore();
	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const broadcastDeckListStore = useBroadcastDeckListStore();
	const deckCache = usePlayerDeckCache();

	const deckSource = computed(() => toValue(config).deckSource);
	const showsCompanion = computed(() => toValue(config).showCompanion !== false);
	const game = computed(() => eventStore.event?.game);

	const player = computed(() => {
		const source = deckSource.value;
		return source?.type === 'player' && source.playerId !== null
			? playerStore.players.find(candidate => candidate.id === source.playerId)
			: undefined;
	});

	// ── A Magic Player's Deck List, read again whenever the Player's revision moves ──

	/** The Deck List last read, and whose: another Player's counts nothing, and a re-read keeps it until answered. */
	const playerDeck = shallowRef<{ playerId: number; deck: PlayerDeckResponse } | null>(null);
	const playerDeckReads = createGuardedSequence();
	const playerRead = computed(() => game.value === 'mtg' && player.value
		? { playerId: player.value.id, updatedAt: player.value.updatedAt }
		: null);

	watch(() => playerRead.value && `${playerRead.value.playerId}:${new Date(playerRead.value.updatedAt).getTime()}`, async () => {
		const flight = playerDeckReads.begin();
		const read = playerRead.value;
		if (!read)
			return;
		let deck: PlayerDeckResponse | null = null;
		try {
			deck = await deckCache.fetchDeck(read.playerId, toValue(eventId), read.updatedAt);
		}
		catch {
			// A failed read counts nothing, which leaves the contract's bound.
		}
		if (flight.current) {
			playerDeck.value = deck && { playerId: read.playerId, deck };
		}
	}, { immediate: true });

	function playerBoardCards(): DeckBoardCards | undefined {
		if (!player.value)
			return undefined;
		if (game.value === 'op')
			return onePieceBoardCards(getOpGameData(player.value.gameData).deckList);
		const held = playerDeck.value;
		// A Player whose Deck List holds no cards has none to show.
		if (game.value !== 'mtg' || held?.playerId !== player.value.id || held.deck.cards.length === 0)
			return undefined;
		return magicBoardCards(held.deck.cards, showsCompanion.value
			? held.deck.companion?.name ?? null
			: null);
	}

	function broadcastBoardCards(listId: number): DeckBoardCards | undefined {
		const summary = broadcastDeckListStore.summaries.find(list => list.id === listId);
		const detail = broadcastDeckListStore.details.get(listId);
		if (detail && detail.revision >= (summary?.revision ?? 0)) {
			const companion = detail.entries.find(entry => entry.compartment === 'companion');
			return magicBoardCards(
				detail.entries.map(entry => ({ name: entry.canonicalName, compartment: entry.compartment })),
				showsCompanion.value
					? companion?.canonicalName ?? null
					: null,
			);
		}
		return summary && {
			mainboard: summary.mainboardQuantity,
			sideboard: summary.sideboardQuantity + (summary.hasCompanion && showsCompanion.value
				? 1
				: 0),
		};
	}

	/**
	 * The Seat shows whoever sits there now (ADR-0058): their own Feature Match
	 * Deck List, or a linked Player's Deck List (ADR-0074). A Commander Seat's
	 * Commanders lay out where a Sideboard would, beside its list's Mainboard
	 * (ADR-0087).
	 */
	function slotSideBoardCards(slotId: number | null, side: Seat): DeckBoardCards | undefined {
		const slot = featureMatchStore.featureMatches.find(candidate => candidate.id === slotId);
		if (!slot)
			return undefined;
		const { playerId, data } = featureMatchSidePlayer(withFollowedFeatureMatchSession(slot, featureMatchStateStore), side);
		if (eventStore.event && eventKind(eventStore.event) === 'mtg-commander') {
			const { commanders, featureMatchDeckList } = getMtgGameData(data?.gameData);
			return commanders?.length || featureMatchDeckList
				? { mainboard: featureMatchDeckList?.mainboardCount ?? 0, sideboard: commanders?.length ?? 0 }
				: undefined;
		}
		const gameData = getOpGameData(data?.gameData);
		return onePieceBoardCards(gameData.featureMatchDeckList
			?? (playerId !== null
				? gameData.deckList
				: null));
	}

	return computed(() => {
		const source = deckSource.value;
		switch (source?.type) {
			case 'player':
				return playerBoardCards();
			case 'broadcast':
				return broadcastBoardCards(source.broadcastDeckListId);
			case 'featureMatchSlot':
				return slotSideBoardCards(source.slotId, source.side);
			default:
				return undefined;
		}
	});
}

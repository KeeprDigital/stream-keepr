import type { MaybeRefOrGetter, Ref } from 'vue';
import type { PlayerSide } from '~~/shared/types/enums';
import type { OpLeader } from '~~/shared/types/game';
import type { OpDeckListView } from '~~/shared/types/opDeckList';
import type { FeatureMatch } from '~/types';
import type { OpMatchPlayerDeckData } from '~/types/card/deckList';
import { computed, ref, toValue, watch } from 'vue';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getOpGameData } from '~~/shared/utils/gameData';
import { playerDisplayName } from '~~/shared/utils/playerName';

interface OpCardDeckSourceRuntimeState {
	eventId: MaybeRefOrGetter<number | null | undefined>;
	featureMatches: MaybeRefOrGetter<FeatureMatch[]>;
	loadingDeckList: Ref<boolean>;
	deckListPlayer1: Ref<OpMatchPlayerDeckData | null>;
	deckListPlayer2: Ref<OpMatchPlayerDeckData | null>;
}

/** Where a Slot side's Deck List is read: its own Feature Match Deck List, or its linked Player's (ADR-0074). */
type SideDeckListSource
	= | { owner: 'side'; slotId: number; id: number }
		| { owner: 'player'; playerId: number; id: number };

/** Who a Slot side seats now, and where their Deck List is read. */
interface SeatedSide {
	playerName: string;
	playerId: number | null;
	leader: OpLeader | null;
	source: SideDeckListSource | null;
}

/**
 * Cards page Feature Match Deck Lists on a One Piece Card Game Event.
 *
 * The One Piece counterpart of `useCardDeckSourceRuntime`'s Slot path: an OP
 * Event has no Rounds or Matches (ADR-0057), so a Slot is the only matchup.
 * Each side shows whoever its followed Session seats there (ADR-0058), and
 * reads the Deck List that player's slot data names. A Deck List never changes
 * under its id, so a re-paste, a clear, a Player's Deck List write or a swap
 * reaches the page as a new reference, and the shown Slot reloads.
 */
export function useOpCardDeckSourceRuntime(state: OpCardDeckSourceRuntimeState) {
	const featureMatchStateStore = useFeatureMatchStateStore();
	const playerDeckLists = useOpPlayerDeckListRepository();
	const featureMatchDeckLists = useFeatureMatchDeckListRepository();

	function seatedSide(slot: FeatureMatch, side: PlayerSide): SeatedSide | null {
		const { playerId, data } = featureMatchSidePlayer(slot, side);
		const playerName = playerDisplayName(data);
		if (!playerName && playerId === null)
			return null;
		const gameData = getOpGameData(data?.gameData);
		const source: SideDeckListSource | null = gameData.featureMatchDeckList
			? { owner: 'side', slotId: slot.id, id: gameData.featureMatchDeckList.id }
			: gameData.deckList && playerId !== null
				? { owner: 'player', playerId, id: gameData.deckList.id }
				: null;
		return {
			playerName,
			playerId,
			leader: gameData.leader ?? null,
			source,
		};
	}

	function findSlot(slotId: number): FeatureMatch | null {
		const slot = toValue(state.featureMatches).find(candidate => candidate.id === slotId);
		return slot
			? withFollowedFeatureMatchSession(slot, featureMatchStateStore)
			: null;
	}

	/** Both sides of a Slot, in the order its followed Session seats them. */
	function slotSides(slotId: number): [SeatedSide | null, SeatedSide | null] | null {
		const slot = findSlot(slotId);
		return slot
			? [
					seatedSide(slot, 'player1'),
					seatedSide(slot, 'player2'),
				]
			: null;
	}

	/** Whether either side of the Slot holds a Deck List. */
	function slotHoldsDeckLists(slotId: number): boolean {
		return slotSides(slotId)?.some(side => side?.source != null) ?? false;
	}

	const canUseDeckListMode = computed(() =>
		toValue(state.featureMatches).some(slot => slotHoldsDeckLists(slot.id)),
	);

	/** Deck Lists read so far, by where they were read; a Deck List never changes under its id. */
	const deckListReads = new Map<string, Promise<OpDeckListView | null>>();

	function readDeckList(eventId: number, source: SideDeckListSource): Promise<OpDeckListView | null> {
		const key = source.owner === 'player'
			? `player:${source.playerId}:${source.id}`
			: `side:${source.slotId}:${source.id}`;
		const held = deckListReads.get(key);
		if (held)
			return held;
		const read = source.owner === 'player'
			? playerDeckLists.read(eventId, source.playerId).then(answer => answer.deckList)
			: featureMatchDeckLists.read(eventId, source.slotId, source.id);
		deckListReads.set(key, read);
		// A failed read is tried again next time rather than held.
		read.catch(() => deckListReads.delete(key));
		return read;
	}

	async function sideDeckData(eventId: number, side: SeatedSide | null): Promise<OpMatchPlayerDeckData | null> {
		if (!side)
			return null;
		const shown = {
			playerName: side.playerName,
			playerId: side.playerId,
			leader: side.leader,
		};
		if (!side.source)
			return { ...shown, deckList: null, failed: false };
		try {
			return { ...shown, deckList: await readDeckList(eventId, side.source), failed: false };
		}
		catch (err) {
			console.error('Failed to load Feature Match Deck List:', err);
			return { ...shown, deckList: null, failed: true };
		}
	}

	/** The Feature Match Slot whose Deck Lists the page shows. */
	const shownSlotId = ref<number | null>(null);
	let flight = 0;

	async function runSlotLoad(slotId: number, options: { silent: boolean }) {
		const sides = slotSides(slotId);
		const eventId = toValue(state.eventId);
		if (!sides || !eventId)
			return;

		const current = ++flight;
		if (!options.silent)
			state.loadingDeckList.value = true;
		try {
			const [player1, player2] = await Promise.all(sides.map(side => sideDeckData(eventId, side)));
			if (current !== flight)
				return;
			state.deckListPlayer1.value = player1 ?? null;
			state.deckListPlayer2.value = player2 ?? null;
		}
		finally {
			if (!options.silent && current === flight)
				state.loadingDeckList.value = false;
		}
	}

	const shownSlotKey = computed(() => shownSlotId.value === null
		? null
		: JSON.stringify(slotSides(shownSlotId.value)));

	// A swap, a new Deck List, or any edit to who the shown Slot seats reloads it in place.
	watch([shownSlotId, shownSlotKey], ([slotId, key], [previousSlotId, previousKey]) => {
		if (slotId === null || slotId !== previousSlotId || key === previousKey)
			return;
		void runSlotLoad(slotId, { silent: true });
	});

	/** A Feature Match Slot's two Deck Lists, kept on the sides its followed Session seats each player. */
	async function loadMatchDeckLists(slotId: number) {
		shownSlotId.value = slotId;
		await runSlotLoad(slotId, { silent: false });
	}

	function clearMatchDeckLists() {
		shownSlotId.value = null;
		++flight;
		state.deckListPlayer1.value = null;
		state.deckListPlayer2.value = null;
	}

	function resetDeckSources() {
		clearMatchDeckLists();
		deckListReads.clear();
		state.loadingDeckList.value = false;
	}

	return {
		canUseDeckListMode,
		slotHoldsDeckLists,
		loadMatchDeckLists,
		clearMatchDeckLists,
		resetDeckSources,
	};
}

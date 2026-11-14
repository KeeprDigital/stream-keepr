import type { MaybeRefOrGetter, Ref } from 'vue';
import type { Seat } from '~~/shared/types/enums';
import type { CommanderDeckListEntry } from '~~/shared/types/featureMatchDeckList';
import type { Commander } from '~~/shared/types/game';
import type { FeatureMatch } from '~/types';
import type { CommanderSeatDeckData } from '~/types/card/deckList';
import { computed, ref, toValue, watch } from 'vue';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { commanderMainboard } from '~~/shared/utils/commanderDeckList';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { playerDisplayName } from '~~/shared/utils/playerName';

interface CommanderCardDeckSourceRuntimeState {
	eventId: MaybeRefOrGetter<number | null | undefined>;
	featureMatches: MaybeRefOrGetter<FeatureMatch[]>;
	loadingDeckList: Ref<boolean>;
	/** The Seats of the shown Slot somebody sits in, in Seat order. */
	seats: Ref<CommanderSeatDeckData[]>;
}

/** Who a Seat seats now, and the Deck List their Seat names. */
interface SeatedSeat {
	seat: Seat;
	playerName: string;
	deckName: string | null;
	deckColors: string | null;
	commanders: Commander[];
	deckListId: number | null;
}

/**
 * Cards page Feature Match Deck Lists on a Commander Event (ADR-0087).
 *
 * A Commander Event has no Rounds, Matches or Players, so a Slot is the only
 * thing to pick, as on a One Piece Card Game Event (ADR-0057). Each Seat
 * somebody sits in shows its Commanders, and the Mainboard of the list it
 * holds, each card the printing it was saved as. A list never changes under
 * its id, so a re-paste, a clear, Swap Seats or a change of Commander reaches
 * the page as a change to the Slot, and the shown Slot reloads.
 */
export function useCommanderCardDeckSourceRuntime(state: CommanderCardDeckSourceRuntimeState) {
	const featureMatchStateStore = useFeatureMatchStateStore();
	const deckLists = useFeatureMatchDeckListRepository();
	const { fetchScryfallCards, buildDeckListArrays } = useScryfallBatch();

	function seatedSeat(slot: FeatureMatch, seat: Seat): SeatedSeat | null {
		const { data } = featureMatchSidePlayer(slot, seat);
		const gameData = getMtgGameData(data?.gameData);
		const commanders = gameData.commanders ?? [];
		const playerName = playerDisplayName(data);
		if (!playerName && commanders.length === 0)
			return null;
		return {
			seat,
			playerName,
			deckName: gameData.deckName ?? null,
			deckColors: gameData.deckColors ?? null,
			commanders,
			deckListId: gameData.featureMatchDeckList?.id ?? null,
		};
	}

	/** The Seats of a Slot somebody sits in, as its followed Session seats them. */
	function slotSeats(slotId: number): SeatedSeat[] | null {
		const slot = toValue(state.featureMatches).find(candidate => candidate.id === slotId);
		if (!slot)
			return null;
		const followed = withFollowedFeatureMatchSession(slot, featureMatchStateStore);
		return SEAT_VALUES.flatMap(seat => seatedSeat(followed, seat) ?? []);
	}

	/** Whether a Seat of the Slot holds a deck: its Commanders, with or without a list. */
	function slotHoldsDecks(slotId: number): boolean {
		return slotSeats(slotId)?.some(seat => seat.commanders.length > 0) ?? false;
	}

	const canUseDeckListMode = computed(() =>
		toValue(state.featureMatches).some(slot => slotHoldsDecks(slot.id)),
	);

	/** Lists read so far, by Slot and id; a list never changes under its id. */
	const listReads = new Map<string, Promise<CommanderDeckListEntry[]>>();

	function readList(eventId: number, slotId: number, id: number): Promise<CommanderDeckListEntry[]> {
		const key = `${slotId}:${id}`;
		const held = listReads.get(key);
		if (held)
			return held;
		const read = deckLists.readCommander(eventId, slotId, id).then(list => list.entries);
		listReads.set(key, read);
		// A failed read is tried again next time rather than held.
		read.catch(() => listReads.delete(key));
		return read;
	}

	async function seatDeckData(eventId: number, slotId: number, seat: SeatedSeat): Promise<CommanderSeatDeckData> {
		let entries: CommanderDeckListEntry[] = [];
		let failed = false;
		if (seat.deckListId !== null) {
			try {
				entries = await readList(eventId, slotId, seat.deckListId);
			}
			catch (err) {
				console.error('Failed to load Feature Match Deck List:', err);
				failed = true;
			}
		}
		const asCard = (card: { name: string; scryfallId: string }, quantity: number, cardType: string | null) => ({
			name: card.name,
			scryfallId: card.scryfallId,
			quantity,
			compartment: 'mainboard' as const,
			cardType,
		});
		const commanders = seat.commanders.map(commander => asCard(commander, 1, null));
		const mainboard = commanderMainboard(entries, seat.commanders).map(entry => asCard(entry, entry.quantity, entry.cardType));
		const { cards } = await fetchScryfallCards([
			...commanders,
			...mainboard,
		]);
		return {
			seat: seat.seat,
			playerName: seat.playerName,
			deckName: seat.deckName,
			deckColors: seat.deckColors,
			commanders: buildDeckListArrays(commanders, cards).mainboard,
			mainboard: buildDeckListArrays(mainboard, cards).mainboard,
			failed,
		};
	}

	/** The Feature Match Slot whose Seats the page shows. */
	const shownSlotId = ref<number | null>(null);
	let flight = 0;

	async function runSlotLoad(slotId: number, options: { silent: boolean }) {
		const seats = slotSeats(slotId);
		const eventId = toValue(state.eventId);
		if (!seats || !eventId)
			return;

		const current = ++flight;
		// A reload that overtakes a load still in flight takes its spinner over, and ends it.
		const endsLoading = !options.silent || state.loadingDeckList.value;
		if (!options.silent)
			state.loadingDeckList.value = true;
		try {
			const loaded = await Promise.all(seats.map(seat => seatDeckData(eventId, slotId, seat)));
			if (current === flight)
				state.seats.value = loaded;
		}
		finally {
			if (endsLoading && current === flight)
				state.loadingDeckList.value = false;
		}
	}

	const shownSlotKey = computed(() => shownSlotId.value === null
		? null
		: JSON.stringify(slotSeats(shownSlotId.value)));

	// Swap Seats, a new list, or any edit to who the shown Slot seats reloads it in place.
	watch([shownSlotId, shownSlotKey], ([slotId, key], [previousSlotId, previousKey]) => {
		if (slotId === null || slotId !== previousSlotId || key === previousKey)
			return;
		void runSlotLoad(slotId, { silent: true });
	});

	async function loadMatchDeckLists(slotId: number) {
		shownSlotId.value = slotId;
		await runSlotLoad(slotId, { silent: false });
	}

	function clearMatchDeckLists() {
		shownSlotId.value = null;
		// Whatever was loading is left behind, and its spinner with it.
		++flight;
		state.loadingDeckList.value = false;
		state.seats.value = [];
	}

	function resetDeckSources() {
		clearMatchDeckLists();
		listReads.clear();
	}

	return {
		canUseDeckListMode,
		slotHoldsDecks,
		loadMatchDeckLists,
		clearMatchDeckLists,
		resetDeckSources,
	};
}

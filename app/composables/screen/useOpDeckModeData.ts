import type { OpLeader } from '~~/shared/types/game';
import type { OpDeckListEntry } from '~~/shared/types/opDeckList';
import type { DeckModeConfig } from '~~/shared/types/screenConfig';
import type { ScreenOutputOpPlayerDeckListResponse } from '~~/shared/types/screenOutputReads';
import type { OpDeckLayout } from '~~/shared/utils/opDeckLayout';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { FeatureMatch } from '~/types';
import { catalogueOpLeader } from '~~/shared/utils/card/op';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getOpGameData } from '~~/shared/utils/gameData';
import { opDeckLayout } from '~~/shared/utils/opDeckLayout';
import { playerDisplayName } from '~~/shared/utils/playerName';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { createGuardedSequence } from '~/utils/guardedSequence';
import { preloadImages } from '~/utils/preloadImage';

const DECK_LOAD_FAILED = 'Failed to load deck';
const SLOT_LOAD_FAILED = 'Failed to load Feature Match Slot';

/**
 * A Theme preview's Slot: the sample's, read once and held here. The Feature
 * Match store holds the loaded Event's Slots, and a preview has no Event.
 */
function holdSampleSlot(context: ScreenContext, slotId: () => number | null) {
	const outputReads = useScreenOutputReads(context);
	const slot = shallowRef<FeatureMatch | null>(null);
	const error = ref<string | null>(null);
	const answered = ref(false);
	const id = slotId();
	if (id === null) {
		answered.value = true;
	}
	else {
		outputReads.featureMatchSlot(id).then(
			(read) => {
				slot.value = read.slot;
			},
			() => {
				error.value = SLOT_LOAD_FAILED;
			},
		).finally(() => {
			answered.value = true;
		});
	}
	return {
		slot: computed(() => slot.value),
		error: computed(() => error.value),
		answered: computed(() => answered.value),
	};
}

/** Who the Deck Source shows, and the Deck List they hold. */
interface SideShown {
	playerName: string;
	leader: OpLeader | null;
	deckListId: number | null;
}

/** A Slot side's Deck List: its own Feature Match Deck List, or its linked Player's (ADR-0074). */
type SideDeckList
	= { owner: 'side'; id: number }
		| { owner: 'player'; playerId: number; id: number };

/** A Deck List as read for program. */
interface DeckRead {
	id: number;
	entries: OpDeckListEntry[];
}

/** The Deck List on program, with who it was read for. */
interface DisplayedDeck extends OpDeckLayout {
	deckListId: number;
	side: SideShown;
}

/** What one kind of Deck Source answers: who it shows now, and their Deck List once read. */
interface OpDeckSourceRead {
	/** A Slot or a Player is selected. */
	selected: () => boolean;
	side: Readonly<Ref<SideShown | null>>;
	deck: Readonly<Ref<DeckRead | null>>;
	/** Who the source shows is known: false only while its first read is in flight. */
	answered: Readonly<Ref<boolean>>;
	error: Readonly<Ref<string | null>>;
}

/**
 * One player side of a Feature Match Slot (ADR-0057).
 *
 * The Slot and its Session follow through the stores (`useScreenFeatureMatchSlot`).
 * The side shows whichever player sits there now: the active Session's, or the
 * Slot's while none is (ADR-0058), so a swap shows the other player. That
 * player's slot data names their Deck List by id: the side's own, which a
 * re-paste replaces and a clear removes, or a linked Player's, which every
 * write to it replaces and the Slot then announces (ADR-0074). So the Deck
 * List is read again whenever the id changes; a Deck List never changes under
 * its id.
 *
 * A Theme preview shows the One Piece Screen Mode Sample Dataset's Slot and
 * Deck List, read once, and holds no Slot in the stores.
 */
function useSlotSideSource(context: ScreenContext, config: ComputedRef<DeckModeConfig>): OpDeckSourceRead {
	const { eventId, sampleDataset } = context;
	const outputReads = useScreenOutputReads(context);

	const source = computed(() => {
		const deckSource = config.value.deckSource;
		return deckSource.type === 'featureMatchSlot'
			? deckSource
			: null;
	});
	const slotId = () => source.value?.slotId ?? null;

	const slotRead = sampleDataset
		? holdSampleSlot(context, slotId)
		: useScreenFeatureMatchSlot<null>(context, {
				slotId,
				keep: () => null,
				initialData: null,
				errorMessage: SLOT_LOAD_FAILED,
			});

	const seated = computed(() => {
		const shownSide = source.value?.side;
		if (!shownSide || !slotRead.slot.value)
			return null;
		const { playerId, data } = featureMatchSidePlayer(slotRead.slot.value, shownSide);
		const gameData = getOpGameData(data?.gameData);
		const sideDeckList: SideDeckList | null = gameData.featureMatchDeckList
			? { owner: 'side', id: gameData.featureMatchDeckList.id }
			: gameData.deckList && playerId !== null
				? { owner: 'player', playerId, id: gameData.deckList.id }
				: null;
		return {
			side: {
				playerName: playerDisplayName(data),
				leader: gameData.leader ?? null,
				deckListId: sideDeckList?.id ?? null,
			} satisfies SideShown,
			deckList: sideDeckList,
		};
	});
	const sideDeckList = computed(() => seated.value?.deckList ?? null);

	const deckRead = useScreenModeFreshness<DeckRead | null>({
		eventId,
		source: () => {
			const id = slotId();
			const deckList = sideDeckList.value;
			if (!id || !deckList || !outputReads.scopeKey.value)
				return null;
			return deckList.owner === 'player'
				? `${outputReads.scopeKey.value}:${id}:player:${deckList.playerId}:${deckList.id}`
				: `${outputReads.scopeKey.value}:${id}:${deckList.id}`;
		},
		read: async () => {
			const deckList = sideDeckList.value!;
			return deckList.owner === 'player'
				? (await outputReads.opPlayerDeckList(deckList.playerId)).deckList
				: await outputReads.featureMatchDeckList(slotId()!, deckList.id);
		},
		initialData: null,
		errorMessage: DECK_LOAD_FAILED,
		// A Deck List is never edited in place: its replacement has a new id, which the Slot announces.
		dependsOn: {},
	});

	return {
		selected: () => slotId() !== null,
		side: computed(() => seated.value?.side ?? null),
		deck: deckRead.data,
		answered: slotRead.answered,
		error: computed(() => slotRead.error.value ?? deckRead.error.value ?? null),
	};
}

/** The Leader a Player's Deck List marks, as the catalogue names it; none for an Unresolved Deck Card. */
function deckListLeader(deckList: ScreenOutputOpPlayerDeckListResponse['deckList']): OpLeader | null {
	const entry = deckList?.entries.find(candidate => candidate.number === deckList.leaderNumber);
	return entry?.card
		? catalogueOpLeader(entry.number, entry.card)
		: null;
}

function updatedAtStamp(updatedAt: Date | string | null | undefined): number | null {
	return updatedAt == null
		? null
		: new Date(updatedAt).getTime();
}

/**
 * A Player's own Deck List (ADR-0074), read with the Player through the
 * Screen. Every Deck List write gives the Deck List a new id and rolls the
 * Player's `updatedAt`, as a rename does, so an announced Player at the
 * revision held carries nothing new. A TCG+ Import announces itself, not each
 * Player it wrote, so it is always read again.
 */
function usePlayerSource(context: ScreenContext, config: ComputedRef<DeckModeConfig>): OpDeckSourceRead {
	const outputReads = useScreenOutputReads(context);
	const playerId = () => {
		const deckSource = config.value.deckSource;
		return deckSource.type === 'player'
			? deckSource.playerId
			: null;
	};

	const read = useScreenModeFreshness<ScreenOutputOpPlayerDeckListResponse | null>({
		eventId: context.eventId,
		source: () => {
			const id = playerId();
			return id !== null && outputReads.scopeKey.value
				? `${outputReads.scopeKey.value}:player:${id}`
				: null;
		},
		read: () => outputReads.opPlayerDeckList(playerId()!),
		initialData: null,
		errorMessage: DECK_LOAD_FAILED,
		dependsOn: {
			'player:updated': ({ player }, held) =>
				player.id === playerId() && updatedAtStamp(player.updatedAt) !== updatedAtStamp(held?.player.updatedAt),
			// An import announces itself once rather than each Player it wrote.
			'tcgplus:imported': true,
		},
	});

	return {
		selected: () => playerId() !== null,
		side: computed(() => {
			const answer = read.data.value;
			return answer
				? {
						playerName: playerDisplayName(answer.player),
						leader: deckListLeader(answer.deckList),
						deckListId: answer.deckList?.id ?? null,
					}
				: null;
		}),
		deck: computed(() => read.data.value?.deckList ?? null),
		answered: read.answered,
		error: read.error,
	};
}

/**
 * A One Piece Card Game Deck List Screen's Deck List (ADR-0057, ADR-0074), from
 * its Deck Source followed live: one player side of a Feature Match Slot, or a
 * Player.
 *
 * Program keeps the Deck List it shows, and who it was read for, until the
 * incoming one is read and its images are loaded (ADR-0053). A side or Player
 * holding no Deck List shows nothing.
 */
export function useOpDeckModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'deck');
	const slotSide = useSlotSideSource(context, config);
	const player = usePlayerSource(context, config);
	const source = computed(() => config.value.deckSource.type === 'player'
		? player
		: slotSide);

	const side = computed(() => source.value.side.value);
	const deckListId = computed(() => side.value?.deckListId ?? null);

	const displayed = shallowRef<DisplayedDeck | null>(null);
	const builds = createGuardedSequence();

	/** Lays out the Deck List read for who is shown, once its images have loaded. */
	async function show(read: DeckRead, sideShown: SideShown) {
		const flight = builds.begin();
		const layout = opDeckLayout(read.entries);
		const failed = import.meta.client
			? await preloadImages([
					sideShown.leader?.imageUrl,
					...layout.groups.flatMap(group => group.cards.map(card => card.imageUrl)),
				].filter((url): url is string => !!url))
			: new Set<string>();
		// The source may have moved on while the images loaded, back to what is shown.
		if (flight.stale || deckListId.value !== read.id)
			return;
		// A card whose image failed shows its name instead.
		for (const card of layout.groups.flatMap(group => group.cards)) {
			if (card.imageUrl && failed.has(card.imageUrl))
				card.imageUrl = null;
		}
		displayed.value = { ...layout, deckListId: read.id, side: sideShown };
	}

	watch([
		deckListId,
		() => source.value.deck.value,
	], ([id, read]) => {
		if (id === null || displayed.value?.deckListId === id) {
			// What the source holds is shown, or nothing is: no build in flight may replace it.
			builds.supersede();
			if (id === null)
				displayed.value = null;
			return;
		}
		if (read?.id === id && side.value)
			void show(read, side.value);
	}, { immediate: true });

	/** The Deck List shown is its holder's own: their name and Leader follow live. */
	const shownSide = computed(() => {
		const deck = displayed.value;
		if (!deck)
			return null;
		return side.value && side.value.deckListId === deck.deckListId
			? side.value
			: deck.side;
	});

	const error = computed(() => displayed.value
		? null
		: source.value.error.value);

	/** Rendering Readiness: the source's Deck List is on program, or there is none to show. */
	const ready = computed(() => {
		if (error.value)
			return true;
		if (!source.value.selected())
			return true;
		if (!source.value.answered.value)
			return false;
		return deckListId.value === null || displayed.value?.deckListId === deckListId.value;
	});

	return {
		config,
		displayedDeckListId: computed(() => displayed.value?.deckListId ?? null),
		playerName: computed(() => shownSide.value?.playerName ?? ''),
		leader: computed(() => shownSide.value?.leader ?? null),
		groups: computed(() => displayed.value?.groups ?? []),
		costCurve: computed(() => displayed.value?.costCurve ?? []),
		error,
		ready,
	};
}

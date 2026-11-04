import type { OpLeader } from '~~/shared/types/game';
import type { ScreenOutputFeatureMatchDeckListResponse } from '~~/shared/types/screenOutputReads';
import type { OpDeckLayout } from '~~/shared/utils/opDeckLayout';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { FeatureMatch } from '~/types';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getOpGameData } from '~~/shared/utils/gameData';
import { opDeckLayout } from '~~/shared/utils/opDeckLayout';
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

/** Who sits on the side shown, and the Deck List they hold. */
interface SideShown {
	playerName: string;
	leader: OpLeader | null;
	deckListId: number | null;
}

/** The Deck List on program, with the side it was read for. */
interface DisplayedDeck extends OpDeckLayout {
	deckListId: number;
	side: SideShown;
}

/**
 * A Deck List Screen whose Deck Source is one player side of a Feature Match Slot
 * (ADR-0057), followed live.
 *
 * The Slot and its Session follow through the stores (`useScreenFeatureMatchSlot`).
 * The side shows whichever player sits there now: the active Session's, or the
 * Slot's while none is (ADR-0058), so a swap shows the other player. That
 * player's slot data names their Deck List by id, which a re-paste replaces and
 * a clear removes, so the Deck List is read again whenever the id changes. A
 * Deck List never changes under its id.
 *
 * Program keeps the Deck List it shows, and the side it was read for, until the
 * incoming one is read and its images are loaded (ADR-0053). A side holding no
 * Deck List shows nothing.
 *
 * A Theme preview shows the One Piece Screen Mode Sample Dataset's Slot and
 * Deck List, read once, and holds no Slot in the stores.
 */
export function useFeatureMatchDeckModeData(context: ScreenContext) {
	const { eventId, sampleDataset } = context;
	const config = useScreenModeConfig(context, 'deck');
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

	const side = computed<SideShown | null>(() => {
		const shownSide = source.value?.side;
		if (!shownSide || !slotRead.slot.value)
			return null;
		const { data } = featureMatchSidePlayer(slotRead.slot.value, shownSide);
		const gameData = getOpGameData(data?.gameData);
		return {
			playerName: data?.name ?? '',
			leader: gameData.leader ?? null,
			deckListId: gameData.featureMatchDeckList?.id ?? null,
		};
	});
	const deckListId = computed(() => side.value?.deckListId ?? null);

	const deckRead = useScreenModeFreshness<ScreenOutputFeatureMatchDeckListResponse | null>({
		eventId,
		source: () => {
			const id = slotId();
			return id && deckListId.value && outputReads.scopeKey.value
				? `${outputReads.scopeKey.value}:${id}:${deckListId.value}`
				: null;
		},
		read: () => outputReads.featureMatchDeckList(slotId()!, deckListId.value!),
		initialData: null,
		errorMessage: DECK_LOAD_FAILED,
		// A Deck List is never edited in place: its replacement has a new id, which the Slot announces.
		dependsOn: {},
	});

	const displayed = shallowRef<DisplayedDeck | null>(null);
	const builds = createGuardedSequence();

	/** Lays out the Deck List read for the side shown, once its images have loaded. */
	async function show(read: ScreenOutputFeatureMatchDeckListResponse, sideShown: SideShown) {
		const flight = builds.begin();
		const layout = opDeckLayout(read.entries);
		const failed = import.meta.client
			? await preloadImages([
					sideShown.leader?.imageUrl,
					...layout.groups.flatMap(group => group.cards.map(card => card.imageUrl)),
				].filter((url): url is string => !!url))
			: new Set<string>();
		// The side may have moved on while the images loaded, back to what is shown.
		if (flight.stale || deckListId.value !== read.id)
			return;
		// A card whose image failed shows its name instead.
		for (const card of layout.groups.flatMap(group => group.cards)) {
			if (card.imageUrl && failed.has(card.imageUrl))
				card.imageUrl = null;
		}
		displayed.value = { ...layout, deckListId: read.id, side: sideShown };
	}

	watch([deckListId, deckRead.data], ([id, read]) => {
		if (id === null || displayed.value?.deckListId === id) {
			// What the side holds is shown, or nothing is: no build in flight may replace it.
			builds.supersede();
			if (id === null)
				displayed.value = null;
			return;
		}
		if (read?.id === id && side.value)
			void show(read, side.value);
	}, { immediate: true });

	/** The Deck List shown is the side's own: its name and Leader follow live. */
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
		: slotRead.error.value ?? deckRead.error.value ?? null);

	/** Rendering Readiness: the side's Deck List is on program, or there is none to show. */
	const ready = computed(() => {
		if (error.value)
			return true;
		if (!slotId())
			return true;
		if (!slotRead.answered.value)
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

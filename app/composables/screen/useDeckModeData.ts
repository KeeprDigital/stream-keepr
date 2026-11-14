import type { BroadcastDeckListEntryResponse, BroadcastDeckListResponse } from '~~/shared/types/broadcastDeckList';
import type { DeckCompanion } from '~~/shared/types/deckCompanion';
import type { DeckListStats } from '~~/shared/types/deckList';
import type { Seat } from '~~/shared/types/enums';
import type { CommanderDeckListEntry } from '~~/shared/types/featureMatchDeckList';
import type { Commander } from '~~/shared/types/game';
import type { HighlanderDeckSummary } from '~~/shared/types/highlander';
import type { PlayerDeckResponse } from '~~/shared/types/metagame';
import type { DeckModeConfig, DeckSource } from '~~/shared/types/screenConfig';
import type { ScreenOutputCommanderDeckListResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { Player } from '~/types';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { commanderMainboard } from '~~/shared/utils/commanderDeckList';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { createDeckLookupCards } from '~~/shared/utils/playerDeck';
import { playerDisplayName } from '~~/shared/utils/playerName';
import { selectPlayerDeck } from '~/composables/data/usePlayerDeckCache';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';
import { preloadImages } from '~/utils/preloadImage';

interface DeckDisplayState {
	version: number;
	source: LoadedDeckSource;
	/**
	 * Everything the deck was built from, as one comparable value. It is how a
	 * still-degraded rebuild can tell "identical placeholder rendering, keep
	 * program" from "the deck itself changed mid-outage, swap it in" (#465
	 * review), including a resolved deck card, which moves no revision (#648).
	 */
	inputKey: string;
	primaryHeader: string;
	secondaryHeader: string;
	deckColors: string;
	companion: DeckCompanion | null;
	/** The companion as a card image, shown apart from the deck information. */
	companionCard: DeckListCardWithData | null;
	/** A Commander Seat's Commanders, shown apart from its Mainboard (ADR-0087). */
	commanders: DeckListCardWithData[];
	highlander: HighlanderDeckSummary | null;
	deckStats: Array<{ type: string; count: number }>;
	mainboard: DeckListCardWithData[];
	sideboard: DeckListCardWithData[];
}

/** A Commander Slot's Seat, whose deck is its Commanders and the list it may hold (ADR-0087). */
interface SeatDeckSource {
	type: 'seat';
	slotId: number;
	seat: Seat;
}

type LoadedDeckSource
	= { type: 'player'; playerId: number }
		| { type: 'broadcast'; broadcastDeckListId: number }
		| SeatDeckSource;

/**
 * The Deck Source a configuration selects; `null` while it selects no Player
 * or no Slot. A Slot's Seat is read only where the display follows one: a One
 * Piece Card Game Seat is `useOpDeckModeData`'s.
 */
function selectedDeckSource(source: DeckSource, followsSeat: boolean): LoadedDeckSource | null {
	if (source.type === 'broadcast')
		return { type: 'broadcast', broadcastDeckListId: source.broadcastDeckListId };
	if (source.type === 'featureMatchSlot') {
		return followsSeat && source.slotId !== null
			? { type: 'seat', slotId: source.slotId, seat: source.side }
			: null;
	}
	return source.playerId === null
		? null
		: { type: 'player', playerId: source.playerId };
}

/** One Deck Source as one comparable value. */
function deckSourceKey(source: LoadedDeckSource): string {
	if (source.type === 'seat')
		return `seat:${source.slotId}:${source.seat}`;
	return source.type === 'player'
		? `player:${source.playerId}`
		: `broadcast:${source.broadcastDeckListId}`;
}

function sameDeckSource(left: LoadedDeckSource | null | undefined, right: LoadedDeckSource): boolean {
	return !!left && deckSourceKey(left) === deckSourceKey(right);
}

const DECK_LOAD_FAILED = 'Failed to load deck';

/** Who sits in a Commander Seat now, and the Deck List they hold, once read; no cards while they hold none. */
interface SeatDeckRead {
	type: 'seat';
	source: SeatDeckSource;
	playerName: string;
	commanders: Commander[];
	deckName: string;
	deckColors: string;
	entries: CommanderDeckListEntry[];
}

/** What one read of the selected Deck Source answers. */
type DeckSourceRead
	= { type: 'player'; player: Player; deck: PlayerDeckResponse | null }
		| { type: 'broadcast'; list: BroadcastDeckListResponse }
		| SeatDeckRead;

/** A Seat whose Deck List is named and not yet read: program keeps what it shows. */
const SEAT_READ_PENDING = 'pending';

function computeDeckStats(cards: Array<{ quantity: number; compartment: string; cardType: string | null }>): Array<{ type: string; count: number }> {
	const stats: DeckListStats = {
		creatures: 0,
		instants: 0,
		sorceries: 0,
		enchantments: 0,
		artifacts: 0,
		planeswalkers: 0,
		lands: 0,
		other: 0,
	};

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

async function preloadDeckImages(cards: DeckListCardWithData[]): Promise<boolean> {
	if (!import.meta.client) {
		return false;
	}

	const failedUrls = await preloadImages(
		cards
			.map(card => card.mtgCard?.imageData?.front?.normal)
			.filter((url): url is string => !!url),
	);
	if (failedUrls.size === 0)
		return false;

	for (const card of cards) {
		const url = card.mtgCard?.imageData?.front?.normal;
		if (url && failedUrls.has(url))
			card.mtgCard = null;
	}

	return true;
}

/**
 * A Magic: The Gathering Deck List Screen's deck, from its Deck Source: a
 * Player's, a Broadcast Deck List's, or, where `followsSeat`, a Commander
 * Seat's, followed live as a One Piece Card Game Seat is (ADR-0087).
 */
export function useDeckModeData(context: ScreenContext, { followsSeat = false }: { followsSeat?: boolean } = {}) {
	const { assetCapability, cardDataHealth } = context;
	const config = useScreenModeConfig(context, 'deck');

	const outputReads = useScreenOutputReads(context);
	const broadcastDeckLists = useScreenOutputBroadcastDeckListRepository();
	const { buildDeckListArrays } = useScryfallBatch();

	const displayedDeck = ref<DeckDisplayState | null>(null);
	const pendingDeck = ref<DeckDisplayState | null>(null);
	const pendingSwapVersion = ref(0);
	const buildFailed = ref(false);
	let deckVersion = 0;

	const selectedSource = computed(() => selectedDeckSource(config.value.deckSource, followsSeat));
	const isSelected = (source: LoadedDeckSource) => sameDeckSource(selectedSource.value, source);

	/**
	 * The authoritative read of the selected Deck Source, through the Screen
	 * (#604): its capability reaches the Player the Deck List mode selects, and only
	 * that Player, or the Broadcast Deck List the Screen selects.
	 */
	async function readDeckSource(): Promise<DeckSourceRead | null> {
		const source = selectedSource.value;
		const scope = outputReads.scope.value;
		if (!source || !scope)
			return null;
		// A Seat is followed through the stores, not read here.
		if (source.type === 'seat')
			return null;
		if (source.type === 'player') {
			const { player, decks } = await outputReads.playerDecks(source.playerId);
			return { type: 'player', player, deck: selectPlayerDeck(decks) ?? null };
		}
		const list = await broadcastDeckLists.getSelected(scope.eventId, scope.screenId, assetCapability?.value);
		return { type: 'broadcast', list };
	}

	const freshness = useScreenModeFreshness<DeckSourceRead | null>({
		hearing: useScreenModeHearing(context, 'deck', () => config.value),
		source: () => selectedSource.value && selectedSource.value.type !== 'seat' && outputReads.scopeKey.value
			? `${outputReads.scopeKey.value}:${deckSourceKey(selectedSource.value)}`
			: null,
		read: readDeckSource,
		initialData: null,
		errorMessage: DECK_LOAD_FAILED,
	});

	const seat = followsSeat
		? useSeatDeckRead(context, config, () => selectedSource.value?.type === 'seat'
				? selectedSource.value
				: null)
		: null;

	/** What the selected Deck Source answers now. */
	const sourceRead = computed(() => selectedSource.value?.type === 'seat'
		? seat?.read.value ?? null
		: freshness.data.value);
	/** The source's answer is known: false only while its first read is in flight. */
	const sourceAnswered = computed(() => selectedSource.value?.type === 'seat'
		? !!seat?.answered.value
		: freshness.answered.value);

	/** One build of the deck on program, or of the deck being built for it. */
	interface DeckBuild {
		input: DeckDisplayInput;
		/** What the input holds, as one comparable value. */
		key: string;
		/** A failed build is built again by the next read of the same deck. */
		failed: boolean;
	}
	let built: DeckBuild | null = null;
	const buildKey = (input: DeckDisplayInput) => JSON.stringify(input);

	/**
	 * The reload-free recovery path (#465): a degraded deck rebuilds itself on a
	 * slow cadence until a build resolves completely, the selection changes, or
	 * the surface goes away. Program keeps the degraded rendering the whole time
	 * — the recovered deck arrives through the ordinary staged swap. Degradation
	 * is deliberately not `error`: an output on program never blanks for missing
	 * card images, and the report lets a control surface say so while the
	 * broadcast output does not. Card data is not Event Data: a rebuild re-reads
	 * Scryfall, while the Deck Source stays fresh through the read above.
	 */
	const degradedRefetch = useDegradedRefetch<DeckDisplayState>({
		refetch: () => {
			if (built && isSelected(built.input.source))
				void buildDeck(built.input);
		},
		// Identity is what is on program: a rebuild from the same input carries
		// nothing new.
		isUnchanged: next => displayedDeck.value?.inputKey === next.inputKey,
		report: (degraded) => {
			if (cardDataHealth) {
				cardDataHealth.value = degraded ? 'degraded' : 'complete';
			}
		},
	});

	const primaryHeader = computed(() => displayedDeck.value?.primaryHeader ?? '');
	const secondaryHeader = computed(() => displayedDeck.value?.secondaryHeader ?? '');
	const deckColors = computed(() => displayedDeck.value?.deckColors ?? '');
	const companion = computed(() => displayedDeck.value?.companion ?? null);
	const highlander = computed(() => displayedDeck.value?.highlander ?? null);
	const companionCard = computed(() => displayedDeck.value?.companionCard ?? null);
	const commanders = computed(() => displayedDeck.value?.commanders ?? []);
	const deckStats = computed(() => displayedDeck.value?.deckStats ?? []);
	const mainboard = computed(() => displayedDeck.value?.mainboard ?? []);
	const sideboard = computed(() => displayedDeck.value?.sideboard ?? []);
	const displayedDeckVersion = computed(() => displayedDeck.value?.version ?? 0);
	const hasDisplayedDeck = computed(() => displayedDeck.value !== null);

	const loading = freshness.loading;

	/** Program never blanks for an error: one shows only while nothing is on air. */
	const error = computed(() => {
		if (displayedDeck.value)
			return null;
		const read = sourceRead.value;
		// A Seat nobody sits in shows nothing, and says nothing (ADR-0087).
		if (read && read !== SEAT_READ_PENDING && read.type !== 'seat' && !displayInput(read))
			return 'Player has no deck list';
		return freshness.error.value ?? seat?.error.value ?? (buildFailed.value ? DECK_LOAD_FAILED : null);
	});

	/**
	 * Rendering Readiness: a deck is on program, or there is none to build —
	 * nothing selected, no deck list, or a failure that shows as the error.
	 */
	const ready = computed(() => {
		if (displayedDeck.value || error.value)
			return true;
		const read = sourceRead.value;
		return sourceAnswered.value && read !== SEAT_READ_PENDING && !(read && displayInput(read));
	});

	onScopeDispose(() => {
		degradedRefetch.cancel();
		// A degraded report must not outlive the rendering that measured it.
		if (cardDataHealth) {
			cardDataHealth.value = 'complete';
		}
	});

	function queuePendingDeck(nextDeck: DeckDisplayState | null) {
		pendingDeck.value = nextDeck;
		pendingSwapVersion.value++;
	}

	function commitPendingDeck() {
		displayedDeck.value = pendingDeck.value;
		pendingDeck.value = null;
	}

	/**
	 * What program shows, and nothing else: no Player or Broadcast Deck List
	 * revision. A Player's revision moves with their record on every Round sync,
	 * and an identical deck must not cross-fade to itself.
	 */
	interface DeckDisplayInput {
		source: LoadedDeckSource;
		primaryHeader: string;
		secondaryHeader: string;
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
		/** A Commander Seat's Commanders, each the printing its Seat holds. */
		commanders?: Array<{ name: string; scryfallId: string }>;
	}

	async function buildDeckDisplayState(input: DeckDisplayInput): Promise<{ deck: DeckDisplayState; degraded: boolean }> {
		// Commanders are drawn as the Mainboard's cards are, from one read of card data.
		const commanderCards = (input.commanders ?? []).map(commander => ({
			...commander,
			setCode: null,
			quantity: 1,
			compartment: 'mainboard' as const,
			cardType: '',
		}));
		const lookupCards = createDeckLookupCards([
			...commanderCards,
			...input.cards,
		], input.companion);
		const { cards: cardDataMap, degraded } = await outputReads.cardData(lookupCards);
		const arrays = buildDeckListArrays(input.cards, cardDataMap);
		const commanders = buildDeckListArrays(commanderCards, cardDataMap).mainboard;
		const companionCard = input.companion
			? buildDeckListArrays([
				{
					name: input.companion.name,
					setCode: null,
					quantity: 1,
					compartment: 'sideboard',
					cardType: '',
					scryfallId: input.companion.scryfallId,
				},
			], cardDataMap).sideboard[0] ?? null
			: null;
		const artDegraded = await preloadDeckImages([
			...commanders,
			...arrays.mainboard,
			...arrays.sideboard,
			...(companionCard
				? [companionCard]
				: []),
		]);

		return {
			deck: {
				version: ++deckVersion,
				source: input.source,
				inputKey: buildKey(input),
				primaryHeader: input.primaryHeader,
				secondaryHeader: input.secondaryHeader,
				deckColors: input.deckColors,
				companion: input.companion,
				companionCard,
				commanders,
				highlander: input.highlander,
				deckStats: computeDeckStats(input.cards),
				mainboard: arrays.mainboard,
				sideboard: arrays.sideboard,
			},
			degraded: degraded || artDegraded,
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
			source: { type: 'player', playerId: player.id },
			primaryHeader: player.name,
			secondaryHeader: deckResponse.name,
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
			source: { type: 'broadcast', broadcastDeckListId: list.id },
			primaryHeader: list.name,
			secondaryHeader: list.archetypeLabel ?? '',
			deckColors: list.colors ?? '',
			cards,
			companion,
			highlander: null,
		};
	}

	/** A Seat's deck: its Commanders apart, and every other card of the list it holds as its Mainboard. */
	function seatDisplayInput(read: SeatDeckRead): DeckDisplayInput {
		return {
			source: read.source,
			primaryHeader: read.playerName,
			secondaryHeader: read.deckName,
			deckColors: read.deckColors,
			cards: commanderMainboard(read.entries, read.commanders).map(entry => ({
				name: entry.name,
				setCode: entry.setCode,
				quantity: entry.quantity,
				compartment: 'mainboard' as const,
				cardType: entry.cardType ?? '',
				scryfallId: entry.scryfallId,
				highlanderPoints: null,
			})),
			companion: null,
			highlander: null,
			commanders: read.commanders.map(({ name, scryfallId }) => ({ name, scryfallId })),
		};
	}

	/** What a read shows; `null` for a Player with no deck list, or a Seat nobody sits in. */
	function displayInput(read: DeckSourceRead): DeckDisplayInput | null {
		if (read.type === 'seat') {
			return read.commanders.length > 0 || read.entries.length > 0
				? seatDisplayInput(read)
				: null;
		}
		if (read.type === 'broadcast')
			return broadcastDisplayInput(read.list);
		return read.deck && read.deck.cards.length > 0
			? playerDisplayInput(read.player, read.deck)
			: null;
	}

	function stageLoadedDeck(nextDeck: DeckDisplayState, degraded: boolean) {
		// A still-degraded rebuild of the unchanged deck keeps the rendering
		// rather than cross-fading to an identical placeholder deck on every
		// cadence tick. A rebuild whose source has since changed carries new
		// cards and must still reach program.
		if (degradedRefetch.completeLoad(degraded, nextDeck) === 'keep')
			return;
		if (!displayedDeck.value) {
			displayedDeck.value = nextDeck;
			return;
		}
		queuePendingDeck(nextDeck);
	}

	async function buildDeck(input: DeckDisplayInput) {
		const flight = degradedRefetch.begin();
		const build: DeckBuild = {
			input,
			key: buildKey(input),
			failed: false,
		};
		built = build;
		buildFailed.value = false;
		try {
			const { deck: nextDeck, degraded } = await buildDeckDisplayState(input);
			if (flight.stale)
				return;
			if (!isSelected(input.source)) {
				built = null;
				return;
			}
			stageLoadedDeck(nextDeck, degraded);
		}
		catch (err) {
			console.error('Failed to build deck:', err);
			if (flight.stale)
				return;
			build.failed = true;
			buildFailed.value = true;
			degradedRefetch.keepCadence();
		}
	}

	/**
	 * Program follows what the Deck Source read answers. A read that answers the
	 * deck already on program, or being built for it, changes nothing: the
	 * module re-reads on every resync and degraded tick, and an unchanged deck
	 * must not cross-fade to itself. Selecting nothing, or a Player whose Deck
	 * List is gone, blanks program through the same staged swap.
	 */
	function followSource(read: DeckSourceRead | typeof SEAT_READ_PENDING | null) {
		if (read === SEAT_READ_PENDING)
			return;
		const input = read && displayInput(read);
		if (!input) {
			built = null;
			degradedRefetch.settle();
			if (displayedDeck.value)
				queuePendingDeck(null);
			else
				pendingDeck.value = null;
			return;
		}
		if (built && !built.failed && built.key === buildKey(input))
			return;
		void buildDeck(input);
	}
	watch(sourceRead, followSource);
	// A Seat of a Slot the stores already hold is answered before any read: it is shown at once.
	if (seat)
		followSource(sourceRead.value);

	return {
		config,
		primaryHeader,
		secondaryHeader,
		deckColors,
		companion,
		highlander,
		companionCard,
		commanders,
		deckStats,
		mainboard,
		sideboard,
		loading,
		error,
		ready,
		cardDataDegraded: degradedRefetch.degraded,
		hasDisplayedDeck,
		displayedDeckVersion,
		pendingSwapVersion: readonly(pendingSwapVersion),
		commitPendingDeck,
	};
}

/**
 * One Seat of a Commander Slot (ADR-0087), followed as a One Piece Card Game
 * Seat is: the Slot and its Session through the stores, so the Seat shows
 * whoever sits there now, and that player's Deck List read by the id their
 * Seat names. A re-paste gives the list a new id and Swap Seats moves it, each
 * announced with the Slot, so a list is read again only when the id changes.
 */
function useSeatDeckRead(
	context: ScreenContext,
	config: ComputedRef<DeckModeConfig>,
	source: () => SeatDeckSource | null,
) {
	const outputReads = useScreenOutputReads(context);
	const slotId = () => source()?.slotId ?? null;

	const slotRead = useScreenFeatureMatchSlot<null>(context, {
		mode: 'deck',
		config: () => config.value,
		slotId,
		keep: () => null,
		initialData: null,
		errorMessage: DECK_LOAD_FAILED,
	});

	const seated = computed(() => {
		const shown = source();
		if (!shown || !slotRead.slot.value)
			return null;
		const { data } = featureMatchSidePlayer(slotRead.slot.value, shown.seat);
		const gameData = getMtgGameData(data?.gameData);
		return {
			playerName: playerDisplayName(data),
			commanders: gameData.commanders ?? [],
			deckName: gameData.deckName ?? '',
			deckColors: gameData.deckColors ?? '',
			deckListId: gameData.featureMatchDeckList?.id ?? null,
		};
	});
	const deckListId = computed(() => seated.value?.deckListId ?? null);

	const deckList = useScreenModeFreshness<ScreenOutputCommanderDeckListResponse | null>({
		// A list is never edited in place: the Slot announces its replacement's id.
		hearing: useScreenModeHearing(context, 'deck', () => config.value, { follows: [] }),
		source: () => {
			const id = slotId();
			return id && deckListId.value !== null && outputReads.scopeKey.value
				? `${outputReads.scopeKey.value}:${id}:${deckListId.value}`
				: null;
		},
		read: () => outputReads.commanderDeckList(slotId()!, deckListId.value!),
		initialData: null,
		errorMessage: DECK_LOAD_FAILED,
	});

	const read = computed<SeatDeckRead | typeof SEAT_READ_PENDING | null>(() => {
		const shown = source();
		const held = seated.value;
		if (!shown)
			return null;
		if (!held) {
			return slotRead.answered.value
				? null
				: SEAT_READ_PENDING;
		}
		const { deckListId: id, ...player } = held;
		if (id === null) {
			return {
				type: 'seat',
				source: shown,
				...player,
				entries: [],
			};
		}
		return deckList.data.value?.id === id
			? {
					type: 'seat',
					source: shown,
					...player,
					entries: deckList.data.value.entries,
				}
			: SEAT_READ_PENDING;
	});

	return {
		read,
		answered: slotRead.answered,
		error: computed(() => slotRead.error.value ?? deckList.error.value ?? null),
	};
}

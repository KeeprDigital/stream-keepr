import type { BroadcastDeckListEntryResponse, BroadcastDeckListResponse } from '~~/shared/types/broadcastDeckList';
import type { DeckCompanion } from '~~/shared/types/deckCompanion';
import type { DeckListStats } from '~~/shared/types/deckList';
import type { CounterTypeConfig } from '~~/shared/types/game';
import type { HighlanderDeckSummary } from '~~/shared/types/highlander';
import type { PlayerDeckResponse } from '~~/shared/types/metagame';
import type { DeckSource } from '~~/shared/types/screenConfig';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import type { Player } from '~/types';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { getCounterTypeConfigs } from '~~/shared/config/games';
import { counterConfigsForDeckCounterTypes } from '~~/shared/utils/deckCounters';
import { createDeckLookupCards } from '~~/shared/utils/playerDeck';
import { selectPlayerDeck } from '~/composables/data/usePlayerDeckCache';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
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
	highlander: HighlanderDeckSummary | null;
	deckCounters: CounterTypeConfig[];
	deckStats: Array<{ type: string; count: number }>;
	mainboard: DeckListCardWithData[];
	sideboard: DeckListCardWithData[];
}

type LoadedDeckSource
	= { type: 'player'; playerId: number }
		| { type: 'broadcast'; broadcastDeckListId: number };

/** The Deck Source a configuration selects; `null` while it selects no Player. */
function selectedDeckSource(source: DeckSource): LoadedDeckSource | null {
	if (source.type === 'broadcast')
		return { type: 'broadcast', broadcastDeckListId: source.broadcastDeckListId };
	return source.playerId === null
		? null
		: { type: 'player', playerId: source.playerId };
}

/** One Deck Source as one comparable value. */
function deckSourceKey(source: LoadedDeckSource): string {
	return source.type === 'player'
		? `player:${source.playerId}`
		: `broadcast:${source.broadcastDeckListId}`;
}

function sameDeckSource(left: LoadedDeckSource | null | undefined, right: LoadedDeckSource): boolean {
	return !!left && deckSourceKey(left) === deckSourceKey(right);
}

const DECK_LOAD_FAILED = 'Failed to load deck';

/** What one read of the selected Deck Source answers. */
type DeckSourceRead
	= { type: 'player'; player: Player; deck: PlayerDeckResponse | null }
		| { type: 'broadcast'; list: BroadcastDeckListResponse };

function readRevision(read: DeckSourceRead | null): number | null | undefined {
	if (!read)
		return undefined;
	return read.type === 'player'
		? deckSourceStamp(read.player.updatedAt)
		: read.list.revision;
}

/**
 * The Event Data a Deck Source is read from. An edit to a Player's deck rolls
 * their `updatedAt` (#483), and a Broadcast Deck List carries its revision, so
 * an announcement at the revision already held carries nothing new. A Melee
 * sync, a deck review or a resolved deck card changes what a Player's deck
 * shows without one.
 */
function deckDependencies(selected: () => LoadedDeckSource | null): ScreenModeDependencies<DeckSourceRead | null> {
	const selectedPlayerId = () => {
		const source = selected();
		return source?.type === 'player'
			? source.playerId
			: null;
	};
	const selectedListId = () => {
		const source = selected();
		return source?.type === 'broadcast'
			? source.broadcastDeckListId
			: null;
	};
	const showsPlayer = () => selectedPlayerId() !== null;
	const showsArchetype = (archetypeId: number, held: DeckSourceRead | null) =>
		held?.type === 'player' && held.deck?.archetypeId === archetypeId;

	return {
		'player:updated': ({ player }, held) =>
			player.id === selectedPlayerId() && deckSourceStamp(player.updatedAt) !== readRevision(held),
		'playerDeck:reviewed': ({ deck }) => deck.playerId === selectedPlayerId(),
		'playerDeck:cardsResolved': ({ playerIds }) => {
			const playerId = selectedPlayerId();
			return playerId !== null && playerIds.includes(playerId);
		},
		// A reviewed deck shows its Archetype's name and colours.
		'archetype:updated': ({ archetype }, held) => showsArchetype(archetype.id, held),
		'archetype:deleted': ({ archetypeId }, held) => showsArchetype(archetypeId, held),
		'melee:dataReset': showsPlayer,
		'melee:playersSynced': showsPlayer,
		'melee:decklistsSynced': showsPlayer,
		'broadcastDeckList:updated': ({ listId, revision }, held) =>
			listId === selectedListId() && revision !== readRevision(held),
	};
}

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

function deckSourceStamp(updatedAt: Date | string | null | undefined): number | null {
	return updatedAt == null
		? null
		: new Date(updatedAt).getTime();
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

export function useDeckModeData() {
	const { eventId, assetCapability, cardDataHealth } = useScreenContext();
	const config = useScreenModeConfig('deck');

	const outputReads = useScreenOutputReads();
	const broadcastDeckLists = useScreenOutputBroadcastDeckListRepository();
	const { buildDeckListArrays } = useScryfallBatch();

	const displayedDeck = ref<DeckDisplayState | null>(null);
	const pendingDeck = ref<DeckDisplayState | null>(null);
	const pendingSwapVersion = ref(0);
	const buildFailed = ref(false);
	let deckVersion = 0;

	const selectedSource = computed(() => selectedDeckSource(config.value.deckSource));
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
		if (source.type === 'player') {
			const { player, decks } = await outputReads.playerDecks(source.playerId);
			return { type: 'player', player, deck: selectPlayerDeck(decks) ?? null };
		}
		const list = await broadcastDeckLists.getSelected(scope.eventId, scope.screenId, assetCapability?.value);
		return { type: 'broadcast', list };
	}

	const freshness = useScreenModeFreshness<DeckSourceRead | null>({
		eventId,
		source: () => selectedSource.value && outputReads.scopeKey.value
			? `${outputReads.scopeKey.value}:${deckSourceKey(selectedSource.value)}`
			: null,
		read: readDeckSource,
		initialData: null,
		errorMessage: DECK_LOAD_FAILED,
		dependsOn: deckDependencies(() => selectedSource.value),
	});

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
	const deckCounters = computed(() => displayedDeck.value?.deckCounters ?? []);
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
		const read = freshness.data.value;
		if (read && !displayInput(read))
			return 'Player has no deck list';
		return freshness.error.value ?? (buildFailed.value ? DECK_LOAD_FAILED : null);
	});

	/**
	 * Rendering Readiness: a deck is on program, or there is none to build —
	 * nothing selected, no deck list, or a failure that shows as the error.
	 */
	const ready = computed(() => {
		if (displayedDeck.value || error.value)
			return true;
		const read = freshness.data.value;
		return freshness.answered.value && !(read && displayInput(read));
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
	}

	async function buildDeckDisplayState(input: DeckDisplayInput): Promise<{ deck: DeckDisplayState; degraded: boolean }> {
		const lookupCards = createDeckLookupCards(input.cards, input.companion);
		const { cards: cardDataMap, degraded } = await outputReads.cardData(lookupCards);
		const arrays = buildDeckListArrays(input.cards, cardDataMap);
		const deckCounters = counterConfigsForDeckCounterTypes(
			input.cards.flatMap(card => card.deckCounterTypes ?? []),
			getCounterTypeConfigs('mtg'),
		);
		const artDegraded = await preloadDeckImages([
			...arrays.mainboard,
			...arrays.sideboard,
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
				highlander: input.highlander,
				deckCounters,
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

	/** What a read shows; `null` for a Player with no deck list. */
	function displayInput(read: DeckSourceRead): DeckDisplayInput | null {
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
	watch(freshness.data, (read) => {
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
	});

	return {
		config,
		primaryHeader,
		secondaryHeader,
		deckColors,
		companion,
		highlander,
		deckCounters,
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

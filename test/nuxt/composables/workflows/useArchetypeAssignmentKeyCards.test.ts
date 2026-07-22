import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

// ── Mock stores ──

const mockReviewDeck = vi.fn();
const mockCreateArchetype = vi.fn();
const mockUpdateArchetype = vi.fn();
const mockLoadByEventId = vi.fn();
const mockFindByName = vi.fn();
const mockFindByNameAndColors = vi.fn();
const mockSetKeyCards = vi.fn().mockResolvedValue([]);
const mockToast = { add: vi.fn() };

const mockArchetypeStore = reactive({
	archetypes: [] as any[],
	findByName: mockFindByName,
	findByNameAndColors: mockFindByNameAndColors,
	createArchetype: mockCreateArchetype,
	updateArchetype: mockUpdateArchetype,
	loadByEventId: mockLoadByEventId,
	setKeyCards: mockSetKeyCards,
});

const mockPlayerStore = reactive({
	players: [] as any[],
});

mockNuxtImport('useArchetypeStore', () => () => mockArchetypeStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerDeckStore', () => () => ({ reviewDeck: mockReviewDeck }));
mockNuxtImport('useToast', () => () => mockToast);

// ── Mock $fetch for key card PATCH ──
const mockFetch = vi.fn().mockResolvedValue({});
vi.stubGlobal('$fetch', mockFetch);

// ── Helpers ──

function makeEntry(opts?: {
	playerId?: number;
	deckName?: string;
	deckColors?: string;
	archetypeId?: number | null;
	deckReviewed?: boolean;
}): any {
	return {
		player: {
			id: opts?.playerId ?? 1,
			name: 'Test Player',
			eventId: 1,
			archetypeId: opts?.archetypeId ?? null,
		} as any,
		deck: {
			id: 1,
			playerId: opts?.playerId ?? 1,
			archetypeId: opts?.archetypeId ?? null,
			reviewedAt: opts?.deckReviewed ? new Date() : null,
		},
		displayName: opts?.deckName ?? '',
		displayColors: opts?.deckColors ?? null,
	};
}

function makeDeck(cards: Array<{ name: string; cardId?: number }>): any {
	return {
		id: 1,
		cards: cards.map((c, i) => ({
			name: c.name,
			cardId: c.cardId ?? i + 1,
			compartment: 'mainboard',
			quantity: 1,
			cardType: 'Instant',
			scryfallId: null,
			colors: null,
			cmc: null,
			sortOrder: i,
		})),
	};
}

/** Create a CardResponse-like key card object */
function makeKeyCard(name: string, id: number = 1): any {
	return { id, name, game: 'mtg', scryfallId: null, cardType: 'Instant', colors: null, cmc: null };
}

function makeArchetype(opts?: {
	id?: number;
	name?: string;
	colors?: string | null;
	keyCards?: any[] | null;
}) {
	return {
		id: opts?.id ?? 1,
		eventId: 1,
		name: opts?.name ?? 'Test Archetype',
		colors: opts?.colors ?? 'WU',
		keyCards: opts?.keyCards ?? [],
		createdAt: new Date(),
		updatedAt: new Date(),
	} as any;
}

function makeOptions(
	entryOverride?: any,
	advanceSpy?: ReturnType<typeof vi.fn>,
	archetypePlayerCountsOverride?: Map<number, number>,
	activeDeckCards?: Array<{ name: string; cardId?: number }>,
) {
	const currentEntry = computed(() => entryOverride ?? makeEntry());
	const eventId = computed(() => 1 as number | null);
	const advance = (advanceSpy ?? vi.fn()) as () => void;
	const prepareAdvance = () => ({
		commit: advance,
		cancel: vi.fn(),
	});
	const archetypePlayerCounts = computed(() => archetypePlayerCountsOverride ?? new Map<number, number>());
	const activeDeck = ref<any>(activeDeckCards ? makeDeck(activeDeckCards) : null);
	return { currentEntry, activeDeck, eventId, prepareAdvance, archetypePlayerCounts };
}

// ── Tests ──

describe('useArchetypeAssignment key cards and selection', () => {
	beforeEach(() => {
		mockArchetypeStore.archetypes = [];
		mockPlayerStore.players = [];
		vi.clearAllMocks();
		mockFindByName.mockReturnValue(undefined);
		mockFindByNameAndColors.mockReturnValue(undefined);
		mockReviewDeck.mockImplementation(async (_eventId, playerId, deckId, archetypeId) => ({
			deck: { id: deckId, playerId, archetypeId, reviewedAt: new Date() },
			player: null,
		}));
		mockCreateArchetype.mockResolvedValue(undefined);
		mockUpdateArchetype.mockResolvedValue(undefined);
		mockLoadByEventId.mockResolvedValue(undefined);
		mockSetKeyCards.mockResolvedValue([]);
		mockFetch.mockResolvedValue({});
	});

	// ── acceptName — existing archetype ──

	describe('hasKeyCardChanges', () => {
		it('is false when selected key cards match stored exactly', () => {
			const archetype = makeArchetype({ keyCards: [makeKeyCard('A', 1), makeKeyCard('B', 2)] });
			mockFindByNameAndColors.mockReturnValue(archetype);
			const opts = makeOptions();
			const { nameInput, selectedKeyCards, hasKeyCardChanges } = useArchetypeAssignment(opts);
			nameInput.value = 'Test';
			selectedKeyCards.value = new Set(['A', 'B']);
			expect(hasKeyCardChanges.value).toBe(false);
		});

		it('is true when a key card is added', () => {
			const archetype = makeArchetype({ keyCards: [makeKeyCard('A', 1)] });
			mockFindByNameAndColors.mockReturnValue(archetype);
			const opts = makeOptions();
			const { nameInput, selectedKeyCards, hasKeyCardChanges } = useArchetypeAssignment(opts);
			nameInput.value = 'Test';
			selectedKeyCards.value = new Set(['A', 'B']);
			expect(hasKeyCardChanges.value).toBe(true);
		});

		it('is true when cards differ in content but not count', () => {
			const archetype = makeArchetype({ keyCards: [makeKeyCard('A', 1), makeKeyCard('B', 2)] });
			mockFindByNameAndColors.mockReturnValue(archetype);
			const opts = makeOptions();
			const { nameInput, selectedKeyCards, hasKeyCardChanges } = useArchetypeAssignment(opts);
			nameInput.value = 'Test';
			selectedKeyCards.value = new Set(['A', 'C']); // same size, different content
			expect(hasKeyCardChanges.value).toBe(true);
		});

		it('is false when no archetype is matched', () => {
			mockFindByNameAndColors.mockReturnValue(undefined);
			const opts = makeOptions();
			const { nameInput, hasKeyCardChanges } = useArchetypeAssignment(opts);
			nameInput.value = 'Unknown';
			expect(hasKeyCardChanges.value).toBe(false);
		});
	});

	// ── toggleKeyCard ──

	describe('toggleKeyCard', () => {
		it('adds a card name when not already selected', () => {
			const opts = makeOptions();
			const { selectedKeyCards, toggleKeyCard } = useArchetypeAssignment(opts);
			toggleKeyCard('Lightning Bolt');
			expect(selectedKeyCards.value.has('Lightning Bolt')).toBe(true);
		});

		it('removes a card name when already selected', () => {
			const opts = makeOptions();
			const { selectedKeyCards, toggleKeyCard } = useArchetypeAssignment(opts);
			selectedKeyCards.value.add('Lightning Bolt');
			toggleKeyCard('Lightning Bolt');
			expect(selectedKeyCards.value.has('Lightning Bolt')).toBe(false);
		});
	});

	// ── selectArchetype ──

	describe('selectArchetype', () => {
		it('sets nameInput and colorsInput from archetype', () => {
			const archetype = makeArchetype({ name: 'Azorius Control', colors: 'WU' });
			const opts = makeOptions();
			const { nameInput, colorsInput, selectArchetype } = useArchetypeAssignment(opts);

			selectArchetype(archetype);

			expect(nameInput.value).toBe('Azorius Control');
			expect(colorsInput.value).toEqual(['W', 'U']);
		});
	});

	// ── handleChipClick ──

	describe('handleChipClick', () => {
		it('classify mode (player has no archetypeId) → calls assignArchetype (updatePlayer called)', async () => {
			const advance = vi.fn();
			const archetype = makeArchetype({ id: 3, name: 'Aggro' });
			const opts = makeOptions(makeEntry({ archetypeId: null, playerId: 5 }), advance);
			const { handleChipClick } = useArchetypeAssignment(opts);

			// handleChipClick is synchronous but calls async assignArchetype internally
			handleChipClick(archetype);
			await nextTick();
			await nextTick();

			expect(mockReviewDeck).toHaveBeenCalledWith(1, 5, 1, 3);
			expect(advance).toHaveBeenCalledOnce();
		});
	});

	// ── archetypeKeyCardMatches and sortedArchetypes ──

	describe('archetypeKeyCardMatches and sortedArchetypes', () => {
		it('archetypeKeyCardMatches includes arch with matching key card, excludes arch without', () => {
			const archA = makeArchetype({ id: 1, name: 'Arch A', keyCards: [makeKeyCard('Lightning Bolt', 1)] });
			const archB = makeArchetype({ id: 2, name: 'Arch B', keyCards: [makeKeyCard('Counterspell', 2)] });
			mockArchetypeStore.archetypes = [archA, archB];

			const opts = makeOptions(makeEntry(), undefined, undefined, [{ name: 'Lightning Bolt', cardId: 1 }]);
			const { archetypeKeyCardMatches } = useArchetypeAssignment(opts);

			expect(archetypeKeyCardMatches.value.has(1)).toBe(true);
			expect(archetypeKeyCardMatches.value.has(2)).toBe(false);
		});

		it('sortedArchetypes orders by match count descending, then by player count descending', () => {
			const archA = makeArchetype({ id: 1, name: 'Arch A', keyCards: [makeKeyCard('Lightning Bolt', 1)] });
			const archB = makeArchetype({ id: 2, name: 'Arch B', keyCards: [] });
			const archC = makeArchetype({ id: 3, name: 'Arch C', keyCards: [makeKeyCard('Counterspell', 2)] });
			mockArchetypeStore.archetypes = [archA, archB, archC];

			const playerCounts = new Map([[1, 5], [2, 10], [3, 2]]);
			const opts = makeOptions(
				makeEntry(),
				undefined,
				playerCounts,
				[{ name: 'Lightning Bolt', cardId: 1 }],
			);
			const { sortedArchetypes } = useArchetypeAssignment(opts);

			// archA: 1 match > archB/archC: 0 matches; archB: 10 players > archC: 2 players
			const sorted = sortedArchetypes.value;
			expect(sorted[0]!.id).toBe(1); // archA - 1 key card match
			expect(sorted[1]!.id).toBe(2); // archB - 0 matches but 10 players
			expect(sorted[2]!.id).toBe(3); // archC - 0 matches, 2 players
		});
	});

	// ── currentEntry watcher ──

	describe('currentEntry watcher', () => {
		it('pre-populates nameInput/colorsInput/selectedKeyCards from assigned archetype when entry changes', async () => {
			const keyCard = makeKeyCard('Goblin Guide', 1);
			const archetype = makeArchetype({ id: 5, name: 'Mono Red', colors: 'R', keyCards: [keyCard] });
			mockArchetypeStore.archetypes = [archetype];

			const entryRef = ref<any>(null);
			const opts = {
				currentEntry: computed(() => entryRef.value),
				activeDeck: ref<any>(null),
				eventId: computed(() => 1 as number | null),
				prepareAdvance: () => ({ commit: vi.fn(), cancel: vi.fn() }),
				archetypePlayerCounts: computed(() => new Map<number, number>()),
			};
			const { nameInput, colorsInput, selectedKeyCards } = useArchetypeAssignment(opts);

			entryRef.value = makeEntry({ archetypeId: 5, deckName: 'Mono Red', deckColors: 'R' });
			await nextTick();

			expect(nameInput.value).toBe('Mono Red');
			expect(colorsInput.value).toEqual(['R']);
			expect(selectedKeyCards.value.has('Goblin Guide')).toBe(true);
		});
	});
});

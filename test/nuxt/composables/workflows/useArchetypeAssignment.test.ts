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
const mockToast = {
	add: vi.fn(),
};

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
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn().mockResolvedValue({}),
}));
mockNuxtImport('$fetch', () => mockFetch);

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
			reviewedAt: opts?.deckReviewed
				? new Date()
				: null,
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
	return {
		id,
		name,
		game: 'mtg',
		scryfallId: null,
		cardType: 'Instant',
		colors: null,
		cmc: null,
	};
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
	const activeDeck = ref<any>(activeDeckCards
		? makeDeck(activeDeckCards)
		: null);
	return {
		currentEntry,
		activeDeck,
		eventId,
		prepareAdvance,
		archetypePlayerCounts,
	};
}

// ── Tests ──

describe('useArchetypeAssignment', () => {
	beforeEach(() => {
		mockArchetypeStore.archetypes = [];
		mockPlayerStore.players = [];

		mockFindByName.mockReturnValue(undefined);
		mockFindByNameAndColors.mockReturnValue(undefined);
		mockReviewDeck.mockImplementation(async (_eventId, playerId, deckId, archetypeId) => ({
			deck: {
				id: deckId,
				playerId,
				archetypeId,
				reviewedAt: new Date(),
			},
			player: null,
		}));
		mockCreateArchetype.mockResolvedValue(undefined);
		mockUpdateArchetype.mockResolvedValue(undefined);
		mockLoadByEventId.mockResolvedValue(undefined);
		mockSetKeyCards.mockResolvedValue([]);
		mockFetch.mockResolvedValue({});
	});

	// ── acceptName — existing archetype ──

	describe('acceptName with existing archetype', () => {
		it('assigns and advances when archetype exists and no key card changes', async () => {
			const advance = vi.fn();
			const existing = makeArchetype({
				id: 5,
				name: 'Control',
				keyCards: [
					makeKeyCard('Counterspell', 1),
				],
			});
			mockFindByName.mockReturnValue(existing);
			mockFindByNameAndColors.mockReturnValue(existing);

			const opts = makeOptions(makeEntry({ playerId: 10 }), advance);
			const { nameInput, acceptName } = useArchetypeAssignment(opts);
			nameInput.value = 'Control';

			await acceptName();

			expect(mockReviewDeck).toHaveBeenCalledWith(1, 10, 1, 5);
			expect(advance).toHaveBeenCalledOnce();
		});

		it('calls PATCH key cards and assigns when key cards changed', async () => {
			const advance = vi.fn();
			const existing = makeArchetype({
				id: 5,
				name: 'Control',
				keyCards: [
					makeKeyCard('Counterspell', 1),
				],
			});
			mockFindByName.mockReturnValue(existing);
			mockFindByNameAndColors.mockReturnValue(existing);

			const opts = makeOptions(makeEntry(), advance, undefined, [
				{ name: 'Wrath of God', cardId: 2 },
			]);
			const { nameInput, selectedKeyCards, acceptName } = useArchetypeAssignment(opts);
			nameInput.value = 'Control';
			selectedKeyCards.value = new Set(['Wrath of God']);

			await acceptName();

			expect(mockSetKeyCards).toHaveBeenCalledWith(1, 5, ['Wrath of God']);
			expect(mockReviewDeck).toHaveBeenCalledWith(1, 1, 1, 5);
			expect(advance).toHaveBeenCalledOnce();
		});
	});

	// ── acceptName — new archetype ──

	describe('acceptName with new archetype', () => {
		it('updates same-name archetype colors, saves key cards, and assigns', async () => {
			const advance = vi.fn();
			const existing = makeArchetype({
				id: 8,
				name: 'Control',
				colors: 'WU',
				keyCards: [
					makeKeyCard('Counterspell', 1),
				],
			});
			const updated = makeArchetype({
				id: 8,
				name: 'Control',
				colors: 'UB',
				keyCards: [
					makeKeyCard('Counterspell', 1),
				],
			});
			mockFindByName.mockReturnValue(existing);
			mockUpdateArchetype.mockResolvedValue(updated);

			const opts = makeOptions(makeEntry({ playerId: 7, archetypeId: null }), advance, undefined, [
				{ name: 'Sheoldred, the Apocalypse', cardId: 2 },
			]);
			const { nameInput, colorsInput, selectedKeyCards, acceptName } = useArchetypeAssignment(opts);
			nameInput.value = 'Control';
			colorsInput.value = ['U', 'B'];
			await nextTick();
			selectedKeyCards.value = new Set(['Sheoldred, the Apocalypse']);

			await acceptName();

			expect(mockUpdateArchetype).toHaveBeenCalledWith(1, 8, { colors: 'UB' });
			expect(mockSetKeyCards).toHaveBeenCalledWith(1, 8, ['Sheoldred, the Apocalypse']);
			expect(mockReviewDeck).toHaveBeenCalledWith(1, 7, 1, 8);
			expect(advance).toHaveBeenCalledOnce();
		});

		it('creates archetype, assigns, and advances when createArchetype succeeds', async () => {
			const advance = vi.fn();
			const created = makeArchetype({ id: 99, name: 'New Deck' });
			mockFindByName.mockReturnValue(undefined);
			mockCreateArchetype.mockResolvedValue(created);

			const opts = makeOptions(makeEntry({ playerId: 7 }), advance);
			const { nameInput, acceptName } = useArchetypeAssignment(opts);
			nameInput.value = 'New Deck';

			await acceptName();

			expect(mockCreateArchetype).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'New Deck' }));
			expect(mockReviewDeck).toHaveBeenCalledWith(1, 7, 1, 99);
			expect(advance).toHaveBeenCalledOnce();
		});
	});

	// ── saving flag ──

	describe('saving flag', () => {
		it('is true during async operations, false after success', async () => {
			const savingValues: boolean[] = [];
			const existing = makeArchetype({ name: 'Control' });
			mockFindByName.mockReturnValue(existing);
			mockFindByNameAndColors.mockReturnValue(existing);
			mockReviewDeck.mockImplementation(async () => {
				savingValues.push(true); // saving should be true here
				return {
					deck: {
						id: 1,
						playerId: 1,
						archetypeId: 1,
						reviewedAt: new Date(),
					},
					player: null,
				};
			});

			const opts = makeOptions();
			const { nameInput, saving, acceptName } = useArchetypeAssignment(opts);
			nameInput.value = 'Control';

			const promise = acceptName();
			expect(saving.value).toBe(true);
			await promise;
			expect(saving.value).toBe(false);
		});

		it('resets to false when createArchetype returns null', async () => {
			mockFindByName.mockReturnValue(undefined);
			mockCreateArchetype.mockResolvedValue(null);

			const opts = makeOptions();
			const { nameInput, saving, acceptName } = useArchetypeAssignment(opts);
			nameInput.value = 'New Deck';

			await acceptName();
			expect(saving.value).toBe(false);
		});
	});

	// ── acceptName guards ──

	// ── assignArchetype ──

	describe('assignArchetype', () => {
		it('applies assignment and calls advance', async () => {
			const advance = vi.fn();
			const archetype = makeArchetype({ id: 3, name: 'Aggro' });
			const opts = makeOptions(makeEntry({ playerId: 5 }), advance);
			const { assignArchetype } = useArchetypeAssignment(opts);

			await assignArchetype(archetype);

			expect(mockReviewDeck).toHaveBeenCalledWith(1, 5, 1, 3);
			expect(advance).toHaveBeenCalledOnce();
		});
	});

	// ── isEditMode ──

	describe('isEditMode', () => {
		it('is true when reviewedAt is set', () => {
			const opts = makeOptions(makeEntry({ archetypeId: 5, deckReviewed: true }));
			const { isEditMode } = useArchetypeAssignment(opts);
			expect(isEditMode.value).toBe(true);
		});

		it('is false when reviewedAt is null', () => {
			const opts = makeOptions(makeEntry({ archetypeId: 5, deckReviewed: false }));
			const { isEditMode } = useArchetypeAssignment(opts);
			expect(isEditMode.value).toBe(false);
		});

		// `$fetch` JSON round-trips the review entries, so `reviewedAt` arrives as a string (#272, #284).
		it('is true when reviewedAt is the ISO string the wire delivers', () => {
			const entry = JSON.parse(JSON.stringify(makeEntry({ archetypeId: 5, deckReviewed: true })));
			expect(typeof entry.deck.reviewedAt).toBe('string');
			const opts = makeOptions(entry);
			const { isEditMode } = useArchetypeAssignment(opts);
			expect(isEditMode.value).toBe(true);
		});

		it('is false when currentEntry is null', () => {
			const currentEntry = computed(() => null as any);
			const eventId = computed(() => 1 as number | null);
			const advance = vi.fn() as () => void;
			const prepareAdvance = () => ({
				commit: advance,
				cancel: vi.fn(),
			});
			const archetypePlayerCounts = computed(() => new Map<number, number>());
			const { isEditMode } = useArchetypeAssignment({
				currentEntry,
				activeDeck: ref(null),
				eventId,
				prepareAdvance,
				archetypePlayerCounts,
			});
			expect(isEditMode.value).toBe(false);
		});
	});

	// ── buttonLabel ──

	describe('buttonLabel', () => {
		const control = makeArchetype({ name: 'Control', colors: 'WU', keyCards: [makeKeyCard('Counterspell', 1)] });

		it.each([
			['Create & Assign', 'no Archetype matches', { byName: undefined, exact: undefined, reviewed: false }],
			['Assign', 'classifying into a matching Archetype', { byName: control, exact: control, reviewed: false }],
			['Update & Assign', 'classifying into a same-name Archetype of other colors', { byName: control, exact: undefined, colors: ['U', 'B'], reviewed: false }],
			['Reassign', 'editing with no key card changes', { byName: control, exact: control, keyCards: ['Counterspell'], reviewed: true }],
			['Update & Reassign', 'editing with key card changes', { byName: control, exact: control, keyCards: ['Wrath of God'], reviewed: true }],
			['Update & Reassign', 'editing into a same-name Archetype of other colors', { byName: control, exact: undefined, colors: ['U', 'B'], reviewed: true }],
		] as const)('reads %s when %s', (expected, _, scenario) => {
			mockFindByName.mockReturnValue(scenario.byName);
			mockFindByNameAndColors.mockReturnValue(scenario.exact);
			const entry = makeEntry({ archetypeId: scenario.reviewed ? 5 : null, deckReviewed: scenario.reviewed });
			const { nameInput, colorsInput, selectedKeyCards, buttonLabel } = useArchetypeAssignment(makeOptions(entry));

			nameInput.value = scenario.byName ? 'Control' : 'Brand New';
			if ('colors' in scenario)
				colorsInput.value = [...scenario.colors];
			if ('keyCards' in scenario)
				selectedKeyCards.value = new Set(scenario.keyCards);

			expect(buttonLabel.value).toBe(expected);
		});
	});
	// ── hasKeyCardChanges ──

	describe('hasKeyCardChanges', () => {
		it('is false when selected key cards match stored exactly', () => {
			const archetype = makeArchetype({
				keyCards: [
					makeKeyCard('A', 1),
					makeKeyCard('B', 2),
				],
			});
			mockFindByNameAndColors.mockReturnValue(archetype);
			const opts = makeOptions();
			const { nameInput, selectedKeyCards, hasKeyCardChanges } = useArchetypeAssignment(opts);
			nameInput.value = 'Test';
			selectedKeyCards.value = new Set(['A', 'B']);
			expect(hasKeyCardChanges.value).toBe(false);
		});

		it('is true when a key card is added', () => {
			const archetype = makeArchetype({
				keyCards: [
					makeKeyCard('A', 1),
				],
			});
			mockFindByNameAndColors.mockReturnValue(archetype);
			const opts = makeOptions();
			const { nameInput, selectedKeyCards, hasKeyCardChanges } = useArchetypeAssignment(opts);
			nameInput.value = 'Test';
			selectedKeyCards.value = new Set(['A', 'B']);
			expect(hasKeyCardChanges.value).toBe(true);
		});

		it('is true when cards differ in content but not count', () => {
			const archetype = makeArchetype({
				keyCards: [
					makeKeyCard('A', 1),
					makeKeyCard('B', 2),
				],
			});
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
			const archA = makeArchetype({
				id: 1,
				name: 'Arch A',
				keyCards: [
					makeKeyCard('Lightning Bolt', 1),
				],
			});
			const archB = makeArchetype({
				id: 2,
				name: 'Arch B',
				keyCards: [
					makeKeyCard('Counterspell', 2),
				],
			});
			mockArchetypeStore.archetypes = [archA, archB];

			const opts = makeOptions(makeEntry(), undefined, undefined, [
				{ name: 'Lightning Bolt', cardId: 1 },
			]);
			const { archetypeKeyCardMatches } = useArchetypeAssignment(opts);

			expect(archetypeKeyCardMatches.value.has(1)).toBe(true);
			expect(archetypeKeyCardMatches.value.has(2)).toBe(false);
		});

		it('sortedArchetypes orders by match count descending, then by player count descending', () => {
			const archA = makeArchetype({
				id: 1,
				name: 'Arch A',
				keyCards: [
					makeKeyCard('Lightning Bolt', 1),
				],
			});
			const archB = makeArchetype({ id: 2, name: 'Arch B', keyCards: [] });
			const archC = makeArchetype({
				id: 3,
				name: 'Arch C',
				keyCards: [
					makeKeyCard('Counterspell', 2),
				],
			});
			mockArchetypeStore.archetypes = [archA, archB, archC];

			const playerCounts = new Map([
				[1, 5],
				[2, 10],
				[3, 2],
			]);
			const opts = makeOptions(
				makeEntry(),
				undefined,
				playerCounts,
				[
					{ name: 'Lightning Bolt', cardId: 1 },
				],
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
			const archetype = makeArchetype({
				id: 5,
				name: 'Mono Red',
				colors: 'R',
				keyCards: [keyCard],
			});
			mockArchetypeStore.archetypes = [archetype];

			const entryRef = ref<any>(null);
			const opts = {
				currentEntry: computed(() => entryRef.value),
				activeDeck: ref<any>(null),
				eventId: computed(() => 1 as number | null),
				prepareAdvance: () => ({
					commit: vi.fn(),
					cancel: vi.fn(),
				}),
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

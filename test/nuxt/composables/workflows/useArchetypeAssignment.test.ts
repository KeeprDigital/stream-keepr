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
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn().mockResolvedValue({}) }));
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

describe('useArchetypeAssignment', () => {
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

	describe('acceptName with existing archetype', () => {
		it('assigns and advances when archetype exists and no key card changes', async () => {
			const advance = vi.fn();
			const existing = makeArchetype({ id: 5, name: 'Control', keyCards: [makeKeyCard('Counterspell', 1)] });
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
			const existing = makeArchetype({ id: 5, name: 'Control', keyCards: [makeKeyCard('Counterspell', 1)] });
			mockFindByName.mockReturnValue(existing);
			mockFindByNameAndColors.mockReturnValue(existing);

			const opts = makeOptions(makeEntry(), advance, undefined, [{ name: 'Wrath of God', cardId: 2 }]);
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
				keyCards: [makeKeyCard('Counterspell', 1)],
			});
			const updated = makeArchetype({
				id: 8,
				name: 'Control',
				colors: 'UB',
				keyCards: [makeKeyCard('Counterspell', 1)],
			});
			mockFindByName.mockReturnValue(existing);
			mockUpdateArchetype.mockResolvedValue(updated);

			const opts = makeOptions(makeEntry({ playerId: 7, archetypeId: null }), advance, undefined, [{ name: 'Sheoldred, the Apocalypse', cardId: 2 }]);
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
				return { deck: { id: 1, playerId: 1, archetypeId: 1, reviewedAt: new Date() }, player: null };
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

		it('is false when currentEntry is null', () => {
			const currentEntry = computed(() => null as any);
			const eventId = computed(() => 1 as number | null);
			const advance = vi.fn() as () => void;
			const prepareAdvance = () => ({ commit: advance, cancel: vi.fn() });
			const archetypePlayerCounts = computed(() => new Map<number, number>());
			const { isEditMode } = useArchetypeAssignment({ currentEntry, activeDeck: ref(null), eventId, prepareAdvance, archetypePlayerCounts });
			expect(isEditMode.value).toBe(false);
		});
	});

	// ── buttonLabel ──

	describe('buttonLabel', () => {
		it('returns \'Create & Assign\' when no matching archetype exists', () => {
			mockFindByNameAndColors.mockReturnValue(undefined);
			mockFindByName.mockReturnValue(undefined);
			const opts = makeOptions(makeEntry({ archetypeId: null }));
			const { nameInput, buttonLabel } = useArchetypeAssignment(opts);
			nameInput.value = 'Brand New';
			expect(buttonLabel.value).toBe('Create & Assign');
		});

		it('returns \'Assign\' in classify mode with a matching archetype', () => {
			const archetype = makeArchetype({ name: 'Control' });
			mockFindByName.mockReturnValue(archetype);
			mockFindByNameAndColors.mockReturnValue(archetype);
			const opts = makeOptions(makeEntry({ archetypeId: null }));
			const { nameInput, buttonLabel } = useArchetypeAssignment(opts);
			nameInput.value = 'Control';
			expect(buttonLabel.value).toBe('Assign');
		});

		it('returns \'Update & Assign\' in classify mode with same name but different colors', () => {
			const archetype = makeArchetype({ name: 'Control', colors: 'WU' });
			mockFindByName.mockReturnValue(archetype);
			mockFindByNameAndColors.mockReturnValue(undefined);
			const opts = makeOptions(makeEntry({ archetypeId: null }));
			const { nameInput, colorsInput, buttonLabel } = useArchetypeAssignment(opts);
			nameInput.value = 'Control';
			colorsInput.value = ['U', 'B'];
			expect(buttonLabel.value).toBe('Update & Assign');
		});

		it('returns \'Reassign\' in edit mode with no key card changes', () => {
			const archetype = makeArchetype({ name: 'Control', keyCards: [makeKeyCard('Counterspell', 1)] });
			mockFindByName.mockReturnValue(archetype);
			mockFindByNameAndColors.mockReturnValue(archetype);
			const opts = makeOptions(makeEntry({ archetypeId: 5, deckReviewed: true }));
			const { nameInput, selectedKeyCards, buttonLabel } = useArchetypeAssignment(opts);
			nameInput.value = 'Control';
			selectedKeyCards.value = new Set(['Counterspell']);
			expect(buttonLabel.value).toBe('Reassign');
		});

		it('returns \'Update & Reassign\' in edit mode with key card changes', () => {
			const archetype = makeArchetype({ name: 'Control', keyCards: [makeKeyCard('Counterspell', 1)] });
			mockFindByName.mockReturnValue(archetype);
			mockFindByNameAndColors.mockReturnValue(archetype);
			const opts = makeOptions(makeEntry({ archetypeId: 5, deckReviewed: true }));
			const { nameInput, selectedKeyCards, buttonLabel } = useArchetypeAssignment(opts);
			nameInput.value = 'Control';
			selectedKeyCards.value = new Set(['Wrath of God']); // different from stored
			expect(buttonLabel.value).toBe('Update & Reassign');
		});

		it('returns \'Update & Reassign\' in edit mode with same name but different colors', () => {
			const archetype = makeArchetype({ name: 'Control', colors: 'WU' });
			mockFindByName.mockReturnValue(archetype);
			mockFindByNameAndColors.mockReturnValue(undefined);
			const opts = makeOptions(makeEntry({ archetypeId: 5, deckReviewed: true }));
			const { nameInput, colorsInput, buttonLabel } = useArchetypeAssignment(opts);
			nameInput.value = 'Control';
			colorsInput.value = ['U', 'B'];
			expect(buttonLabel.value).toBe('Update & Reassign');
		});
	});

	// ── hasKeyCardChanges ──
});

import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createMockUiArchetype } from '~~/test/helpers/fixtures';

const modal = {
	open: vi.fn(),
};
mockNuxtImport('useOverlay', () => () => ({
	create: () => modal,
}));

const { navigateTo } = vi.hoisted(() => ({
	navigateTo: vi.fn(),
}));
mockNuxtImport('navigateTo', () => navigateTo);

const archetypeStore = reactive({
	archetypes: [] as any[],
	isLoaded: true,
	loadByEventId: vi.fn(),
	mergeArchetype: vi.fn(),
	removeArchetype: vi.fn(),
});
const playerDeckStore = reactive({
	decks: [] as any[],
	isLoaded: true,
	loadByEventId: vi.fn(),
});
const playerStore = reactive({
	players: [] as any[],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
});
const screenStore = reactive({ screens: [] as any[] });
mockNuxtImport('useArchetypeStore', () => () => archetypeStore);
mockNuxtImport('usePlayerDeckStore', () => () => playerDeckStore);
mockNuxtImport('usePlayerStore', () => () => playerStore);
mockNuxtImport('useScreenStore', () => () => screenStore);

const BURN = createMockUiArchetype({ id: 1, name: 'Burn' });
const BOROS = createMockUiArchetype({ id: 2, name: 'Boros Burn' });
const UNUSED = createMockUiArchetype({ id: 3, name: 'Unused' });

function answer(confirmed: boolean) {
	modal.open.mockReturnValue({
		result: Promise.resolve(confirmed),
	});
}

/** What the confirm said, as one string. */
function asked() {
	const { message, description } = modal.open.mock.calls[0]![0];
	return `${message} ${description}`;
}

beforeEach(() => {
	vi.clearAllMocks();
	archetypeStore.archetypes = [BURN, BOROS, UNUSED];
	playerDeckStore.decks = [
		{ id: 10, playerId: 1, archetypeId: 1 },
		{ id: 11, playerId: 2, archetypeId: 1 },
		{ id: 12, playerId: 3, archetypeId: 2 },
	];
	playerStore.players = [
		{ id: 4, archetypeId: 2 },
	];
	screenStore.screens = [
		{
			id: 20,
			name: 'Spotlight',
			modeConfigs: {
				'archetype-spotlight': { archetypeId: 1 },
			},
		},
	];
	archetypeStore.mergeArchetype.mockResolvedValue(true);
	archetypeStore.removeArchetype.mockResolvedValue(true);
});

describe('what holds an Archetype', () => {
	it('counts the decks assigned to each', () => {
		const { deckCountOf } = useArchetypeHoldings(9);

		expect([
			deckCountOf(1),
			deckCountOf(2),
			deckCountOf(3),
		]).toEqual([2, 1, 0]);
	});

	it('finds empty those no deck is assigned to and no Player holds', () => {
		archetypeStore.archetypes = [
			BURN,
			UNUSED,
			createMockUiArchetype({ id: 5, name: 'Held by a Player alone' }),
		];
		playerStore.players = [
			{ id: 4, archetypeId: 5 },
		];

		expect(useArchetypeHoldings(9).emptyArchetypes.value).toEqual([UNUSED]);
	});

	// Before its decks are read, every Archetype would look empty.
	it.each(['archetypeStore', 'playerDeckStore', 'playerStore'] as const)('finds none empty until the %s has loaded', (name) => {
		const store = { archetypeStore, playerDeckStore, playerStore }[name];
		store.isLoaded = false;

		expect(useArchetypeHoldings(9).emptyArchetypes.value).toEqual([]);

		store.isLoaded = true;
	});
});

describe('merging an Archetype from its page', () => {
	it('says what moves, what the survivor keeps and which Screens follow, then merges and opens the survivor', async () => {
		answer(true);

		await expect(useArchetypeManagement(9, () => 1).mergeInto(2)).resolves.toBe(true);

		expect(asked()).toContain('Merge “Burn” into “Boros Burn”?');
		expect(asked()).toContain('2 decks move to “Boros Burn”');
		expect(asked()).toContain('keeps its own colours, key cards and pinned series');
		expect(asked()).toContain('1 Screen showing “Burn” will show “Boros Burn”');
		expect(archetypeStore.mergeArchetype).toHaveBeenCalledWith(9, 1, 2);
		expect(navigateTo).toHaveBeenCalledWith('/event/9/metagame/archetype/2');
	});

	it.each([
		['declined', false, true],
		['refused by the server', true, false],
	])('stays on the Archetype when the merge is %s', async (_case, confirmed, merged) => {
		answer(confirmed);
		archetypeStore.mergeArchetype.mockResolvedValue(merged);

		await expect(useArchetypeManagement(9, () => 1).mergeInto(2)).resolves.toBe(false);

		expect(archetypeStore.mergeArchetype).toHaveBeenCalledTimes(confirmed ? 1 : 0);
		expect(navigateTo).not.toHaveBeenCalled();
	});
});

describe('deleting an Archetype from its page', () => {
	it('says how many decks return to unreviewed and which Screens lose it, then deletes and returns to the Metagame', async () => {
		answer(true);

		await expect(useArchetypeManagement(9, () => 1).remove()).resolves.toBe(true);

		expect(asked()).toContain('Delete “Burn”?');
		expect(asked()).toContain('2 decks return to unreviewed');
		expect(asked()).toContain('1 Screen showing it will show no Archetype');
		expect(archetypeStore.removeArchetype).toHaveBeenCalledWith(9, 1);
		expect(navigateTo).toHaveBeenCalledWith('/event/9/metagame');
	});

	it('says nothing of decks or Screens for an Archetype none hold', async () => {
		answer(false);

		await expect(useArchetypeManagement(9, () => 3).remove()).resolves.toBe(false);

		expect(asked()).not.toContain('deck');
		expect(asked()).not.toContain('Screen');
		expect(archetypeStore.removeArchetype).not.toHaveBeenCalled();
	});
});

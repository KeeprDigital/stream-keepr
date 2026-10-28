import type { EffectScope } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const realtime = createFakeEventChannel();
const { deliver } = realtime;
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);

const defaultConfig = {
	scope: 'all' as 'all' | 'topN' | 'playerList',
	topN: 8,
	playerListId: undefined as number | undefined,
	archetypeFilter: undefined as string | undefined,
	board: 'mainboard' as const,
	sortBy: 'inclusionRate' as const,
	limit: 10,
	excludedCardTypes: ['Land'] as string[],
	columns: 5,
	autoColumns: false,
	cardSizing: 'fit' as 'fit' | 'fixed',
	rowsPerPage: 60,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	currentPage: undefined as number | undefined,
	rotationAnchor: undefined as number | undefined,
	showHeader: true,
	headerText: undefined as string | undefined,
	showCardNames: true,
	showRankBadges: true,
	statBadge: 'inclusionRate' as const,
};

const mutableConfig = reactive({ ...defaultConfig });

const mockEventId = ref<number | null>(1);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test Screen' }),
	eventId: mockEventId,
	interactive: ref(false),
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

// Server time is the Page Rotation's clock; synced and controllable here.
let mockServerNow = 1_000_000;
mockNuxtImport('useServerTime', () => () => ({
	isSynced: ref(true),
	serverTimeOffset: ref(0),
	getServerTime: () => mockServerNow,
}));

/** `count` ranked cards, named by their rank. */
function rankedCards(count: number) {
	return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Card ${i + 1}` }));
}

const scopes: EffectScope[] = [];

function makeTopCardsModeData() {
	const scope = effectScope();
	const result = scope.run(() => useTopCardsModeData())!;
	scopes.push(scope);
	return result;
}

describe('useTopCardsModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig, {
			excludedCardTypes: ['Land'],
		});
		mockEventId.value = 1;
		mockServerNow = 1_000_000;
		realtime.reset();
		mockFetch.mockResolvedValue({ entries: [], totalDecks: 0, scope: 'all' });
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it.each([
		['the full field', {}, 'Most Played Cards'],
		[
			'the Top N scope',
			{ scope: 'topN', topN: 8 },
			'Top 8 Most Played Cards',
		],
		[
			'the archetype filter',
			{ archetypeFilter: 'Mono Red' },
			'Most Played Cards: Mono Red',
		],
		[
			'a custom header',
			{ headerText: 'The Chase Cards' },
			'The Chase Cards',
		],
	] as const)('heads the grid with %s', (_, config, expected) => {
		Object.assign(mutableConfig, config);

		expect(makeTopCardsModeData().headerText.value).toBe(expected);
	});

	it('reads the card breakdown through the Screen', async () => {
		mockFetch.mockResolvedValue({
			entries: rankedCards(1),
			totalDecks: 5,
			scope: 'all',
		});
		const { entries } = makeTopCardsModeData();
		await flushPromises();

		// The server derives board, sort, limit and excluded types from the saved
		// configuration, so the client names only the Screen resource.
		expect(mockFetch).toHaveBeenLastCalledWith(
			'/api/screen-output/events/1/screens/1/top-cards',
			expect.objectContaining({ headers: undefined }),
		);
		expect(entries.value.map(entry => entry.name)).toEqual(['Card 1']);
	});

	it('re-reads when a configuration field the breakdown depends on changes', async () => {
		makeTopCardsModeData();
		await flushPromises();
		mockFetch.mockClear();

		mutableConfig.excludedCardTypes = [];
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/top-cards', expect.anything());
	});

	it.each([
		['no decks', 0, 'No players in this event'],
		['decks but no card data', 4, 'No card data available'],
	])('is empty with a message for a field with %s', async (_, totalDecks, expected) => {
		mockFetch.mockResolvedValue({ entries: [], totalDecks, scope: 'all' });

		const { isEmpty, emptyMessage } = makeTopCardsModeData();
		await flushPromises();

		expect(isEmpty.value).toBe(true);
		expect(emptyMessage.value).toBe(expected);
	});
	describe('page rotation', () => {
		/** The cards a page shows, as `rank:name`. */
		function shown(page: { entry: { name: string }; rank: number }[]) {
			return page.map(({ entry, rank }) => `${rank}:${entry.name}`);
		}

		it('shows every card on one page when a Screen never set its page size', async () => {
			mockFetch.mockResolvedValue({
				entries: rankedCards(12),
				totalDecks: 5,
				scope: 'all',
			});
			mutableConfig.columns = 1;

			const { pageEntries, totalPages } = makeTopCardsModeData();
			await flushPromises();

			expect(totalPages.value).toBe(1);
			expect(pageEntries.value).toHaveLength(12);
			expect(shown(pageEntries.value).at(-1)).toBe('12:Card 12');
		});

		it('pages the grid by whole rows of columns cards, keeping each card\'s overall rank', async () => {
			mockFetch.mockResolvedValue({
				entries: rankedCards(5),
				totalDecks: 5,
				scope: 'all',
			});
			Object.assign(mutableConfig, { columns: 2, rowsPerPage: 1, currentPage: 2 });

			const { pageEntries, currentPage, totalPages } = makeTopCardsModeData();
			await flushPromises();

			expect(totalPages.value).toBe(3);
			expect(currentPage.value).toBe(2);
			expect(shown(pageEntries.value)).toEqual(['3:Card 3', '4:Card 4']);
		});

		it('ends on a partial last page', async () => {
			mockFetch.mockResolvedValue({
				entries: rankedCards(5),
				totalDecks: 5,
				scope: 'all',
			});
			Object.assign(mutableConfig, { columns: 2, rowsPerPage: 2, currentPage: 2 });

			const { pageEntries, totalPages } = makeTopCardsModeData();
			await flushPromises();

			expect(totalPages.value).toBe(2);
			expect(shown(pageEntries.value)).toEqual(['5:Card 5']);
		});

		// A Fit grid shares its height between a full page's rows, so a short last page keeps its card size.
		it.each([
			{
				cards: 5,
				rowsPerPage: 2,
				currentPage: 2,
				pageRowCount: 2,
			},
			{
				cards: 3,
				rowsPerPage: 60,
				currentPage: 1,
				pageRowCount: 2,
			},
		])('lays $cards cards, $rowsPerPage rows a page, out in $pageRowCount rows on page $currentPage', async ({ cards, rowsPerPage, currentPage, pageRowCount }) => {
			mockFetch.mockResolvedValue({
				entries: rankedCards(cards),
				totalDecks: 5,
				scope: 'all',
			});
			Object.assign(mutableConfig, { columns: 2, rowsPerPage, currentPage });

			const data = makeTopCardsModeData();
			await flushPromises();

			expect(data.pageRowCount.value).toBe(pageRowCount);
		});

		it('pages by the columns auto columns chooses for the Event Canvas', async () => {
			mockFetch.mockResolvedValue({
				entries: rankedCards(10),
				totalDecks: 5,
				scope: 'all',
			});
			Object.assign(mutableConfig, { columns: 2, autoColumns: true, rowsPerPage: 1 });

			const { pageEntries, totalPages, resolvedColumns } = makeTopCardsModeData();
			await flushPromises();

			// One row a page on the default 1920×1080 canvas: two cards are as large as one, in half the pages.
			expect(resolvedColumns.value).toBe(2);
			expect(totalPages.value).toBe(5);
			expect(pageEntries.value).toHaveLength(2);
		});

		it('shows the page projected from the Rotation Anchor while auto-page is on', async () => {
			mockFetch.mockResolvedValue({
				entries: rankedCards(6),
				totalDecks: 5,
				scope: 'all',
			});
			// 25s into 10s pages: the third page, whatever page was last selected by hand.
			Object.assign(mutableConfig, {
				columns: 2,
				rowsPerPage: 1,
				currentPage: 1,
				autoPageEnabled: true,
				rotationAnchor: mockServerNow - 25_000,
			});

			const { pageEntries, currentPage } = makeTopCardsModeData();
			await flushPromises();

			expect(currentPage.value).toBe(3);
			expect(shown(pageEntries.value)).toEqual(['5:Card 5', '6:Card 6']);
		});
	});

	describe('freshness', () => {
		// The Event, the Screen configuration and the Player store are held
		// constant throughout: only the aggregate's Event Data changes under the
		// output, and nothing loads a roster to stand in for that (#602).
		async function showingCards() {
			const data = makeTopCardsModeData();
			await flushPromises();
			mockFetch.mockClear();
			return data;
		}

		it('re-reads when another browser resolves an unresolved deck card (#648)', async () => {
			await showingCards();

			deliver('playerDeck:cardsResolved', {
				deckIds: [3, 9],
				playerIds: [2, 7],
			});
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenLastCalledWith('/api/screen-output/events/1/screens/1/top-cards', expect.anything());
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('re-reads when a deck review lands elsewhere', async () => {
			await showingCards();

			deliver('playerDeck:reviewed', {
				deck: { id: 3, playerId: 2 },
			});
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenLastCalledWith('/api/screen-output/events/1/screens/1/top-cards', expect.anything());
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('re-reads when an Archetype is edited or its key cards change', async () => {
			await showingCards();

			deliver('archetype:updated', {
				archetype: { id: 4, name: 'Mono Red' },
			});
			await flushPromises();
			deliver('archetype:keyCardsUpdated', { archetypeId: 4, keyCards: [] });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('re-reads when the Player List driving it gains or loses a member, and not for another list', async () => {
			mutableConfig.scope = 'playerList';
			mutableConfig.playerListId = 5;
			await showingCards();

			deliver('playerList:membersChanged', {
				listId: 6,
				playerIds: [2],
				action: 'added',
				memberCount: 3,
			});
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			deliver('playerList:membersChanged', {
				listId: 5,
				playerIds: [2],
				action: 'added',
				memberCount: 3,
			});
			await flushPromises();
			deliver('playerList:membersChanged', {
				listId: 5,
				playerIds: [2],
				action: 'removed',
				memberCount: 2,
			});
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('ignores Player List membership while scoped to the full field', async () => {
			mutableConfig.playerListId = 5;
			await showingCards();

			deliver('playerList:membersChanged', {
				listId: 5,
				playerIds: [2],
				action: 'added',
				memberCount: 3,
			});
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('re-reads when Melee stores new Round Standings', async () => {
			mutableConfig.scope = 'topN';
			await showingCards();

			deliver('melee:roundStandingsSynced', { roundId: 31 });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('shows cards missed while disconnected once its channel is attached again', async () => {
			const { entries } = await showingCards();

			realtime.transport.connectionState = 'disconnected';
			await nextTick();
			mockFetch.mockResolvedValue({
				entries: [
					{ id: 1, name: 'Lightning Bolt' },
				],
				totalDecks: 4,
				scope: 'all',
			});
			realtime.transport.connectionState = 'connected';
			realtime.reattach();
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(entries.value.map(entry => entry.name)).toEqual(['Lightning Bolt']);
		});
	});

	it('reads nothing, and reports no failure, until the Screen and its Event are known', async () => {
		mockEventId.value = null;

		const { error } = makeTopCardsModeData();
		await flushPromises();

		expect(mockFetch).not.toHaveBeenCalled();
		expect(error.value).toBeNull();
	});
});

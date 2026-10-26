import type { EffectScope } from 'vue';
import type { MetagameScope, MetagameViewMode } from '~~/shared/types/enums';
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

const mockScreenStore = {
	updateModeConfig: vi.fn(),
};

const defaultConfig = {
	viewMode: 'archetype' as MetagameViewMode,
	scope: 'all' as MetagameScope,
	topN: 8,
	minPoints: 9,
	playerListId: undefined as number | undefined,
	archetypeFilter: undefined as string | undefined,
	sortBy: 'metaShare' as const,
	cardSortBy: 'inclusionRate' as const,
	archetypeColumns: [
		{ key: 'archetype', visible: true },
		{ key: 'count', visible: true },
		{ key: 'metaShare', visible: true },
		{ key: 'winRate', visible: true },
		{ key: 'avgPlace', visible: false },
		{ key: 'colors', visible: false },
	],
	cardColumns: [
		{ key: 'card', visible: true },
		{ key: 'manaCost', visible: true },
		{ key: 'type', visible: true },
		{ key: 'inclusionRate', visible: true },
		{ key: 'avgCopies', visible: true },
		{ key: 'totalCopies', visible: true },
		{ key: 'deckCount', visible: true },
		{ key: 'mainboardCount', visible: true },
		{ key: 'sideboardCount', visible: true },
	],
	limit: 50,
	pageSize: 5,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	currentPage: 1,
	rotationAnchor: undefined as number | undefined,
	showHeader: true,
	headerText: undefined,
	animateEntries: true,
};

const mutableConfig = reactive({ ...defaultConfig });
const mockInteractive = ref(false);

mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test Screen' }),
	eventId: computed(() => 1),
	interactive: mockInteractive,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

// Server time is the Page Rotation's clock.
const mockIsSynced = ref(true);
let mockServerNow = 1_000_000;
mockNuxtImport('useServerTime', () => () => ({
	isSynced: mockIsSynced,
	serverTimeOffset: ref(0),
	getServerTime: () => mockServerNow,
}));

/** The Metagame Screen Output read's answer: the breakdown its configured view renders. */
function archetypeRead(breakdown: Record<string, unknown>) {
	return { viewMode: 'archetype', breakdown };
}

function cardsRead(breakdown: Record<string, unknown>) {
	return { viewMode: 'cards', breakdown };
}

const METAGAME_READ = '/api/screen-output/events/1/screens/1/metagame';

const scopes: EffectScope[] = [];

function makeMetagameModeData() {
	const scope = effectScope();
	const result = scope.run(() => useMetagameModeData())!;
	scopes.push(scope);
	return result;
}

const names = (rows: unknown[]) => rows.map(row => (row as { name: string }).name);

describe('useMetagameModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		mockInteractive.value = false;
		realtime.reset();
		mockIsSynced.value = true;
		mockServerNow = 1_000_000;
		mockFetch.mockResolvedValue(archetypeRead({ entries: [], totalPlayers: 0, scope: 'all' }));
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
		vi.useRealTimers();
	});

	it.each([
		['all', {}, 'Full Field Metagame'],
		['minPoints', { minPoints: 12 }, '12+ Points Metagame'],
	] as const)('heads the archetype view with its %s scope', (scope, config, expected) => {
		Object.assign(mutableConfig, { scope, ...config });

		const { headerText } = makeMetagameModeData();

		expect(headerText.value).toBe(expected);
	});

	it('reads the breakdown through the Screen, re-reading when the scope changes', async () => {
		makeMetagameModeData();
		await flushPromises();

		// The server derives scope, sort and limit from the saved configuration,
		// so the client names only the Screen resource.
		expect(mockFetch).toHaveBeenLastCalledWith(METAGAME_READ, expect.objectContaining({ headers: undefined }));

		mockFetch.mockClear();
		mutableConfig.scope = 'minPoints';
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith(METAGAME_READ, expect.anything());
	});

	it.each([
		['no Players', 0, 'No players in this event'],
		['Players but no breakdown', 6, 'No metagame data available'],
	])('is empty with a message for an Event with %s', async (_, totalPlayers, expected) => {
		mockFetch.mockResolvedValue(archetypeRead({ entries: [], totalPlayers, scope: 'all' }));

		const { isEmpty, emptyMessage } = makeMetagameModeData();
		await flushPromises();

		expect(isEmpty.value).toBe(true);
		expect(emptyMessage.value).toBe(expected);
	});

	it('renders the card breakdown the cards view reads', async () => {
		mockFetch.mockResolvedValue(cardsRead({
			entries: [{
				id: 1,
				name: 'Lightning Bolt',
				inclusionRate: 100,
				avgCopies: 4,
				totalCopies: 8,
				mainboardCount: 8,
				sideboardCount: 0,
				mainboardDeckCount: 2,
				sideboardDeckCount: 0,
				deckCount: 2,
				cardType: 'Instant',
				scryfallId: null,
				colors: 'R',
				cmc: 1,
			}],
			totalDecks: 2,
			scope: 'all',
		}));
		Object.assign(mutableConfig, { viewMode: 'cards', archetypeFilter: 'Mono Red' });

		const { displayRows } = makeMetagameModeData();
		await flushPromises();

		expect(names(displayRows.value)).toEqual(['Lightning Bolt']);
	});

	describe('pages', () => {
		const twelveArchetypes = archetypeRead({
			entries: Array.from({ length: 12 }, (_, i) => ({ name: `Arch${i}`, count: 1, metaShare: 1 })),
			totalPlayers: 12,
			scope: 'all',
		});

		it('pages its rows by the configured page size', async () => {
			mockFetch.mockResolvedValue(twelveArchetypes);

			const { totalPages, pageData } = makeMetagameModeData();
			await flushPromises();

			expect(totalPages.value).toBe(3);
			expect(names(pageData.value)).toEqual(['Arch0', 'Arch1', 'Arch2', 'Arch3', 'Arch4']);
		});

		it('projects a rotating page from server time on a rendering, and never writes', async () => {
			vi.useFakeTimers();
			mockFetch.mockResolvedValue(twelveArchetypes);
			const { currentPage } = makeMetagameModeData();
			await flushPromises();

			Object.assign(mutableConfig, { autoPageEnabled: true, autoPageIntervalMs: 5000, rotationAnchor: mockServerNow });
			await nextTick();
			expect(currentPage.value).toBe(1);

			mockServerNow += 5000;
			vi.advanceTimersByTime(5000);
			await nextTick();

			expect(currentPage.value).toBe(2);
			expect(mockScreenStore.updateModeConfig).not.toHaveBeenCalled();
		});
	});

	describe('chart display', () => {
		const chartEntries = [
			{ id: 3, name: 'Boros Energy', colors: 'RW', count: 6, metaShare: 50 },
			{ id: 7, name: 'Eldrazi Ramp', colors: 'C', count: 4, metaShare: 33.33 },
			{ id: -1, name: 'Other', colors: null, count: 2, metaShare: 16.67 },
		];

		beforeEach(() => {
			mutableConfig.viewMode = 'chart';
			mockFetch.mockResolvedValue(archetypeRead({ entries: chartEntries, totalPlayers: 12, classifiedPlayers: 12, scope: 'all' }));
		});

		it('draws the archetype breakdown as chart bars under the archetype header', async () => {
			const { chartBars, headerText, isEmpty } = makeMetagameModeData();
			await flushPromises();

			expect(headerText.value).toBe('Full Field Metagame');
			expect(isEmpty.value).toBe(false);
			expect(chartBars.value.map(bar => [bar.name, bar.metaShare, bar.colorSlot === null])).toEqual([
				['Boros Energy', 50, false],
				['Eldrazi Ramp', 33.33, false],
				['Other', 16.67, true],
			]);
		});

		it('is one page: a Page Rotation never pages it', async () => {
			vi.useFakeTimers();
			mockFetch.mockResolvedValue(archetypeRead({
				entries: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Arch${i}`, count: 1, metaShare: 8.33 })),
				totalPlayers: 12,
				classifiedPlayers: 12,
				scope: 'all',
			}));
			const { chartBars, currentPage, totalPages } = makeMetagameModeData();
			await flushPromises();

			Object.assign(mutableConfig, { autoPageEnabled: true, autoPageIntervalMs: 5000, rotationAnchor: mockServerNow });
			mockServerNow += 5000;
			vi.advanceTimersByTime(5000);
			await nextTick();

			expect(totalPages.value).toBe(1);
			expect(currentPage.value).toBe(1);
			// Eight archetypes and Other, whatever the page size.
			expect(chartBars.value).toHaveLength(9);
		});

		it('follows deck data live, as the table does', async () => {
			const { chartBars } = makeMetagameModeData();
			await flushPromises();
			mockFetch.mockResolvedValue(archetypeRead({
				entries: [{ id: 7, name: 'Eldrazi Ramp', colors: 'C', count: 12, metaShare: 100 }],
				totalPlayers: 12,
				classifiedPlayers: 12,
				scope: 'all',
			}));

			deliver('playerDeck:reviewed', { deck: { id: 3, playerId: 2 } });
			await flushPromises();

			expect(chartBars.value.map(bar => bar.name)).toEqual(['Eldrazi Ramp']);
		});

		it('draws nothing outside the chart display', async () => {
			mutableConfig.viewMode = 'archetype';
			const { chartBars, displayRows } = makeMetagameModeData();
			await flushPromises();

			expect(displayRows.value).toHaveLength(3);
			expect(chartBars.value).toEqual([]);
		});
	});

	describe('freshness', () => {
		// Only the aggregate's Event Data changes under the output, and nothing
		// loads a roster to stand in for it (#602).
		async function showingMetagame() {
			const data = makeMetagameModeData();
			await flushPromises();
			mockFetch.mockClear();
			return data;
		}

		it('re-reads when the Player List driving it gains or loses a member', async () => {
			Object.assign(mutableConfig, { scope: 'playerList', playerListId: 5 });
			const { displayRows } = await showingMetagame();
			mockFetch.mockResolvedValue(archetypeRead({
				entries: [{ name: 'Mono Red', count: 1, metaShare: 100 }],
				totalPlayers: 1,
				scope: 'playerList',
			}));

			deliver('playerList:membersChanged', { listId: 5, playerIds: [2], action: 'added', memberCount: 1 });
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledOnce();
			expect(displayRows.value).toHaveLength(1);
			expect(usePlayerStore().dataVersion).toBe(0);

			deliver('playerList:membersChanged', { listId: 5, playerIds: [2], action: 'removed', memberCount: 0 });
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('ignores another Player List\'s membership', async () => {
			Object.assign(mutableConfig, { scope: 'playerList', playerListId: 5 });
			await showingMetagame();

			deliver('playerList:membersChanged', { listId: 6, playerIds: [2], action: 'added', memberCount: 1 });
			deliver('playerList:deleted', { listId: 6 });
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it.each([
			['an unresolved deck card is resolved elsewhere (#648)', [['playerDeck:cardsResolved', { deckIds: [3, 9], playerIds: [2, 7] }]]],
			['a deck review lands elsewhere', [['playerDeck:reviewed', { deck: { id: 3, playerId: 2 } }]]],
			['an Archetype is created, edited or deleted', [
				['archetype:created', { archetype: { id: 4, name: 'Mono Red' } }],
				['archetype:updated', { archetype: { id: 4, name: 'Boros' } }],
				['archetype:deleted', { archetypeId: 4 }],
			]],
			['a Melee round sync rewrites standings', [['melee:roundSynced', { roundId: 31, matchCount: 8, created: 0, updated: 8, staleDeleted: 0 }]]],
		] as const)('re-reads when %s', async (_, messages) => {
			await showingMetagame();

			for (const [type, payload] of messages) {
				deliver(type, payload);
				await flushPromises();
			}

			expect(mockFetch).toHaveBeenCalledTimes(messages.length);
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('shows a breakdown missed while disconnected once its channel is attached again', async () => {
			const { displayRows } = await showingMetagame();

			realtime.transport.connectionState = 'disconnected';
			await nextTick();
			mockFetch.mockResolvedValue(archetypeRead({
				entries: [{ name: 'Mono Red', count: 1, metaShare: 100 }],
				totalPlayers: 1,
				scope: 'all',
			}));
			realtime.transport.connectionState = 'connected';
			realtime.reattach();
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledOnce();
			expect(displayRows.value).toHaveLength(1);
		});
	});
});

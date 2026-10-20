import type { EffectScope } from 'vue';
import type { MetagameScope } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);

type Handler = (message: Record<string, unknown>) => void;
const channelHandlers = new Map<string, Set<Handler>>();
const continuity = createContinuitySignal();
const mockRealtime = reactive({
	connectionState: 'connected',
	tokenError: null as Error | null,
	onChannel: (channel: string, type: string, handler: Handler) => {
		const key = `${channel}|${type}`;
		if (!channelHandlers.has(key))
			channelHandlers.set(key, new Set());
		channelHandlers.get(key)!.add(handler);
		return () => channelHandlers.get(key)!.delete(handler);
	},
	onContinuityLost: continuity.onContinuityLost,
});

/** An Event message, as the Event channel delivers it. */
function deliver(type: string, payload: Record<string, unknown>) {
	for (const handler of channelHandlers.get(`event:1|${type}`) ?? [])
		handler({ eventId: 1, ...payload });
}

mockNuxtImport('tryUseRealtime', () => () => mockRealtime);

const mockScreenStore = {
	updateModeConfig: vi.fn(),
};

const defaultConfig = {
	viewMode: 'archetype' as 'archetype' | 'cards',
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

// Mutable config and interactive for timer tests
const mutableConfig = reactive({ ...defaultConfig });
const mockInteractive = ref(false);

mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test Screen' }),
	eventId: computed(() => 1),
	interactive: mockInteractive,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

// Server time is the Page Rotation's clock; synced and controllable here.
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

const scopes: EffectScope[] = [];

function makeMetagameModeData() {
	const scope = effectScope();
	const result = scope.run(() => useMetagameModeData())!;
	scopes.push(scope);
	return result;
}

describe('useMetagameModeData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.assign(mutableConfig, defaultConfig);
		mockInteractive.value = false;
		mockRealtime.connectionState = 'connected';
		mockRealtime.tokenError = null;
		mockIsSynced.value = true;
		mockServerNow = 1_000_000;
		mockFetch.mockResolvedValue(archetypeRead({ entries: [], totalPlayers: 0, scope: 'all' }));
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('returns expected properties', () => {
		const result = makeMetagameModeData();

		expect(result).toHaveProperty('config');
		expect(result).toHaveProperty('loading');
		expect(result).toHaveProperty('error');
		expect(result).toHaveProperty('isEmpty');
		expect(result).toHaveProperty('emptyMessage');
		expect(result).toHaveProperty('headerText');
		expect(result).toHaveProperty('displayRows');
		expect(result).toHaveProperty('pageData');
		expect(result).toHaveProperty('currentPage');
		expect(result).toHaveProperty('totalPages');
		expect(result).toHaveProperty('nextPage');
		expect(result).toHaveProperty('prevPage');
	});

	it('generates header text for archetype view with all scope', () => {
		const { headerText } = makeMetagameModeData();

		expect(headerText.value).toBe('Full Field Metagame');
	});

	it('generates header text for archetype view with minPoints scope', () => {
		mutableConfig.scope = 'minPoints';
		mutableConfig.minPoints = 12;

		const { headerText } = makeMetagameModeData();

		expect(headerText.value).toBe('12+ Points Metagame');
	});

	it('reads the breakdown through the Screen, re-reading when the scope changes', async () => {
		makeMetagameModeData();
		await flushPromises();

		// The server derives scope, sort and limit from the saved configuration,
		// so the client names only the Screen resource.
		expect(mockFetch).toHaveBeenLastCalledWith(
			'/api/screen-output/events/1/screens/1/metagame',
			expect.objectContaining({ headers: undefined }),
		);

		mockFetch.mockClear();
		mutableConfig.scope = 'minPoints';
		mutableConfig.minPoints = 12;
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/metagame', expect.anything());
	});

	it('isEmpty is true when entries are empty and not loading', async () => {
		mockFetch.mockResolvedValue(archetypeRead({ entries: [], totalPlayers: 0, scope: 'all' }));

		const { isEmpty } = makeMetagameModeData();
		await flushPromises();

		expect(isEmpty.value).toBe(true);
	});

	it('emptyMessage references no players when the breakdown counts none', async () => {
		const { emptyMessage } = makeMetagameModeData();
		await flushPromises();

		expect(emptyMessage.value).toBe('No players in this event');
	});

	it('emptyMessage shows generic message when players exist but no data', async () => {
		mockFetch.mockResolvedValue(archetypeRead({ entries: [], totalPlayers: 6, scope: 'all' }));

		const { emptyMessage } = makeMetagameModeData();
		await flushPromises();

		expect(emptyMessage.value).toBe('No metagame data available');
	});

	it('totalPages computes from displayRows and pageSize', async () => {
		mockFetch.mockResolvedValue(archetypeRead({
			entries: Array.from({ length: 12 }, (_, i) => ({ name: `Arch${i}`, count: 1, metaShare: 1 })),
			totalPlayers: 12,
			scope: 'all',
		}));

		const { totalPages } = makeMetagameModeData();
		await flushPromises();

		// pageSize is 5 from config, 12 entries => ceil(12/5) = 3
		expect(totalPages.value).toBe(3);
	});

	it('pageData returns correct slice for current page', async () => {
		const entries = Array.from({ length: 8 }, (_, i) => ({ name: `Arch${i}`, count: 1, metaShare: 1 }));
		mockFetch.mockResolvedValue(archetypeRead({ entries, totalPlayers: 8, scope: 'all' }));

		const { pageData } = makeMetagameModeData();
		await flushPromises();

		// Page 1, pageSize 5 => first 5
		expect(pageData.value).toHaveLength(5);
		expect((pageData.value[0] as any).name).toBe('Arch0');
	});

	it('setPage calls screenStore.updateModeConfig', async () => {
		mockInteractive.value = true;
		const entries = Array.from({ length: 12 }, (_, i) => ({ name: `Arch${i}`, count: 1, metaShare: 1 }));
		mockFetch.mockResolvedValue(archetypeRead({ entries, totalPlayers: 12, scope: 'all' }));

		const { setPage } = makeMetagameModeData();
		await flushPromises();
		setPage(2);

		expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
			1,
			1,
			'metagame',
			{ currentPage: 2 },
		);
	});

	it('setPage clamps to valid range', async () => {
		mockInteractive.value = true;
		mockFetch.mockResolvedValue(archetypeRead({
			entries: [{ name: 'A', count: 1, metaShare: 100 }],
			totalPlayers: 1,
			scope: 'all',
		}));

		const { setPage } = makeMetagameModeData();
		await flushPromises();

		// totalPages is 1, so setPage(5) should clamp to 1
		setPage(5);
		expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
			1,
			1,
			'metagame',
			{ currentPage: 1 },
		);
	});

	it('nextPage wraps to 1 after last page', async () => {
		mockInteractive.value = true;
		mockFetch.mockResolvedValue(archetypeRead({
			entries: [{ name: 'A', count: 1, metaShare: 100 }],
			totalPlayers: 1,
			scope: 'all',
		}));

		const { nextPage } = makeMetagameModeData();
		await flushPromises();

		// Only 1 page, currentPage=1, nextPage should wrap to 1
		nextPage();
		expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
			1,
			1,
			'metagame',
			{ currentPage: 1 },
		);
	});

	it('prevPage wraps to last page from page 1', async () => {
		mockInteractive.value = true;
		const entries = Array.from({ length: 12 }, (_, i) => ({ name: `Arch${i}`, count: 1, metaShare: 1 }));
		mockFetch.mockResolvedValue(archetypeRead({ entries, totalPlayers: 12, scope: 'all' }));

		const { prevPage } = makeMetagameModeData();
		await flushPromises();

		// currentPage=1, prevPage should go to last (3)
		prevPage();
		expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
			1,
			1,
			'metagame',
			{ currentPage: 3 },
		);
	});

	// ── auto-paging ──

	describe('auto-paging', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('a non-interactive rendering projects the rotation from server time and never writes', async () => {
			const entries = Array.from({ length: 12 }, (_, i) => ({
				name: `Arch${i}`,
				count: 1,
				metaShare: 1,
			}));
			mockFetch.mockResolvedValue(archetypeRead({ entries, totalPlayers: 12, scope: 'all' }));
			mockInteractive.value = false;

			const { currentPage } = makeMetagameModeData();
			await flushPromises();

			// Anchor now with 5s pages: page 1, flipping at each boundary.
			mutableConfig.autoPageEnabled = true;
			mutableConfig.autoPageIntervalMs = 5000;
			mutableConfig.rotationAnchor = mockServerNow;
			await nextTick();

			expect(currentPage.value).toBe(1);

			mockServerNow += 5000;
			vi.advanceTimersByTime(5000);
			await nextTick();

			expect(currentPage.value).toBe(2);
			expect(mockScreenStore.updateModeConfig).not.toHaveBeenCalled();
		});

		it('renders the card breakdown the cards view reads', async () => {
			const cardEntries = [{ id: 1, name: 'Lightning Bolt', inclusionRate: 100, avgCopies: 4, totalCopies: 8, mainboardCount: 8, sideboardCount: 0, mainboardDeckCount: 2, sideboardDeckCount: 0, deckCount: 2, cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1 }];
			mockFetch.mockResolvedValue(cardsRead({ entries: cardEntries, totalDecks: 2, scope: 'all' }));
			mutableConfig.viewMode = 'cards';
			mutableConfig.archetypeFilter = 'Mono Red';

			const { displayRows } = makeMetagameModeData();
			await flushPromises();

			expect(displayRows.value).toHaveLength(1);
		});
	});

	describe('freshness', () => {
		// The Event, the Screen configuration and the Player store are held
		// constant throughout: only the aggregate's Event Data changes under the
		// output, and nothing loads a roster to stand in for that (#602).
		async function showingMetagame() {
			const data = makeMetagameModeData();
			await flushPromises();
			mockFetch.mockClear();
			return data;
		}

		it('re-reads when the Player List driving it gains or loses a member', async () => {
			mutableConfig.scope = 'playerList';
			mutableConfig.playerListId = 5;
			const { displayRows } = await showingMetagame();
			mockFetch.mockResolvedValue(archetypeRead({ entries: [{ name: 'Mono Red', count: 1, metaShare: 100 }], totalPlayers: 1, scope: 'playerList' }));

			deliver('playerList:membersChanged', { listId: 5, playerIds: [2], action: 'added', memberCount: 1 });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenLastCalledWith('/api/screen-output/events/1/screens/1/metagame', expect.anything());
			expect(displayRows.value).toHaveLength(1);
			expect(usePlayerStore().dataVersion).toBe(0);

			deliver('playerList:membersChanged', { listId: 5, playerIds: [2], action: 'removed', memberCount: 0 });
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('ignores another Player List\'s membership', async () => {
			mutableConfig.scope = 'playerList';
			mutableConfig.playerListId = 5;
			await showingMetagame();

			deliver('playerList:membersChanged', { listId: 6, playerIds: [2], action: 'added', memberCount: 1 });
			deliver('playerList:deleted', { listId: 6 });
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('re-reads when a deck review lands elsewhere', async () => {
			await showingMetagame();

			deliver('playerDeck:reviewed', { deck: { id: 3, playerId: 2 } });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('re-reads when an Archetype is created, edited or deleted', async () => {
			await showingMetagame();

			deliver('archetype:created', { archetype: { id: 4, name: 'Mono Red' } });
			await flushPromises();
			deliver('archetype:updated', { archetype: { id: 4, name: 'Boros' } });
			await flushPromises();
			deliver('archetype:deleted', { archetypeId: 4 });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(3);
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('shows a breakdown missed while disconnected once its channel is attached again', async () => {
			const { displayRows } = await showingMetagame();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			mockFetch.mockResolvedValue(archetypeRead({ entries: [{ name: 'Mono Red', count: 1, metaShare: 100 }], totalPlayers: 1, scope: 'all' }));
			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(displayRows.value).toHaveLength(1);
		});
	});
});

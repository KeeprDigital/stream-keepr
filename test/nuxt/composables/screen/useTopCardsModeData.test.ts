import type { EffectScope } from 'vue';
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
	onceAttached: vi.fn(() => () => {}),
});

/** An Event message, as the Event channel delivers it. */
function deliver(type: string, payload: Record<string, unknown>) {
	for (const handler of channelHandlers.get(`event:1|${type}`) ?? [])
		handler({ eventId: 1, ...payload });
}

mockNuxtImport('tryUseRealtime', () => () => mockRealtime);

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
	cardSize: 'medium' as const,
	dynamicCardSize: true,
	cardGap: 12,
	showHeader: true,
	headerText: undefined as string | undefined,
	showCardNames: true,
	showRankBadges: true,
	statBadge: 'inclusionRate' as const,
	statBadgeSize: 'medium' as const,
};

const mutableConfig = reactive({ ...defaultConfig });

const mockEventId = ref<number | null>(1);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test Screen' }),
	eventId: mockEventId,
	interactive: ref(false),
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

const scopes: EffectScope[] = [];

function makeTopCardsModeData() {
	const scope = effectScope();
	const result = scope.run(() => useTopCardsModeData())!;
	scopes.push(scope);
	return result;
}

describe('useTopCardsModeData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.assign(mutableConfig, defaultConfig, { excludedCardTypes: ['Land'] });
		mockEventId.value = 1;
		mockRealtime.connectionState = 'connected';
		mockRealtime.tokenError = null;
		mockFetch.mockResolvedValue({ entries: [], totalDecks: 0, scope: 'all' });
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('returns expected properties', () => {
		const result = makeTopCardsModeData();

		expect(result).toHaveProperty('config');
		expect(result).toHaveProperty('loading');
		expect(result).toHaveProperty('error');
		expect(result).toHaveProperty('isEmpty');
		expect(result).toHaveProperty('emptyMessage');
		expect(result).toHaveProperty('headerText');
		expect(result).toHaveProperty('entries');
	});

	it('generates the default header text for the full field', () => {
		const { headerText } = makeTopCardsModeData();

		expect(headerText.value).toBe('Most Played Cards');
	});

	it('prefixes the header with the Top N scope', () => {
		mutableConfig.scope = 'topN';
		mutableConfig.topN = 8;

		const { headerText } = makeTopCardsModeData();

		expect(headerText.value).toBe('Top 8 Most Played Cards');
	});

	it('names the archetype filter in the header', () => {
		mutableConfig.archetypeFilter = 'Mono Red';

		const { headerText } = makeTopCardsModeData();

		expect(headerText.value).toBe('Top Cards: Mono Red');
	});

	it('prefers custom header text', () => {
		mutableConfig.headerText = 'The Chase Cards';

		const { headerText } = makeTopCardsModeData();

		expect(headerText.value).toBe('The Chase Cards');
	});

	it('reads the card breakdown through the Screen', async () => {
		makeTopCardsModeData();
		await flushPromises();

		// The server derives board, sort, limit and excluded types from the saved
		// configuration, so the client names only the Screen resource.
		expect(mockFetch).toHaveBeenLastCalledWith(
			'/api/screen-output/events/1/screens/1/top-cards',
			expect.objectContaining({ headers: undefined }),
		);
	});

	it('re-reads when a configuration field the breakdown depends on changes', async () => {
		makeTopCardsModeData();
		await flushPromises();
		mockFetch.mockClear();

		mutableConfig.excludedCardTypes = [];
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/top-cards', expect.anything());
	});

	it('isEmpty is true when entries are empty and not loading', async () => {
		const { isEmpty } = makeTopCardsModeData();
		await flushPromises();

		expect(isEmpty.value).toBe(true);
	});

	it('exposes fetched entries', async () => {
		mockFetch.mockResolvedValue({
			entries: [{ id: 1, name: 'Lightning Bolt', inclusionRate: 80, avgCopies: 3.6, totalCopies: 18, deckCount: 4, mainboardCount: 18, sideboardCount: 0, mainboardDeckCount: 4, sideboardDeckCount: 0, cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1, manaCost: '{R}' }],
			totalDecks: 5,
			scope: 'all',
		});

		const { entries } = makeTopCardsModeData();
		await flushPromises();

		expect(entries.value).toHaveLength(1);
		expect(entries.value[0]!.name).toBe('Lightning Bolt');
	});

	it('emptyMessage references no players when the breakdown counts no decks', async () => {
		const { emptyMessage } = makeTopCardsModeData();
		await flushPromises();

		expect(emptyMessage.value).toBe('No players in this event');
	});

	it('emptyMessage reports missing card data when the field has decks', async () => {
		mockFetch.mockResolvedValue({ entries: [], totalDecks: 4, scope: 'all' });

		const { emptyMessage } = makeTopCardsModeData();
		await flushPromises();

		expect(emptyMessage.value).toBe('No card data available');
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

			deliver('playerDeck:cardsResolved', { deckIds: [3, 9], playerIds: [2, 7] });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenLastCalledWith('/api/screen-output/events/1/screens/1/top-cards', expect.anything());
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('re-reads when a deck review lands elsewhere', async () => {
			await showingCards();

			deliver('playerDeck:reviewed', { deck: { id: 3, playerId: 2 } });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenLastCalledWith('/api/screen-output/events/1/screens/1/top-cards', expect.anything());
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('re-reads when an Archetype is edited or its key cards change', async () => {
			await showingCards();

			deliver('archetype:updated', { archetype: { id: 4, name: 'Mono Red' } });
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

			deliver('playerList:membersChanged', { listId: 6, playerIds: [2], action: 'added', memberCount: 3 });
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			deliver('playerList:membersChanged', { listId: 5, playerIds: [2], action: 'added', memberCount: 3 });
			await flushPromises();
			deliver('playerList:membersChanged', { listId: 5, playerIds: [2], action: 'removed', memberCount: 2 });
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(usePlayerStore().dataVersion).toBe(0);
		});

		it('ignores Player List membership while scoped to the full field', async () => {
			mutableConfig.playerListId = 5;
			await showingCards();

			deliver('playerList:membersChanged', { listId: 5, playerIds: [2], action: 'added', memberCount: 3 });
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('re-reads when a Melee round sync rewrites standings', async () => {
			mutableConfig.scope = 'topN';
			await showingCards();

			deliver('melee:roundSynced', { roundId: 31, matchCount: 8, created: 0, updated: 8, staleDeleted: 0 });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('shows cards missed while disconnected once its channel is attached again', async () => {
			const { entries } = await showingCards();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			mockFetch.mockResolvedValue({ entries: [{ id: 1, name: 'Lightning Bolt' }], totalDecks: 4, scope: 'all' });
			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
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

import type { EffectScope } from 'vue';
import type { ScreenOutputArchetypePilot, ScreenOutputArchetypeSpotlightResponse } from '~~/shared/types/screenOutputReads';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';

const defaultConfig = {
	archetypeId: undefined as number | undefined,
	scope: 'all' as 'all' | 'topN' | 'minPoints' | 'playerList',
	topN: 8,
	minPoints: 9,
	playerListId: undefined as number | undefined,
	conversionMetric: 'topN' as 'topN' | 'minPoints',
	conversionThreshold: 8,
	board: 'full' as const,
	cardLimit: 8,
	excludedCardTypes: ['Land'],
	showHeader: true,
	headerText: undefined as string | undefined,
	rowsPerPage: 8,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	currentPage: 1,
	rotationAnchor: undefined as number | undefined,
};

const mutableConfig = reactive({ ...defaultConfig });
const mockEventId = ref<number | null>(1);
const mockInteractive = ref(false);
const mockScreenStore = { updateModeConfig: vi.fn() };
const mockEventStore = reactive({ displayEvent: null as null | { displayRecordSeparator?: string; displayHideZeroDraws?: boolean } });
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
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

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => mockRealtime);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: mockInteractive,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

function pilot(id: number, name: string, position: number | null, overrides: Partial<ScreenOutputArchetypePilot> = {}): ScreenOutputArchetypePilot {
	return { id, name, position, points: 12, wins: 4, losses: 1, draws: 0, ...overrides };
}

function answer(overrides: Partial<ScreenOutputArchetypeSpotlightResponse> = {}): ScreenOutputArchetypeSpotlightResponse {
	return {
		archetype: { id: 7, name: 'Mono Red', colors: 'R' },
		playerCount: 2,
		metaShare: 25,
		convertedCount: 1,
		conversionRate: 50,
		pilots: [pilot(11, 'Nadia Rivers', 1), pilot(12, 'Oskar Lind', 6)],
		topCards: [],
		...overrides,
	};
}

const scopes: EffectScope[] = [];

function makeSpotlight() {
	const scope = effectScope();
	const result = scope.run(() => useArchetypeSpotlightModeData())!;
	scopes.push(scope);
	return result;
}

describe('useArchetypeSpotlightModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		mockEventId.value = 1;
		mockInteractive.value = false;
		mockEventStore.displayEvent = null;
		mockRealtime.connectionState = 'connected';
		mockRealtime.tokenError = null;
		mockFetch.mockReset();
		mockScreenStore.updateModeConfig.mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('reads the configured Archetype\'s spotlight through the Screen', async () => {
		mutableConfig.archetypeId = 7;
		mockFetch.mockResolvedValue(answer());

		const { spotlight, pageData, isEmpty, error } = makeSpotlight();
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/archetype-spotlight', expect.anything());
		expect(spotlight.value?.metaShare).toBe(25);
		expect(pageData.value.map(row => row.name)).toEqual(['Nadia Rivers', 'Oskar Lind']);
		expect(isEmpty.value).toBe(false);
		expect(error.value).toBeNull();
	});

	it('reads nothing and is empty while no Archetype is picked', async () => {
		const { isEmpty } = makeSpotlight();
		await flushPromises();

		expect(mockFetch).not.toHaveBeenCalled();
		expect(isEmpty.value).toBe(true);
	});

	it('is empty while the Archetype has no pilots in the scope', async () => {
		mutableConfig.archetypeId = 7;
		mockFetch.mockResolvedValue(answer({ playerCount: 0, pilots: [] }));

		const { isEmpty } = makeSpotlight();
		await flushPromises();

		expect(isEmpty.value).toBe(true);
	});

	it('re-reads when the Archetype, scope or conversion target changes', async () => {
		mutableConfig.archetypeId = 7;
		mockFetch.mockResolvedValue(answer());
		makeSpotlight();
		await flushPromises();

		mutableConfig.archetypeId = 8;
		await flushPromises();
		mutableConfig.scope = 'topN';
		await flushPromises();
		mutableConfig.conversionThreshold = 4;
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(4);
	});

	describe('headerText', () => {
		it('prefers the configured header', async () => {
			mutableConfig.archetypeId = 7;
			mutableConfig.headerText = 'Deck to Beat';
			mockFetch.mockResolvedValue(answer());

			const { headerText } = makeSpotlight();
			await flushPromises();

			expect(headerText.value).toBe('Deck to Beat');
		});

		it('names the loaded Archetype within its scope when no header is configured', async () => {
			mutableConfig.archetypeId = 7;
			mutableConfig.scope = 'topN';
			mockFetch.mockResolvedValue(answer());

			const { headerText } = makeSpotlight();
			await flushPromises();

			expect(headerText.value).toBe('Top 8 Spotlight: Mono Red');
		});

		it('falls back to a generic header before an Archetype loads', () => {
			expect(makeSpotlight().headerText.value).toBe('Archetype Spotlight');
		});
	});

	describe('conversionLabel', () => {
		it.each([
			['topN', 8, 'Top 8'],
			['minPoints', 18, '18+ pts'],
		] as const)('names a %s target of %d as the archetype page does', (conversionMetric, conversionThreshold, expected) => {
			mutableConfig.conversionMetric = conversionMetric;
			mutableConfig.conversionThreshold = conversionThreshold;

			expect(makeSpotlight().conversionLabel.value).toBe(expected);
		});
	});

	describe('formatRecord', () => {
		it('hides zero draws by default', () => {
			expect(makeSpotlight().formatRecord(pilot(1, 'A', 1, { wins: 5, losses: 2, draws: 0 }))).toBe('5-2');
		});

		it('follows the Event\'s record formatting', () => {
			mockEventStore.displayEvent = { displayRecordSeparator: ' | ', displayHideZeroDraws: false };

			expect(makeSpotlight().formatRecord(pilot(1, 'A', 1, { wins: 5, losses: 2, draws: 0 }))).toBe('5 | 2 | 0');
		});

		it('shows a draw count when there is one', () => {
			expect(makeSpotlight().formatRecord(pilot(1, 'A', 1, { wins: 5, losses: 1, draws: 1 }))).toBe('5-1-1');
		});
	});

	it('pages pilots by the configured page size and current page', async () => {
		mutableConfig.archetypeId = 7;
		mutableConfig.rowsPerPage = 1;
		mutableConfig.currentPage = 2;
		mockFetch.mockResolvedValue(answer());

		const { pageData } = makeSpotlight();
		await flushPromises();

		expect(pageData.value.map(row => row.name)).toEqual(['Oskar Lind']);
	});

	it('never writes mode config from a rendering, even with auto-page on', async () => {
		mutableConfig.archetypeId = 7;
		mutableConfig.autoPageEnabled = true;
		mockInteractive.value = true;
		mockFetch.mockResolvedValue(answer());

		makeSpotlight();
		await flushPromises();

		expect(mockScreenStore.updateModeConfig).not.toHaveBeenCalled();
	});

	describe('freshness', () => {
		async function showingSpotlight() {
			mutableConfig.archetypeId = 7;
			mockFetch.mockResolvedValue(answer());
			const data = makeSpotlight();
			await flushPromises();
			mockFetch.mockClear();
			return data;
		}

		it('shows a pilot\'s new standing without reload', async () => {
			const { pageData } = await showingSpotlight();
			mockFetch.mockResolvedValue(answer({ pilots: [pilot(11, 'Nadia Rivers', 1, { wins: 5 }), pilot(12, 'Oskar Lind', 6)] }));

			deliver('player:updated', { player: { id: 11 } });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(pageData.value[0]?.wins).toBe(5);
		});

		it('follows deck reviews, resolved cards, Archetype edits and Melee syncs', async () => {
			await showingSpotlight();

			for (const [type, payload] of [
				['playerDeck:reviewed', { playerId: 11 }],
				['playerDeck:cardsResolved', { deckIds: [3] }],
				['archetype:updated', { archetype: { id: 7 } }],
				['archetype:keyCardsUpdated', { archetypeId: 7 }],
				['melee:decklistsSynced', {}],
				['melee:roundSynced', { roundId: 31 }],
			] as const) {
				deliver(type, payload);
				await flushPromises();
			}

			expect(mockFetch).toHaveBeenCalledTimes(6);
		});

		it('follows its Player List\'s members only while the scope names that list', async () => {
			await showingSpotlight();
			mutableConfig.playerListId = 3;

			deliver('playerList:membersChanged', { listId: 3 });
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			mutableConfig.scope = 'playerList';
			await flushPromises();
			mockFetch.mockClear();

			deliver('playerList:membersChanged', { listId: 4 });
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			deliver('playerList:membersChanged', { listId: 3 });
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('shows a change missed while disconnected once its channel is attached again', async () => {
			const { spotlight } = await showingSpotlight();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			mockFetch.mockResolvedValue(answer({ metaShare: 30 }));
			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(spotlight.value?.metaShare).toBe(30);
		});
	});
});

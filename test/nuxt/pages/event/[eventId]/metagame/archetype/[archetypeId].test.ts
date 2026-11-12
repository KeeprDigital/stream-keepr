import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import { createMockArchetypeDetailResponse } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

const route = reactive({
	params: { archetypeId: '7' },
	path: '/event/99/metagame/archetype/7',
	fullPath: '/event/99/metagame/archetype/7',
	query: {} as Record<string, string>,
});

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useRoute', () => () => route);
mockNuxtImport('useRouter', () => () => ({
	currentRoute: ref(route),
	replace: vi.fn(),
	push: vi.fn(),
	beforeEach: vi.fn(() => () => {}),
	beforeResolve: vi.fn(() => () => {}),
	afterEach: vi.fn(() => () => {}),
	onError: vi.fn(() => () => {}),
	resolve: vi.fn(() => ({
		fullPath: route.fullPath,
		path: route.path,
		href: route.fullPath,
		matched: [],
	})),
	options: {
		history: { state: {}, base: '/' },
	},
}));
const mockEventStore = reactive({
	eventId: 99,
	event: { id: 99, game: 'mtg' as 'mtg' | 'op' },
});
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useMetagameStore', () => () => reactive({
	scopeQuery: { scope: 'all' },
	conversionTarget: { conversionMetric: 'topN', conversionThreshold: 8 },
	invalidationVersion: 0,
}));
mockNuxtImport('usePlayerStore', () => () => reactive({
	players: [],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
}));
mockNuxtImport('useToast', () => () => ({
	add: vi.fn(),
}));

async function mountPage() {
	route.params.archetypeId = '7';
	mockFetch.mockResolvedValue(createMockArchetypeDetailResponse());
	const pagePath = '../../../../../../../app/pages/event/[eventId]/metagame/archetype/[archetypeId].vue';
	const { default: ArchetypeDetailPage } = await import(pagePath);
	return mount(ArchetypeDetailPage, {
		global: {
			stubs: {
				...nuxtUiStubs,
				UTabs: true,
				UILoadingSpinner: true,
				MetagameStatStrip: {
					props: ['stats'],
					template: '<dl data-testid="stats">{{ stats.map(stat => stat.label).join("|") }}</dl>',
				},
				MtgManaColorDisplay: true,
				MetagameKeyCards: true,
				MetagameCardsTable: true,
				MetagamePlayersTable: true,
				MetagameArchetypeChartSeriesField: true,
				MetagameArchetypeNameField: true,
				MetagameArchetypeActions: true,
			},
		},
	});
}

describe('archetype metagame detail page', () => {
	it('re-reads the Archetype when the route names another', async () => {
		const wrapper = await mountPage();
		await flushPromises();
		mockFetch.mockClear();

		route.params.archetypeId = '8';
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/events/99/metagame/archetypes/8', {
			query: {
				scope: 'all',
				board: 'full',
				conversionMetric: 'topN',
				conversionThreshold: 8,
			},
		});
		wrapper.unmount();
	});

	it('edits the Pinned Chart Series of the Archetype it shows', async () => {
		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.findComponent({ name: 'MetagameArchetypeChartSeriesField' }).props()).toEqual({ eventId: 99, archetypeId: 1 });
		wrapper.unmount();
	});

	// An OP Metagame counts its Archetype's cards and reads participation only; its pin is edited as on Magic (ADR-0074).
	it.each([
		['mtg', 'Players|Meta Share|Win Rate|Avg Place|Conversion (Top 8)'],
		['op', 'Players|Meta Share'],
	] as const)('on a %s Event, shows the cards, the pin, and the stats %s', async (game, stats) => {
		mockEventStore.event.game = game;
		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="stats"]').text()).toBe(stats);
		expect(wrapper.findComponent({ name: 'MetagameCardsTable' }).exists()).toBe(true);
		expect(wrapper.findComponent({ name: 'MetagameArchetypeChartSeriesField' }).exists()).toBe(true);
		wrapper.unmount();
		mockEventStore.event.game = 'mtg';
	});

	// An MTG Archetype is the operator's to rename, merge and delete; an OP one follows its Leader and is only renamed (ADR-0074).
	it.each([
		['mtg', true],
		['op', false],
	] as const)('on a %s Event, renames the Archetype, and merges or deletes it: %s', async (game, managed) => {
		mockEventStore.event.game = game;
		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.findComponent({ name: 'MetagameArchetypeNameField' }).props()).toEqual({ eventId: 99, archetypeId: 1, mergeable: managed });
		expect(wrapper.findComponent({ name: 'MetagameArchetypeActions' }).exists()).toBe(managed);
		wrapper.unmount();
		mockEventStore.event.game = 'mtg';
	});
});

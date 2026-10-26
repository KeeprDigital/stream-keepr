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
mockNuxtImport('useEventStore', () => () => reactive({
	eventId: 99,
	event: { id: 99, game: 'mtg' },
}));
mockNuxtImport('useMetagameStore', () => () => reactive({
	scopeQuery: { scope: 'all' },
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

describe('archetype metagame detail page', () => {
	it('re-reads the Archetype when the route names another', async () => {
		mockFetch.mockResolvedValue(createMockArchetypeDetailResponse());
		const pagePath = '../../../../../../../app/pages/event/[eventId]/metagame/archetype/[archetypeId].vue';
		const { default: ArchetypeDetailPage } = await import(pagePath);
		const wrapper = mount(ArchetypeDetailPage, {
			global: {
				stubs: {
					...nuxtUiStubs,
					UTabs: true,
					UILoadingSpinner: true,
					MetagameStatStrip: true,
					MtgManaColorDisplay: true,
					MetagameKeyCards: true,
					MetagameCardsTable: true,
					MetagamePlayersTable: true,
				},
			},
		});
		await flushPromises();
		mockFetch.mockClear();

		route.params.archetypeId = '8';
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/events/99/metagame/archetypes/8', {
			query: { scope: 'all', board: 'full' },
		});
		wrapper.unmount();
	});
});

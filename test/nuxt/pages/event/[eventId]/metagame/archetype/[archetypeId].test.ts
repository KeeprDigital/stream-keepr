import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive, ref } from 'vue';
import { createMockArchetypeDetailResponse } from '~~/test/helpers/fixtures';

const route = reactive({
	params: { archetypeId: '7' },
	path: '/event/99/metagame/archetype/7',
	fullPath: '/event/99/metagame/archetype/7',
	query: reactive<Record<string, string | undefined>>({}),
});

function buildFullPath() {
	const queryString = new URLSearchParams(
		Object.entries(route.query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	).toString();

	route.fullPath = queryString ? `${route.path}?${queryString}` : route.path;
}

const beforeEachHooks: Array<(...args: unknown[]) => unknown> = [];
const beforeResolveHooks: Array<(...args: unknown[]) => unknown> = [];
const afterEachHooks: Array<(...args: unknown[]) => unknown> = [];

const mockRouter = {
	currentRoute: ref(route),
	beforeEach: vi.fn((handler: (...args: unknown[]) => unknown) => {
		beforeEachHooks.push(handler);
		return () => {};
	}),
	afterEach: vi.fn((handler: (...args: unknown[]) => unknown) => {
		afterEachHooks.push(handler);
		return () => {};
	}),
	beforeResolve: vi.fn((handler: (...args: unknown[]) => unknown) => {
		beforeResolveHooks.push(handler);
		return () => {};
	}),
	onError: vi.fn(() => () => {}),
	resolve: vi.fn((to?: { path?: string }) => ({
		fullPath: to?.path ?? route.fullPath,
		path: to?.path ?? route.path,
		href: to?.path ?? route.fullPath,
		matched: [],
	})),
	options: {
		history: {
			state: {},
			base: '/',
		},
	},
	push: vi.fn(),
	replace: vi.fn(async ({ query }: { query?: Record<string, unknown> }) => {
		const from = { ...route, query: { ...route.query } };
		const to = { ...route, query: { ...route.query } };

		for (const handler of beforeEachHooks)
			await handler(to, from);
		for (const handler of beforeResolveHooks)
			await handler(to, from);

		for (const key of Object.keys(route.query))
			delete route.query[key];

		for (const [key, value] of Object.entries(query ?? {})) {
			if (typeof value === 'string')
				route.query[key] = value;
		}

		buildFullPath();
		mockRouter.currentRoute.value = route;

		for (const handler of afterEachHooks)
			await handler(route, from);

		await nextTick();
	}),
};

const mockReplace = mockRouter.replace;

const mockToast = {
	add: vi.fn(),
};

const mockEventStore = reactive({
	eventId: 99,
	event: { id: 99, game: 'mtg' as const },
	$reset: vi.fn(),
	loadEvent: vi.fn(),
});

const mockMetagameStore = reactive({
	scope: 'all',
	topN: 8,
	playerListId: undefined as number | undefined,
	scopeQuery: { scope: 'all' as const },
	invalidationVersion: 0,
	$reset: vi.fn(),
});

const mockPlayerStore = reactive({
	players: [],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
	$reset: vi.fn(),
});

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);

mockNuxtImport('useRoute', () => () => route);
mockNuxtImport('useRouter', () => () => mockRouter);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerListStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('usePhaseStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useRoundStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useMatchStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useFeatureMatchStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useScreenStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useCardStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useMeleeStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('clearPlayerDeckCache', () => vi.fn());
mockNuxtImport('navigateTo', () => vi.fn());

const UCardStub = defineComponent({
	template: '<div><slot name="header" /><slot /></div>',
});

const UTabsStub = defineComponent({
	props: {
		items: {
			type: Array,
			default: () => [],
		},
		modelValue: {
			type: String,
			default: undefined,
		},
	},
	emits: ['update:model-value'],
	template: `
		<div data-testid="section-tabs">
			<button
				v-for="item in items"
				:key="item.value"
				:type="'button'"
				:data-testid="'tab-' + item.value"
				:data-active="item.value === modelValue"
				@click="$emit('update:model-value', item.value)"
			>
				{{ item.label }}
			</button>
		</div>
	`,
});

const CardsTableStub = defineComponent({
	template: '<div data-testid="cards-table">Cards</div>',
});

const PlayersTableStub = defineComponent({
	template: '<div data-testid="players-table">Players</div>',
});

let activeWrapper: any = null;

async function mountPage(): Promise<any> {
	const pagePath = '../../../../../../../app/pages/event/[eventId]/metagame/archetype/[archetypeId].vue';
	const { default: ArchetypeDetailPage } = await import(pagePath);

	activeWrapper = mount(ArchetypeDetailPage, {
		global: {
			stubs: {
				UILoadingSpinner: true,
				UIcon: true,
				UCard: UCardStub,
				UTabs: UTabsStub,
				MetagameStatStrip: true,
				MtgManaColorDisplay: true,
				MetagameKeyCards: true,
				MetagameCardsTable: CardsTableStub,
				MetagamePlayersTable: PlayersTableStub,
			},
		},
	});

	return activeWrapper;
}

describe('archetype metagame detail page', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockResolvedValue(createMockArchetypeDetailResponse());
		mockReplace.mockClear();
		mockRouter.beforeEach.mockClear();
		mockRouter.beforeResolve.mockClear();
		mockRouter.afterEach.mockClear();
		mockRouter.onError.mockClear();
		mockToast.add.mockClear();
		mockEventStore.eventId = 99;
		mockEventStore.event = { id: 99, game: 'mtg' };
		mockEventStore.$reset.mockClear();
		mockEventStore.loadEvent.mockClear();
		mockMetagameStore.scope = 'all';
		mockMetagameStore.topN = 8;
		mockMetagameStore.playerListId = undefined;
		mockMetagameStore.scopeQuery = { scope: 'all' };
		mockMetagameStore.invalidationVersion = 0;
		mockMetagameStore.$reset.mockClear();
		mockPlayerStore.players = [];
		mockPlayerStore.isLoaded = true;
		mockPlayerStore.loadPlayersByEventId.mockClear();
		mockPlayerStore.$reset.mockClear();
		route.params.archetypeId = '7';
		route.path = '/event/99/metagame/archetype/7';

		for (const key of Object.keys(route.query))
			delete route.query[key];

		buildFullPath();
		mockRouter.currentRoute.value = route;
		beforeEachHooks.length = 0;
		beforeResolveHooks.length = 0;
		afterEachHooks.length = 0;
	});

	afterEach(() => {
		activeWrapper?.unmount();
		activeWrapper = null;
	});

	it('refetches when the route archetypeId changes', async () => {
		await mountPage();
		await flushPromises();
		await nextTick();

		mockFetch.mockClear();
		route.params.archetypeId = '8';
		route.path = '/event/99/metagame/archetype/8';
		buildFullPath();
		mockRouter.currentRoute.value = route;

		await flushPromises();
		await nextTick();

		expect(mockFetch).toHaveBeenCalledWith(
			'/api/events/99/metagame/archetypes/8',
			{ query: { scope: 'all', board: 'full' } },
		);
	});
});

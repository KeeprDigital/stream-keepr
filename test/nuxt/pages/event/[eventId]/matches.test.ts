import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive, ref, watch } from 'vue';

const route = reactive({
	params: { eventId: '1' },
	path: '/event/1/matches',
	fullPath: '/event/1/matches',
	query: {} as Record<string, string | undefined>,
});

function buildFullPath() {
	const queryString = new URLSearchParams(
		Object.entries(route.query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	).toString();

	route.fullPath = queryString ? `${route.path}?${queryString}` : route.path;
}

const router = {
	currentRoute: ref(route),
	beforeEach: vi.fn(() => () => {}),
	afterEach: vi.fn(() => () => {}),
	beforeResolve: vi.fn(() => () => {}),
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
	replace: vi.fn(async ({ query }: { query: Record<string, string | undefined> }) => {
		for (const key of Object.keys(route.query))
			delete route.query[key];

		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined)
				route.query[key] = value;
		}

		buildFullPath();
		router.currentRoute.value = route;

		await nextTick();
	}),
};

const mockEventStore = reactive({
	eventId: 1,
	loadEvent: vi.fn(),
	$reset: vi.fn(),
});

const mockMatchStore = reactive({
	matches: [] as Array<{ id: number; roundId: number; hasResult?: boolean; isBye?: boolean }>,
	isLoaded: true,
	loadMatchesByRoundId: vi.fn(),
	$reset: vi.fn(),
});

const mockRoundStore = reactive({
	rounds: [] as Array<{ id: number; phaseId: number; name: string; lastSyncedAt?: string | Date | null }>,
	isLoaded: true,
	loadRoundsByEventId: vi.fn(),
	getRoundById: vi.fn((id: number) => mockRoundStore.rounds.find(round => round.id === id)),
	$reset: vi.fn(),
});

const mockFeatureMatchStore = reactive({
	featureMatches: [] as Array<{ id: number; matchId: number | null }>,
	isLoaded: true,
	loadFeatureMatchesByEventId: vi.fn(),
	$reset: vi.fn(),
});

const mockFeatureMatchPromotion = {
	promote: vi.fn(),
};

const releaseAssignmentRound = vi.fn();
const assignmentsByRound = new Map<number, Array<{ id: number; roundId: number; note: string | null }>>();
const mockFeatureMatchAssignmentStore = reactive({
	consumeRound: vi.fn(() => releaseAssignmentRound),
	loadAssignments: vi.fn(),
	assignmentsForRound: vi.fn((roundId: number) => assignmentsByRound.get(roundId) ?? []),
	isRemoteChanged: vi.fn(() => false),
	updateAssignment: vi.fn(),
});

const mockPlayerStore = reactive({
	players: [] as Array<{ id: number; name: string; updatedAt: string }>,
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
	$reset: vi.fn(),
});

const mockPhaseStore = reactive({
	isLoaded: true,
	loadPhasesByEventId: vi.fn(),
	getPhaseById: vi.fn(() => undefined),
	$reset: vi.fn(),
});

const mockToast = {
	add: vi.fn(),
};

const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(),
	})),
};

const mockPlayerDeckCache = {
	getDeckLists: vi.fn(() => []),
	fetchDeck: vi.fn(),
};

const mockMatchRepository = {
	list: vi.fn(),
};

const eventId = ref(1);
const storesLoading = ref(false);

mockNuxtImport('useRoute', () => () => route);
mockNuxtImport('useRouter', () => () => router);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('useMatchRepository', () => () => mockMatchRepository);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchPromotion', () => () => mockFeatureMatchPromotion);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => mockFeatureMatchAssignmentStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useArchetypeStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useMetagameStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('usePlayerListStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('useOverlay', () => () => mockOverlay);
mockNuxtImport('usePlayerDeckCache', () => () => mockPlayerDeckCache);
mockNuxtImport('useEventPageLoading', () => () => ({ eventId, initialLoading: storesLoading, initialError: ref(null), retry: vi.fn() }));
mockNuxtImport('useScreenStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useCardStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useMeleeStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('clearPlayerDeckCache', () => vi.fn());
mockNuxtImport('navigateTo', () => vi.fn());
mockNuxtImport('watchDebounced', () => (source: any, callback: any) => watch(source, callback));

const NuxtLayoutStub = defineComponent({
	props: {
		flush: {
			type: Boolean,
			default: false,
		},
	},
	template: `
		<div :data-flush="flush ? 'true' : 'false'">
			<div data-testid="actions"><slot name="actions" /></div>
			<div data-testid="toolbar"><slot name="toolbar" /></div>
			<slot />
		</div>
	`,
});

const UIEmptyStateStub = defineComponent({
	props: {
		title: {
			type: String,
			required: true,
		},
		description: {
			type: String,
			required: false,
		},
	},
	template: '<div data-testid="empty-state">{{ title }}|{{ description }}<slot name="actions" /></div>',
});

const MatchListStub = defineComponent({
	props: {
		matches: {
			type: Array,
			required: true,
		},
		featureMatchAssignments: {
			type: Array,
			default: () => [],
		},
	},
	template: '<div data-testid="match-list" :data-assignment-notes="featureMatchAssignments.map(assignment => assignment.note).join(\'|\')">Match list: {{ matches.map(match => match.id).join(",") }}</div>',
});

const UDashboardToolbarStub = defineComponent({
	template: '<div data-testid="toolbar-content"><slot name="left" /><slot name="right" /></div>',
});

const UButtonStub = defineComponent({
	props: {
		label: {
			type: String,
			required: false,
		},
	},
	template: '<button type="button"><slot />{{ label }}</button>',
});

const USelectMenuStub = defineComponent({
	props: {
		items: {
			type: Array,
			required: true,
		},
	},
	template: `
		<div data-testid="round-select">
			<div v-for="item in items" :key="item.value">
				{{ item.label }}|{{ item.disabled ? 'disabled' : 'enabled' }}
			</div>
		</div>
	`,
});

const UContainerStub = defineComponent({
	template: '<div data-testid="container"><slot /></div>',
});

const mountedPages: Array<ReturnType<typeof mount>> = [];

async function mountPage() {
	const pagePath = '../../../../../app/pages/event/[eventId]/matches.vue';
	const { default: MatchesPage } = await import(pagePath);

	const wrapper = mount(MatchesPage, {
		global: {
			stubs: {
				NuxtLayout: NuxtLayoutStub,
				UIEmptyState: UIEmptyStateStub,
				UDashboardToolbar: UDashboardToolbarStub,
				UContainer: UContainerStub,
				UButton: UButtonStub,
				USelectMenu: USelectMenuStub,
				UISearchInput: true,
				MatchList: MatchListStub,
			},
		},
	});
	mountedPages.push(wrapper);
	return wrapper;
}

describe('matches page', () => {
	beforeEach(() => {
		for (const key of Object.keys(route.query))
			delete route.query[key];

		mockMatchStore.matches = [];
		mockRoundStore.rounds = [];
		mockFeatureMatchStore.featureMatches = [];
		assignmentsByRound.clear();
		mockPlayerStore.players = [];
		storesLoading.value = false;
		mockMatchStore.loadMatchesByRoundId.mockClear();
		mockFeatureMatchAssignmentStore.consumeRound.mockClear();
		mockFeatureMatchAssignmentStore.loadAssignments.mockClear();
		releaseAssignmentRound.mockClear();
		mockMatchRepository.list.mockReset();
		mockMatchRepository.list.mockResolvedValue([]);
		mockOverlay.create.mockClear();
		router.replace.mockClear();
		mockToast.add.mockClear();
	});

	afterEach(() => {
		for (const wrapper of mountedPages.splice(0))
			wrapper.unmount();
	});

	it('shows the rounds setup empty state when no rounds exist', async () => {
		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('Set up rounds before creating matches.');
		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('Set Up Structure');
	});

	it('shows an empty state when rounds exist but none of them have matches', async () => {
		mockRoundStore.rounds = [{ id: 2, phaseId: 1, name: 'Round 1', lastSyncedAt: null }];

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('Create a match to get started.');
		expect(mockMatchStore.loadMatchesByRoundId).toHaveBeenCalledWith(1, 2);
	});

	it('shows the navbar Add Match action once matches exist', async () => {
		mockRoundStore.rounds = [{ id: 2, phaseId: 1, name: 'Round 1', lastSyncedAt: null }];
		mockMatchRepository.list.mockResolvedValue([{ id: 9, roundId: 2 }]);
		mockMatchStore.matches = [{ id: 9, roundId: 2, hasResult: false, isBye: false }];

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="actions"]').text()).toContain('Add Match');
		expect(wrapper.get('[data-testid="toolbar"]').text()).toContain('1 Match');
		expect(wrapper.get('[data-testid="match-list"]').text()).toContain('Match list: 9');
	});

	it('prefers the most recently synced round when no query or current round exists', async () => {
		mockRoundStore.rounds = [
			{ id: 2, phaseId: 1, name: 'Round 1', lastSyncedAt: '2026-04-10T10:00:00.000Z' },
			{ id: 3, phaseId: 1, name: 'Round 2', lastSyncedAt: '2026-04-10T11:00:00.000Z' },
			{ id: 4, phaseId: 1, name: 'Round 3', lastSyncedAt: null },
		];
		mockMatchRepository.list.mockResolvedValue([
			{ id: 1, roundId: 2 },
			{ id: 2, roundId: 3 },
		]);

		await mountPage();
		await flushPromises();

		expect(mockMatchStore.loadMatchesByRoundId).toHaveBeenCalledWith(1, 3);
	});

	it('uses most recently synced round when no query exists', async () => {
		mockRoundStore.rounds = [
			{ id: 2, phaseId: 1, name: 'Round 1', lastSyncedAt: '2026-04-10T11:00:00.000Z' },
			{ id: 4, phaseId: 1, name: 'Round 2', lastSyncedAt: null },
		];
		mockMatchRepository.list.mockResolvedValue([
			{ id: 1, roundId: 2 },
			{ id: 2, roundId: 4 },
		]);

		await mountPage();
		await flushPromises();

		expect(mockMatchStore.loadMatchesByRoundId).toHaveBeenCalledWith(1, 2);
	});

	it('shows available rounds in the selector', async () => {
		mockRoundStore.rounds = [
			{ id: 2, phaseId: 1, name: 'Round 1', lastSyncedAt: null },
			{ id: 3, phaseId: 1, name: 'Round 2', lastSyncedAt: null },
		];
		mockMatchRepository.list.mockResolvedValue([{ id: 1, roundId: 3 }]);
		mockMatchStore.matches = [{ id: 1, roundId: 3 }];

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="round-select"]').text()).toContain('Round 1|enabled');
		expect(wrapper.get('[data-testid="round-select"]').text()).toContain('Round 2|enabled');
	});

	it('shows all matches for the selected round', async () => {
		mockRoundStore.rounds = [{ id: 2, phaseId: 1, name: 'Round 1', lastSyncedAt: null }];
		mockMatchRepository.list.mockResolvedValue([
			{ id: 11, roundId: 2 },
			{ id: 12, roundId: 2 },
			{ id: 13, roundId: 2 },
		]);
		mockMatchStore.matches = [
			{ id: 11, roundId: 2, hasResult: false, isBye: false },
			{ id: 12, roundId: 2, hasResult: true, isBye: false },
			{ id: 13, roundId: 2, hasResult: false, isBye: true },
		];

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="toolbar"]').text()).toContain('3 Matches');
		expect(wrapper.get('[data-testid="match-list"]').text()).toContain('Match list: 11,12,13');
	});

	it('passes only the selected previous Round Assignments to the Matches list and releases it on unmount', async () => {
		route.query.roundId = '3';
		mockRoundStore.rounds = [
			{ id: 2, phaseId: 1, name: 'Round 1', lastSyncedAt: null },
			{ id: 3, phaseId: 1, name: 'Round 2', lastSyncedAt: null },
		];
		mockMatchRepository.list.mockResolvedValue([{ id: 13, roundId: 3 }]);
		mockMatchStore.matches = [{ id: 13, roundId: 3, hasResult: false, isBye: false }];
		assignmentsByRound.set(2, [{ id: 20, roundId: 2, note: 'Wrong Round' }]);
		assignmentsByRound.set(3, [{ id: 30, roundId: 3, note: 'Selected Round Note' }]);

		const wrapper = await mountPage();
		await flushPromises();

		expect(mockFeatureMatchAssignmentStore.consumeRound).toHaveBeenCalledWith(1, 3);
		expect(wrapper.get('[data-testid="match-list"]').attributes('data-assignment-notes')).toBe('Selected Round Note');
		wrapper.unmount();
		expect(releaseAssignmentRound).toHaveBeenCalledOnce();
	});
});

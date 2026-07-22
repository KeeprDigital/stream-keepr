import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref, watch } from 'vue';

const mockEventStore = reactive({
	eventId: 1,
	event: { id: 1, game: 'mtg' as const, pronounsEnabled: true, lgsEnabled: false },
});

const mockPlayerStore = reactive({
	players: [] as Array<{ id: number; name: string; gameData: null; updatedAt: string }>,
	isLoaded: true,
	loading: false,
	loadPlayersByEventId: vi.fn(),
	removePlayer: vi.fn(),
});

const mockPlayerListStore = reactive({
	lists: [] as Array<{ id: number; name: string; memberCount: number }>,
	isLoaded: true,
	loadByEventId: vi.fn(),
	getCachedMemberIds: vi.fn(() => [] as number[] | undefined),
	loadListMembers: vi.fn(),
	addMembers: vi.fn(),
	batchRemoveMembers: vi.fn(),
});

const mockPhaseStore = reactive({
	isLoaded: true,
	loadPhasesByEventId: vi.fn(),
	getPhaseById: vi.fn(() => undefined),
});

const mockRoundStore = reactive({
	rounds: [] as Array<{ id: number; phaseId: number; status: string; name: string }>,
	isLoaded: true,
	loadRoundsByEventId: vi.fn(),
});

const mockScreenStore = reactive({
	screens: [] as Array<{ id: number; name: string }>,
	isLoaded: true,
	currentEventId: 1,
	loadScreensByEventId: vi.fn(),
});

const mockToast = {
	add: vi.fn(),
};

const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(() => ({ result: Promise.resolve(false) })),
	})),
};

const mockPlayerDeckCache = {
	getDeckLists: vi.fn(() => []),
	fetchDeck: vi.fn(),
};

const mockSendDeckToScreen = {
	sendToFirstDeckScreen: vi.fn(),
	sendToScreen: vi.fn(),
};

const eventId = ref(1);
const initialLoading = ref(false);

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('useOverlay', () => () => mockOverlay);
mockNuxtImport('usePlayerDeckCache', () => () => mockPlayerDeckCache);
mockNuxtImport('useSendDeckToScreen', () => () => mockSendDeckToScreen);
mockNuxtImport('useEventPageLoading', () => () => ({ eventId, initialLoading, initialError: ref(null), retry: vi.fn() }));
mockNuxtImport('watchDebounced', () => (source: any, callback: any) => watch(source, callback));

const NuxtLayoutStub = defineComponent({
	template: `
		<div>
			<div data-testid="actions"><slot name="actions" /></div>
			<div data-testid="toolbar"><slot name="toolbar" /></div>
			<slot />
		</div>
	`,
});

const UDashboardToolbarStub = defineComponent({
	template: '<div data-testid="toolbar-content"><slot name="left" /><slot name="right" /></div>',
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
	template: `
		<div data-testid="empty-state">
			<div>{{ title }}</div>
			<div>{{ description }}</div>
			<slot name="actions" />
		</div>
	`,
});

const PlayerListStub = defineComponent({
	template: '<div data-testid="player-list">Player list</div>',
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

async function mountPage() {
	const pagePath = '../../../../../app/pages/event/[eventId]/players.vue';
	const { default: PlayersPage } = await import(pagePath);

	return mount(PlayersPage, {
		global: {
			stubs: {
				NuxtLayout: NuxtLayoutStub,
				UDashboardToolbar: UDashboardToolbarStub,
				UIEmptyState: UIEmptyStateStub,
				PlayerList: PlayerListStub,
				PlayerListTabs: true,
				UISearchInput: true,
				UButton: UButtonStub,
				UDropdownMenu: true,
				USeparator: true,
				USelectMenu: true,
			},
		},
	});
}

describe('players page', () => {
	beforeEach(() => {
		mockPlayerStore.players = [];
		mockPlayerListStore.lists = [];
		mockRoundStore.rounds = [];
		mockScreenStore.screens = [];
		initialLoading.value = false;
		mockOverlay.create.mockClear();
		mockToast.add.mockClear();
	});

	it('moves the create action into the empty state when the event has no players', async () => {
		const wrapper = await mountPage();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No players yet');
		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('Create Player');
	});

	it('shows the navbar action and player list once players exist', async () => {
		mockPlayerStore.players = [{ id: 7, name: 'Ari', gameData: null, updatedAt: '2026-01-01T00:00:00.000Z' }];

		const wrapper = await mountPage();

		expect(wrapper.get('[data-testid="actions"]').text()).toContain('Create Player');
		expect(wrapper.get('[data-testid="player-list"]').text()).toContain('Player list');
	});
});

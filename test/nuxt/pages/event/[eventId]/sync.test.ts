import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

const mockEventStore = reactive({
	event: {
		id: 1,
		meleeEnabled: true,
		meleeConfigured: true,
		initialSetupCompletedAt: new Date('2026-04-09T10:00:00.000Z') as Date | null,
		lastEventSyncedAt: new Date('2026-04-09T10:00:00.000Z') as Date | null,
		lastPlayersSyncedAt: new Date('2026-04-09T10:05:00.000Z') as Date | null,
		lastDecklistsSyncedAt: new Date('2026-04-09T10:10:00.000Z') as Date | null,
		lastSyncError: null as string | null,
	},
	$reset: vi.fn(),
});

const mockRoundStore = reactive({
	rounds: [] as Array<{ id: number; phaseId: number; name: string; status: string; lastSyncedAt: Date | null; externalId?: string | null; externalSource?: string | null; controlMode?: string | null }>,
	isLoaded: true,
	loadRoundsByEventId: vi.fn(),
	getRoundById: vi.fn((id: number) => mockRoundStore.rounds.find((round: any) => round.id === id)),
	$reset: vi.fn(),
});

const mockPhaseStore = reactive({
	isLoaded: true,
	loadPhasesByEventId: vi.fn(),
	getPhaseById: vi.fn((id: number) => (id === 1 ? { id: 1, name: 'Swiss' } : undefined)),
	$reset: vi.fn(),
});

const mockMatchStore = reactive({
	matches: [] as Array<{ id: number; roundId: number }>,
	loadMatchesByRoundId: vi.fn(),
	$reset: vi.fn(),
});

const mockMeleeStore = reactive({
	syncing: false,
	syncingPlayers: false,
	syncingDecklists: false,
	syncingRound: false,
	updatingFromMelee: false,
	runningSetup: false,
	setupStep: null as string | null,
	syncStep: null as string | null,
	error: null as string | null,
	lastOperation: null as { title: string; description: string; status: 'success' | 'warning' | 'error'; details?: string[] } | null,
	availableRounds: [] as typeof mockRoundStore.rounds,
	nextUnsyncedRound: null as { id: number } | null,
	nextRoundLabel: null as string | null,
	allRoundsSynced: false,
	syncedRoundCount: 0,
	totalRoundCount: 0,
	runInitialSetup: vi.fn(async () => ({ success: true })),
	updateFromMelee: vi.fn(async () => ({ success: true })),
	syncEvent: vi.fn(async () => ({ success: true })),
	syncPlayers: vi.fn(async () => ({ success: true })),
	syncDecklists: vi.fn(async () => ({ success: true })),
	syncSpecificRound: vi.fn(async () => ({ success: true })),
	$reset: vi.fn(),
});

const mockPlayerStore = { $reset: vi.fn(), loadPlayersByEventId: vi.fn() };
const mockNoopStore = { $reset: vi.fn() };
const mockScreenStore = { ...mockNoopStore, loadScreensByEventId: vi.fn(), screens: [] };
const mockEventRepo = {
	listUnresolvedDeckCards: vi.fn(async () => []),
	resolveUnresolvedDeckCard: vi.fn(async () => ({ success: true, message: 'Resolved card', resolvedCardName: 'Lightning Bolt', unresolvedId: 1, resolvedCount: 1 })),
};

const mockToast = { add: vi.fn() };
const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(() => ({ result: Promise.resolve(false) })),
	})),
};

const eventId = ref(1);
const initialLoading = ref(false);

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('useMeleeStore', () => () => mockMeleeStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useArchetypeStore', () => () => mockNoopStore);
mockNuxtImport('useMetagameStore', () => () => mockNoopStore);
mockNuxtImport('usePlayerListStore', () => () => mockNoopStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockNoopStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockNoopStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useCardStore', () => () => mockNoopStore);
mockNuxtImport('useEventRepository', () => () => mockEventRepo);
mockNuxtImport('clearPlayerDeckCache', () => vi.fn());
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('useOverlay', () => () => mockOverlay);
mockNuxtImport('useEventPageLoading', () => () => ({ eventId, initialLoading, initialError: ref(null), retry: vi.fn() }));
mockNuxtImport('navigateTo', () => vi.fn());

const NuxtLayoutStub = defineComponent({
	template: '<div><slot name="actions" /><slot name="toolbar" /><slot /></div>',
});

const UCardStub = defineComponent({
	template: '<section><slot name="header" /><slot /><slot name="footer" /></section>',
});

const UContainerStub = defineComponent({
	template: '<div><slot /></div>',
});

const UAlertStub = defineComponent({
	props: {
		title: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div><div>{{ title }}</div><div>{{ description }}</div><slot name="description" /></div>',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		loading: { type: Boolean, required: false },
		disabled: { type: Boolean, required: false },
	},
	template: `<button type="button" :data-loading="loading ? 'true' : 'false'" :disabled="disabled"><slot>{{ label }}</slot></button>`,
});

const USelectMenuStub = defineComponent({
	props: {
		disabled: { type: Boolean, required: false },
		items: { type: Array, default: () => [] },
	},
	template: '<select :disabled="disabled"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
});

const UIEmptyStateStub = defineComponent({
	props: {
		title: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div><div>{{ title }}</div><div>{{ description }}</div></div>',
});

const UCheckboxStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<label><input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)">{{ label }}</label>',
});

const UDashboardToolbarStub = defineComponent({
	template: '<div><slot name="left" /><slot name="right" /></div>',
});

const UTableStub = defineComponent({
	template: '<table><slot /></table>',
});

async function mountPage() {
	const pagePath = '../../../../../app/pages/event/[eventId]/sync.vue';
	const { default: SyncPage } = await import(pagePath);

	return mount(SyncPage, {
		global: {
			stubs: {
				NuxtLayout: NuxtLayoutStub,
				UContainer: UContainerStub,
				UCard: UCardStub,
				UAlert: UAlertStub,
				UButton: UButtonStub,
				UDashboardToolbar: UDashboardToolbarStub,
				UTable: UTableStub,
				UModal: true,
				UInput: true,
				UBadge: true,
				UIEmptyState: UIEmptyStateStub,
				USelectMenu: USelectMenuStub,
				UCheckbox: UCheckboxStub,
				UILoadingSpinner: true,
				UIcon: true,
			},
		},
	});
}

describe('melee Sync page', () => {
	beforeEach(() => {
		mockEventStore.event = {
			id: 1,
			meleeEnabled: true,
			meleeConfigured: true,
			initialSetupCompletedAt: new Date('2026-04-09T10:00:00.000Z'),
			lastEventSyncedAt: new Date('2026-04-09T10:00:00.000Z'),
			lastPlayersSyncedAt: new Date('2026-04-09T10:05:00.000Z'),
			lastDecklistsSyncedAt: new Date('2026-04-09T10:10:00.000Z'),
			lastSyncError: null,
		};
		mockRoundStore.rounds = [
			{ id: 11, phaseId: 1, name: 'Round 1', status: 'active', lastSyncedAt: new Date('2026-04-09T10:15:00.000Z'), externalId: 'melee-11', externalSource: 'melee', controlMode: 'external' },
			{ id: 12, phaseId: 1, name: 'Round 2', status: 'upcoming', lastSyncedAt: null, externalId: 'melee-12', externalSource: 'melee', controlMode: 'external' },
		];
		mockMeleeStore.availableRounds = [...mockRoundStore.rounds];
		mockMatchStore.matches = [];
		mockMeleeStore.nextUnsyncedRound = { id: 12 };
		mockMeleeStore.nextRoundLabel = null;
		mockMeleeStore.syncedRoundCount = 1;
		mockMeleeStore.totalRoundCount = 2;
		mockMeleeStore.syncing = false;
		mockMeleeStore.syncingPlayers = false;
		mockMeleeStore.syncingDecklists = false;
		mockMeleeStore.syncingRound = false;
		mockMeleeStore.updatingFromMelee = false;
		mockMeleeStore.runningSetup = false;
		mockMeleeStore.setupStep = null;
		mockMeleeStore.syncStep = null;
		mockMeleeStore.lastOperation = null;
		initialLoading.value = false;
		vi.clearAllMocks();
		mockEventRepo.listUnresolvedDeckCards.mockResolvedValue([]);
	});

	it('renders the status + recovery sections when setup is complete', async () => {
		const wrapper = await mountPage();
		await Promise.resolve();

		expect(wrapper.text()).toContain('Data Freshness');
		expect(wrapper.text()).toContain('Round Sync Status');
		expect(wrapper.text()).toContain('Update from Melee');
		expect(wrapper.text()).toContain('Advanced Recovery Tools');
		expect(wrapper.text()).toContain('Danger Zone');
		expect(wrapper.text()).toContain('Refresh Players');
		expect(wrapper.text()).toContain('Refresh Deck Lists');
		expect(wrapper.text()).toContain('Refresh Round Matches');
		expect(wrapper.text()).toContain('Reset Event Structure');
		expect(wrapper.text()).toContain('Manage Integration');
	});

	// The event store is filled from a client-side `$fetch`, which JSON round-trips
	// every response — so `lastEventSyncedAt` and friends reach this page as ISO
	// strings, never as the `Date` the response type declares (#272, #284). Every
	// other fixture here hands the store real Dates, so `formatSyncTimestamp` has
	// only ever been exercised on a shape production does not deliver.
	it('formats the freshness timestamps the wire actually delivers', async () => {
		const wireEvent = JSON.parse(JSON.stringify(mockEventStore.event)) as typeof mockEventStore.event;
		expect(typeof wireEvent.lastEventSyncedAt).toBe('string');
		expect(typeof wireEvent.lastPlayersSyncedAt).toBe('string');
		expect(typeof wireEvent.lastDecklistsSyncedAt).toBe('string');
		mockEventStore.event = wireEvent;
		mockRoundStore.rounds = JSON.parse(JSON.stringify(mockRoundStore.rounds));
		expect(typeof mockRoundStore.rounds[0]!.lastSyncedAt).toBe('string');

		const wrapper = await mountPage();
		await Promise.resolve();

		expect(wrapper.text()).toContain(new Date('2026-04-09T10:00:00.000Z').toLocaleDateString());
		expect(wrapper.text()).toContain(new Date('2026-04-09T10:05:00.000Z').toLocaleDateString());
		expect(wrapper.text()).toContain(new Date('2026-04-09T10:10:00.000Z').toLocaleDateString());
		expect(wrapper.text()).not.toContain('Invalid Date');
	});

	it('runs the unified update action from the primary sync card', async () => {
		const wrapper = await mountPage();
		await Promise.resolve();

		const updateButton = wrapper.findAll('button').find((button: any) => button.text().trim() === 'Update from Melee');
		await updateButton?.trigger('click');

		expect(mockMeleeStore.updateFromMelee).toHaveBeenCalledWith({ includeDeckLists: false });
	});

	it('shows progress and disables pre-setup actions while initial setup is running', async () => {
		mockEventStore.event = {
			...mockEventStore.event,
			initialSetupCompletedAt: null,
		};
		mockMeleeStore.runningSetup = true;
		mockMeleeStore.setupStep = 'syncing';

		const wrapper = await mountPage();
		await Promise.resolve();

		expect(wrapper.text()).toContain('Initial Setup In Progress');
		expect(wrapper.text()).toContain('Importing event structure, players, standings, and deck lists from Melee.gg.');

		const buttons = wrapper.findAll('button');
		const runInitialSetupButton = buttons.find((button: any) => button.text().includes('Run Initial Setup'));
		const manageIntegrationButtons = buttons.filter((button: any) => button.text().includes('Manage Integration'));

		expect(runInitialSetupButton?.attributes()['data-loading']).toBe('true');
		expect(runInitialSetupButton?.attributes().disabled).toBeDefined();
		expect(manageIntegrationButtons.at(-1)?.attributes().disabled).toBeDefined();
	});

	it('disables the rest of the recovery tools while a sync is running', async () => {
		mockMeleeStore.syncingPlayers = true;

		const wrapper = await mountPage();
		await Promise.resolve();

		expect(wrapper.text()).toContain('Player Sync In Progress');

		const buttons = wrapper.findAll('button');
		const refreshPlayersButton = buttons.find((button: any) => button.text().includes('Refresh Players'));
		const refreshDeckListsButton = buttons.find((button: any) => button.text().includes('Refresh Deck Lists'));
		const refreshRoundButton = buttons.find((button: any) => button.text().includes('Refresh Round'));
		const resetStructureButton = buttons.find((button: any) => button.text().includes('Reset Structure'));
		const roundPicker = wrapper.find('select');

		expect(refreshPlayersButton?.attributes()['data-loading']).toBe('true');
		expect(refreshPlayersButton?.attributes().disabled).toBeDefined();
		expect(refreshDeckListsButton?.attributes().disabled).toBeDefined();
		expect(refreshRoundButton?.attributes().disabled).toBeDefined();
		expect(resetStructureButton?.attributes().disabled).toBeDefined();
		expect(roundPicker.attributes().disabled).toBeDefined();
	});

	it('surfaces the warning banner when lastSyncError is set', async () => {
		mockEventStore.event = {
			...mockEventStore.event,
			lastSyncError: 'Melee returned 500',
		};

		const wrapper = await mountPage();
		await Promise.resolve();

		expect(wrapper.text()).toContain('Sync Attention Needed');
		expect(wrapper.text()).toContain('Melee returned 500');
	});

	it('only offers source-managed rounds in status and recovery controls', async () => {
		mockRoundStore.rounds.push({
			id: 13,
			phaseId: 1,
			name: 'Local Tiebreaker',
			status: 'upcoming',
			lastSyncedAt: null,
			externalId: null,
			externalSource: null,
			controlMode: 'manual',
		});
		mockMeleeStore.availableRounds = mockRoundStore.rounds.filter(round => round.externalSource === 'melee' && !!round.externalId);

		const wrapper = await mountPage();
		await Promise.resolve();

		const roundPicker = wrapper.find('select');
		expect(roundPicker.text()).toContain('Round 1');
		expect(roundPicker.text()).toContain('Round 2');
		expect(roundPicker.text()).not.toContain('Local Tiebreaker');
	});

	it('shows unresolved-card load failures instead of claiming all cards are resolved', async () => {
		mockEventRepo.listUnresolvedDeckCards.mockRejectedValueOnce(new Error('Unresolved endpoint unavailable'));

		const wrapper = await mountPage();
		await Promise.resolve();
		await Promise.resolve();

		expect(wrapper.text()).toContain('Unresolved cards could not be loaded');
		expect(wrapper.text()).toContain('Unresolved endpoint unavailable');
		expect(wrapper.text()).not.toContain('All imported deck cards are resolved.');
	});

	it('renders grouped unresolved deck card review state', async () => {
		mockEventRepo.listUnresolvedDeckCards.mockResolvedValueOnce([
			{
				id: 1,
				eventId: 1,
				playerId: 2,
				playerName: 'Marcus',
				deckId: 10,
				formatExternalId: 'modern',
				phaseName: 'Swiss',
				deckName: 'Burn',
				entryType: 'card',
				originalName: 'Lightnng Bolt',
				setCode: 'm11',
				quantity: 4,
				compartment: 'mainboard',
				sortOrder: 0,
				cardType: 'Instant',
				createdAt: new Date('2026-04-09T10:00:00.000Z'),
				updatedAt: new Date('2026-04-09T10:00:00.000Z'),
			},
			{
				id: 2,
				eventId: 1,
				playerId: 3,
				playerName: 'Taylor',
				deckId: 20,
				formatExternalId: 'modern',
				phaseName: 'Swiss',
				deckName: 'Burn Mirror',
				entryType: 'card',
				originalName: 'lightnng  bolt',
				setCode: 'm11',
				quantity: 3,
				compartment: 'mainboard',
				sortOrder: 1,
				cardType: 'Instant',
				createdAt: new Date('2026-04-09T10:00:00.000Z'),
				updatedAt: new Date('2026-04-09T10:00:00.000Z'),
			},
		] as any);

		const wrapper = await mountPage();
		await Promise.resolve();
		await Promise.resolve();

		expect(wrapper.text()).toContain('Unresolved Deck Cards');
		expect(wrapper.text()).toContain('Lightnng Bolt');
		expect(wrapper.text()).toContain('2 players');
		expect(wrapper.text()).toContain('2 decks affected');
		expect(wrapper.text()).toContain('Review Unresolved Cards');
		expect(wrapper.text()).toContain('Review Group');
	});
});

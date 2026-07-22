import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import { createMockFeatureMatch } from '~~/test/helpers/fixtures';

const mockFeatureMatchStore = reactive({
	error: null as string | null,
	updateFeatureMatch: vi.fn(),
	reorderFeatureMatch: vi.fn(),
});

const mockEventStore = reactive({
	eventId: 1,
	event: {
		id: 1,
		featureMatchOrientation: 'horizontal',
		game: 'mtg',
	},
});

const mockFeatureMatchStateStore = reactive({
	featureMatchStates: new Map<number, FeatureMatchState>(),
	loadState: vi.fn(),
});

const mockPlayerStore = reactive({
	isLoaded: true,
	players: [],
	loadPlayersByEventId: vi.fn(),
});

const mockToast = { add: vi.fn() };

mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useMatchStore', () => () => ({ matches: [] }));
mockNuxtImport('useRoundStore', () => () => ({ getRoundById: vi.fn() }));
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('useRegisterDirtyState', () => () => undefined);
mockNuxtImport('useFeatureMatchDeckList', () => () => ({
	getDeckForCurrentPhase: vi.fn((_, name, colors) => ({ name, colors })),
	player1ForDeckList: ref(null),
	player2ForDeckList: ref(null),
	player1HasDeckList: ref(false),
	player2HasDeckList: ref(false),
	openDeckListModal: vi.fn(),
}));
mockNuxtImport('useFeatureMatchGameMode', () => () => ({
	activePlayerTrackingEnabled: ref(false),
	pronounsEnabled: ref(false),
	standingsEnabled: ref(true),
	lgsEnabled: ref(false),
	tableNumberEnabled: ref(true),
	inMulliganPhase: ref(false),
	startingHandSize: ref(7),
	turnCounterMode: ref('counter'),
	showTurnCounter: ref(false),
	turnCounterLabel: ref('Turn'),
	turnHalf: ref(1),
	stepBackDisabled: ref(false),
	extraTurnsLabel: ref('Turns'),
	handleTurnChange: vi.fn(),
	handleSelectFirstPlayer: vi.fn(),
	handleNextOvertimeTurn: vi.fn(),
	handlePrevOvertimeTurn: vi.fn(),
	handleResetGame: vi.fn(),
	matchActionItems: ref([]),
}));
mockNuxtImport('useFeatureMatchSetupActions', () => () => ({
	meleeModalOpen: ref(false),
	swapPlayers: vi.fn(),
	clearMatch: vi.fn(),
	populateFromMelee: vi.fn(),
}));

const UCardStub = defineComponent({
	template: '<section><slot name="header" /><slot /><slot name="footer" /></section>',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
		loading: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button :data-label="label" :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
});

const PanelHeaderStub = defineComponent({
	emits: ['update:panelView', 'update:tableNumber'],
	template: `
		<div>
			<button data-testid="edit-mode" @click="$emit('update:panelView', 'setup')">Edit</button>
			<button data-testid="set-table" @click="$emit('update:tableNumber', 12)">Table</button>
		</div>
	`,
});

const PlayerFormStub = defineComponent({
	props: {
		formId: { type: String, required: true },
	},
	emits: ['submit', 'update:playerId'],
	template: '<form :id="formId" data-testid="player-form" @submit.prevent="$emit(\'submit\')"></form>',
});

async function mountComponent() {
	const componentPath = '../../../../app/components/FeatureMatch/' + 'Panel.vue';
	const { default: FeatureMatchPanel } = await import(componentPath);

	return mount(FeatureMatchPanel, {
		props: {
			match: createMockFeatureMatch({ id: 1, eventId: 1 }) as any,
			matchNumber: 1,
		},
		global: {
			stubs: {
				UCard: UCardStub,
				UButton: UButtonStub,
				UFieldGroup: { template: '<div><slot /></div>' },
				USeparator: true,
				UDropdownMenu: { template: '<div><slot /></div>' },
				FeatureMatchPanelHeader: PanelHeaderStub,
				FeatureMatchSetupPlayerForm: PlayerFormStub,
				FeatureMatchPanelMeleeModal: { template: '<div />' },
			},
		},
	});
}

describe('featureMatchPanel setup save', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatureMatchStore.error = null;
		mockFeatureMatchStateStore.featureMatchStates = new Map();
	});

	it('saves a table-only edit without empty player payloads', async () => {
		const updated = createMockFeatureMatch({ id: 1, tableNumber: 12 });
		mockFeatureMatchStore.updateFeatureMatch.mockResolvedValue(updated);
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		await wrapper.get('[data-testid="set-table"]').trigger('click');
		await wrapper.get('button[data-label="Save"]').trigger('click');
		await flushPromises();

		expect(mockFeatureMatchStore.updateFeatureMatch).toHaveBeenCalledWith(1, 1, { tableNumber: 12 });
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Match updated successfully',
			color: 'success',
		}));
	});

	it('saves setup edits when a player form submits', async () => {
		const updated = createMockFeatureMatch({ id: 1, tableNumber: 12 });
		mockFeatureMatchStore.updateFeatureMatch.mockResolvedValue(updated);
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		await wrapper.get('[data-testid="set-table"]').trigger('click');
		await wrapper.findAll('[data-testid="player-form"]')[0]!.trigger('submit');
		await flushPromises();

		expect(mockFeatureMatchStore.updateFeatureMatch).toHaveBeenCalledWith(1, 1, { tableNumber: 12 });
	});

	it('associates hidden submit buttons with both player forms', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="edit-mode"]').trigger('click');

		expect(wrapper.find('#feature-match-1-player-1-form').exists()).toBe(true);
		expect(wrapper.find('#feature-match-1-player-2-form').exists()).toBe(true);

		const submitButtons = wrapper.findAll('button[type="submit"]');
		expect(submitButtons.map(button => button.attributes('form'))).toEqual([
			'feature-match-1-player-1-form',
			'feature-match-1-player-2-form',
		]);
		expect(submitButtons.every(button => button.classes().includes('sr-only'))).toBe(true);
	});
});

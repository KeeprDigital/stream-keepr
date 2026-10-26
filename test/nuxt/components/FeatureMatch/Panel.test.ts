import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import { createMockFeatureMatch } from '~~/test/helpers/fixtures';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';
import FeatureMatchPanel from '~/components/FeatureMatch/Panel.vue';

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
		featureMatchNotesEnabled: true,
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

const mockAssignmentStore = reactive({
	assignments: [] as any[],
	consumeRound: vi.fn(() => vi.fn()),
	loadAssignments: vi.fn(),
	updateAssignment: vi.fn(),
	isRemoteChanged: vi.fn(() => false),
});

const mockMatchRepository = {
	getById: vi.fn(),
};

const mockToast = {
	add: vi.fn(),
};

mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => mockAssignmentStore);
mockNuxtImport('useMatchRepository', () => () => mockMatchRepository);
mockNuxtImport('useMatchStore', () => () => ({ matches: [] }));
mockNuxtImport('useRoundStore', () => () => ({
	isLoaded: true,
	getRoundById: vi.fn(),
	loadRoundsByEventId: vi.fn(),
}));
mockNuxtImport('useToast', () => () => mockToast);
// The page guard reaches for the overlay and the router when it installs itself.
// What it does with them is its own composable's test; here they only have to
// exist so a test can mount this panel the way its page does. `useRegisterDirtyState`
// itself is deliberately not mocked: mocked away, deleting the panel's registration
// changed nothing this file could see.
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({
		open: () => ({
			result: Promise.resolve(true),
		}),
	}),
}));
mockNuxtImport('onBeforeRouteLeave', () => () => {});
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
		modelValue: { type: Object, required: false },
	},
	emits: ['submit', 'update:playerId', 'update:modelValue'],
	template: '<form :id="formId" data-testid="player-form" @submit.prevent="$emit(\'submit\')"></form>',
});

/** A fresh match per mount, so nothing one test edits reaches the next. */
function mountProps(overrides: Record<string, unknown> = {}) {
	return {
		match: createMockFeatureMatch({ id: 1, eventId: 1, ...overrides }) as any,
		matchNumber: 1,
	};
}

const mountOptions = {
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
};

async function mountComponent(overrides: Record<string, unknown> = {}) {
	return mount(FeatureMatchPanel, {
		...mountOptions,
		props: mountProps(overrides),
	});
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/**
 * Mounts the panel the way `pages/event/[eventId]/feature-matches.vue` does —
 * through `FeatureMatchList` — inside a page that has installed the
 * unsaved-changes guard. See the shared harness for why the registration is
 * invisible from a bare mount.
 */
async function mountUnderGuard(props = mountProps()) {
	return mountUnderPageGuard<Wrapper>(FeatureMatchPanel, { ...mountOptions, props });
}

/**
 * A match the mocked store updates in place with each answer, as the real one
 * does: the panel learns the save landed from its prop, not from the answer.
 */
function storeEchoedMatch() {
	const match = reactive(createMockFeatureMatch({ id: 1, eventId: 1 }));
	mockFeatureMatchStore.updateFeatureMatch.mockImplementation(async (_eventId: number, _matchId: number, update: object) => {
		Object.assign(match, update);
		return { ...match };
	});
	return match;
}

describe('featureMatchPanel setup save', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatureMatchStore.error = null;
		mockFeatureMatchStateStore.featureMatchStates = new Map();
		mockAssignmentStore.assignments = [];
		mockAssignmentStore.isRemoteChanged.mockReturnValue(false);
		mockMatchRepository.getById.mockResolvedValue(null);
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

	// #612: the panel ignored remote updates while dirty, so a saved player object
	// carried the stale value of every field the operator had not touched.
	it('keeps a colleague\'s change to a player field this operator left untouched', async () => {
		const updated = createMockFeatureMatch({ id: 1 });
		mockFeatureMatchStore.updateFeatureMatch.mockResolvedValue(updated);
		const original = { name: 'Alice', pronouns: 'she/her' };
		const wrapper = await mountComponent({ player1Data: original });

		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		const player1Form = wrapper.findAllComponents(PlayerFormStub)[0]!;
		player1Form.vm.$emit('update:modelValue', {
			...player1Form.props('modelValue'),
			name: 'Alicia',
		});
		await wrapper.setProps({
			match: createMockFeatureMatch({
				id: 1,
				eventId: 1,
				player1Data: { ...original, pronouns: 'they/them' },
			}) as any,
		});
		await wrapper.get('button[data-label="Save"]').trigger('click');
		await flushPromises();

		expect(mockFeatureMatchStore.updateFeatureMatch).toHaveBeenCalledWith(1, 1, {
			player1Data: { name: 'Alicia', pronouns: 'they/them' },
		});
	});

	// The guard is what stops an operator navigating away from an unsaved edit. It
	// registers through inject, so a panel mounted without a page around it
	// registers with nothing and loses this silently — which is what this file used
	// to arrange for itself by mocking the registration away.
	it('tells the page it has unsaved changes while its setup edit is unsaved', async () => {
		const match = storeEchoedMatch();
		const { wrapper, pageIsDirty } = await mountUnderGuard({ match: match as any, matchNumber: 1 });

		expect(pageIsDirty()).toBe(false);

		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		await wrapper.get('[data-testid="set-table"]').trigger('click');
		expect(pageIsDirty()).toBe(true);

		await wrapper.get('button[data-label="Save"]').trigger('click');
		await flushPromises();

		expect(pageIsDirty()).toBe(false);
	});

	it('keeps an edit typed while the save is in flight', async () => {
		const match = reactive(createMockFeatureMatch({ id: 1, eventId: 1 }));
		let land = () => {};
		mockFeatureMatchStore.updateFeatureMatch.mockImplementation((_eventId: number, _matchId: number, update: object) =>
			new Promise((resolve) => {
				land = () => {
					Object.assign(match, update);
					resolve({ ...match });
				};
			}));
		const { wrapper, pageIsDirty } = await mountUnderGuard({ match: match as any, matchNumber: 1 });

		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		await wrapper.get('[data-testid="set-table"]').trigger('click');
		await wrapper.get('button[data-label="Save"]').trigger('click');
		const player1Form = wrapper.findAllComponents(PlayerFormStub)[0]!;
		player1Form.vm.$emit('update:modelValue', {
			...player1Form.props('modelValue'),
			name: 'Alicia',
		});
		land();
		await flushPromises();

		expect(match.tableNumber).toBe(12);
		expect(wrapper.findAllComponents(PlayerFormStub)[0]!.props('modelValue')).toMatchObject({ name: 'Alicia' });
		expect(pageIsDirty()).toBe(true);
	});

	// The save trims, reads blanks as null and drops an empty deck, and the server
	// stores what it was sent; the form kept the operator's raw value as a local
	// edit against that answer, so the toast said saved while Save stayed enabled
	// and leaving the page warned of unsaved changes.
	it.each([
		[
			'a name with trailing whitespace',
			{ name: 'Alicia ' },
		],
		[
			'a cleared field',
			{ pronouns: '' },
		],
		[
			'a number typed as text',
			{ points: '3' },
		],
		[
			'a deck name typed then cleared',
			{
				gameData: { type: 'mtg', deckName: null, deckColors: null },
			},
		],
	])('reads clean once a save of %s lands', async (_label, edit) => {
		const match = storeEchoedMatch();
		match.player1Data = { name: 'Alice', pronouns: 'she/her' } as any;
		const { wrapper, pageIsDirty } = await mountUnderGuard({ match: match as any, matchNumber: 1 });

		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		const player1Form = wrapper.findAllComponents(PlayerFormStub)[0]!;
		player1Form.vm.$emit('update:modelValue', {
			...player1Form.props('modelValue'),
			...edit,
		});
		await flushPromises();
		expect(pageIsDirty()).toBe(true);

		await wrapper.get('button[data-label="Save"]').trigger('click');
		await flushPromises();

		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
		expect(pageIsDirty()).toBe(false);
		expect(wrapper.get('button[data-label="Save"]').attributes('disabled')).toBeDefined();
	});

	it('reads clean when the saved player comes back carrying a field it did not send', async () => {
		const match = reactive(createMockFeatureMatch({ id: 1, eventId: 1 }));
		mockFeatureMatchStore.updateFeatureMatch.mockImplementation(async (_eventId: number, _matchId: number, update: any) => {
			Object.assign(match, update, {
				player1Data: { ...update.player1Data, archetypeId: 7 },
			});
			return { ...match };
		});
		const { wrapper, pageIsDirty } = await mountUnderGuard({ match: match as any, matchNumber: 1 });

		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		wrapper.findAllComponents(PlayerFormStub)[0]!.vm.$emit('update:modelValue', { name: 'Bob', lgs: 'Shop' });
		await flushPromises();
		await wrapper.get('button[data-label="Save"]').trigger('click');
		await flushPromises();

		expect(pageIsDirty()).toBe(false);
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

	it('shows the Assignment Note as a compact strip immediately beneath the panel header', async () => {
		const releaseRound = vi.fn();
		mockAssignmentStore.consumeRound.mockReturnValueOnce(releaseRound);
		mockAssignmentStore.assignments = [
			{
				id: 9,
				eventId: 1,
				roundId: 3,
				slotId: 1,
				matchId: 7,
				note: 'Watch the sideboard plan',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		];
		mockAssignmentStore.isRemoteChanged.mockReturnValue(true);
		mockMatchRepository.getById.mockResolvedValue({ id: 7, roundId: 3 });

		const wrapper = await mountComponent({ matchId: 7 });
		await flushPromises();

		const note = wrapper.get('.feature-match-note');
		expect(note.text()).toContain('Watch the sideboard plan');
		expect(note.classes()).toContain('px-3');
		expect(note.attributes('data-remote-changed')).toBe('true');
		expect(wrapper.html().indexOf('feature-match-note')).toBeGreaterThan(wrapper.html().indexOf('data-testid="edit-mode"'));
		expect(mockAssignmentStore.consumeRound).toHaveBeenCalledWith(1, 3);
		wrapper.unmount();
		expect(releaseRound).toHaveBeenCalledOnce();
	});

	it('shows no Assignment Note when the Event has Feature Match Notes switched off', async () => {
		mockAssignmentStore.assignments = [
			{
				id: 9,
				eventId: 1,
				roundId: 3,
				slotId: 1,
				matchId: 7,
				note: 'Watch the sideboard plan',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		];
		mockMatchRepository.getById.mockResolvedValue({ id: 7, roundId: 3 });
		mockEventStore.event.featureMatchNotesEnabled = false;

		try {
			const wrapper = await mountComponent({ matchId: 7 });
			await flushPromises();

			expect(wrapper.find('.feature-match-note').exists()).toBe(false);
		}
		finally {
			mockEventStore.event.featureMatchNotesEnabled = true;
		}
	});

	it('resolves simultaneous Feature Match panels against their own Assignment Rounds', async () => {
		mockAssignmentStore.assignments = [
			{
				id: 9,
				eventId: 1,
				roundId: 3,
				slotId: 1,
				matchId: 7,
				note: 'Round three Note',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: 10,
				eventId: 1,
				roundId: 4,
				slotId: 2,
				matchId: 8,
				note: 'Round four Note',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		];
		mockMatchRepository.getById.mockImplementation(async (_eventId, matchId) => ({
			id: matchId,
			roundId: matchId === 7
				? 3
				: 4,
		}));

		const roundThreePanel = await mountComponent({ id: 1, matchId: 7 });
		const roundFourPanel = await mountComponent({ id: 2, matchId: 8 });
		await flushPromises();

		expect(roundThreePanel.get('.feature-match-note').text()).toContain('Round three Note');
		expect(roundFourPanel.get('.feature-match-note').text()).toContain('Round four Note');
		expect(mockAssignmentStore.consumeRound).toHaveBeenCalledWith(1, 3);
		expect(mockAssignmentStore.consumeRound).toHaveBeenCalledWith(1, 4);
	});
});

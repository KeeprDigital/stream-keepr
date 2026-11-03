import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, reactive, ref } from 'vue';
import { createInitialOvertimeState } from '~~/shared/types/featureMatchState';
import { createMockFeatureMatch, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';
import { matchStatePart, offeredMatchStateParts } from '~~/test/nuxt/helpers/featureMatchControls';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
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
	featureMatchSessions: new Map<number, { id: number; slotId: number; sourceSnapshot: { playersSwapped?: boolean } }>(),
	sessionIdBySlotId: new Map<number, number>(),
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
// The page guard needs these to install; `useRegisterDirtyState` stays real.
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
/** What the Event's Card Game tracks, as `useFeatureMatchGameMode` reports it. */
const cardGameTracks = reactive({
	life: true,
	counters: true,
	overtime: true,
	sideboard: true,
});

mockNuxtImport('useFeatureMatchGameMode', () => () => ({
	activePlayerTrackingEnabled: ref(false),
	lifeTrackingEnabled: computed(() => cardGameTracks.life),
	counterTrackingEnabled: computed(() => cardGameTracks.counters),
	overtimeTrackingEnabled: computed(() => cardGameTracks.overtime),
	sideboardTrackingEnabled: computed(() => cardGameTracks.sideboard),
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

// The player controls render for real; only their reads are stood in.
mockNuxtImport('usePlayerFeatureMatchData', () => () => ({
	player: computed(() => createMockFeatureMatchState().player1),
	playerName: computed(() => 'Alice'),
	linkedPlayer: computed(() => null),
	playerPronouns: computed(() => undefined),
	deckName: computed(() => undefined),
	bestOf: computed(() => 1),
	seatLabel: computed(() => undefined),
	playerLgs: computed(() => undefined),
	playerRecord: computed(() => undefined),
}));
mockNuxtImport('usePlayerControls', () => () => ({}));
mockNuxtImport('usePlayerDeckCounters', () => () => ({
	availableCounterTypes: ref([]),
}));

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
			...nuxtUiStubs,
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

function saveButton(wrapper: Wrapper) {
	return wrapper.findAll('button').find(button => button.text() === 'Save')!;
}

/** Mounts the panel inside a page that has installed the unsaved-changes guard. */
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

describe('featureMatchPanel setup sides after a swap', () => {
	/** The followed Session of Slot 1, swapped or in Slot order. */
	function followSession(playersSwapped: boolean) {
		mockFeatureMatchStateStore.sessionIdBySlotId.set(1, 90);
		mockFeatureMatchStateStore.featureMatchSessions.set(90, {
			id: 90,
			slotId: 1,
			sourceSnapshot: { playersSwapped },
		});
	}

	function columns(wrapper: Wrapper) {
		return wrapper.findAllComponents(PlayerFormStub).map(form => (form.props('modelValue') as { name?: string }).name);
	}

	async function editColumn(wrapper: Wrapper, column: 0 | 1, name: string) {
		const form = wrapper.findAllComponents(PlayerFormStub)[column]!;
		form.vm.$emit('update:modelValue', {
			...form.props('modelValue'),
			name,
		});
		await flushPromises();
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockFeatureMatchStore.updateFeatureMatch.mockImplementation(async () => createMockFeatureMatch({ id: 1 }));
	});

	afterEach(() => {
		mockFeatureMatchStateStore.featureMatchSessions.clear();
		mockFeatureMatchStateStore.sessionIdBySlotId.clear();
	});

	// The Session owns side order; the form holds the Slot's (ADR-0058).
	it.each([
		{
			orientation: 'Slot order',
			swapped: false,
			shown: ['Alice', 'Bob'],
			saved: {
				player1Data: { name: 'Edited' },
			},
		},
		{
			orientation: 'swapped order',
			swapped: true,
			shown: ['Bob', 'Alice'],
			saved: {
				player2Data: { name: 'Edited' },
			},
		},
	])('shows its sides in the Session\'s $orientation and saves the left one to its own Slot side', async ({ swapped, shown, saved }) => {
		followSession(swapped);
		const wrapper = await mountComponent({
			player1Data: { name: 'Alice' },
			player2Data: { name: 'Bob' },
		});
		await wrapper.get('[data-testid="edit-mode"]').trigger('click');

		expect(columns(wrapper)).toEqual(shown);

		await editColumn(wrapper, 0, 'Edited');
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(mockFeatureMatchStore.updateFeatureMatch).toHaveBeenCalledWith(1, 1, saved);
	});

	it('turns its sides when a swap lands, keeping an unsaved edit with its player and leaving nothing else to save', async () => {
		followSession(false);
		const wrapper = await mountComponent({
			player1Data: { name: 'Alice' },
			player2Data: { name: 'Bob' },
		});
		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		await editColumn(wrapper, 0, 'Alicia');

		followSession(true);
		await flushPromises();
		expect(columns(wrapper)).toEqual(['Bob', 'Alicia']);

		await saveButton(wrapper).trigger('click');
		await flushPromises();
		expect(mockFeatureMatchStore.updateFeatureMatch).toHaveBeenCalledWith(1, 1, {
			player1Data: { name: 'Alicia' },
		});
	});

	it('keeps the Session\'s sides through a reset', async () => {
		followSession(true);
		const wrapper = await mountComponent({
			player1Data: { name: 'Alice' },
			player2Data: { name: 'Bob' },
		});
		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		await editColumn(wrapper, 0, 'Edited');

		await wrapper.findAll('button').find(button => button.text() === 'Reset')!.trigger('click');

		expect(columns(wrapper)).toEqual(['Bob', 'Alice']);
		expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
	});
});

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
		await saveButton(wrapper).trigger('click');
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

	// A saved player object carries only the fields this operator edited (#612).
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
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(mockFeatureMatchStore.updateFeatureMatch).toHaveBeenCalledWith(1, 1, {
			player1Data: { name: 'Alicia', pronouns: 'they/them' },
		});
	});

	it('tells the page it has unsaved changes while its setup edit is unsaved', async () => {
		const match = storeEchoedMatch();
		const { wrapper, pageIsDirty } = await mountUnderGuard({ match: match as any, matchNumber: 1 });

		expect(pageIsDirty()).toBe(false);

		await wrapper.get('[data-testid="edit-mode"]').trigger('click');
		await wrapper.get('[data-testid="set-table"]').trigger('click');
		expect(pageIsDirty()).toBe(true);

		await saveButton(wrapper).trigger('click');
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
		await saveButton(wrapper).trigger('click');
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

	// The save normalizes what it sends; the form settles to the stored value.
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

		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
		expect(pageIsDirty()).toBe(false);
		expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
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
		await saveButton(wrapper).trigger('click');
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
	});

	it('shows the Assignment Note for the panel\'s Round, and releases the Round on unmount', async () => {
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
		expect(note.attributes('data-remote-changed')).toBe('true');
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

describe('featureMatchPanel match state by Card Game', () => {
	// `useFeatureMatchGameMode` owns what a Card Game tracks; the panel offers exactly that.
	it.each([
		[
			'every part',
			true,
			[
				'counters',
				'life',
				'overtime',
				'sideboard',
			],
		],
		['none of the optional parts', false, []],
	] as const)('offers %s of the match state its Card Game tracks', async (_, tracked, expected) => {
		Object.assign(cardGameTracks, {
			life: tracked,
			counters: tracked,
			overtime: tracked,
			sideboard: tracked,
		});
		mockFeatureMatchStateStore.featureMatchStates = new Map([
			[
				1,
				createMockFeatureMatchState({
					overtime: createInitialOvertimeState(5),
				}),
			],
		]);

		const wrapper = mount(FeatureMatchPanel, {
			props: mountProps(),
			global: {
				stubs: {
					...mountOptions.global.stubs,
					UINumericCounter: matchStatePart('life'),
					FeatureMatchStateCounterList: matchStatePart('counters'),
					FeatureMatchStateOvertimeTurnsCounter: matchStatePart('overtime'),
					FeatureMatchStateGameWins: true,
					FeatureMatchStateEditStateModal: true,
					FeatureMatchTokensModal: true,
					PlayerMatchHistoryButton: true,
					USwitch: matchStatePart('sideboard'),
				},
			},
		});
		await flushPromises();

		expect(offeredMatchStateParts(wrapper)).toEqual(expected);
	});
});

import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import { opSlotSide } from '~~/test/helpers/opCards';
import { screenSettingsLayoutStubs, settingsLayout, settingsSummaries } from '~~/test/nuxt/helpers/screenSettingsLayout';
import Settings from '~/components/Screen/Modes/Deck/Settings.vue';

// Every mount reads the one shared config; a mount left behind re-renders on each later test's edit.
enableAutoUnmount(afterEach);

const mockPlayerStore = {
	players: [
		{
			id: 1,
			name: 'Alice',
			updatedAt: '2026-08-01T00:00:00.000Z',
			gameData: { type: 'mtg', deckName: 'Mono Blue', deckColors: 'U' },
		},
	],
	loadPlayersByEventId: vi.fn().mockResolvedValue(undefined),
};

const mockConfig = ref<Record<string, any>>({});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});

const mockFetchDeck = vi.fn();
const mockLoadBroadcastDeckLists = vi.fn();
const mockEventStore = reactive({
	event: {
		id: 1,
		game: 'mtg',
		broadcastDeckListsEnabled: true,
		pointsSystem: '7ph' as string | null,
	},
});
const mockBroadcastDeckListStore = reactive({
	summaries: [
		{
			id: 23,
			name: 'Feature Table',
			mainboardQuantity: 60,
			sideboardQuantity: 15,
		},
	],
	loadCollection: mockLoadBroadcastDeckLists,
});

/** An OP Slot whose first player has a Deck List and whose second has none. */
const ALICE = opSlotSide('Alice', null, 501);
const BOB = opSlotSide('Bob', null, null);
const mockFeatureMatchStore = reactive({
	featureMatches: [
		{
			id: 11,
			player1Id: null,
			player2Id: null,
			player1Data: ALICE,
			player2Data: BOB,
			activeSession: null,
		},
	],
	loadFeatureMatchesByEventId: vi.fn(),
});
const mockFeatureMatchStateStore = reactive({
	featureMatchSessions: new Map<number, unknown>(),
	sessionIdBySlotId: new Map<number, number>(),
});

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([
	{ label: 'Alice vs Bob', value: 11 },
]));
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useBroadcastDeckListStore', () => () => mockBroadcastDeckListStore);
mockNuxtImport('usePlayerDeckCache', () => () => ({
	fetchDeck: mockFetchDeck,
}));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

const ScreenSettingsToggleStub = defineComponent({
	props: {
		label: { type: String, required: true },
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" :data-label="label" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div data-testid="form-field" :data-label="label" :data-description="description"><span>{{ label }}</span><slot /></div>',
});

const UISegmentedTabsStub = defineComponent({
	props: {
		items: { type: Array, required: false },
		modelValue: {
			type: [String, Number],
			required: false,
		},
	},
	emits: ['update:modelValue'],
	template: `
		<div data-testid="segmented-tabs">
			<button
				v-for="item in (items || [])"
				:key="item.value"
				type="button"
				data-testid="segmented-tab"
				:data-value="item.value"
				:data-active="String(item.value === modelValue)"
				:disabled="item.disabled"
				@click="$emit('update:modelValue', item.value)"
			>
				{{ item.label }}
			</button>
		</div>
	`,
});

const USelectStub = defineComponent({
	props: {
		modelValue: {
			type: [String, Number, Boolean, Object],
			required: false,
		},
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-select"><button v-for="item in (items || [])" :key="String(item.value)" type="button" :data-value="String(item.value)" @click="$emit(\'update:modelValue\', item.value)">{{ item.label }}</button></div>',
});

const UTabsStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="source-tabs"><button v-for="item in (items || [])" :key="item.value" type="button" :data-value="item.value" @click="$emit(\'update:modelValue\', item.value)">{{ item.label }}</button></div>',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-input-number" :aria-disabled="String(disabled)">{{ modelValue }}</div>',
});

function defaultDeckConfig(): Record<string, any> {
	return {
		deckSource: { type: 'player', playerId: 1 },
		board: 'full',
		sideboardPlacement: 'beside',
		mainboard: {
			view: 'grid',
			columns: 4,
			listColumns: 2,
			cardSizing: 'fixed',
			autoColumns: false,
			cardWidth: 144,
			cardGap: 8,
		},
		sideboard: {
			view: 'stack',
			columns: 4,
			listColumns: 2,
			cardSizing: 'fixed',
			autoColumns: false,
		},
		showQuantities: true,
		showDeckName: true,
		showDeckColors: true,
		showDeckMetaPill: true,
		showHighlanderPointedCards: true,
		showHighlanderPoints: true,
	};
}

async function mountComponent() {
	return mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				...screenSettingsLayoutStubs,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				UFormField: UFormFieldStub,
				UISegmentedTabs: UISegmentedTabsStub,
				USelect: USelectStub,
				UTabs: UTabsStub,
				UInputNumber: UInputNumberStub,
				UIColorPicker: true,
				USeparator: true,
				UIcon: true,
			},
		},
	});
}

/** The settings card titled `title`, by its `deck:card` id. */
function card(wrapper: Awaited<ReturnType<typeof mountComponent>>, title: string) {
	return wrapper.get(`[data-settings-card="deck:${title.toLowerCase().replaceAll(' ', '-')}"]`);
}

/** A board's own card. */
function boardCard(wrapper: Awaited<ReturnType<typeof mountComponent>>, title: 'Mainboard' | 'Sideboard') {
	return card(wrapper, title);
}

function sectionTitles(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return settingsLayout(wrapper).map(entry => entry.title);
}

describe('screenDeckSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.event = {
			id: 1,
			game: 'mtg',
			broadcastDeckListsEnabled: true,
			pointsSystem: '7ph',
		};
		mockBroadcastDeckListStore.summaries = [
			{
				id: 23,
				name: 'Feature Table',
				mainboardQuantity: 60,
				sideboardQuantity: 15,
			},
		];
		mockConfig.value = defaultDeckConfig();
		mockFetchDeck.mockResolvedValue({
			cards: [
				{ name: 'Mana Drain', quantity: 4, compartment: 'mainboard' },
				{ name: 'Force of Will', quantity: 2, compartment: 'sideboard' },
			],
		});
	});

	// Each Mode Token's Look sits in the card for what it styles (ADR-0072).
	it.each([
		{
			name: 'a player\'s deck under a points system',
			config: {},
			pointsSystem: '7ph',
			details: ['deck-details', 'pointed-cards'],
			badges: ['quantity-badge', 'points-badge'],
		},
		{
			name: 'a Broadcast Deck List, which carries no points',
			config: {
				deckSource: { type: 'broadcast', broadcastDeckListId: 23 },
			},
			pointsSystem: '7ph',
			details: ['deck-details'],
			badges: ['quantity-badge'],
		},
	])('lays out its cards for $name', async ({ config, pointsSystem, details, badges }) => {
		mockEventStore.event = { ...mockEventStore.event, pointsSystem };
		mockConfig.value = {
			...defaultDeckConfig(),
			...config,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(settingsLayout(wrapper)).toEqual([
			{
				id: 'deck:deck-source',
				title: 'Deck Source',
				collapsible: false,
				groups: [],
			},
			{
				id: 'deck:header',
				title: 'Header',
				collapsible: true,
				groups: ['header'],
			},
			{
				id: 'deck:deck-details',
				title: 'Deck Details',
				collapsible: true,
				groups: details,
			},
			{
				id: 'deck:mainboard',
				title: 'Mainboard',
				collapsible: true,
				groups: [],
			},
			{
				id: 'deck:sideboard',
				title: 'Sideboard',
				collapsible: true,
				groups: [],
			},
			{
				id: 'deck:card-look',
				title: 'Card Look',
				collapsible: true,
				groups: ['card-look'],
			},
			{
				id: 'deck:card-badges',
				title: 'Card Badges',
				collapsible: true,
				groups: badges,
			},
		]);
	});

	it('summarises each closed card', async () => {
		mockConfig.value = {
			...defaultDeckConfig(),
			board: 'mainboard',
			showCompanion: false,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(settingsSummaries(wrapper)).toEqual({
			'deck:header': 'Player name, deck name, colours',
			'deck:deck-details': 'Shown',
			'deck:mainboard': 'Grid · 144 px cards',
			'deck:sideboard': 'Hidden',
			'deck:card-look': 'Follows the Theme',
			'deck:card-badges': 'Quantity, Point badges',
		});
	});

	// A Broadcast Deck List names a list and its archetype, so the Header says so.
	it.each([
		{
			source: { type: 'player', playerId: 1 },
			labels: ['Show Player Name', 'Show Deck Name', 'Show Deck Colors'],
		},
		{
			source: { type: 'broadcast', broadcastDeckListId: 23 },
			labels: ['Show List Name', 'Show Archetype', 'Show Deck Colors'],
		},
	])('labels the Header toggles for a $source.type source', async ({ source, labels }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			deckSource: source,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(card(wrapper, 'Header').findAll('[data-testid="settings-toggle"]').map(toggle => toggle.attributes('data-label'))).toEqual(labels);
	});

	// Wiring: the board's view reaches its grid fields, whose home test owns what a stack shows.
	it('lays out a stacked sideboard\'s grid fields as a stack', async () => {
		mockConfig.value = {
			...defaultDeckConfig(),
			sideboard: {
				...defaultDeckConfig().sideboard,
				cardSizing: 'fit',
			},
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(boardCard(wrapper, 'Sideboard').findAll('[data-config-field]').map(field => field.attributes('data-config-field')))
			.toEqual([
				'sideboardPlacement',
				'showCompanion',
				'view',
				'cardSizing',
				'alignment',
				'cardWidth',
				'stackReveal',
			]);
	});

	// Each board is shown or hidden on its own card; the last board shown stays on.
	it.each([
		{ board: 'full', toggle: 'Mainboard', written: 'sideboard' },
		{ board: 'full', toggle: 'Sideboard', written: 'mainboard' },
		{ board: 'mainboard', toggle: 'Sideboard', written: 'full' },
		{ board: 'mainboard', toggle: 'Mainboard', written: undefined },
	] as const)('at board: $board, toggling $toggle writes board: $written', async ({ board, toggle, written }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			board,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		await boardCard(wrapper, toggle).get(`[data-label="Show ${toggle}"]`).trigger('click');

		if (written)
			expect(mockUpdateConfig).toHaveBeenCalledWith({ board: written });
		else
			expect(mockUpdateConfig).not.toHaveBeenCalled();
	});

	it('shows source tabs only while Broadcast Deck Lists are enabled', async () => {
		let wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.get('[data-testid="source-tabs"]').text()).toContain('Player Deck');
		expect(wrapper.get('[data-testid="source-tabs"]').text()).toContain('Broadcast Deck List');

		mockEventStore.event = {
			id: 1,
			game: 'mtg',
			broadcastDeckListsEnabled: false,
			pointsSystem: '7ph',
		};
		wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.find('[data-testid="source-tabs"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain('Broadcast Deck List');
	});

	it('keeps tab navigation local and saves only deckSource after an explicit Broadcast selection', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.get('[data-testid="source-tabs"] [data-value="broadcast"]').trigger('click');
		expect(mockUpdateConfig).not.toHaveBeenCalled();
		expect(mockConfig.value.deckSource).toEqual({ type: 'player', playerId: 1 });

		const field = wrapper.get('[data-testid="form-field"][data-label="Broadcast Deck List"]');
		await field.get('[data-value="23"]').trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			deckSource: { type: 'broadcast', broadcastDeckListId: 23 },
		});
		expect(mockConfig.value.board).toBe('full');
		expect(mockConfig.value.sideboardPlacement).toBe('beside');
		expect(mockConfig.value.showDeckName).toBe(true);
	});

	it('does not change or blank the source when the Broadcast tab has no lists', async () => {
		mockBroadcastDeckListStore.summaries = [];
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.get('[data-testid="source-tabs"] [data-value="broadcast"]').trigger('click');

		expect(wrapper.text()).toContain('No Broadcast Deck Lists are available');
		expect(mockUpdateConfig).not.toHaveBeenCalled();
		expect(mockConfig.value.deckSource).toEqual({ type: 'player', playerId: 1 });
	});

	it('hides Highlander-only controls for a selected Broadcast source without clearing their values', async () => {
		mockConfig.value = {
			...defaultDeckConfig(),
			deckSource: { type: 'broadcast', broadcastDeckListId: 23 },
			showHighlanderTotal: true,
			showHighlanderPointedCards: true,
			showHighlanderPoints: true,
		};
		let wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.text()).not.toContain('Show Total Points');
		expect(wrapper.text()).not.toContain('Show Pointed Cards');
		expect(wrapper.text()).not.toContain('Highlander Point Badge');
		expect(mockConfig.value.showHighlanderTotal).toBe(true);
		expect(mockConfig.value.showHighlanderPointedCards).toBe(true);
		expect(mockConfig.value.showHighlanderPoints).toBe(true);

		mockConfig.value = {
			...mockConfig.value,
			deckSource: { type: 'player', playerId: 1 },
		};
		wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.text()).toContain('Show Total Points');
		expect(wrapper.text()).toContain('Show Pointed Cards');
		expect(wrapper.text()).toContain('Highlander Point Badge');
	});

	// Card points are the Event's points system; with none, no card point setting shows.
	it.each([
		{ pointsSystem: '7ph', shown: true },
		{ pointsSystem: null, shown: false },
	])('offers card point settings with points system $pointsSystem: $shown', async ({ pointsSystem, shown }) => {
		mockEventStore.event = { ...mockEventStore.event, pointsSystem };
		const wrapper = await mountComponent();
		await flushPromises();

		for (const text of ['Show Total Points', 'Show Pointed Cards', 'Highlander Point Badge'])
			expect(wrapper.text().includes(text), text).toBe(shown);
	});

	// The details row shows only with something in it, so its text size and pill show only then.
	it.each([
		{
			name: 'card type counts',
			config: { showDeckStats: true, showHighlanderTotal: false },
			shown: true,
		},
		{
			name: 'the points total',
			config: { showDeckStats: false, showHighlanderTotal: true },
			shown: true,
		},
		{
			name: 'nothing',
			config: { showDeckStats: false, showHighlanderTotal: false },
			shown: false,
		},
	])('offers the details row\'s look while it shows $name: $shown', async ({ config, shown }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			...config,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		const details = card(wrapper, 'Deck Details');
		expect(details.find('[data-label="Details Text Size"]').exists()).toBe(shown);
		expect(details.find('[data-label="Show Deck Meta Pill"]').exists()).toBe(shown);
	});

	it.each([
		{ field: 'quantityPosition', current: 'top-right' },
		{ field: 'highlanderPointsPosition', current: 'top-left' },
		{ field: 'companionTagPosition', current: 'top' },
	])('picks the $field on a nine-point grid with no centre (#543)', async ({ field, current }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			showHighlanderPoints: true,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		const picker = wrapper.get(`[data-config-field="${field}"] [role="radiogroup"]`);
		expect(picker.get('[aria-checked="true"]').attributes('data-point')).toBe(current);
		expect(picker.get('[data-point="center"]').attributes('disabled')).toBeDefined();

		await picker.get('[data-point="bottom"]').trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ [field]: 'bottom' });
	});

	// Both boards keep their card; a hidden board's layout collapses under its toggle.
	it.each([
		{ board: 'full', mainboardViews: true, sideboardViews: true },
		{ board: 'mainboard', mainboardViews: true, sideboardViews: false },
		{ board: 'sideboard', mainboardViews: false, sideboardViews: true },
	] as const)('at board: $board, shows each board\'s layout only while it is shown', async ({ board, mainboardViews, sideboardViews }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			board,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(sectionTitles(wrapper)).toEqual(expect.arrayContaining(['Mainboard', 'Sideboard']));
		expect(boardCard(wrapper, 'Mainboard').find('[data-label="View"]').exists()).toBe(mainboardViews);
		expect(boardCard(wrapper, 'Sideboard').find('[data-label="View"]').exists()).toBe(sideboardViews);
	});

	// The sideboard sits beside or below the mainboard only while both show; its companion is always its to show.
	it.each([
		{ board: 'full', placement: true },
		{ board: 'sideboard', placement: false },
		{ board: 'mainboard', placement: false },
	] as const)('offers the sideboard placement at board: $board: $placement, and its companion', async ({ board, placement }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			board,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		const sideboard = boardCard(wrapper, 'Sideboard');
		expect(sideboard.find('[data-label="Sideboard Placement"]').exists()).toBe(placement);
		await sideboard.get('[data-label="Show Companion"]').trigger('click');
		expect(mockUpdateConfig).toHaveBeenCalledWith({ showCompanion: false });
	});

	// Both boards Fit are placed as one group at the mainboard's alignment; the sideboard's places it along the mainboard.
	it.each([
		{ sideboardSizing: 'fit', description: 'Up and down, where the sideboard sits, top to bottom of the screen. Right sends it to the right edge; otherwise it sits beside the mainboard.' },
		{ sideboardSizing: 'fixed', description: 'Where the cards sit when they don\'t fill the board\'s space. A Fixed grid places them across only.' },
	] as const)('describes the sideboard alignment while it is $sideboardSizing', async ({ sideboardSizing, description }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			mainboard: {
				...defaultDeckConfig().mainboard,
				cardSizing: 'fit',
			},
			sideboard: {
				...defaultDeckConfig().sideboard,
				cardSizing: sideboardSizing,
			},
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(boardCard(wrapper, 'Sideboard').get('[data-label="Alignment"]').attributes('data-description')).toBe(description);
		const picker = boardCard(wrapper, 'Mainboard').get('[role="radiogroup"][aria-label="Mainboard alignment"]');
		await picker.get('[data-point="top-left"]').trigger('click');
		expect(mockUpdateConfig).toHaveBeenLastCalledWith({
			mainboard: expect.objectContaining({ alignment: 'top-left' }),
		});
	});

	it('shows only the knobs the board view reads', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const mainboardSection = card(wrapper, 'Mainboard');
		expect(mainboardSection.find('[data-label="Grid Columns"]').exists()).toBe(true);
		expect(mainboardSection.find('[data-label="Card Sizing"]').exists()).toBe(true);
		expect(mainboardSection.find('[data-label="Auto Columns"]').exists()).toBe(true);
		expect(mainboardSection.find('[data-label="List Columns"]').exists()).toBe(false);

		// A stack's look is otherwise all Mode Tokens, so it offers only its view and sizing.
		const sideboardSection = card(wrapper, 'Sideboard');
		expect(sideboardSection.find('[data-label="Grid Columns"]').exists()).toBe(false);
		expect(sideboardSection.find('[data-label="Card Sizing"]').exists()).toBe(true);
		expect(sideboardSection.find('[data-label="Auto Columns"]').exists()).toBe(false);
		expect(sideboardSection.find('[data-label="List Columns"]').exists()).toBe(false);
	});

	it('writes a complete board block when one knob changes', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const sideboardSection = card(wrapper, 'Sideboard');
		const viewTabs = sideboardSection.findAll('[data-testid="segmented-tab"]');
		await viewTabs.find(tab => tab.attributes('data-value') === 'grid')!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			sideboard: {
				view: 'grid',
				columns: 4,
				listColumns: 2,
				cardSizing: 'fixed',
				autoColumns: false,
				cardWidth: 144,
				cardGap: 8,
				alignment: 'center',
				stackReveal: 30,
			},
		});
	});

	// Each size sits beside the control it sizes, and writes that one field (ADR-0054).
	it.each([
		{
			title: 'Mainboard',
			label: 'Card Width',
			patch: {
				mainboard: expect.objectContaining({ cardWidth: 200 }),
			},
		},
		{
			title: 'Mainboard',
			label: 'Card Gap',
			patch: {
				mainboard: expect.objectContaining({ cardGap: 200 }),
			},
		},
		{
			title: 'Sideboard',
			label: 'Card Width',
			patch: {
				sideboard: expect.objectContaining({ cardWidth: 200 }),
			},
		},
		{
			title: 'Sideboard',
			label: 'Stack Reveal',
			patch: {
				sideboard: expect.objectContaining({ stackReveal: 200 }),
			},
		},
		{
			title: 'Deck Details',
			label: 'Details Text Size',
			patch: { metaPillSize: 200 },
		},
		{
			title: 'Deck Details',
			label: 'Pointed Card Text Size',
			patch: { pointedCardSize: 200 },
		},
	])('writes the $title $label', async ({ title, label, patch }) => {
		const wrapper = await mountComponent();
		await flushPromises();

		card(wrapper, title).get(`[data-label="${label}"]`).getComponent(UInputNumberStub).vm.$emit('update:modelValue', 200);

		expect(mockUpdateConfig).toHaveBeenLastCalledWith(patch);
	});

	it('writes each card badge\'s text size', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const sizes = card(wrapper, 'Card Badges').findAll('[data-label="Badge Text Size"]');
		sizes[0]!.getComponent(UInputNumberStub).vm.$emit('update:modelValue', 20);
		expect(mockUpdateConfig).toHaveBeenLastCalledWith({ quantityBadgeSize: 20 });
		sizes[1]!.getComponent(UInputNumberStub).vm.$emit('update:modelValue', 18);
		expect(mockUpdateConfig).toHaveBeenLastCalledWith({ pointsBadgeSize: 18 });
	});

	// A Fit grid sizes its cards to the screen, so it offers no width.
	it.each([
		{ cardSizing: 'fixed', offered: true },
		{ cardSizing: 'fit', offered: false },
	])('offers a $cardSizing grid a card width: $offered', async ({ cardSizing, offered }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			mainboard: {
				...defaultDeckConfig().mainboard,
				cardSizing,
			},
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(card(wrapper, 'Mainboard').find('[data-label="Card Width"]').exists()).toBe(offered);
	});

	// Only a sideboard stacks, and only beside the mainboard (ADR-0054).
	it.each([
		{ name: 'beside', config: {}, stackEnabled: true },
		{
			name: 'below',
			config: { sideboardPlacement: 'below' },
			stackEnabled: false,
		},
		{
			name: 'alone',
			config: { board: 'sideboard' },
			stackEnabled: false,
		},
	])('offers a sideboard placed $name a stack: $stackEnabled, and the mainboard none', async ({ config, stackEnabled }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			...config,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		const tabsOf = (title: string) => card(wrapper, title).findAll('[data-testid="segmented-tab"]');
		expect(tabsOf('Mainboard').map(tab => tab.attributes('data-value'))).toEqual(config.board
			? []
			: ['grid', 'list']);
		const stackTab = tabsOf('Sideboard').find(tab => tab.attributes('data-value') === 'stack')!;
		expect(stackTab.attributes('disabled')).toBe(stackEnabled ? undefined : '');
	});

	it('picks a grid\'s card sizing, and its columns by count or automatically', async () => {
		const wrapper = await mountComponent();
		await flushPromises();
		const mainboardSection = () => card(wrapper, 'Mainboard');

		await mainboardSection().get('[data-label="Card Sizing"] [data-value="fit"]').trigger('click');
		expect(mockUpdateConfig).toHaveBeenLastCalledWith({
			mainboard: expect.objectContaining({ cardSizing: 'fit' }),
		});

		await mainboardSection().get('[data-label="Auto Columns"]').trigger('click');
		expect(mockUpdateConfig).toHaveBeenLastCalledWith({
			mainboard: expect.objectContaining({ autoColumns: true }),
		});
		await flushPromises();
		// Auto columns choose the count, so the count is not offered.
		expect(mainboardSection().find('[data-label="Grid Columns"]').exists()).toBe(false);
	});

	it('hints when the selected deck has no sideboard cards', async () => {
		mockFetchDeck.mockResolvedValue({
			cards: [
				{ name: 'Mana Drain', quantity: 4, compartment: 'mainboard' },
			],
		});

		let wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.find('[data-testid="empty-sideboard-hint"]').exists()).toBe(true);

		mockConfig.value = {
			...defaultDeckConfig(),
			board: 'mainboard',
		};
		wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.find('[data-testid="empty-sideboard-hint"]').exists()).toBe(false);
	});

	it('shows no empty-sideboard hint when the deck has sideboard cards', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.find('[data-testid="empty-sideboard-hint"]').exists()).toBe(false);
	});

	it('describes empty selected Broadcast boards without blanking the header', async () => {
		mockConfig.value = {
			...defaultDeckConfig(),
			deckSource: { type: 'broadcast', broadcastDeckListId: 23 },
		};
		mockBroadcastDeckListStore.summaries = [
			{
				id: 23,
				name: 'Feature Table',
				mainboardQuantity: 0,
				sideboardQuantity: 15,
			},
		];

		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.get('[data-testid="empty-sideboard-hint"]').text()).toContain('no mainboard cards');
		expect(mockUpdateConfig).not.toHaveBeenCalled();
	});
});

describe('screenDeckSettings on a One Piece Card Game Event', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.event = {
			id: 1,
			game: 'op',
			broadcastDeckListsEnabled: false,
			pointsSystem: null,
		};
		mockConfig.value = {
			...defaultDeckConfig(),
			deckSource: { type: 'player', playerId: null },
		};
		mockFeatureMatchStateStore.featureMatchSessions = new Map();
		mockFeatureMatchStateStore.sessionIdBySlotId = new Map();
	});

	it('picks a Feature Match Slot side as the Deck Source, and offers nothing MTG-only', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(settingsLayout(wrapper)).toEqual([
			{
				id: 'deck:deck-source',
				title: 'Deck Source',
				collapsible: false,
				groups: [],
			},
			{
				id: 'deck:header',
				title: 'Header',
				collapsible: true,
				groups: ['header'],
			},
			{
				id: 'deck:mainboard',
				title: 'Mainboard',
				collapsible: true,
				groups: [],
			},
			{
				id: 'deck:card-look',
				title: 'Card Look',
				collapsible: true,
				groups: ['card-look'],
			},
			{
				id: 'deck:card-badges',
				title: 'Card Badges',
				collapsible: true,
				groups: ['quantity-badge'],
			},
		]);
		await wrapper.get('[data-testid="deck-source-slot"] [data-value="11"]').trigger('click');
		await wrapper.get('[data-testid="deck-source-side"] [data-value="player2"]').trigger('click');
		expect(mockUpdateConfig.mock.calls.map(([patch]) => patch.deckSource)).toEqual([
			{ type: 'featureMatchSlot', slotId: 11, side: 'player1' },
			{ type: 'featureMatchSlot', slotId: 11, side: 'player2' },
		]);
		expect(mockPlayerStore.loadPlayersByEventId).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: 'a side holding a Deck List',
			side: 'player1',
			swapped: false,
			hint: false,
		},
		{
			name: 'a side holding none',
			side: 'player2',
			swapped: false,
			hint: true,
		},
		{
			name: 'a side Swap Players moved the player with none to',
			side: 'player1',
			swapped: true,
			hint: true,
		},
	])('says the Screen shows nothing only for $name', async ({ side, swapped, hint }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			deckSource: { type: 'featureMatchSlot', slotId: 11, side },
		};
		if (swapped) {
			mockFeatureMatchStateStore.featureMatchSessions.set(90, {
				id: 90,
				sourceSnapshot: {
					player1: { playerId: null, data: BOB },
					player2: { playerId: null, data: ALICE },
				},
			});
			mockFeatureMatchStateStore.sessionIdBySlotId.set(11, 90);
		}
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.find('[data-testid="empty-side-hint"]').exists()).toBe(hint);
	});
});

import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import Settings from '~/components/Screen/Modes/Deck/Settings.vue';

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

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
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

const ScreenSettingsCardStub = defineComponent({
	props: {
		title: { type: String, required: false },
	},
	template: '<section data-testid="settings-card" :data-title="title"><h2>{{ title }}</h2><slot /></section>',
});

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
				ScreenSettingsCard: ScreenSettingsCardStub,
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

/** A board's own card. */
function boardCard(wrapper: Awaited<ReturnType<typeof mountComponent>>, title: 'Mainboard' | 'Sideboard') {
	return wrapper.get(`[data-testid="settings-card"][data-title="${title}"]`);
}

function sectionTitles(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return wrapper.findAll('[data-testid="settings-card"]').map(card => card.attributes('data-title'));
}

// The whole Deck editor mounts in each test, about half a second alone; a full
// parallel run can take several times that, past the default five seconds.
vi.setConfig({ testTimeout: 15_000 });

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
		expect(wrapper.text()).not.toContain('Highlander Point Badges');
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
		expect(wrapper.text()).toContain('Highlander Point Badges');
	});

	// Card points are the Event's points system; with none, no card point setting shows.
	it.each([
		{ pointsSystem: '7ph', shown: true },
		{ pointsSystem: null, shown: false },
	])('offers card point settings with points system $pointsSystem: $shown', async ({ pointsSystem, shown }) => {
		mockEventStore.event = { ...mockEventStore.event, pointsSystem };
		const wrapper = await mountComponent();
		await flushPromises();

		for (const text of ['Show Total Points', 'Show Pointed Cards', 'Highlander Point Badges'])
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

		const details = wrapper.get('[data-testid="settings-card"][data-title="Deck Details"]');
		expect(details.find('[data-label="Details Text Size"]').exists()).toBe(shown);
		expect(details.find('[data-label="Show Deck Meta Pill"]').exists()).toBe(shown);
	});

	it.each([
		{ label: 'Quantity badge position', field: 'quantityPosition', current: 'top-right' },
		{ label: 'Highlander point badge position', field: 'highlanderPointsPosition', current: 'top-left' },
		{ label: 'Companion badge position', field: 'companionTagPosition', current: 'top' },
	])('picks the $label on a nine-point grid with no centre (#543)', async ({ label, field, current }) => {
		mockConfig.value = {
			...defaultDeckConfig(),
			showHighlanderPoints: true,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		const picker = wrapper.get(`[role="radiogroup"][aria-label="${label}"]`);
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

		const mainboardSection = wrapper.get('[data-testid="settings-card"][data-title="Mainboard"]');
		expect(mainboardSection.find('[data-label="Grid Columns"]').exists()).toBe(true);
		expect(mainboardSection.find('[data-label="Card Sizing"]').exists()).toBe(true);
		expect(mainboardSection.find('[data-label="Auto Columns"]').exists()).toBe(true);
		expect(mainboardSection.find('[data-label="List Columns"]').exists()).toBe(false);

		// A stack's look is otherwise all Mode Tokens, so it offers only its view and sizing.
		const sideboardSection = wrapper.get('[data-testid="settings-card"][data-title="Sideboard"]');
		expect(sideboardSection.find('[data-label="Grid Columns"]').exists()).toBe(false);
		expect(sideboardSection.find('[data-label="Card Sizing"]').exists()).toBe(true);
		expect(sideboardSection.find('[data-label="Auto Columns"]').exists()).toBe(false);
		expect(sideboardSection.find('[data-label="List Columns"]').exists()).toBe(false);
	});

	it('writes a complete board block when one knob changes', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const sideboardSection = wrapper.get('[data-testid="settings-card"][data-title="Sideboard"]');
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
			card: 'Mainboard',
			label: 'Card Width',
			patch: {
				mainboard: expect.objectContaining({ cardWidth: 200 }),
			},
		},
		{
			card: 'Mainboard',
			label: 'Card Gap',
			patch: {
				mainboard: expect.objectContaining({ cardGap: 200 }),
			},
		},
		{
			card: 'Sideboard',
			label: 'Card Width',
			patch: {
				sideboard: expect.objectContaining({ cardWidth: 200 }),
			},
		},
		{
			card: 'Sideboard',
			label: 'Stack Reveal',
			patch: {
				sideboard: expect.objectContaining({ stackReveal: 200 }),
			},
		},
		{
			card: 'Deck Details',
			label: 'Details Text Size',
			patch: { metaPillSize: 200 },
		},
		{
			card: 'Deck Details',
			label: 'Pointed Card Text Size',
			patch: { pointedCardSize: 200 },
		},
	])('writes the $card $label', async ({ card, label, patch }) => {
		const wrapper = await mountComponent();
		await flushPromises();

		wrapper.get(`[data-testid="settings-card"][data-title="${card}"]`).get(`[data-label="${label}"]`).getComponent(UInputNumberStub).vm.$emit('update:modelValue', 200);

		expect(mockUpdateConfig).toHaveBeenLastCalledWith(patch);
	});

	it('writes each card badge\'s text size', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const sizes = wrapper.get('[data-testid="settings-card"][data-title="Card Badges"]').findAll('[data-label="Badge Text Size"]');
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

		expect(wrapper.get('[data-testid="settings-card"][data-title="Mainboard"]').find('[data-label="Card Width"]').exists()).toBe(offered);
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

		const tabsOf = (title: string) => wrapper.find(`[data-testid="settings-card"][data-title="${title}"]`).exists()
			? wrapper.get(`[data-testid="settings-card"][data-title="${title}"]`).findAll('[data-testid="segmented-tab"]')
			: [];
		expect(tabsOf('Mainboard').map(tab => tab.attributes('data-value'))).toEqual(config.board
			? []
			: ['grid', 'list']);
		const stackTab = tabsOf('Sideboard').find(tab => tab.attributes('data-value') === 'stack')!;
		expect(stackTab.attributes('disabled')).toBe(stackEnabled ? undefined : '');
	});

	it('picks a grid\'s card sizing, and its columns by count or automatically', async () => {
		const wrapper = await mountComponent();
		await flushPromises();
		const mainboardSection = () => wrapper.get('[data-testid="settings-card"][data-title="Mainboard"]');

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

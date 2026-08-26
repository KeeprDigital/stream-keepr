import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

const mockPlayerStore = {
	players: [
		{ id: 1, name: 'Alice', updatedAt: '2026-08-01T00:00:00.000Z', gameData: { type: 'mtg', deckName: 'Mono Blue', deckColors: 'U' } },
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

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
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
	template: '<div data-testid="form-field" :data-label="label"><span>{{ label }}</span><slot /></div>',
});

const UISegmentedTabsStub = defineComponent({
	props: {
		items: { type: Array, required: false },
		modelValue: { type: [String, Number], required: false },
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
				@click="$emit('update:modelValue', item.value)"
			>
				{{ item.label }}
			</button>
		</div>
	`,
});

const USelectStub = defineComponent({
	props: {
		modelValue: { type: [String, Number, Boolean, Object], required: false },
		items: { type: Array, required: false },
	},
	template: '<div data-testid="u-select">{{ (items || []).map(item => item.label).join("|") }}</div>',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-input-number">{{ modelValue }}</div>',
});

function defaultDeckConfig(): Record<string, any> {
	return {
		deckSource: { type: 'player', playerId: 1 },
		board: 'full',
		sideboardPlacement: 'beside',
		mainboard: { view: 'grid', columns: 4, listColumns: 2, cardSize: 'medium', dynamicCardSize: false, cardGap: 8, stackOverlap: 15 },
		sideboard: { view: 'stack', columns: 4, listColumns: 2, cardSize: 'medium', dynamicCardSize: false, cardGap: 8, stackOverlap: 15 },
		showQuantities: true,
		showDeckName: true,
		showDeckColors: true,
	};
}

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/Deck/Settings.vue';
	const { default: Settings } = await import(componentPath);

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
				UInputNumber: UInputNumberStub,
				UIColorPicker: true,
				USeparator: true,
				UIcon: true,
			},
		},
	});
}

function boardsControl(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return wrapper.get('[data-testid="form-field"][data-label="Boards"] [data-testid="segmented-tabs"]');
}

function sectionTitles(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return wrapper.findAll('[data-testid="settings-card"]').map(card => card.attributes('data-title'));
}

describe('screenDeckSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = defaultDeckConfig();
		mockFetchDeck.mockResolvedValue({
			cards: [
				{ name: 'Mana Drain', quantity: 4, compartment: 'mainboard' },
				{ name: 'Force of Will', quantity: 2, compartment: 'sideboard' },
			],
		});
	});

	it('selects the shown boards with a three-way segmented control', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const tabs = boardsControl(wrapper).findAll('[data-testid="segmented-tab"]');
		expect(tabs.map(tab => tab.attributes('data-value'))).toEqual(['full', 'mainboard', 'sideboard']);
		expect(tabs.map(tab => tab.text())).toEqual(['Full deck', 'Mainboard', 'Sideboard']);

		await tabs[2]!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ board: 'sideboard' });
	});

	it('shows a layout section per visible board only', async () => {
		let wrapper = await mountComponent();
		await flushPromises();
		expect(sectionTitles(wrapper)).toContain('Mainboard Layout');
		expect(sectionTitles(wrapper)).toContain('Sideboard Layout');

		mockConfig.value = { ...defaultDeckConfig(), board: 'mainboard' };
		wrapper = await mountComponent();
		await flushPromises();
		expect(sectionTitles(wrapper)).toContain('Mainboard Layout');
		expect(sectionTitles(wrapper)).not.toContain('Sideboard Layout');

		mockConfig.value = { ...defaultDeckConfig(), board: 'sideboard' };
		wrapper = await mountComponent();
		await flushPromises();
		expect(sectionTitles(wrapper)).not.toContain('Mainboard Layout');
		expect(sectionTitles(wrapper)).toContain('Sideboard Layout');
	});

	it('offers the sideboard placement knob only at board: full', async () => {
		let wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.find('[data-testid="form-field"][data-label="Sideboard Placement"]').exists()).toBe(true);

		mockConfig.value = { ...defaultDeckConfig(), board: 'sideboard' };
		wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.find('[data-testid="form-field"][data-label="Sideboard Placement"]').exists()).toBe(false);
	});

	it('shows only the knobs the board view reads', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const mainboardSection = wrapper.get('[data-testid="settings-card"][data-title="Mainboard Layout"]');
		expect(mainboardSection.find('[data-label="Grid Columns"]').exists()).toBe(true);
		expect(mainboardSection.find('[data-label="Stack Visible %"]').exists()).toBe(false);
		expect(mainboardSection.find('[data-label="List Columns"]').exists()).toBe(false);

		const sideboardSection = wrapper.get('[data-testid="settings-card"][data-title="Sideboard Layout"]');
		expect(sideboardSection.find('[data-label="Stack Visible %"]').exists()).toBe(true);
		expect(sideboardSection.find('[data-label="Grid Columns"]').exists()).toBe(false);
	});

	it('writes a complete board block when one knob changes', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const sideboardSection = wrapper.get('[data-testid="settings-card"][data-title="Sideboard Layout"]');
		const viewTabs = sideboardSection.findAll('[data-testid="segmented-tab"]');
		await viewTabs.find(tab => tab.attributes('data-value') === 'grid')!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			sideboard: { view: 'grid', columns: 4, listColumns: 2, cardSize: 'medium', dynamicCardSize: false, cardGap: 8, stackOverlap: 15 },
		});
	});

	it('hints when the selected deck has no sideboard cards', async () => {
		mockFetchDeck.mockResolvedValue({
			cards: [{ name: 'Mana Drain', quantity: 4, compartment: 'mainboard' }],
		});

		let wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.find('[data-testid="empty-sideboard-hint"]').exists()).toBe(true);

		mockConfig.value = { ...defaultDeckConfig(), board: 'mainboard' };
		wrapper = await mountComponent();
		await flushPromises();
		expect(wrapper.find('[data-testid="empty-sideboard-hint"]').exists()).toBe(false);
	});

	it('shows no empty-sideboard hint when the deck has sideboard cards', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.find('[data-testid="empty-sideboard-hint"]').exists()).toBe(false);
	});
});

import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

vi.mock('vue-draggable-plus', () => ({
	VueDraggable: defineComponent({
		name: 'VueDraggable',
		props: {
			modelValue: { type: Array, required: false },
		},
		emits: ['update:modelValue', 'end'],
		template: '<div data-testid="draggable"><slot /></div>',
	}),
}));

const mockPlayerStore = {
	players: [{ id: 1 }, { id: 2 }, { id: 3 }],
	isLoaded: false,
	loadPlayersByEventId: vi.fn().mockResolvedValue(undefined),
	$reset: vi.fn(),
};

const mockPlayerListStore = {
	lists: [{ id: 7, name: 'Feature Table', memberCount: 4 }],
	isLoaded: false,
	loadByEventId: vi.fn().mockResolvedValue(undefined),
	$reset: vi.fn(),
};

const mockEventStore = {
	event: { id: 1 },
	loadEvent: vi.fn().mockResolvedValue(undefined),
	$reset: vi.fn(),
};

function createResettableStore() {
	return {
		$reset: vi.fn(),
	};
}

const defaultConfig = {
	viewMode: 'archetype' as const,
	scope: 'all' as const,
	topN: 8,
	minPoints: 9,
	playerListId: undefined,
	archetypeFilter: undefined,
	sortBy: 'metaShare' as const,
	cardSortBy: 'inclusionRate' as const,
	archetypeColumns: [
		{ key: 'archetype', visible: true },
		{ key: 'count', visible: true },
		{ key: 'metaShare', visible: true },
		{ key: 'winRate', visible: true },
		{ key: 'avgPlace', visible: false },
		{ key: 'colors', visible: false },
	],
	cardColumns: [
		{ key: 'card', visible: true },
		{ key: 'manaCost', visible: true },
		{ key: 'type', visible: true },
		{ key: 'inclusionRate', visible: true },
		{ key: 'avgCopies', visible: true },
		{ key: 'totalCopies', visible: true },
		{ key: 'deckCount', visible: true },
		{ key: 'mainboardCount', visible: true },
		{ key: 'sideboardCount', visible: true },
	],
	limit: 50,
	pageSize: 10,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	currentPage: 1,
	showHeader: true,
	headerText: undefined,
	animateEntries: true,
};

const mockConfig = ref<Record<string, any>>({ ...defaultConfig });
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useArchetypeStore', () => createResettableStore);
mockNuxtImport('useMetagameStore', () => createResettableStore);
mockNuxtImport('usePhaseStore', () => createResettableStore);
mockNuxtImport('useRoundStore', () => createResettableStore);
mockNuxtImport('useMatchStore', () => createResettableStore);
mockNuxtImport('useFeatureMatchStore', () => createResettableStore);
mockNuxtImport('useFeatureMatchStateStore', () => createResettableStore);
mockNuxtImport('useScreenStore', () => createResettableStore);
mockNuxtImport('useCardStore', () => createResettableStore);
mockNuxtImport('useMeleeStore', () => createResettableStore);
mockNuxtImport('clearPlayerDeckCache', () => vi.fn());
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

const ScreenSettingsCardStub = defineComponent({
	props: {
		title: { type: String, required: false },
		subtitle: { type: String, required: false },
	},
	template: '<section data-testid="settings-card"><h2>{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p><slot /></section>',
});

const ScreenSettingsToggleStub = defineComponent({
	props: {
		label: { type: String, required: true },
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div data-testid="form-field"><span>{{ label }}</span><slot /></div>',
});

const USelectStub = defineComponent({
	props: {
		modelValue: { type: [String, Number, Boolean, Object], required: false },
		items: { type: Array, required: false },
	},
	template: '<div data-testid="u-select">{{ (items || []).map(item => item.label).join("|") }}</div>',
});

const UInputStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
	},
	template: '<div data-testid="u-input">{{ modelValue }}</div>',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-input-number">{{ modelValue }}</div>',
});

const USwitchStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="u-switch" @click="$emit(\'update:modelValue\', !modelValue)">{{ String(!!modelValue) }}</button>',
});

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/Metagame/Settings.vue';
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
				USelect: USelectStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USwitch: USwitchStub,
				UButton: true,
				USeparator: true,
				UIcon: true,
			},
		},
	});
}

describe('screenMetagameSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = structuredClone(defaultConfig);
		mockPlayerStore.isLoaded = false;
		mockPlayerListStore.isLoaded = false;
	});

	it('toggles metagame column visibility', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const switches = wrapper.findAll('[data-testid="u-switch"]');
		await switches[5]!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			archetypeColumns: [
				{ key: 'archetype', visible: true },
				{ key: 'count', visible: true },
				{ key: 'metaShare', visible: true },
				{ key: 'winRate', visible: true },
				{ key: 'avgPlace', visible: false },
				{ key: 'colors', visible: true },
			],
		});
	});

	it('offers the Minimum Points player scope', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const scopeSelect = wrapper.findAll('[data-testid="u-select"]')
			.find(select => select.text().includes('All Players'));

		expect(scopeSelect).toBeDefined();
		expect(scopeSelect!.text()).toContain('Minimum Points');
	});

	it('shows a minimum points input for the minPoints scope and persists changes', async () => {
		mockConfig.value = { ...structuredClone(defaultConfig), scope: 'minPoints', minPoints: 9 };

		const wrapper = await mountComponent();
		await flushPromises();

		const minPointsField = wrapper.findAll('[data-testid="form-field"]')
			.find(field => field.text().includes('Minimum points'));
		expect(minPointsField).toBeDefined();

		const input = minPointsField!.getComponent(UInputNumberStub);
		expect(input.props('modelValue')).toBe(9);

		input.vm.$emit('update:modelValue', 12);
		await nextTick();

		expect(mockUpdateConfig).toHaveBeenCalledWith({ minPoints: 12, currentPage: 1 });
	});

	it('persists reordered columns for the active table', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const reordered = [
			{ key: 'metaShare', visible: true },
			{ key: 'archetype', visible: true },
			{ key: 'count', visible: true },
			{ key: 'winRate', visible: true },
			{ key: 'avgPlace', visible: false },
			{ key: 'colors', visible: false },
		];

		const draggable = wrapper.getComponent({ name: 'VueDraggable' });
		draggable.vm.$emit('update:modelValue', reordered);
		await nextTick();
		draggable.vm.$emit('end');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			archetypeColumns: reordered,
		});
	});
});

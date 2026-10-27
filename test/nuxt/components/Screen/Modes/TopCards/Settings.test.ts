import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import Settings from '~/components/Screen/Modes/TopCards/Settings.vue';
import { eventDataResync } from '~/modules/event-data/resync';

const mockPlayerStore = {
	players: [
		{ id: 1 },
		{ id: 2 },
	],
	isLoaded: false,
	loadPlayersByEventId: vi.fn().mockResolvedValue(undefined),
	$reset: vi.fn(),
};

const mockPlayerListStore = {
	lists: [
		{ id: 7, name: 'Feature Table', memberCount: 4 },
	],
	isLoaded: false,
	loadByEventId: vi.fn().mockResolvedValue(undefined),
	$reset: vi.fn(),
};

const defaultConfig = {
	scope: 'all' as const,
	topN: 8,
	playerListId: undefined,
	archetypeFilter: undefined,
	board: 'mainboard' as const,
	sortBy: 'inclusionRate' as const,
	limit: 10,
	excludedCardTypes: ['Land'],
	columns: 5,
	dynamicCardSize: true,
	rowsPerPage: 60,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	showHeader: true,
	headerText: undefined,
	showCardNames: true,
	showRankBadges: true,
	statBadge: 'inclusionRate' as const,
};

const mockConfig = ref<Record<string, any>>({ ...defaultConfig });
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});

// The Screen's ranking, read as its Screen Output reads it.
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => null);

/** A ranking of `count` cards, as the server answers it once it has applied the filters. */
function ranking(count: number) {
	return {
		totalDecks: 8,
		entries: Array.from({ length: count }, (_, index) => ({ id: `card-${index + 1}`, name: `Card ${index + 1}` })),
	};
}

// Server time is the Page Rotation's clock.
mockNuxtImport('useServerTime', () => () => ({
	isSynced: ref(true),
	serverTimeOffset: ref(0),
	getServerTime: () => 1_000_000.25,
}));

mockNuxtImport('useEventStore', () => () => ({ eventId: 1 }));
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);
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
	template: '<section data-testid="settings-card"><h2>{{ title }}</h2><slot /></section>',
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
		modelValue: {
			type: [String, Number, Boolean, Object],
			required: false,
		},
		items: { type: Array, required: false },
	},
	template: '<div data-testid="u-select">{{ (items || []).map(item => item.label).join("|") }}</div>',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		variant: { type: String, required: false },
		color: { type: String, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :data-variant="variant" @click="$emit(\'click\')">{{ label }}</button>',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-input-number">{{ modelValue }}</div>',
});

/** The number input under the form field labelled `label`. */
function numberInput(wrapper: Awaited<ReturnType<typeof mountComponent>>, label: string) {
	const field = wrapper.findAll('[data-testid="form-field"]').find(item => item.text().includes(label));
	expect(field, label).toBeDefined();
	return field!.getComponent(UInputNumberStub);
}

async function mountComponent() {
	const wrapper = mount(Settings, {
		props: {
			// Saved as edited: the Screen reads through its saved configuration.
			screen: {
				id: 1,
				modeConfigs: { 'top-cards': mockConfig.value },
			} as unknown as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UButton: UButtonStub,
				UInput: true,
				UInputNumber: UInputNumberStub,
				USeparator: true,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('screenTopCardsSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = structuredClone(defaultConfig);
		mockPlayerStore.isLoaded = false;
		mockPlayerListStore.isLoaded = false;
		mockFetch.mockReset();
		mockFetch.mockResolvedValue(ranking(10));
	});

	it('renders a filter chip per card-type bucket', async () => {
		const wrapper = await mountComponent();

		const chips = wrapper.findAll('[data-testid^="top-cards-type-"]');
		expect(chips).toHaveLength(9);
		expect(wrapper.get('[data-testid="top-cards-type-Land"]').text()).toBe('Nonbasic Land');
	});

	it('marks excluded types with the outline variant', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="top-cards-type-Land"]').attributes('data-variant')).toBe('outline');
		expect(wrapper.get('[data-testid="top-cards-type-Creature"]').attributes('data-variant')).toBe('solid');
	});

	it('re-includes an excluded type on click', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="top-cards-type-Land"]').trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ excludedCardTypes: [], currentPage: 1 });
	});

	it('excludes an included type on click', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="top-cards-type-Creature"]').trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			excludedCardTypes: ['Land', 'Creature'],
			currentPage: 1,
		});
	});

	it('offers the player list scope only when lists exist', async () => {
		const wrapper = await mountComponent();
		expect(wrapper.text()).toContain('Player List');

		mockPlayerListStore.lists = [];
		const wrapperWithoutLists = await mountComponent();
		expect(wrapperWithoutLists.text()).not.toContain('Player List');

		mockPlayerListStore.lists = [
			{ id: 7, name: 'Feature Table', memberCount: 4 },
		];
	});

	it('loads players and player lists on mount', async () => {
		await mountComponent();

		expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
		expect(mockPlayerListStore.loadByEventId).toHaveBeenCalledWith(1);
	});

	it('re-reads the players and player lists it loaded on Reconnect Resync, until it unmounts (#610)', async () => {
		const wrapper = await mountComponent();
		mockPlayerStore.isLoaded = true;
		mockPlayerListStore.isLoaded = true;
		vi.clearAllMocks();

		await eventDataResync.resync();
		expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
		expect(mockPlayerListStore.loadByEventId).toHaveBeenCalledWith(1);

		wrapper.unmount();
		eventDataResync.reset();
	});

	// The rotation writes themselves are `rotationConfigWrites`' and the Pagination card's tests.
	describe('page rotation', () => {
		it('counts pages of whole grid rows from the cards the Screen reads and its columns', async () => {
			mockConfig.value = {
				...mockConfig.value,
				limit: 12,
				columns: 5,
				rowsPerPage: 1,
			};
			mockFetch.mockResolvedValue(ranking(12));

			const wrapper = await mountComponent();

			expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/top-cards', expect.anything());
			// 12 cards in rows of 5 is 3 grid rows, one per page.
			expect(wrapper.text()).toContain('Page 1 of 3');
		});

		it('counts the cards the filters leave, not the configured limit (#780)', async () => {
			mockConfig.value = {
				...mockConfig.value,
				limit: 12,
				columns: 5,
				rowsPerPage: 1,
				excludedCardTypes: ['Land', 'Creature'],
			};
			// Only 7 cards are left once Lands and Creatures are excluded.
			mockFetch.mockResolvedValue(ranking(7));

			const wrapper = await mountComponent();

			// 7 cards in rows of 5 is 2 grid rows, one per page, as the Screen renders.
			expect(wrapper.text()).toContain('Page 1 of 2');
		});

		it('returns to page 1 when the columns change which cards each page holds, without re-anchoring', async () => {
			mockConfig.value = { ...mockConfig.value, autoPageEnabled: true, currentPage: 2 };
			const wrapper = await mountComponent();

			numberInput(wrapper, 'Columns').vm.$emit('update:modelValue', 4);

			expect(mockUpdateConfig).toHaveBeenCalledWith({ columns: 4, currentPage: 1 });
		});
	});
});

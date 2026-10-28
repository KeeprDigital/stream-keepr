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
	autoColumns: false,
	cardSizing: 'fit',
	cardWidth: 160,
	cardGap: 12,
	cardsPerPage: 60,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	showHeader: true,
	headerText: undefined,
	showRankBadges: true,
	rankBadgePosition: 'top-left' as const,
	rankBadgeTextSize: 14,
	statBadge: 'inclusionRate' as const,
	statBadgePosition: 'bottom-right' as const,
	statBadgeTextSize: 14,
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
		enabled: { type: Boolean, required: false, default: undefined },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" :aria-pressed="modelValue" :aria-disabled="enabled === false" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

const UINinePointPickerStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="nine-point-picker" :data-value="modelValue" />',
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
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-input-number" :aria-disabled="disabled">{{ modelValue }}</div>',
});

/** The control under the form field or toggle labelled `label`. */
function control<T>(wrapper: Awaited<ReturnType<typeof mountComponent>>, label: string, stub: T) {
	const field = wrapper.findAll('[data-testid="form-field"], [data-testid="settings-toggle"]').find(item => item.text().includes(label));
	expect(field, label).toBeDefined();
	return field!.findComponent(stub as any).exists()
		? field!.getComponent(stub as any)
		: field!;
}

/** The component stub carrying `aria-label`. */
function labelled<T>(wrapper: Awaited<ReturnType<typeof mountComponent>>, stub: T, label: string) {
	return wrapper.findAllComponents(stub as any).find(item => item.attributes('aria-label') === label);
}

/** The toggle labelled `label`. */
function toggle(wrapper: Awaited<ReturnType<typeof mountComponent>>, label: string) {
	return wrapper.findAll('[data-testid="settings-toggle"]').find(item => item.text() === label)!;
}

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
				UINinePointPicker: UINinePointPickerStub,
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
		it('counts pages of cards from the cards the Screen reads, whatever its columns', async () => {
			mockConfig.value = {
				...mockConfig.value,
				limit: 12,
				columns: 5,
				cardsPerPage: 4,
			};
			mockFetch.mockResolvedValue(ranking(12));

			const wrapper = await mountComponent();

			expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/top-cards', expect.anything());
			// 12 cards, 4 a page.
			expect(wrapper.text()).toContain('Page 1 of 3');
		});

		it('counts the cards the filters leave, not the configured limit (#780)', async () => {
			mockConfig.value = {
				...mockConfig.value,
				limit: 12,
				columns: 5,
				cardsPerPage: 5,
				excludedCardTypes: ['Land', 'Creature'],
			};
			// Only 7 cards are left once Lands and Creatures are excluded.
			mockFetch.mockResolvedValue(ranking(7));

			const wrapper = await mountComponent();

			// 7 cards, 5 a page, as the Screen renders.
			expect(wrapper.text()).toContain('Page 1 of 2');
		});

		// Columns never change which cards a page holds, so a layout edit keeps the page on air.
		it.each([
			{
				label: 'Columns',
				patch: { columns: 4 },
			},
			{
				label: 'Card gap',
				patch: { cardGap: 20 },
			},
		])('keeps the page when the $label change', async ({ label, patch }) => {
			mockConfig.value = { ...mockConfig.value, autoPageEnabled: true, currentPage: 2 };
			const wrapper = await mountComponent();

			numberInput(wrapper, label).vm.$emit('update:modelValue', Object.values(patch)[0]);

			expect(mockUpdateConfig).toHaveBeenCalledWith(patch);
		});
	});

	describe('card sizing', () => {
		it('offers Fixed width and Fit to screen, and writes the choice', async () => {
			const wrapper = await mountComponent();

			const select = control(wrapper, 'Card sizing', USelectStub);
			expect(select.text()).toBe('Fixed width|Fit to screen');
			(select as any).vm.$emit('update:modelValue', 'fixed');

			expect(mockUpdateConfig).toHaveBeenCalledWith({ cardSizing: 'fixed' });
		});

		it('turns auto columns on', async () => {
			const wrapper = await mountComponent();

			await control(wrapper, 'Auto columns', ScreenSettingsToggleStub).trigger('click');

			expect(mockUpdateConfig).toHaveBeenCalledWith({ autoColumns: true });
		});

		// Auto columns choose the count, so the count is offered only while they are off.
		it.each([
			{ autoColumns: false, offered: true },
			{ autoColumns: true, offered: false },
		])('offers a column count while auto columns is $autoColumns: $offered', async ({ autoColumns, offered }) => {
			mockConfig.value = { ...mockConfig.value, autoColumns };
			const wrapper = await mountComponent();

			expect(wrapper.findAll('[data-testid="form-field"]').some(field => field.text().includes('Columns'))).toBe(offered);
		});

		// Each size sits beside the control it sizes and writes that one field (ADR-0054).
		it.each([
			{
				label: 'Card width',
				patch: { cardWidth: 200 },
			},
			{
				label: 'Card gap',
				patch: { cardGap: 20 },
			},
		])('writes the $label', async ({ label, patch }) => {
			mockConfig.value = { ...mockConfig.value, cardSizing: 'fixed' };
			const wrapper = await mountComponent();

			numberInput(wrapper, label).vm.$emit('update:modelValue', Object.values(patch)[0]);

			expect(mockUpdateConfig).toHaveBeenCalledWith(patch);
		});

		// A Fit grid sizes its cards to the screen, so it offers no width.
		it.each([
			{ cardSizing: 'fixed', offered: true },
			{ cardSizing: 'fit', offered: false },
		])('offers a $cardSizing grid a card width: $offered', async ({ cardSizing, offered }) => {
			mockConfig.value = { ...mockConfig.value, cardSizing };
			const wrapper = await mountComponent();

			expect(wrapper.findAll('[data-testid="form-field"]').some(field => field.text().includes('Card width'))).toBe(offered);
		});
	});

	// Paging is the ranking split into pages: on while a page holds fewer cards than the ranking.
	describe('paging', () => {
		it.each([
			{ limit: 10, cardsPerPage: 60, paged: false },
			{ limit: 10, cardsPerPage: 10, paged: false },
			{ limit: 12, cardsPerPage: 4, paged: true },
		])('splits $limit cards at $cardsPerPage a page: $paged', async ({ limit, cardsPerPage, paged }) => {
			mockConfig.value = { ...mockConfig.value, limit, cardsPerPage };
			mockFetch.mockResolvedValue(ranking(limit));

			const wrapper = await mountComponent();

			expect(toggle(wrapper, 'Split into pages').attributes('aria-pressed')).toBe(String(paged));
			expect(wrapper.findAll('[data-testid="form-field"]').some(field => field.text().includes('Cards per page'))).toBe(paged);
			expect(wrapper.text().includes('Automatic Paging')).toBe(paged);
		});

		// On splits the ranking in two; off stores the most a page holds, so any card count stays one page.
		it.each([
			{ cardsPerPage: 60, cardsPerPageWritten: 5 },
			{ cardsPerPage: 4, cardsPerPageWritten: 60 },
		])('toggles paging from $cardsPerPage a page to $cardsPerPageWritten', async ({ cardsPerPage, cardsPerPageWritten }) => {
			mockConfig.value = { ...mockConfig.value, limit: 10, cardsPerPage };
			const wrapper = await mountComponent();

			await toggle(wrapper, 'Split into pages').trigger('click');

			expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ cardsPerPage: cardsPerPageWritten }));
		});

		it.each([
			{ limit: 1, enabled: false },
			{ limit: 2, enabled: true },
		])('offers paging to a ranking of $limit: $enabled', async ({ limit, enabled }) => {
			mockConfig.value = { ...mockConfig.value, limit };
			const wrapper = await mountComponent();

			expect(toggle(wrapper, 'Split into pages').attributes('aria-disabled')).toBe(String(!enabled));
		});

		it('caps a page below the ranking, so paging stays on', async () => {
			mockConfig.value = { ...mockConfig.value, limit: 12, cardsPerPage: 4 };
			const wrapper = await mountComponent();

			expect(numberInput(wrapper, 'Cards per page').attributes('max')).toBe('11');
		});
	});

	// Each badge is placed and sized on its own, as a Deck Screen's are.
	describe('card badges', () => {
		it.each([
			{
				label: 'Rank badge position',
				value: 'bottom-left',
				patch: { rankBadgePosition: 'bottom-left' },
			},
			{
				label: 'Stat badge position',
				value: 'top',
				patch: { statBadgePosition: 'top' },
			},
		])('writes the $label', async ({ label, value, patch }) => {
			const wrapper = await mountComponent();

			labelled(wrapper, UINinePointPickerStub, label)!.vm.$emit('update:modelValue', value);

			expect(mockUpdateConfig).toHaveBeenCalledWith(patch);
		});

		it.each([
			{
				label: 'Rank badge text size',
				value: 20,
				patch: { rankBadgeTextSize: 20 },
			},
			{
				label: 'Stat badge text size',
				value: 11,
				patch: { statBadgeTextSize: 11 },
			},
		])('writes the $label', async ({ label, value, patch }) => {
			const wrapper = await mountComponent();

			labelled(wrapper, UInputNumberStub, label)!.vm.$emit('update:modelValue', value);

			expect(mockUpdateConfig).toHaveBeenCalledWith(patch);
		});

		// A hidden badge offers no place or size.
		it.each([
			{
				hidden: { showRankBadges: false },
				gone: 'Rank',
				kept: 'Stat',
			},
			{
				hidden: { statBadge: 'none' },
				gone: 'Stat',
				kept: 'Rank',
			},
		])('offers no $gone badge controls while it is hidden', async ({ hidden, gone, kept }) => {
			mockConfig.value = {
				...mockConfig.value,
				...hidden,
			};
			const wrapper = await mountComponent();

			expect(labelled(wrapper, UINinePointPickerStub, `${gone} badge position`)).toBeUndefined();
			expect(labelled(wrapper, UInputNumberStub, `${gone} badge text size`)).toBeUndefined();
			expect(labelled(wrapper, UINinePointPickerStub, `${kept} badge position`)).toBeDefined();
		});
	});
});

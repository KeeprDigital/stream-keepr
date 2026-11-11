import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { screenSettingsLayoutStubs, settingsLayout, settingsSummaries } from '~~/test/nuxt/helpers/screenSettingsLayout';
import Settings from '~/components/Screen/Modes/TopCards/Settings.vue';
import { eventDataResync } from '~/modules/event-data/resync';

// Every mount reads the one shared config; a mount left behind re-renders on each later test's edit.
enableAutoUnmount(afterEach);

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
	pointedOnly: false,
	columns: undefined,
	maxCardSize: undefined,
	cardGap: undefined,
	cardsPerPage: undefined as number | undefined,
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
	showPointsBadges: false,
	pointsBadgePosition: 'top-right' as const,
	pointsBadgeTextSize: 14,
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

const mockEventStore = {
	eventId: 1,
	event: { pointsSystem: '7ph' as string | null, game: 'mtg' as string | undefined },
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);
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
		enabled: { type: Boolean, required: false, default: undefined },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" :aria-pressed="modelValue" :aria-disabled="enabled === false" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

/** A card badge row's bare switch, read as a toggle labelled by its accessible name. */
const USwitchStub = defineComponent({
	inheritAttrs: false,
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" :data-config-field="$attrs[\'data-config-field\']" :aria-pressed="modelValue" @click="$emit(\'update:modelValue\', !modelValue)">{{ $attrs[\'aria-label\'] }}</button>',
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
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :data-variant="variant" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
		max: { type: Number, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-input-number" :data-max="max" :aria-disabled="disabled">{{ modelValue }}</div>',
});

/** The `stub` control of the contract field `key`, if rendered. */
function configControl<T>(wrapper: Awaited<ReturnType<typeof mountComponent>>, stub: T, key: string) {
	const field = wrapper.find(`[data-config-field="${key}"]`);
	return field.exists()
		? field.getComponent(stub as any)
		: undefined;
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

async function mountComponent(themeOverrides: Record<string, unknown> = {}) {
	const wrapper = mount(Settings, {
		props: {
			// Saved as edited: the Screen reads through its saved configuration.
			screen: {
				id: 1,
				modeConfigs: { 'top-cards': mockConfig.value },
				themeOverrides,
			} as unknown as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				...screenSettingsLayoutStubs,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UButton: UButtonStub,
				UInput: true,
				UInputNumber: UInputNumberStub,
				UINinePointPicker: UINinePointPickerStub,
				USwitch: USwitchStub,
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
		mockEventStore.event = { pointsSystem: '7ph', game: 'mtg' };
		mockFetch.mockReset();
		mockFetch.mockResolvedValue(ranking(10));
	});

	// Each Mode Token's Look sits in the card for what it styles (ADR-0072).
	it.each([
		{
			pointsSystem: '7ph',
			badgeGroups: ['rank-badge', 'stat-badge', 'points-badge'],
		},
		{
			pointsSystem: null,
			badgeGroups: ['rank-badge', 'stat-badge'],
		},
	])('lays out its cards, each holding its Look, with points system $pointsSystem', async ({ pointsSystem, badgeGroups }) => {
		mockEventStore.event = { pointsSystem, game: 'mtg' };
		const wrapper = await mountComponent();

		expect(settingsLayout(wrapper)).toEqual([
			{
				id: 'top-cards:data',
				title: 'Data',
				collapsible: false,
				groups: [],
			},
			{
				id: 'top-cards:filters',
				title: 'Filters',
				collapsible: true,
				groups: [],
			},
			{
				id: 'top-cards:ranking-and-pages',
				title: 'Ranking & Pages',
				collapsible: true,
				groups: [],
			},
			{
				id: 'top-cards:layout',
				title: 'Layout',
				collapsible: true,
				groups: [],
			},
			{
				id: 'top-cards:header',
				title: 'Header',
				collapsible: true,
				groups: [],
			},
			{
				id: 'top-cards:card-badges',
				title: 'Card Badges',
				collapsible: true,
				groups: badgeGroups,
			},
		]);
	});

	it('summarises each closed card', async () => {
		mockConfig.value = {
			...mockConfig.value,
			pointedOnly: true,
			excludedCardTypes: ['Land', 'Creature'],
			statBadge: 'none',
		};
		const wrapper = await mountComponent();

		expect(settingsSummaries(wrapper)).toEqual({
			'top-cards:filters': 'Pointed only · 1 type excluded',
			'top-cards:ranking-and-pages': 'Top 10 · One page',
			'top-cards:layout': 'Auto',
			'top-cards:header': 'Auto title',
			'top-cards:card-badges': 'Rank badge',
		});
	});

	// A closed card counts only the overrides its mounted Looks show; the rest sit in the Screen-wide look.
	it.each([
		{ pointsSystem: '7ph', summary: 'Rank, Stat badges · 2 Screen Theme Overrides' },
		{ pointsSystem: null, summary: 'Rank, Stat badges · 1 Screen Theme Override' },
	])('counts the Card Badges overrides it shows with points system $pointsSystem', async ({ pointsSystem, summary }) => {
		mockEventStore.event = { pointsSystem, game: 'mtg' };
		const wrapper = await mountComponent({
			'top-cards.rank-badge-surface': '#000000',
			'top-cards.points-badge-surface': '#ff0000',
		});

		expect(settingsSummaries(wrapper)['top-cards:card-badges']).toBe(summary);
	});

	it('renders a filter chip per card-type bucket', async () => {
		const wrapper = await mountComponent();

		const chips = wrapper.findAll('[data-testid^="top-cards-type-"]');
		expect(chips).toHaveLength(9);
		expect(wrapper.get('[data-testid="top-cards-type-Land"]').text()).toBe('Nonbasic Land');
	});

	it('presses each included type\'s chip, not an excluded one\'s', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="top-cards-type-Land"]').attributes('aria-pressed')).toBe('false');
		expect(wrapper.get('[data-testid="top-cards-type-Creature"]').attributes('aria-pressed')).toBe('true');
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

	// An OP Deck List is one Mainboard of Characters, Events and Stages, and carries no points (ADR-0074).
	describe('on a One Piece Event', () => {
		beforeEach(() => {
			mockEventStore.event = { pointsSystem: '7ph', game: 'op' };
		});

		it('offers a chip per OP card type, and counts a stored Magic type as none excluded', async () => {
			const wrapper = await mountComponent();

			expect(wrapper.findAll('[data-testid^="top-cards-type-"]').map(chip => chip.text())).toEqual(['Character', 'Event', 'Stage']);
			expect(settingsSummaries(wrapper)['top-cards:filters']).toBe('Every card type');
		});

		it('excludes an OP card type on click, keeping what was stored', async () => {
			const wrapper = await mountComponent();

			await wrapper.get('[data-testid="top-cards-type-Event"]').trigger('click');

			expect(mockUpdateConfig).toHaveBeenCalledWith({
				excludedCardTypes: ['Land', 'Event'],
				currentPage: 1,
			});
		});

		it('offers no board, pointed only or point badges', async () => {
			const wrapper = await mountComponent();

			expect(wrapper.find('[data-config-field="board"]').exists()).toBe(false);
			expect(toggle(wrapper, 'Pointed only')).toBeUndefined();
			expect(toggle(wrapper, 'Show point badges')).toBeUndefined();
		});
	});

	describe('pointed only', () => {
		// Points come from the Event's points system; a Screen left filtering keeps its way back.
		it.each([
			{ pointsSystem: '7ph', pointedOnly: false, offered: true },
			{ pointsSystem: null, pointedOnly: false, offered: false },
			{ pointsSystem: null, pointedOnly: true, offered: true },
		])('offers the filter with points system $pointsSystem, filtering $pointedOnly: $offered', async ({ pointsSystem, pointedOnly, offered }) => {
			mockEventStore.event = { pointsSystem, game: 'mtg' };
			mockConfig.value = { ...mockConfig.value, pointedOnly };
			const wrapper = await mountComponent();

			const pointed = toggle(wrapper, 'Pointed only');
			expect(pointed?.exists() ?? false).toBe(offered);
			if (offered)
				expect(pointed.attributes('aria-pressed')).toBe(String(pointedOnly));
		});

		it.each([
			{ pointedOnly: false, written: true },
			{ pointedOnly: true, written: false },
		])('turns the filter from $pointedOnly', async ({ pointedOnly, written }) => {
			mockConfig.value = { ...mockConfig.value, pointedOnly };
			const wrapper = await mountComponent();

			await toggle(wrapper, 'Pointed only').trigger('click');

			expect(mockUpdateConfig).toHaveBeenCalledWith({ pointedOnly: written, currentPage: 1 });
		});

		// The Screen ranks pointed lands whatever the Land filter holds, so the chip shows them in and can't be turned off.
		it.each([
			{ pointedOnly: true, pressed: 'true', locked: true },
			{ pointedOnly: false, pressed: 'false', locked: false },
		])('shows Nonbasic Land in while filtering $pointedOnly', async ({ pointedOnly, pressed, locked }) => {
			mockConfig.value = {
				...mockConfig.value,
				pointedOnly,
				excludedCardTypes: ['Land'],
			};
			const wrapper = await mountComponent();

			const land = wrapper.get('[data-testid="top-cards-type-Land"]');
			expect(land.attributes('aria-pressed')).toBe(pressed);
			expect(land.attributes('disabled') !== undefined).toBe(locked);
		});
	});

	describe('point badges', () => {
		it.each([
			{ pointsSystem: '7ph', showPointsBadges: false, offered: true },
			{ pointsSystem: null, showPointsBadges: false, offered: false },
			{ pointsSystem: null, showPointsBadges: true, offered: true },
		])('offers point badges with points system $pointsSystem, badging $showPointsBadges: $offered', async ({ pointsSystem, showPointsBadges, offered }) => {
			mockEventStore.event = { pointsSystem, game: 'mtg' };
			mockConfig.value = { ...mockConfig.value, showPointsBadges };
			const wrapper = await mountComponent();

			expect(toggle(wrapper, 'Show point badges')?.exists() ?? false).toBe(offered);
		});

		it('turns point badges on', async () => {
			const wrapper = await mountComponent();

			await toggle(wrapper, 'Show point badges').trigger('click');

			expect(mockUpdateConfig).toHaveBeenCalledWith({ showPointsBadges: true });
		});

		// A hidden badge offers no place or size.
		it.each([
			{ showPointsBadges: true, offered: true },
			{ showPointsBadges: false, offered: false },
		])('offers a place and size while badging $showPointsBadges', async ({ showPointsBadges, offered }) => {
			mockConfig.value = { ...mockConfig.value, showPointsBadges };
			const wrapper = await mountComponent();

			expect(configControl(wrapper, UINinePointPickerStub, 'pointsBadgePosition') !== undefined).toBe(offered);
			expect(configControl(wrapper, UInputNumberStub, 'pointsBadgeTextSize') !== undefined).toBe(offered);
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

	// Wiring: the Layout card edits the Screen's Card Layout, bounded by its card
	// count. The fields' own rules are tested at `ScreenCardGridLayoutFields`.
	describe('card layout', () => {
		it.each([
			{
				label: 'Columns',
				patch: { columns: null },
			},
			{
				label: 'Max card size',
				patch: { maxCardSize: 200 },
			},
		])('writes $label as $patch', async ({ label, patch }) => {
			const wrapper = await mountComponent();

			numberInput(wrapper, label).vm.$emit('update:modelValue', Object.values(patch)[0]);

			expect(mockUpdateConfig).toHaveBeenCalledWith(patch);
		});

		it('offers columns up to the card count, and a max card size up to the Event Canvas', async () => {
			mockConfig.value = { ...mockConfig.value, limit: 7 };
			const wrapper = await mountComponent();

			expect(numberInput(wrapper, 'Columns').attributes('data-max')).toBe('7');
			expect(numberInput(wrapper, 'Max card size').attributes('data-max')).toBe('775');
		});

		it.each([
			{ layout: {}, summary: 'Auto' },
			{
				layout: { columns: 1 },
				summary: '1 column',
			},
			{
				layout: { columns: 5, maxCardSize: 200, cardGap: 0 },
				summary: '5 columns · Max 200 px · 0 px gap',
			},
		])('summarises $layout as $summary', async ({ layout, summary }) => {
			mockConfig.value = {
				...mockConfig.value,
				...layout,
			};
			const wrapper = await mountComponent();

			expect(settingsSummaries(wrapper)['top-cards:layout']).toBe(summary);
		});
	});

	// Cards per page is Auto, one page of every card, or a number; a page smaller than the ranking pages it.
	describe('paging', () => {
		it.each([
			{
				limit: 10,
				cardsPerPage: undefined,
				pages: false,
				shown: '',
				summary: 'Top 10 · One page',
			},
			{
				limit: 10,
				cardsPerPage: 10,
				pages: false,
				shown: '10',
				summary: 'Top 10 · One page',
			},
			{
				limit: 10,
				cardsPerPage: 60,
				pages: false,
				shown: '60',
				summary: 'Top 10 · One page',
			},
			{
				limit: 12,
				cardsPerPage: 4,
				pages: true,
				shown: '4',
				summary: 'Top 12 · 4 per page',
			},
		])('$limit cards at $cardsPerPage a page offer the rotation: $pages', async ({ limit, cardsPerPage, pages, shown, summary }) => {
			mockConfig.value = { ...mockConfig.value, limit, cardsPerPage };
			mockFetch.mockResolvedValue(ranking(limit));

			const wrapper = await mountComponent();

			expect(configControl(wrapper, UInputNumberStub, 'cardsPerPage')!.text()).toBe(shown);
			expect(wrapper.text().includes('Automatic Paging')).toBe(pages);
			expect(settingsSummaries(wrapper)['top-cards:ranking-and-pages']).toBe(summary);
			expect(wrapper.text()).not.toContain('Split into pages');
		});

		it.each([
			{ name: 'a number', emitted: 5, cardsPerPage: 5 },
			{ name: 'Auto, by emptying it', emitted: null, cardsPerPage: null },
		])('writes $name, returning to page 1', async ({ emitted, cardsPerPage }) => {
			mockConfig.value = {
				...mockConfig.value,
				limit: 12,
				cardsPerPage: 4,
				currentPage: 2,
			};
			const wrapper = await mountComponent();

			configControl(wrapper, UInputNumberStub, 'cardsPerPage')!.vm.$emit('update:modelValue', emitted);

			expect(mockUpdateConfig).toHaveBeenCalledWith({ cardsPerPage, currentPage: 1 });
		});

		it('shows an unset page size as Auto', async () => {
			const wrapper = await mountComponent();

			expect(configControl(wrapper, UInputNumberStub, 'cardsPerPage')!.attributes('placeholder')).toBe('Auto');
		});
	});

	// Each badge is placed and sized on its own, as a Deck List Screen's are.
	describe('card badges', () => {
		it.each([
			{
				key: 'rankBadgePosition',
				value: 'bottom-left',
				patch: { rankBadgePosition: 'bottom-left' },
			},
			{
				key: 'statBadgePosition',
				value: 'top',
				patch: { statBadgePosition: 'top' },
			},
		])('writes the $key', async ({ key, value, patch }) => {
			const wrapper = await mountComponent();

			configControl(wrapper, UINinePointPickerStub, key)!.vm.$emit('update:modelValue', value);

			expect(mockUpdateConfig).toHaveBeenCalledWith(patch);
		});

		it.each([
			{
				key: 'rankBadgeTextSize',
				value: 20,
				patch: { rankBadgeTextSize: 20 },
			},
			{
				key: 'statBadgeTextSize',
				value: 11,
				patch: { statBadgeTextSize: 11 },
			},
		])('writes the $key', async ({ key, value, patch }) => {
			const wrapper = await mountComponent();

			configControl(wrapper, UInputNumberStub, key)!.vm.$emit('update:modelValue', value);

			expect(mockUpdateConfig).toHaveBeenCalledWith(patch);
		});

		// A hidden badge offers no place or size.
		it.each([
			{
				hidden: { showRankBadges: false },
				gone: 'rank',
				kept: 'stat',
			},
			{
				hidden: { statBadge: 'none' },
				gone: 'stat',
				kept: 'rank',
			},
		])('offers no $gone badge controls while it is hidden', async ({ hidden, gone, kept }) => {
			mockConfig.value = {
				...mockConfig.value,
				...hidden,
			};
			const wrapper = await mountComponent();

			expect(configControl(wrapper, UINinePointPickerStub, `${gone}BadgePosition`)).toBeUndefined();
			expect(configControl(wrapper, UInputNumberStub, `${gone}BadgeTextSize`)).toBeUndefined();
			expect(configControl(wrapper, UINinePointPickerStub, `${kept}BadgePosition`)).toBeDefined();
		});
	});
});

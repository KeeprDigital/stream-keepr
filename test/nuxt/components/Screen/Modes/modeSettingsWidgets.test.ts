import type { DbEvent } from '~~/server/db/schema';
import type { Game, ScreenMode } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, h, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { NuxtLinkStub, nuxtUiStubs, UFormFieldBesideStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { fakeScreenThemeNetwork, screenSettingsPage, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import { getScreenModeSettingsComponent } from '~/modules/screen-mode';
import { useEventStore } from '~/stores/event';

// The bespoke widgets the table and card modes mount in the generic
// renderer's slots, and the reads and writes they add to it.

enableAutoUnmount(afterEach);

const { mockFetch, modeData } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	modeData: { noPreviousRoundStandings: false },
}));
mockNuxtImport('$fetch', () => mockFetch);

// The rows the Screen pages, and whether its Standings read found a previous Round to compare with.
vi.mock('~/modules/screen-mode/editorModeData', async () => {
	const { ref } = await import('vue');
	return {
		useEditedScreenModeData: () => ({
			rowCount: ref(0),
			loading: ref(false),
			answered: ref(true),
			noPreviousRoundStandings: ref(modeData.noPreviousRoundStandings),
		}),
	};
});

const config = ref<Record<string, any>>({});
const writes: Record<string, unknown>[] = [];

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving: ref(false),
	updateConfig: (patch: Record<string, unknown>) => {
		writes.push(patch);
		config.value = {
			...config.value,
			...patch,
		};
	},
	resetConfig: vi.fn(),
}));
mockNuxtImport('useServerTime', () => () => ({
	isSynced: ref(true),
	serverTimeOffset: ref(0),
	getServerTime: () => 1_000_000,
}));

const playerLists = {
	isLoaded: false,
	lists: [] as { id: number; name: string; memberCount: number }[],
	loadByEventId: vi.fn(async () => {
		playerLists.isLoaded = true;
	}),
	$reset: vi.fn(),
};
mockNuxtImport('usePlayerListStore', () => () => playerLists);

const loaded = {
	isLoaded: true,
	$reset: vi.fn(),
};
mockNuxtImport('useRoundStore', () => () => ({
	...loaded,
	rounds: [],
	loadRoundsByEventId: vi.fn(),
}));
mockNuxtImport('usePhaseStore', () => () => ({
	...loaded,
	phases: [],
	loadPhasesByEventId: vi.fn(),
}));
mockNuxtImport('useArchetypeStore', () => () => ({
	...loaded,
	archetypes: [],
	loadByEventId: vi.fn(),
}));

beforeEach(() => {
	writes.length = 0;
	modeData.noPreviousRoundStandings = false;
	playerLists.isLoaded = false;
	playerLists.lists = [];
	playerLists.loadByEventId.mockClear();
});

async function mountPage(mode: ScreenMode, variant: Record<string, unknown> = {}, { game = 'mtg', event = {} }: { game?: Game; event?: Partial<DbEvent> } = {}) {
	fakeScreenThemeNetwork(mockFetch, mode);
	const screen = seedThemedScreen(mode);
	useEventStore().event = createMockEvent({ game, ...event, themeId: 'brand' }) as never;
	config.value = structuredClone({
		...getDefaultConfigForMode(mode),
		...variant,
	});
	const settings = getScreenModeSettingsComponent(mode)!;
	await (settings as { __asyncLoader?: () => Promise<unknown> }).__asyncLoader?.();
	const wrapper = mount(screenSettingsPage(screen, () => h(settings, {
		screen: screen(),
		eventId: 1,
	})), {
		global: {
			stubs: {
				...nuxtUiStubs,
				UFormField: UFormFieldBesideStub,
				NuxtLink: NuxtLinkStub,
			},
		},
	});
	await flushPromises();
	writes.length = 0;
	return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountPage>>;

function button(wrapper: Wrapper, label: string) {
	return wrapper.findAll('button').find(found => found.text() === label);
}

describe('the Standings reveal', () => {
	it.each([
		{
			revealedCount: 0,
			press: 'Reveal next',
			writes: [
				{ revealedCount: 1 },
			],
		},
		{
			revealedCount: 3,
			press: 'Reveal next',
			writes: [
				{ revealedCount: 4 },
			],
		},
		{ revealedCount: 8, press: 'Reveal next', writes: [] },
		{
			revealedCount: 3,
			press: 'Reset',
			writes: [
				{ revealedCount: 0 },
			],
		},
		{ revealedCount: 0, press: 'Reset', writes: [] },
	])('with $revealedCount of 8 revealed, $press writes $writes', async ({ revealedCount, press, writes: written }) => {
		const wrapper = await mountPage('standings', { viewMode: 'reveal', revealCount: 8, revealedCount });
		const live = wrapper.get('[data-settings-card="live"] [data-settings-slot="reveal"]');

		expect(live.get('[data-testid="reveal-progress"]').text()).toBe(`${revealedCount} of 8 revealed`);
		await button(wrapper, press)!.trigger('click');

		expect(writes).toEqual(written);
	});

	it.each([
		[
			'reveal',
			[
				{ viewMode: 'reveal', revealedCount: 0, currentPage: 1 },
			],
		],
		[
			'range',
			[
				{ viewMode: 'range', currentPage: 1 },
			],
		],
	])('entering the %s view writes %j', async (viewMode, written) => {
		const wrapper = await mountPage('standings', { revealedCount: 5 });

		await wrapper.get('[data-settings-field="viewMode"] select').setValue(viewMode);

		expect(writes).toEqual(written);
	});

	it('shows its controls in the reveal view only', async () => {
		const wrapper = await mountPage('standings', { viewMode: 'all' });

		expect(wrapper.find('[data-settings-slot="reveal"]').exists()).toBe(false);
	});
});

describe('the Standings Position Change warning', () => {
	// Warns from the Screen's own read (#905), only while the column shows.
	it.each([
		{ shown: true, noPreviousRound: true, warns: true },
		{ shown: true, noPreviousRound: false, warns: false },
		{ shown: false, noPreviousRound: true, warns: false },
	])('with the column shown $shown and no previous Round $noPreviousRound, warns: $warns', async ({ shown, noPreviousRound, warns }) => {
		modeData.noPreviousRoundStandings = noPreviousRound;
		const wrapper = await mountPage('standings', {
			columns: [
				{ key: 'name', visible: true },
				{ key: 'positionChange', visible: shown },
			],
		});

		const warning = wrapper.find('[data-settings-card="content"] [data-testid="position-change-no-data"]');
		expect(warning.exists()).toBe(warns);
	});
});

describe('the Event\'s Conversion Target', () => {
	it.each([
		{
			mode: 'metagame',
			game: 'mtg',
			variant: {},
			shown: false,
		},
		{
			mode: 'metagame',
			game: 'mtg',
			variant: { sortBy: 'conversionRate' },
			shown: true,
		},
		{
			mode: 'metagame',
			game: 'mtg',
			variant: {
				archetypeColumns: [
					{ key: 'archetype', visible: true },
					{ key: 'conversionRate', visible: true },
				],
			},
			shown: true,
		},
		{
			mode: 'metagame',
			game: 'mtg',
			variant: { viewMode: 'cards', sortBy: 'conversionRate' },
			shown: false,
		},
		{
			mode: 'metagame',
			game: 'op',
			variant: { sortBy: 'conversionRate' },
			shown: false,
		},
		{
			mode: 'archetype-spotlight',
			game: 'mtg',
			variant: {},
			shown: true,
		},
		{
			mode: 'archetype-spotlight',
			game: 'op',
			variant: {},
			shown: false,
		},
	] as { mode: ScreenMode; game: Game; variant: Record<string, unknown>; shown: boolean }[])(
		'$mode on a $game Event with $variant shows it read-only: $shown',
		async ({ mode, game, variant, shown }) => {
			const wrapper = await mountPage(mode, variant, { game });
			const target = wrapper.find('[data-testid="event-conversion-target-link"]');

			expect(target.exists()).toBe(shown);
			if (shown)
				expect(target.attributes('href')).toBe('/event/1/metagame');
		},
	);
});

describe('the Metagame chart', () => {
	it.each([
		['chart', true],
		['archetype', false],
	])('in the %s view links to where an Archetype pins its series: %s', async (viewMode, shown) => {
		const wrapper = await mountPage('metagame', { viewMode });

		expect(wrapper.find('[data-testid="pinned-chart-series-link"]').exists()).toBe(shown);
	});
});

describe('a Metagame Scope', () => {
	it.each([
		[
			[],
			['All Players', 'Top N', 'Minimum points'],
		],
		[
			[
				{ id: 2, name: 'Locals', memberCount: 3 },
			],
			[
				'All Players',
				'Top N',
				'Player List',
				'Minimum points',
			],
		],
	])('with Player Lists %j offers the scopes %j, loading the lists', async (lists, scopes) => {
		playerLists.lists = lists;
		const wrapper = await mountPage('top-cards');

		expect(playerLists.loadByEventId).toHaveBeenCalledWith(1);
		expect(wrapper.get('[data-settings-field="scope"]').findAll('option').map(option => option.text())).toEqual(scopes);
	});
});

describe('the card type chips', () => {
	it.each([
		{
			mode: 'top-cards',
			chip: 'top-cards-type-Creature',
			written: [
				{
					excludedCardTypes: ['Land', 'Creature'],
					currentPage: 1,
				},
			],
		},
		{
			mode: 'top-cards',
			chip: 'top-cards-type-Land',
			written: [
				{ excludedCardTypes: [], currentPage: 1 },
			],
		},
		{
			mode: 'archetype-spotlight',
			chip: 'archetype-spotlight-type-Creature',
			written: [
				{
					excludedCardTypes: ['Land', 'Creature'],
				},
			],
		},
	] as { mode: ScreenMode; chip: string; written: Record<string, unknown>[] }[])('$mode toggles $chip, writing $written', async ({ mode, chip, written }) => {
		const wrapper = await mountPage(mode);

		await wrapper.get(`[data-testid="${chip}"]`).trigger('click');

		expect(writes).toEqual(written);
	});

	it.each([
		[false, 'false', false],
		[true, 'true', true],
	])('with pointed only %s, Most Played Cards presses Nonbasic Land: %s, locked: %s', async (pointedOnly, pressed, locked) => {
		const wrapper = await mountPage('top-cards', { pointedOnly }, {
			event: { pointsSystem: '7ph' },
		});
		const land = wrapper.get('[data-testid="top-cards-type-Land"]');

		expect(land.attributes('aria-pressed')).toBe(pressed);
		expect(land.attributes('disabled') !== undefined).toBe(locked);
	});
});

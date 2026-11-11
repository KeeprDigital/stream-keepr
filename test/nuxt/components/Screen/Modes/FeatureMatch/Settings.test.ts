import type { DbEvent } from '~~/server/db/schema';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { featureMatchModeConfigContract } from '~~/shared/screenModeConfigs/featureMatch';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import Settings from '~/components/Screen/Modes/FeatureMatch/Settings.vue';

// Feature Match Controls' settings: one card per thing it shows or decides, each
// field through its contract, gated by what the Event and its Card Game track.

enableAutoUnmount(afterEach);

const mockConfig = ref<Record<string, any>>({});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});
const mockLoadState = vi.fn();
const mockEvent = ref<DbEvent>(createMockEvent());

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));
mockNuxtImport('useEventStore', () => () => ({
	get event() {
		return mockEvent.value;
	},
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	loadFeatureMatchesByEventId: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({
	loadState: mockLoadState,
}));
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([
	{ label: 'Table 1', value: 4 },
	{ label: 'Table 2', value: 5 },
]));

/** An Event offering every feature a field is gated on. */
const everyFeature: Partial<DbEvent> = {
	game: 'mtg',
	pronounsEnabled: true,
	standingsEnabled: true,
	lgsEnabled: true,
	tableNumberEnabled: true,
	featureMatchDefaultTurnTrackingEnabled: true,
	featureMatchDefaultExtraTurnsEnabled: true,
	featureMatchDefaultMulliganTrackingEnabled: true,
};

async function mountSettings() {
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: { ...nuxtUiStubs, MtgManaColorDisplay: true },
		},
	});
	await flushPromises();
	return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountSettings>>;

function card(wrapper: Wrapper, title: string) {
	const found = wrapper.findAll('section').find(section => section.find('h3').text() === title);
	if (!found)
		throw new Error(`no "${title}" card`);
	return found;
}

function collapseToggle(wrapper: Wrapper, title: string) {
	return card(wrapper, title).find('button[aria-expanded]');
}

function field(wrapper: Wrapper, key: string) {
	return wrapper.get(`[data-config-field="${key}"]`);
}

describe('screenFeatureMatchSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockEvent.value = createMockEvent(everyFeature);
		mockConfig.value = { ...featureMatchModeConfigContract.defaults };
	});

	it('lays out its cards in order', async () => {
		const wrapper = await mountSettings();

		expect(wrapper.findAll('h3').map(title => title.text())).toEqual([
			'Source',
			'Player info',
			'Match display',
			'Game state',
			'Control permissions',
		]);
	});

	it.each([
		{ key: 'showPronouns', title: 'Player info' },
		{ key: 'showDeckNames', title: 'Player info' },
		{ key: 'showRecords', title: 'Player info' },
		{ key: 'showLgs', title: 'Player info' },
		{ key: 'showClock', title: 'Match display' },
		{ key: 'showTableNumber', title: 'Match display' },
		{ key: 'showSeatLabels', title: 'Match display' },
		{ key: 'showCounters', title: 'Game state' },
		{ key: 'showTurnControls', title: 'Game state' },
		{ key: 'showOvertime', title: 'Game state' },
		{ key: 'showMulliganInfo', title: 'Game state' },
		{ key: 'allowLifeControls', title: 'Control permissions' },
		{ key: 'allowGameWinControls', title: 'Control permissions' },
		{ key: 'allowCounterControls', title: 'Control permissions' },
	])('puts the $key toggle in the $title card, writing it as its own field', async ({ key, title }) => {
		const wrapper = await mountSettings();

		await card(wrapper, title).get(`[data-config-field="${key}"] [role="switch"]`).trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ [key]: false });
	});

	it.each([
		{
			key: 'showPronouns',
			event: { pronounsEnabled: false },
			reason: 'Enable player pronouns in event settings to use this.',
		},
		{
			key: 'showRecords',
			event: { standingsEnabled: false },
			reason: 'Enable player standings in event settings to use this.',
		},
		{
			key: 'showLgs',
			event: { lgsEnabled: false },
			reason: 'Enable LGS tracking in event settings to use this.',
		},
		{
			key: 'showTableNumber',
			event: { tableNumberEnabled: false },
			reason: 'Enable table numbers in event settings to use this.',
		},
		{
			key: 'showCounters',
			event: { game: 'op' },
			reason: 'No counter types available for this game.',
		},
		{
			key: 'showTurnControls',
			event: { featureMatchDefaultTurnTrackingEnabled: false },
			reason: 'Enable turn or active player tracking in event settings to use this.',
		},
		{
			key: 'showOvertime',
			event: { featureMatchDefaultExtraTurnsEnabled: false },
			reason: 'Enable extra turns in event format settings to use this.',
		},
		{
			key: 'showOvertime',
			event: { game: 'op' },
			reason: 'Not tracked in One Piece.',
		},
		{
			key: 'showMulliganInfo',
			event: { featureMatchDefaultMulliganTrackingEnabled: false },
			reason: 'Enable mulligan tracking in event settings to use this.',
		},
		{
			key: 'showMulliganInfo',
			event: { game: 'op' },
			reason: 'Not tracked in One Piece.',
		},
		{
			key: 'allowLifeControls',
			event: { game: 'op' },
			reason: 'Not tracked in One Piece.',
		},
		{
			key: 'allowCounterControls',
			event: { game: 'op' },
			reason: 'No counter types available for this game.',
		},
	] as { key: string; event: Partial<DbEvent>; reason: string }[])('gates $key off for an Event with $event', async ({ key, event, reason }) => {
		mockEvent.value = createMockEvent({
			...everyFeature,
			...event,
		});
		const wrapper = await mountSettings();

		expect(field(wrapper, key).get('[role="switch"]').attributes('disabled')).toBeDefined();
		expect(field(wrapper, key).text()).toContain(reason);
	});

	it.each([
		{ game: 'mtg', label: 'Show deck names', description: 'Show player deck names below their name.' },
		{ game: 'op', label: 'Show leader names', description: 'Show player leader names below their name.' },
	] as const)('names the $game player identity in the deck names toggle', async ({ game, label, description }) => {
		mockEvent.value = createMockEvent({ ...everyFeature, game });
		const wrapper = await mountSettings();

		expect(field(wrapper, 'showDeckNames').text()).toContain(label);
		expect(field(wrapper, 'showDeckNames').text()).toContain(description);
	});

	it.each([
		{
			orientation: 'horizontal',
			options: ['Left player', 'Right player'],
		},
		{
			orientation: 'vertical',
			options: ['Top player', 'Bottom player'],
		},
	] as const)('offers the left side to the $orientation arena\'s seats', async ({ orientation, options }) => {
		mockEvent.value = createMockEvent({ ...everyFeature, featureMatchOrientation: orientation });
		const wrapper = await mountSettings();

		expect(field(wrapper, 'leftSidePlayer').findAll('option').map(option => option.text())).toEqual(options);
	});

	it('puts the left side select in the Match Display card, writing it as its own field', async () => {
		const wrapper = await mountSettings();

		await card(wrapper, 'Match display').get('[data-config-field="leftSidePlayer"] select').setValue('player2');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ leftSidePlayer: 'player2' });
	});

	it('binds the Screen to a Feature Match Slot and loads its state', async () => {
		const wrapper = await mountSettings();

		await card(wrapper, 'Source').get('select').setValue('5');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ featureMatchId: 5 });
		expect(mockLoadState).toHaveBeenCalledWith(1, 5);
	});

	it('keeps the Feature Match Slot card open, with no collapse control', async () => {
		const wrapper = await mountSettings();

		expect(collapseToggle(wrapper, 'Source').exists()).toBe(false);
	});

	it.each([
		{
			title: 'Player info',
			event: {},
			config: {},
			summary: 'Names · Pronouns · Deck names · Record · LGS',
		},
		{
			title: 'Player info',
			event: { lgsEnabled: false },
			config: { showPronouns: false },
			summary: 'Names · Deck names · Record',
		},
		{
			title: 'Player info',
			event: { pronounsEnabled: false, standingsEnabled: false, lgsEnabled: false },
			config: { showNames: false, showDeckNames: false },
			summary: 'Nothing shown',
		},
		{
			title: 'Match display',
			event: { tableNumberEnabled: false },
			config: { leftSidePlayer: 'player2' },
			summary: 'Clock · Seat labels · Left side of Screen: Right player',
		},
		{
			title: 'Game state',
			event: { game: 'op' },
			config: {},
			summary: 'Turn controls',
		},
		{
			title: 'Control permissions',
			event: {},
			config: { allowGameWinControls: false },
			summary: 'Life total controls · Counter controls',
		},
		{
			title: 'Control permissions',
			event: { game: 'op' },
			config: { allowGameWinControls: false },
			summary: 'None allowed',
		},
	] as { title: string; event: Partial<DbEvent>; config: Record<string, unknown>; summary: string }[])('collapses $title to "$summary"', async ({ title, event, config, summary }) => {
		mockEvent.value = createMockEvent({
			...everyFeature,
			...event,
		});
		mockConfig.value = {
			...mockConfig.value,
			...config,
		};
		const wrapper = await mountSettings();

		await collapseToggle(wrapper, title).trigger('click');

		expect(collapseToggle(wrapper, title).attributes('aria-expanded')).toBe('false');
		expect(card(wrapper, title).get('[data-settings-card-summary]').text()).toBe(summary);
	});

	it('remembers a collapsed card for the next visit', async () => {
		const first = await mountSettings();
		await collapseToggle(first, 'Game state').trigger('click');
		first.unmount();

		const next = await mountSettings();

		expect(collapseToggle(next, 'Game state').attributes('aria-expanded')).toBe('false');
		expect(collapseToggle(next, 'Player info').attributes('aria-expanded')).toBe('true');
	});
});

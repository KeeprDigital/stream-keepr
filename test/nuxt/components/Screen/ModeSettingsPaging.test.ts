import type { ScreenOutputRoundMatch } from '~~/shared/types/screenOutputReads';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ScreenModeSettings from '~/components/Screen/ModeSettings.vue';

// Every mount reads the one shared config; a mount left behind re-renders on each later test's edit.
enableAutoUnmount(afterEach);

// A paginated mode's page selection counts the pages its Screen Output renders: the rows as the
// Screen reads them, followed as the Screen follows them (Screen Mode Data Freshness), not a count
// from config. Shown on Pairings, whose rows are a Round's Matches.

const savedConfig = {
	roundId: 31,
	showHeader: true,
	headerText: undefined,
	rowsPerPage: 8,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	currentPage: 1,
};

const mockConfig = ref<Record<string, any>>({ ...savedConfig });
const mockUpdateConfig = vi.fn();
const mockSaving = ref(false);
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));

type Handler = (message: Record<string, unknown>) => void;
const channelHandlers = new Map<string, Set<Handler>>();
const continuity = createContinuitySignal();
const mockRealtime = reactive({
	connectionState: 'connected',
	tokenError: null as Error | null,
	onChannel: (channel: string, type: string, handler: Handler) => {
		const key = `${channel}|${type}`;
		if (!channelHandlers.has(key))
			channelHandlers.set(key, new Set());
		channelHandlers.get(key)!.add(handler);
		return () => channelHandlers.get(key)!.delete(handler);
	},
	onContinuityLost: continuity.onContinuityLost,
	onceAttached: vi.fn(() => () => {}),
});

/** An Event message, as the Event channel delivers it. */
function deliver(type: string, payload: Record<string, unknown>) {
	for (const handler of channelHandlers.get(`event:1|${type}`) ?? [])
		handler({ eventId: 1, ...payload });
}

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => mockRealtime);
mockNuxtImport('useServerTime', async () => (await import('~~/test/nuxt/helpers/serverTime')).fakeServerTime(() => ({
	getServerTime: () => 1_000_000,
})));
mockNuxtImport('useRoundStore', () => () => ({
	rounds: [
		{
			id: 31,
			phaseId: 3,
			name: 'Round 4',
			roundNumber: 4,
		},
		{
			id: 41,
			phaseId: 4,
			name: 'Round 1',
			roundNumber: 1,
		},
	],
	isLoaded: true,
	loadRoundsByEventId: vi.fn(),
}));
mockNuxtImport('usePhaseStore', () => () => ({
	phases: [
		{ id: 3, name: 'Swiss', sortOrder: 1 },
		{ id: 4, name: 'Top Cut', sortOrder: 2 },
	],
	isLoaded: true,
	loadPhasesByEventId: vi.fn(),
}));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: mockSaving,
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

function pairing(matchId: number): ScreenOutputRoundMatch {
	return {
		matchId,
		tableNumber: matchId,
		player1: { id: matchId * 2, name: `Player ${matchId * 2}` },
		player2: { id: matchId * 2 + 1, name: `Player ${matchId * 2 + 1}` },
		isBye: false,
		hasResult: false,
		player1GameWins: null,
		player2GameWins: null,
		gameDraws: null,
	};
}

function pairingsOf(count: number) {
	return {
		round: {
			id: 31,
			eventId: 1,
			phaseId: 3,
			name: 'Round 4',
			roundNumber: 4,
		},
		matches: Array.from({ length: count }, (_, index) => pairing(index + 1)),
	};
}

function screenOn(roundId: number | undefined) {
	return {
		id: 1,
		currentMode: 'pairings',
		themeOverrides: {},
		modeConfigs: {
			pairings: { ...savedConfig, roundId },
		},
	} as unknown as Screen;
}

async function mountSettings(roundId: number | undefined = savedConfig.roundId) {
	const wrapper = mount(ScreenModeSettings, {
		props: {
			screen: screenOn(roundId),
			eventId: 1,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				// A Look reads the page's Screen Theme Overrides, which this suite is not about.
				ScreenSettingsLook: true,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

const pageSelection = (wrapper: Awaited<ReturnType<typeof mountSettings>>) => wrapper.get('[role="group"][aria-label="Page selection"]');

describe('a paginated mode\'s page selection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockReset();
		mockConfig.value = { ...savedConfig };
		mockSaving.value = false;
		channelHandlers.clear();
	});

	it('sits in the Live card, counting pages from the rows the Screen reads', async () => {
		mockFetch.mockResolvedValue(pairingsOf(10));

		const wrapper = await mountSettings();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/pairings', expect.anything());
		expect(wrapper.get('[data-settings-card="live"]').text()).toContain('Page 1 of 2');
	});

	it('picks a Round back on page 1', async () => {
		mockFetch.mockResolvedValue(pairingsOf(1));
		const wrapper = await mountSettings();

		await wrapper.get('[data-settings-field="roundId"] select').setValue('41');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ roundId: 41, currentPage: 1 });
	});

	it.each([
		{
			selected: 'as the editor opens',
			select: async () => mountSettings(),
		},
		{
			selected: 'once none was',
			select: async () => {
				const wrapper = await mountSettings(undefined);
				await wrapper.setProps({
					screen: screenOn(31),
				});
				return wrapper;
			},
		},
	])('shows the pages counting, not "Page 1 of 1", until the Round selected $selected is read', async ({ select }) => {
		const read = deferred<ReturnType<typeof pairingsOf>>();
		mockFetch.mockReturnValue(read.promise);
		const wrapper = await select();

		expect(pageSelection(wrapper).attributes('aria-busy')).toBe('true');
		expect(pageSelection(wrapper).text()).toContain('Counting pages…');

		read.resolve(pairingsOf(10));
		await flushPromises();

		expect(pageSelection(wrapper).attributes('aria-busy')).toBe('false');
		expect(pageSelection(wrapper).text()).toContain('Page 1 of 2');
	});

	it('follows rows added after the Round was selected, as the Screen does', async () => {
		mockFetch.mockResolvedValue(pairingsOf(8));
		const wrapper = await mountSettings();
		expect(pageSelection(wrapper).text()).toContain('Page 1 of 1');

		mockFetch.mockResolvedValue(pairingsOf(17));
		deliver('match:created', {
			match: { id: 99, roundId: 31 },
		});
		await flushPromises();

		expect(pageSelection(wrapper).text()).toContain('Page 1 of 3');
	});

	it('reads the newly selected Round once the selection is saved, as the Screen does', async () => {
		mockFetch.mockResolvedValue(pairingsOf(10));
		const wrapper = await mountSettings();
		expect(pageSelection(wrapper).text()).toContain('Page 1 of 2');

		// The store shows the edit at once, but the server reads the Round it holds
		// until the save lands, so the editor waits for it.
		mockSaving.value = true;
		await wrapper.setProps({
			screen: {
				...screenOn(32),
			},
		});
		await flushPromises();
		expect(mockFetch).toHaveBeenCalledTimes(1);

		mockFetch.mockResolvedValue(pairingsOf(20));
		mockSaving.value = false;
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(pageSelection(wrapper).text()).toContain('Page 1 of 3');
	});

	it('selects no page beyond the last one the Screen renders', async () => {
		mockFetch.mockResolvedValue(pairingsOf(10));
		mockConfig.value = { ...savedConfig, currentPage: 2 };
		const wrapper = await mountSettings();

		await pageSelection(wrapper).findAll('button').find(button => button.text() === 'Next')!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ currentPage: 1 });
	});

	it('turns auto-page on in the Live card, anchoring the rotation now', async () => {
		mockFetch.mockResolvedValue(pairingsOf(10));
		const wrapper = await mountSettings();

		await wrapper.get('[data-settings-card="live"] [data-settings-field="autoPageEnabled"] [role="switch"]').trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ autoPageEnabled: true, rotationAnchor: 1_000_000 });
	});
});

import type { ScreenOutputRoundMatch } from '~~/shared/types/screenOutputReads';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';
import Settings from '~/components/Screen/Modes/Pairings/Settings.vue';

// The Pagination card's page count is the one the Screen Output renders: the Round's Matches as the
// Screen reads them, followed as the Screen follows them (Screen Mode Data Freshness), not a count…

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
mockNuxtImport('useServerTime', () => () => ({
	isSynced: ref(true),
	serverTimeOffset: ref(0),
	getServerTime: () => 1_000_000,
}));
mockNuxtImport('useRoundStore', () => () => ({
	rounds: [
		{ id: 31, name: 'Round 4' },
	],
	isLoaded: true,
	loadRoundsByEventId: vi.fn(),
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
		resultString: null,
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

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
});

async function mountSettings() {
	const wrapper = mount(Settings, {
		props: {
			screen: {
				id: 1,
				modeConfigs: { pairings: savedConfig },
			} as unknown as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				ScreenSettingsCard: { template: '<section><slot /></section>' },
				ScreenSettingsToggle: true,
				UFormField: { template: '<div><slot /></div>' },
				USelect: true,
				UInput: true,
				UInputNumber: true,
				USeparator: true,
				UButton: UButtonStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('screenModesPairingsSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch.mockReset();
		mockConfig.value = { ...savedConfig };
		mockSaving.value = false;
		channelHandlers.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('counts pages from the pairings the Screen reads for the Round', async () => {
		mockFetch.mockResolvedValue(pairingsOf(10));

		const wrapper = await mountSettings();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/pairings', expect.anything());
		expect(wrapper.text()).toContain('Page 1 of 2');
	});

	it('follows Matches added to the Round after it was selected, as the Screen does', async () => {
		mockFetch.mockResolvedValue(pairingsOf(8));
		const wrapper = await mountSettings();
		expect(wrapper.text()).toContain('Page 1 of 1');

		mockFetch.mockResolvedValue(pairingsOf(17));
		deliver('match:created', {
			match: { id: 99, roundId: 31 },
		});
		await flushPromises();

		expect(wrapper.text()).toContain('Page 1 of 3');
	});

	it('reads the newly selected Round once the selection is saved, as the Screen does', async () => {
		mockFetch.mockResolvedValue(pairingsOf(10));
		const wrapper = await mountSettings();
		expect(wrapper.text()).toContain('Page 1 of 2');

		// The store shows the edit at once, but the server reads the Round it holds
		// until the save lands, so the editor waits for it.
		mockSaving.value = true;
		await wrapper.setProps({
			screen: {
				id: 1,
				modeConfigs: {
					pairings: { ...savedConfig, roundId: 32 },
				},
			} as unknown as Screen,
		});
		await flushPromises();
		expect(mockFetch).toHaveBeenCalledTimes(1);

		mockFetch.mockResolvedValue(pairingsOf(20));
		mockSaving.value = false;
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(wrapper.text()).toContain('Page 1 of 3');
	});

	it('selects no page beyond the last one the Screen renders', async () => {
		mockFetch.mockResolvedValue(pairingsOf(10));
		mockConfig.value = { ...savedConfig, currentPage: 2 };
		const wrapper = await mountSettings();

		await wrapper.findAll('button').find(button => button.text() === 'Next')!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ currentPage: 1 });
	});
});

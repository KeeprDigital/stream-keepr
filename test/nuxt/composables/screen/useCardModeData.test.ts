import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAttachSignal, createContinuitySignal } from '~~/test/helpers/realtime-mock';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';
import { SCREEN_MODE_REREAD_MS } from '~/modules/screen-mode/freshness';

const mockCardStore = reactive({
	activeCard: null as { name: string } | null,
	setActiveScreen: vi.fn(),
	loadActiveCard: vi.fn(),
	readActiveCardAsScreenOutput: vi.fn((_read: () => Promise<unknown>) => vi.fn()),
	cardDataDegraded: false,
});
/** The Card the server holds for the Screen; `loadActiveCard` reads it, as the store does. */
let serverCard: { name: string } | null = null;
// New for each test, so none hears a channel an earlier one watched.
let continuity = createContinuitySignal();
let attachment = createAttachSignal();
const mockRealtime = reactive({
	connectionState: 'connected',
	tokenError: null as Error | null,
	onChannel: vi.fn(() => () => {}),
	onContinuityLost: (channel: string, handler: () => void) => continuity.onContinuityLost(channel, handler),
	onceAttached: (channel: string, handler: () => void) => attachment.onceAttached(channel, handler),
});
mockNuxtImport('tryUseRealtime', () => () => mockRealtime);
const mockApiFetch = vi.hoisted(() => vi.fn());
mockNuxtImport('$fetch', () => mockApiFetch);

// Reactive screen ref so we can change screenId between tests
const mockScreen = ref<{ id: number } | null>({ id: 1 });
// The health ref is optional on ScreenContext: operator-side consumers have none.
let mockCardDataHealth: Ref<'complete' | 'degraded'> | undefined;

mockNuxtImport('useCardStore', () => () => mockCardStore);
function screenContext() {
	return screenContextOf({
		screen: mockScreen,
		eventId: computed(() => 1),
		cardDataHealth: mockCardDataHealth,
	});
}
mockNuxtImport('useScreenModeConfig', () => () => computed(() => ({ featureMatchId: null })));

/** Mount a component that calls useCardModeData, return its reactive state and the wrapper */
function mountCardModeData() {
	let result: ReturnType<typeof useCardModeData>;
	const Comp = defineComponent({
		setup() {
			result = useCardModeData(screenContext());
			return () => h('div');
		},
	});
	const wrapper = mount(Comp);
	return { ...result!, wrapper };
}

// Each instance watches the shared mocked refs; unmounting it keeps it from reacting to a later test's writes.
enableAutoUnmount(afterEach);

describe('useCardModeData', () => {
	beforeEach(() => {
		mockScreen.value = { id: 1 };
		serverCard = null;
		mockCardStore.activeCard = null;
		mockCardStore.loadActiveCard.mockImplementation(async () => {
			mockCardStore.activeCard = serverCard;
			return 'landed';
		});
		mockRealtime.connectionState = 'connected';
		mockRealtime.tokenError = null;
		continuity = createContinuitySignal();
		attachment = createAttachSignal();
		mockCardStore.cardDataDegraded = false;
		mockCardDataHealth = ref('complete');
		mockApiFetch.mockResolvedValue({ id: 'card-1', name: 'Lightning Bolt' });
	});

	it('calls setActiveScreen and loadActiveCard on mount', async () => {
		mountCardModeData();
		await flushPromises();

		expect(mockCardStore.setActiveScreen).toHaveBeenCalledWith(1);
		expect(mockCardStore.loadActiveCard).toHaveBeenCalled();
	});

	it('reads the Screen\'s Card through the Screen, not the operator\'s Card path (#604)', async () => {
		mountCardModeData();
		await flushPromises();

		const read = mockCardStore.readActiveCardAsScreenOutput.mock.calls[0]?.[0] as () => Promise<unknown>;
		await expect(read()).resolves.toMatchObject({ name: 'Lightning Bolt' });
		expect(mockApiFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/card', expect.anything());
		expect(mockApiFetch.mock.calls.every(([, options]) => !(options as { method?: string } | undefined)?.method)).toBe(true);
	});

	it('sets loading=false after successful card load', async () => {
		const { loading } = mountCardModeData();
		await flushPromises();

		expect(loading.value).toBe(false);
	});

	// ── Card data health reporting (#471) ──

	it('reports deck-source card data health through the screen context', async () => {
		mountCardModeData();
		await flushPromises();

		mockCardStore.cardDataDegraded = true;
		await nextTick();
		expect(mockCardDataHealth!.value).toBe('degraded');

		// Recovery reports itself the same way.
		mockCardStore.cardDataDegraded = false;
		await nextTick();
		expect(mockCardDataHealth!.value).toBe('complete');
	});

	it('settles the health report when the mode is left while degraded', async () => {
		const { wrapper } = mountCardModeData();
		await flushPromises();

		mockCardStore.cardDataDegraded = true;
		await nextTick();
		expect(mockCardDataHealth!.value).toBe('degraded');

		// A degraded report must not outlive the rendering that measured it.
		wrapper.unmount();
		expect(mockCardDataHealth!.value).toBe('complete');
	});

	it('still loads when the context provides no cardDataHealth ref', async () => {
		mockCardDataHealth = undefined;
		mountCardModeData();
		await flushPromises();

		expect(mockCardStore.loadActiveCard).toHaveBeenCalled();

		mockCardStore.cardDataDegraded = true;
		await nextTick();
	});

	it('reloads when screenId changes', async () => {
		mountCardModeData();
		await flushPromises();

		mockCardStore.loadActiveCard.mockResolvedValue(null);

		mockScreen.value = { id: 99 };
		await flushPromises();

		expect(mockCardStore.setActiveScreen).toHaveBeenCalledWith(99);
	});

	// ── Reconnect Resync (#610) ──

	describe('a Card changed while this output was disconnected', () => {
		async function onAirThenDisconnected() {
			serverCard = { name: 'Lightning Bolt' };
			mountCardModeData();
			await flushPromises();
			expect(mockCardStore.activeCard).toEqual({ name: 'Lightning Bolt' });
			mockCardStore.setActiveScreen.mockClear();
			mockRealtime.connectionState = 'disconnected';
			await flushPromises();
		}

		it('shows the change once its channel is attached again, without leaving its Screen', async () => {
			await onAirThenDisconnected();
			serverCard = { name: 'Counterspell' };

			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
			await flushPromises();

			expect(mockCardStore.activeCard).toEqual({ name: 'Counterspell' });
			// Selecting the Screen again would blank program before the read answers.
			expect(mockCardStore.setActiveScreen).not.toHaveBeenCalled();
		});

		it('holds the Card on air while disconnected', async () => {
			await onAirThenDisconnected();
			serverCard = null;
			await flushPromises();

			expect(mockCardStore.activeCard).toEqual({ name: 'Lightning Bolt' });
		});

		it('re-reads again after its resync read failed, keeping the Card on air meanwhile (#726)', async () => {
			await onAirThenDisconnected();
			vi.useFakeTimers();
			try {
				serverCard = { name: 'Counterspell' };
				let reachable = false;
				mockCardStore.loadActiveCard.mockImplementation(async () => {
					if (!reachable)
						return 'failed';
					mockCardStore.activeCard = serverCard;
					return 'landed';
				});

				mockRealtime.connectionState = 'connected';
				continuity.reattach('event:1');
				await vi.advanceTimersByTimeAsync(0);
				expect(mockCardStore.activeCard).toEqual({ name: 'Lightning Bolt' });

				reachable = true;
				await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
				expect(mockCardStore.activeCard).toEqual({ name: 'Counterspell' });
			}
			finally {
				vi.useRealTimers();
			}
		});
	});

	it('shows no error on program for a read something newer superseded', async () => {
		mockCardStore.loadActiveCard.mockResolvedValueOnce('superseded');

		const { error } = mountCardModeData();
		await flushPromises();

		expect(error.value).toBeNull();
	});
});

import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCardStore = reactive({
	setActiveScreen: vi.fn(),
	loadActiveCard: vi.fn(),
	cardDataDegraded: false,
});

// Reactive screen ref so we can change screenId between tests
const mockScreen = ref<{ id: number } | null>({ id: 1 });
// The health ref is optional on ScreenContext: operator-side consumers have none.
let mockCardDataHealth: Ref<'complete' | 'degraded'> | undefined;

mockNuxtImport('useCardStore', () => () => mockCardStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: mockScreen,
	eventId: computed(() => 1),
	interactive: ref(false),
	cardDataHealth: mockCardDataHealth,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => ({ featureMatchId: null })));

/** Mount a component that calls useCardModeData, return its reactive state and the wrapper */
function mountCardModeData() {
	let result: ReturnType<typeof useCardModeData>;
	const Comp = defineComponent({
		setup() {
			result = useCardModeData();
			return () => h('div');
		},
	});
	const wrapper = mount(Comp);
	return { ...result!, wrapper };
}

describe('useCardModeData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockScreen.value = { id: 1 };
		mockCardStore.loadActiveCard.mockResolvedValue(null);
		mockCardStore.cardDataDegraded = false;
		mockCardDataHealth = ref('complete');
	});

	it('returns config, displayConfig, screenId, loading, and error', () => {
		const result = useCardModeData();
		expect(result).toHaveProperty('config');
		expect(result).toHaveProperty('displayConfig');
		expect(result).toHaveProperty('screenId');
		expect(result).toHaveProperty('loading');
		expect(result).toHaveProperty('error');
	});

	it('sets screenId from screen context', () => {
		const { screenId } = useCardModeData();
		expect(screenId.value).toBe(1);
	});

	// ── loadCard (via onMounted) ──

	it('calls setActiveScreen and loadActiveCard on mount', async () => {
		mountCardModeData();
		await flushPromises();

		expect(mockCardStore.setActiveScreen).toHaveBeenCalledWith(1);
		expect(mockCardStore.loadActiveCard).toHaveBeenCalled();
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

		vi.clearAllMocks();
		mockCardStore.loadActiveCard.mockResolvedValue(null);

		mockScreen.value = { id: 99 };
		await flushPromises();

		expect(mockCardStore.setActiveScreen).toHaveBeenCalledWith(99);
	});
});

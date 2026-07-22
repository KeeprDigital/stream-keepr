import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCardStore = {
	setActiveScreen: vi.fn(),
	loadActiveCard: vi.fn(),
};

// Reactive screen ref so we can change screenId between tests
const mockScreen = ref<{ id: number } | null>({ id: 1 });

mockNuxtImport('useCardStore', () => () => mockCardStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: mockScreen,
	eventId: computed(() => 1),
	interactive: ref(false),
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => ({ featureMatchId: null })));

/** Mount a component that calls useCardModeData, return its reactive state */
function mountCardModeData() {
	let result: ReturnType<typeof useCardModeData>;
	const Comp = defineComponent({
		setup() {
			result = useCardModeData();
			return () => h('div');
		},
	});
	mount(Comp);
	return result!;
}

describe('useCardModeData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockScreen.value = { id: 1 };
		mockCardStore.loadActiveCard.mockResolvedValue(null);
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

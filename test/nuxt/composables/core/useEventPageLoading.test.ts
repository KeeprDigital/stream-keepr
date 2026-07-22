import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

const mockEventStore = reactive({
	eventId: 1 as number | null,
	event: { id: 1 },
	loadEvent: vi.fn(),
	$reset: vi.fn(),
});
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePlayerStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useArchetypeStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useMetagameStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('usePlayerListStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('usePhaseStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useRoundStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useMatchStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useFeatureMatchStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useScreenStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useCardStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('useMeleeStore', () => () => ({ $reset: vi.fn() }));
mockNuxtImport('clearPlayerDeckCache', () => () => {});

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
}

describe('useEventPageLoading', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.eventId = 1;
		mockEventStore.event = { id: 1 };
	});

	it('returns eventId computed from the event store', () => {
		const { eventId } = useEventPageLoading([]);
		expect(eventId.value).toBe(1);
	});

	it('returns eventId as 0 when store has no eventId', () => {
		mockEventStore.eventId = null;
		const { eventId } = useEventPageLoading([]);
		expect(eventId.value).toBe(0);
	});

	it('returns initialLoading true when some entries are not loaded', () => {
		const entries = [
			{ isLoaded: () => false, load: vi.fn() },
			{ isLoaded: () => true, load: vi.fn() },
		];
		const { initialLoading } = useEventPageLoading(entries);
		expect(initialLoading.value).toBe(true);
	});

	it('returns initialLoading false when all entries are loaded and no load is running', async () => {
		const entries = [
			{ isLoaded: () => true, load: vi.fn() },
			{ isLoaded: () => true, load: vi.fn() },
		];
		const { initialLoading } = useEventPageLoading(entries);
		await flushPromises();
		expect(initialLoading.value).toBe(false);
	});

	it('calls afterLoad after entries finish loading', async () => {
		const afterLoad = vi.fn().mockResolvedValue(undefined);
		const load = vi.fn().mockResolvedValue(undefined);

		useEventPageLoading([{ isLoaded: () => false, load }], afterLoad);
		await flushPromises();

		expect(load).toHaveBeenCalledWith(1);
		expect(afterLoad).toHaveBeenCalledWith(1);
	});

	it('reloads when the event id changes on the same mounted page', async () => {
		const load = vi.fn().mockResolvedValue(undefined);
		let loadedEventId: number | null = null;
		const isLoaded = vi.fn(() => loadedEventId === mockEventStore.eventId);
		load.mockImplementation(async (id: number) => {
			loadedEventId = id;
		});

		useEventPageLoading([{ isLoaded, load }]);
		await flushPromises();

		mockEventStore.eventId = 2;
		await flushPromises();

		expect(load).toHaveBeenNthCalledWith(1, 1);
		expect(load).toHaveBeenNthCalledWith(2, 2);
	});

	it('keeps initialLoading true while afterLoad is still running', async () => {
		let resolveAfterLoad: (() => void) | null = null;
		const afterLoad = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
			resolveAfterLoad = resolve;
		}));

		const { initialLoading } = useEventPageLoading([
			{ isLoaded: () => true, load: vi.fn() },
		], afterLoad);
		await flushPromises();

		expect(initialLoading.value).toBe(true);

		expect(resolveAfterLoad).toBeTypeOf('function');
		const finishAfterLoad = resolveAfterLoad as unknown as () => void;
		finishAfterLoad();
		await flushPromises();

		expect(initialLoading.value).toBe(false);
	});

	it('exposes a retryable error instead of staying on the loading state', async () => {
		let loaded = false;
		const load = vi.fn()
			.mockResolvedValueOnce(null)
			.mockImplementationOnce(async () => {
				loaded = true;
				return [];
			});

		const { initialLoading, initialError, retry } = useEventPageLoading([
			{ isLoaded: () => loaded, load },
		]);
		await flushPromises();

		expect(initialError.value).toBe('Unable to load this page');
		expect(initialLoading.value).toBe(false);

		await retry();
		expect(load).toHaveBeenCalledTimes(2);
		expect(initialError.value).toBeNull();
		expect(initialLoading.value).toBe(false);
	});

	it('does not let an old Event load replace the state of a newer Event', async () => {
		let resolveFirst!: () => void;
		const first = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		const afterLoad = vi.fn();
		const load = vi.fn()
			.mockReturnValueOnce(first)
			.mockResolvedValueOnce([]);

		const { initialError } = useEventPageLoading([{ isLoaded: () => false, load }], afterLoad);
		await flushPromises();
		mockEventStore.eventId = 2;
		await flushPromises();
		resolveFirst();
		await flushPromises();

		expect(afterLoad).toHaveBeenCalledTimes(1);
		expect(afterLoad).toHaveBeenCalledWith(2);
		expect(initialError.value).toBeNull();
	});
});

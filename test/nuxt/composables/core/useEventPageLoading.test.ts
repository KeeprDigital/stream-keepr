import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive } from 'vue';
import { eventDataResync } from '~/modules/event-data/resync';

const mockEventStore = reactive({
	eventId: 1 as number | null,
	event: { id: 1 },
	loadEvent: vi.fn(),
	$reset: vi.fn(),
});
mockNuxtImport('useEventStore', () => () => mockEventStore);
const mockPlayerStore = reactive({
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
	$reset: vi.fn(),
});
const mockRoundStore = reactive({
	isLoaded: true,
	loadRoundsByEventId: vi.fn(),
	$reset: vi.fn(),
});
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useArchetypeStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('useMetagameStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('usePlayerListStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('usePhaseStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useMatchStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('useScreenStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('useCardStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('useMeleeStore', () => () => ({
	$reset: vi.fn(),
}));
mockNuxtImport('clearPlayerDeckCache', () => () => {});

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
}

/** Each page under test is mounted in its own scope, so what it consumes ends with the test. */
let pageScope = effectScope();
function usePage(...args: Parameters<typeof useEventPageLoading>) {
	return pageScope.run(() => useEventPageLoading(...args))!;
}

describe('useEventPageLoading', () => {
	beforeEach(() => {
		pageScope = effectScope();
		vi.clearAllMocks();
		mockEventStore.eventId = 1;
		mockEventStore.event = { id: 1 };
	});

	afterEach(() => {
		pageScope.stop();
		eventDataResync.reset();
	});

	it('returns initialLoading true when some entries are not loaded', () => {
		const entries = [
			{
				consumes: 'players' as const,
				isLoaded: () => false,
				load: vi.fn(),
			},
			{
				consumes: 'rounds' as const,
				isLoaded: () => true,
				load: vi.fn(),
			},
		];
		const { initialLoading } = usePage(entries);
		expect(initialLoading.value).toBe(true);
	});

	it('returns initialLoading false when all entries are loaded and no load is running', async () => {
		const entries = [
			{
				consumes: 'rounds' as const,
				isLoaded: () => true,
				load: vi.fn(),
			},
			{
				consumes: 'rounds' as const,
				isLoaded: () => true,
				load: vi.fn(),
			},
		];
		const { initialLoading } = usePage(entries);
		await flushPromises();
		expect(initialLoading.value).toBe(false);
	});

	it('calls afterLoad after entries finish loading', async () => {
		const afterLoad = vi.fn().mockResolvedValue(undefined);
		const load = vi.fn().mockResolvedValue(undefined);

		usePage([
			{
				consumes: 'players',
				isLoaded: () => false,
				load,
			},
		], afterLoad);
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

		usePage([
			{ consumes: 'players', isLoaded, load },
		]);
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

		const { initialLoading } = usePage([
			{
				consumes: 'rounds' as const,
				isLoaded: () => true,
				load: vi.fn(),
			},
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

		const { initialLoading, initialError, retry } = usePage([
			{
				consumes: 'players',
				isLoaded: () => loaded,
				load,
			},
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

		const { initialError } = usePage([
			{
				consumes: 'players',
				isLoaded: () => false,
				load,
			},
		], afterLoad);
		await flushPromises();
		mockEventStore.eventId = 2;
		await flushPromises();
		resolveFirst();
		await flushPromises();

		expect(afterLoad).toHaveBeenCalledTimes(1);
		expect(afterLoad).toHaveBeenCalledWith(2);
		expect(initialError.value).toBeNull();
	});

	it('re-reads the collections a mounted page consumes on Reconnect Resync, and stops once it is gone (#610)', async () => {
		usePage([
			{
				consumes: 'players',
				isLoaded: () => true,
				load: vi.fn(),
			},
			{
				consumes: 'rounds',
				isLoaded: () => true,
				load: vi.fn(),
			},
		]);
		await flushPromises();

		await eventDataResync.resync();
		expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
		expect(mockRoundStore.loadRoundsByEventId).toHaveBeenCalledWith(1);

		vi.clearAllMocks();
		pageScope.stop();
		await eventDataResync.resync();
		expect(mockPlayerStore.loadPlayersByEventId).not.toHaveBeenCalled();
	});

	it('re-reads what a revisited page finds loaded when it was missed meanwhile (#610)', async () => {
		await eventDataResync.resync();
		vi.clearAllMocks();

		usePage([
			{
				consumes: 'players',
				isLoaded: () => true,
				load: vi.fn(),
			},
		]);
		await flushPromises();

		expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
	});
});

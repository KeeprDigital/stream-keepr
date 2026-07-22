import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

// ── Mock Dependencies ──

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	getBySlug: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	updateModeConfig: vi.fn(),
	updateScreenConfig: vi.fn(),
	remove: vi.fn(),
};

const mockAbly = createMockRealtime();
const mockIsSelfOrigin = vi.fn(() => false);
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
	ablyCallbacks[storeName] = callbacks;
});

// executeAction that supports onError rollback
const mockExecuteAction = vi.fn(async (fn: any, opts?: any) => {
	try {
		return await fn();
	}
	catch (err) {
		opts?.onError?.(err);
		throw err;
	}
});

mockNuxtImport('useScreenRepository', () => () => mockRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);
mockNuxtImport('useAsyncAction', () => () => ({
	executeAction: mockExecuteAction,
}));
mockNuxtImport('$fetch', () => mockFetch);

describe('useScreenStore', () => {
	let store: ReturnType<typeof useScreenStore>;

	beforeEach(() => {
		store = useScreenStore();
		store.$reset();
		vi.clearAllMocks();
		mockFetch.mockResolvedValue({ ok: true });
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
		ablyCallbacks.screen = {
			'screen:created': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteCreated(data as any),
			'screen:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'screen:deleted': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteDeleted(data as any),
		};
	});

	// ── Loading ──

	describe('loadScreensByEventId', () => {
		it('populates screens state', async () => {
			const screens = [
				createMockScreen({ id: 1, name: 'Screen 1' }),
				createMockScreen({ id: 2, name: 'Screen 2' }),
			];
			mockRepo.list.mockResolvedValue(screens);

			await store.loadScreensByEventId(1);

			expect(store.screens).toEqual(screens);
			expect(store.isLoaded).toBe(true);
			expect(store.currentEventId).toBe(1);
		});
	});

	describe('loadScreenBySlug', () => {
		it('sets activeScreen', async () => {
			const screen = createMockScreen({ id: 1, slug: 'my-screen' });
			mockRepo.getBySlug.mockResolvedValue(screen);

			await store.loadScreenBySlug(1, 'my-screen');

			expect(store.activeScreen).toEqual(screen);
		});

		it('clears the previous active screen and rejects when the slug does not exist', async () => {
			store.activeScreen = createMockScreen({ id: 9, slug: 'old-screen' });
			mockRepo.getBySlug.mockResolvedValue(null);

			await expect(store.loadScreenBySlug(1, 'missing')).rejects.toThrow('Screen not found');

			expect(store.activeScreen).toBeNull();
		});

		it('keeps the latest slug when requests resolve out of order', async () => {
			let resolveOld!: (value: ReturnType<typeof createMockScreen>) => void;
			let resolveNew!: (value: ReturnType<typeof createMockScreen>) => void;
			mockRepo.getBySlug
				.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
				.mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve; }));

			const oldLoad = store.loadScreenBySlug(1, 'old');
			const newLoad = store.loadScreenBySlug(1, 'new');
			const latest = createMockScreen({ id: 2, slug: 'new' });
			resolveNew(latest);
			await newLoad;
			resolveOld(createMockScreen({ id: 1, slug: 'old' }));
			await oldLoad;

			expect(store.activeScreen).toEqual(latest);
		});
	});

	describe('getScreenById', () => {
		it('adds screen to screens array if not present', async () => {
			const screen = createMockScreen({ id: 5 });
			mockRepo.getById.mockResolvedValue(screen);
			store.screens = [];

			await store.getScreenById(1, 5);

			expect(store.screens).toContainEqual(screen);
		});

		it('updates existing screen in array', async () => {
			const existing = createMockScreen({ id: 5, name: 'Old' });
			store.screens = [existing];
			const updated = createMockScreen({ id: 5, name: 'Fresh' });
			mockRepo.getById.mockResolvedValue(updated);

			await store.getScreenById(1, 5);

			expect(store.screens[0]!.name).toBe('Fresh');
		});

		it('sets currentEventId', async () => {
			mockRepo.getById.mockResolvedValue(createMockScreen({ id: 5 }));

			await store.getScreenById(42, 5);

			expect(store.currentEventId).toBe(42);
		});
	});

	// ── Create ──

	describe('createScreen', () => {
		it('adds screen to state', async () => {
			const created = createMockScreen({ id: 3, name: 'New Screen' });
			mockRepo.create.mockResolvedValue(created);

			await store.createScreen(1, { name: 'New Screen', slug: 'new-screen', currentMode: 'idle' });

			expect(store.screens).toContainEqual(created);
		});

		it('returns created screen', async () => {
			const created = createMockScreen({ id: 3 });
			mockRepo.create.mockResolvedValue(created);

			const result = await store.createScreen(1, { name: 'Screen', slug: 's', currentMode: 'idle' });

			expect(result).toEqual(created);
		});
	});

	// ── Update (optimistic) ──

	describe('updateScreen', () => {
		it('optimistically updates then applies server response', async () => {
			const screen = createMockScreen({ id: 1, name: 'Old' });
			store.screens = [screen];

			const serverUpdated = { ...screen, name: 'Server Updated' };
			mockRepo.update.mockResolvedValue(serverUpdated);

			await store.updateScreen(1, 1, { name: 'Updated' });

			expect(store.screens[0]!.name).toBe('Server Updated');
		});

		it('also updates activeScreen if matching', async () => {
			const screen = createMockScreen({ id: 1, name: 'Old' });
			store.screens = [screen];
			store.activeScreen = screen;
			const serverUpdated = { ...screen, name: 'Server Updated' };
			mockRepo.update.mockResolvedValue(serverUpdated);

			await store.updateScreen(1, 1, { name: 'Updated' });

			expect(store.activeScreen!.name).toBe('Server Updated');
		});

		it('sends stateVersion with update request', async () => {
			const screen = createMockScreen({ id: 1, stateVersion: 5 });
			store.screens = [screen];
			mockRepo.update.mockResolvedValue(screen);

			await store.updateScreen(1, 1, { name: 'Updated' });

			expect(mockRepo.update).toHaveBeenCalledWith(1, 1, expect.objectContaining({ stateVersion: 5 }));
		});
	});

	// ── setScreenMode ──

	describe('setScreenMode', () => {
		it('delegates to updateScreen with currentMode', async () => {
			const screen = createMockScreen({ id: 1, currentMode: 'idle' });
			store.screens = [screen];
			const updated = { ...screen, currentMode: 'card' as const };
			mockRepo.update.mockResolvedValue(updated);

			await store.setScreenMode(1, 1, 'card');

			expect(mockRepo.update).toHaveBeenCalledWith(1, 1, expect.objectContaining({ currentMode: 'card' }));
		});
	});

	// ── updateModeConfig (optimistic merge + null-stripping) ──
});

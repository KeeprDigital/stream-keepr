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

describe('useScreenStore config and realtime', () => {
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

	describe('updateModeConfig', () => {
		it('optimistically merges config and strips nulls', async () => {
			const screen = createMockScreen({
				id: 1,
				modeConfigs: { card: { featureMatchId: 1, scale: 1.5 } },
			});
			store.screens = [screen];

			const updated = createMockScreen({
				id: 1,
				modeConfigs: { card: { featureMatchId: 1, scale: 2.0 } },
			});
			mockRepo.updateModeConfig.mockResolvedValue(updated);

			await store.updateModeConfig(1, 1, 'card', { scale: 2.0 });

			expect(store.screens[0]!.modeConfigs).toEqual(updated.modeConfigs);
		});

		it('strips null values from optimistic config', async () => {
			const screen = createMockScreen({
				id: 1,
				modeConfigs: { card: { featureMatchId: 1, scale: 1.5 } },
			});
			store.screens = [screen];

			// During optimistic update, the merged config should not contain null keys
			const updated = createMockScreen({ id: 1, modeConfigs: { card: { scale: 1.5 } } });
			mockRepo.updateModeConfig.mockResolvedValue(updated);

			await store.updateModeConfig(1, 1, 'card', { featureMatchId: null as any });

			// Server response prevails
			expect(store.screens[0]!.modeConfigs).toEqual({ card: { scale: 1.5 } });
		});

		it('updates activeScreen if matching', async () => {
			const screen = createMockScreen({ id: 1, modeConfigs: {} });
			store.screens = [screen];
			store.activeScreen = screen;
			const updated = createMockScreen({ id: 1, modeConfigs: { idle: {} } });
			mockRepo.updateModeConfig.mockResolvedValue(updated);

			await store.updateModeConfig(1, 1, 'idle', {});

			expect(store.activeScreen).toEqual(updated);
		});

		it('batches rapid mode config patches into one write per mode', async () => {
			vi.useFakeTimers();
			const screen = createMockScreen({ id: 1, modeConfigs: { card: { scale: 1 } }, stateVersion: 2 });
			store.screens = [screen];
			const updated = createMockScreen({ id: 1, modeConfigs: { card: { scale: 2, animationEnabled: false } }, stateVersion: 3 });
			mockRepo.updateModeConfig.mockResolvedValue(updated);

			const first = store.updateModeConfig(1, 1, 'card', { scale: 2 });
			const second = store.updateModeConfig(1, 1, 'card', { animationEnabled: false });
			expect(store.screens[0]!.modeConfigs).toEqual({ card: { scale: 2, animationEnabled: false } });
			expect(mockRepo.updateModeConfig).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(300);
			await Promise.all([first, second]);

			expect(mockRepo.updateModeConfig).toHaveBeenCalledOnce();
			expect(mockRepo.updateModeConfig).toHaveBeenCalledWith(1, 1, 'card', { scale: 2, animationEnabled: false }, 2);
			vi.useRealTimers();
		});

		it('uses default config for mode when no existing config', async () => {
			const screen = createMockScreen({ id: 1, modeConfigs: null });
			store.screens = [screen];
			const updated = createMockScreen({ id: 1, modeConfigs: { idle: {} } });
			mockRepo.updateModeConfig.mockResolvedValue(updated);

			await store.updateModeConfig(1, 1, 'idle', {});

			expect(mockRepo.updateModeConfig).toHaveBeenCalledWith(1, 1, 'idle', {}, screen.stateVersion);
		});
	});

	// ── updateScreenConfig (optimistic merge + null-stripping) ──

	describe('updateScreenConfig', () => {
		it('optimistically merges screen config', async () => {
			const screen = createMockScreen({
				id: 1,
				screenConfig: { background: '#000' },
			});
			store.screens = [screen];

			const updated = createMockScreen({
				id: 1,
				screenConfig: { background: '#000', width: 1920 },
			});
			mockRepo.updateScreenConfig.mockResolvedValue(updated);

			await store.updateScreenConfig(1, 1, { width: 1920 });

			expect(store.screens[0]).toEqual(updated);
		});

		it('rejects a failed save and rolls back the optimistic config', async () => {
			const screen = createMockScreen({ id: 1, screenConfig: { background: '#000' }, stateVersion: 2 });
			store.screens = [screen];
			mockRepo.updateScreenConfig.mockRejectedValue(new Error('Save failed'));

			await expect(store.updateScreenConfig(1, 1, { width: 1920 })).rejects.toThrow('Save failed');

			expect(store.screens[0]).toEqual(screen);
		});

		it('batches rapid screen config patches into one write', async () => {
			vi.useFakeTimers();
			const screen = createMockScreen({ id: 1, screenConfig: { background: '#000' }, stateVersion: 2 });
			store.screens = [screen];
			const updated = createMockScreen({ id: 1, screenConfig: { background: '#fff', width: 1920 }, stateVersion: 3 });
			mockRepo.updateScreenConfig.mockResolvedValue(updated);

			const first = store.updateScreenConfig(1, 1, { width: 1920 });
			const second = store.updateScreenConfig(1, 1, { background: '#fff' });
			expect(store.screens[0]!.screenConfig).toEqual({ background: '#fff', width: 1920 });
			expect(mockRepo.updateScreenConfig).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(300);
			await Promise.all([first, second]);

			expect(mockRepo.updateScreenConfig).toHaveBeenCalledOnce();
			expect(mockRepo.updateScreenConfig).toHaveBeenCalledWith(1, 1, { width: 1920, background: '#fff' }, 2);
			vi.useRealTimers();
		});

		it('cancels pending writes when the store resets for another Event', async () => {
			vi.useFakeTimers();
			const screen = createMockScreen({ id: 1, screenConfig: {}, stateVersion: 2 });
			store.screens = [screen];

			const write = store.updateScreenConfig(1, 1, { width: 1920 });
			store.$reset();
			await expect(write).rejects.toThrow('Event scope changed');
			await vi.advanceTimersByTimeAsync(1000);

			expect(mockRepo.updateScreenConfig).not.toHaveBeenCalled();
			vi.useRealTimers();
		});

		it('strips null values from optimistic config', async () => {
			const screen = createMockScreen({
				id: 1,
				screenConfig: { background: '#000', width: 1920 },
			});
			store.screens = [screen];

			const updated = createMockScreen({ id: 1, screenConfig: { width: 1920 } });
			mockRepo.updateScreenConfig.mockResolvedValue(updated);

			await store.updateScreenConfig(1, 1, { background: null });

			expect(store.screens[0]!.screenConfig).toEqual({ width: 1920 });
		});

		it('updates activeScreen if matching', async () => {
			const screen = createMockScreen({ id: 1, screenConfig: {} });
			store.screens = [screen];
			store.activeScreen = screen;
			const updated = createMockScreen({ id: 1, screenConfig: { width: 1920 } });
			mockRepo.updateScreenConfig.mockResolvedValue(updated);

			await store.updateScreenConfig(1, 1, { width: 1920 });

			expect(store.activeScreen).toEqual(updated);
		});

		it('refreshes and retries once when a batched screen config write conflicts', async () => {
			const stale = createMockScreen({ id: 1, screenConfig: {}, stateVersion: 2 });
			const fresh = createMockScreen({ id: 1, screenConfig: { height: 1080 }, stateVersion: 3 });
			const updated = createMockScreen({ id: 1, screenConfig: { height: 1080, width: 1920 }, stateVersion: 4 });
			store.screens = [stale];
			mockRepo.updateScreenConfig
				.mockRejectedValueOnce({ statusCode: 409 })
				.mockResolvedValueOnce(updated);
			mockRepo.getById.mockResolvedValue(fresh);

			await store.updateScreenConfig(1, 1, { width: 1920 });

			expect(mockRepo.getById).toHaveBeenCalledWith(1, 1);
			expect(mockRepo.updateScreenConfig).toHaveBeenNthCalledWith(1, 1, 1, { width: 1920 }, 2);
			expect(mockRepo.updateScreenConfig).toHaveBeenNthCalledWith(2, 1, 1, { width: 1920 }, 3);
			expect(store.screens[0]).toEqual(updated);
		});
	});

	// ── Remove (optimistic) ──

	describe('removeScreen', () => {
		it('removes screen from state', async () => {
			const screen = createMockScreen({ id: 1 });
			store.screens = [screen];
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removeScreen(1, 1);

			expect(store.screens).toHaveLength(0);
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		/*
		 * A Screen change arrives as a notification naming the Screen, never as the
		 * Screen — its mode configuration is far larger than one realtime message may
		 * carry (#95). So every assertion below is about *catching up from the API*,
		 * which is what these handlers now do.
		 */
		describe('screen:created', () => {
			it('loads the announced Screen from the API', async () => {
				store.screens = [];
				store.currentEventId = 1;
				mockRepo.getById.mockResolvedValue(createMockScreen({ id: 10, name: 'Remote' }));

				await ablyCallbacks.screen!['screen:created']!({ eventId: 1, screenId: 10 });

				expect(mockRepo.getById).toHaveBeenCalledWith(1, 10);
				expect(store.screens).toHaveLength(1);
				expect(store.screens[0]!.name).toBe('Remote');
			});

			it('caches the loaded Screen once, so an already-known Screen is not duplicated', async () => {
				store.screens = [createMockScreen({ id: 10 })];
				store.currentEventId = 1;
				mockRepo.getById.mockResolvedValue(createMockScreen({ id: 10, name: 'Remote' }));

				await ablyCallbacks.screen!['screen:created']!({ eventId: 1, screenId: 10 });

				expect(store.screens).toHaveLength(1);
			});

			it('skips when isSelfOrigin returns true', async () => {
				mockIsSelfOrigin.mockReturnValueOnce(true);
				store.screens = [];
				store.currentEventId = 1;

				await ablyCallbacks.screen!['screen:created']!({ eventId: 1, screenId: 10 });

				expect(mockRepo.getById).not.toHaveBeenCalled();
				expect(store.screens).toHaveLength(0);
			});

			it('does not load a Screen for a client that holds no Screen collection', async () => {
				// A Screen Output loads one Screen by slug and never sets `currentEventId`.
				// It has no list to add to, so a Screen created mid-show is not its work.
				store.screens = [];
				store.currentEventId = null;

				await ablyCallbacks.screen!['screen:created']!({ eventId: 1, screenId: 10 });

				expect(mockRepo.getById).not.toHaveBeenCalled();
			});
		});

		describe('screen:updated', () => {
			it('reloads the announced Screen from the API', async () => {
				store.screens = [createMockScreen({ id: 10, name: 'Old' })];
				mockRepo.getById.mockResolvedValue(createMockScreen({ id: 10, name: 'New' }));

				await ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });

				expect(mockRepo.getById).toHaveBeenCalledWith(1, 10);
				expect(store.screens[0]!.name).toBe('New');
			});

			it('also updates activeScreen if matching', async () => {
				const screen = createMockScreen({ id: 10, name: 'Old' });
				store.screens = [screen];
				store.activeScreen = screen;
				mockRepo.getById.mockResolvedValue(createMockScreen({ id: 10, name: 'New' }));

				await ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });

				expect(store.activeScreen!.name).toBe('New');
			});

			it('catches up a Screen Output, which holds its Screen without holding the collection', async () => {
				const screen = createMockScreen({ id: 10, name: 'Old' });
				store.activeScreen = screen;
				store.currentEventId = null;
				mockRepo.getById.mockResolvedValue(createMockScreen({ id: 10, name: 'New' }));

				await ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });

				expect(store.activeScreen!.name).toBe('New');
			});

			it('ignores a Screen this client neither holds nor collects', async () => {
				store.screens = [createMockScreen({ id: 10 })];
				store.currentEventId = null;

				await ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 99 });

				expect(mockRepo.getById).not.toHaveBeenCalled();
			});

			it('skips when isSelfOrigin returns true', async () => {
				store.screens = [createMockScreen({ id: 10, name: 'Old' })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				await ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });

				expect(mockRepo.getById).not.toHaveBeenCalled();
				expect(store.screens[0]!.name).toBe('Old');
			});

			it('keeps the latest answer when two changes are announced in quick succession', async () => {
				// Two loads for one Screen race; the earlier answer must not land last.
				store.screens = [createMockScreen({ id: 10, name: 'Old' })];
				let releaseFirst: (screen: unknown) => void = () => {};
				mockRepo.getById
					.mockReturnValueOnce(new Promise((resolve) => {
						releaseFirst = resolve;
					}))
					.mockResolvedValueOnce(createMockScreen({ id: 10, name: 'Second' }));

				const first = ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });
				await ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });
				releaseFirst(createMockScreen({ id: 10, name: 'First' }));
				await first;

				expect(store.screens[0]!.name).toBe('Second');
			});

			it('leaves the cached Screen alone when the reload fails', async () => {
				store.screens = [createMockScreen({ id: 10, name: 'Old' })];
				mockRepo.getById.mockRejectedValue(new Error('offline'));

				await ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });

				expect(store.screens[0]!.name).toBe('Old');
				expect(store.error).toBeNull();
			});
		});

		describe('screen:deleted', () => {
			it('removes screen from remote message', () => {
				store.screens = [createMockScreen({ id: 10 })];

				ablyCallbacks.screen!['screen:deleted']!({ screenId: 10 });

				expect(store.screens).toHaveLength(0);
			});

			it('clears activeScreen if matching', () => {
				const screen = createMockScreen({ id: 10 });
				store.screens = [screen];
				store.activeScreen = screen;

				ablyCallbacks.screen!['screen:deleted']!({ screenId: 10 });

				expect(store.activeScreen).toBeNull();
			});

			it('skips when isSelfOrigin returns true', () => {
				store.screens = [createMockScreen({ id: 10 })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.screen!['screen:deleted']!({ screenId: 10 });

				expect(store.screens).toHaveLength(1);
			});
		});
	});

	// ── Presence ──

	describe('presence', () => {
		describe('getConnectedCount', () => {
			it('returns 0 when no presence data', () => {
				expect(store.getConnectedCount(1)).toBe(0);
			});

			it('returns count from screenPresence map', () => {
				store.screenPresence = new Map([[1, { count: 3, members: [] }]]);

				expect(store.getConnectedCount(1)).toBe(3);
			});
		});

		describe('subscribeToScreenPresence', () => {
			it('subscribes to screen presence channel', () => {
				store.currentEventId = 1;

				store.subscribeToScreenPresence(10);

				expect(mockAbly.watchPresence).toHaveBeenCalledWith('screen:1:10', expect.any(Function));
			});
		});

		describe('sendScreenCommand', () => {
			it('sends command through the server endpoint', async () => {
				store.currentEventId = 1;

				await store.sendScreenCommand(10, 'refresh');

				expect(mockFetch).toHaveBeenCalledWith('/api/events/1/screens/10/command', {
					method: 'POST',
					body: { command: 'refresh' },
				});
			});
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state', () => {
			store.screens = [createMockScreen()];
			store.activeScreen = createMockScreen();
			store.error = 'some error';
			store.currentEventId = 1;

			store.$reset();

			expect(store.screens).toEqual([]);
			expect(store.activeScreen).toBeNull();
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.currentEventId).toBeNull();
			expect(store.isLoaded).toBe(false);
		});

		it('clears screenPresence map', () => {
			store.screenPresence = new Map([[1, { count: 2, members: [] }]]);

			store.$reset();

			expect(store.screenPresence.size).toBe(0);
		});
	});
});

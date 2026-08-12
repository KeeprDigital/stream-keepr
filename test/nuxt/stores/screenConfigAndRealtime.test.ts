import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
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

/*
 * `useAsyncAction` is deliberately not mocked, as in this store's error-reporting
 * suite. The stand-in that used to sit here rethrew every failure; the real
 * composable swallows one unless the call site asks for `throwError`, writes the
 * message to `errorRef` and resolves `null`. So every failure-path row here was
 * asserting against a contract the store does not have, and the store's own
 * `executeReporting` wrapper — the seam all of this reports through — was never
 * exercised at all. The sibling suites removed exactly this mock for exactly this
 * reason (#241, #263, #271); #311 is the same removal here. The real composable is
 * auto-imported, does no I/O and starts no timers.
 */

mockNuxtImport('useScreenRepository', () => () => mockRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useToast', () => () => ({ add: vi.fn() }));

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

	// Several tests here install fake timers and restore them on their last line, so
	// one failing assertion used to leave them installed and time out every
	// real-timer test after it — four failures reported for one defect.
	afterEach(() => {
		vi.useRealTimers();
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
			// A debounced write answers its own caller by rejecting the deferred it
			// handed out, and reports to the banner through `errorRef` — two separate
			// obligations, of which the removed stand-in honoured only the first (#311).
			expect(store.error).toBe('Save failed');
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

		/*
		 * This used to assert the opposite — that the reset cancelled the write and
		 * rejected its caller. That is what silently reverted an operator's edit when
		 * they left the Event inside the debounce window, since the edit was already
		 * on screen as saved (#308). The reset now spends the write instead, and only
		 * declines to cache its answer back into an Event this client has left.
		 */
		it('spends a pending write when the store resets for another Event', async () => {
			vi.useFakeTimers();
			const screen = createMockScreen({ id: 1, screenConfig: {}, stateVersion: 2 });
			store.screens = [screen];
			mockRepo.updateScreenConfig.mockResolvedValue(
				createMockScreen({ id: 1, screenConfig: { width: 1920 }, stateVersion: 3 }),
			);

			const write = store.updateScreenConfig(1, 1, { width: 1920 });
			store.$reset();
			await vi.advanceTimersByTimeAsync(1000);
			await write;

			// The `stateVersion` is the one the cache held at reset time, so the write
			// must be flushed before the reset clears it.
			expect(mockRepo.updateScreenConfig).toHaveBeenCalledWith(1, 1, { width: 1920 }, 2);
			expect(store.screens).toEqual([]);
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

			it('does not cache a reload that resolves after the store was reset', async () => {
				// Leaving the Event supersedes the write flights; a reload in flight has to
				// be superseded with them, or an answer for the Event just left lands in a
				// store that has been cleared and puts a Screen back that nobody asked for.
				store.screens = [createMockScreen({ id: 10, name: 'Old' })];
				let release: (screen: unknown) => void = () => {};
				mockRepo.getById.mockReturnValue(new Promise((resolve) => {
					release = resolve;
				}));

				const inFlight = ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });
				store.$reset();
				release(createMockScreen({ id: 10, name: 'New' }));
				await inFlight;

				expect(store.screens).toHaveLength(0);
			});

			it('does not let a reload triggered by an older announce overwrite a save that already settled', async () => {
				// The reload's flight guard orders reloads against each other and nothing
				// else, so a GET served before this client's own save committed can still
				// land after it. Once a save settles the editing field stops masking the
				// store, so re-caching the superseded revision is an edit visibly undone.
				//
				// Every step of the interleaving is driven explicitly — the save's debounce
				// by fake timers, the reload's answer by its own resolver — so the ordering
				// under test is the test's, never the machine's.
				vi.useFakeTimers();
				const cached = createMockScreen({ id: 10, screenConfig: { width: 100 }, stateVersion: 3 });
				store.screens = [cached];
				store.activeScreen = cached;

				let serveAnnouncedReload: (screen: unknown) => void = () => {};
				mockRepo.getById.mockReturnValueOnce(new Promise((resolve) => {
					serveAnnouncedReload = resolve;
				}));
				const reload = ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });

				const saved = createMockScreen({ id: 10, screenConfig: { width: 1920 }, stateVersion: 4 });
				mockRepo.updateScreenConfig.mockResolvedValue(saved);
				const save = store.updateScreenConfig(1, 10, { width: 1920 });
				await vi.advanceTimersByTimeAsync(300);
				await save;
				expect(store.screens[0]!.screenConfig).toEqual({ width: 1920 });

				// Served before that save committed, so it answers with the revision the
				// save superseded.
				serveAnnouncedReload(createMockScreen({ id: 10, screenConfig: { width: 100 }, stateVersion: 3 }));
				await reload;

				expect(store.screens[0]!.screenConfig).toEqual({ width: 1920 });
				expect(store.activeScreen!.screenConfig).toEqual({ width: 1920 });
				vi.useRealTimers();
			});

			it('keeps a save that settled through a conflict refresh when the announce that provoked it lands late', async () => {
				// Two operators. The other one's write took the Screen to 4 and announced
				// it; this client's own save collided with that write, refreshed, retried
				// onto it, and settled at 5 — all while the announce's own GET was still
				// out. That GET's answer is a revision older than what the client holds.
				vi.useFakeTimers();
				store.screens = [createMockScreen({ id: 10, screenConfig: { width: 100 }, stateVersion: 3 })];
				const remote = createMockScreen({ id: 10, screenConfig: { width: 100, background: '#fff' }, stateVersion: 4 });

				let serveAnnouncedReload: (screen: unknown) => void = () => {};
				mockRepo.getById
					.mockReturnValueOnce(new Promise((resolve) => {
						serveAnnouncedReload = resolve;
					}))
					.mockResolvedValue(remote);
				const reload = ablyCallbacks.screen!['screen:updated']!({ eventId: 1, screenId: 10 });

				const merged = createMockScreen({ id: 10, screenConfig: { width: 1920, background: '#fff' }, stateVersion: 5 });
				mockRepo.updateScreenConfig
					.mockRejectedValueOnce({ statusCode: 409 })
					.mockResolvedValueOnce(merged);

				const save = store.updateScreenConfig(1, 10, { width: 1920 });
				await vi.advanceTimersByTimeAsync(300);
				await save;
				expect(store.screens[0]!.stateVersion).toBe(5);

				serveAnnouncedReload(remote);
				await reload;

				expect(store.screens[0]).toEqual(merged);
				vi.useRealTimers();
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

	/**
	 * An operator's edit and the two debounces standing between it and the server.
	 *
	 * `useConfigUpdate` holds one, and the write it eventually makes lands on
	 * `updateScreenConfig`, which holds another. So "the edit is saved" is only true
	 * once both have fired, and anything that ends the surface — a panel closing, a
	 * navigation — happens between them. #308 fixed the first layer, which is
	 * useless on its own if the second one drops what the first hands it.
	 */
	describe('a config edit whose surface goes away inside the debounce window', () => {
		function editScreenConfig(scope: ReturnType<typeof effectScope>) {
			const { updateScreenConfig } = scope.run(() =>
				useScreenConfigUpdate(1, 1, { debounceMs: 100 }),
			)!;
			updateScreenConfig({ background: '#fff' });
		}

		beforeEach(() => {
			vi.useFakeTimers();
			store.screens = [createMockScreen({ id: 1, stateVersion: 2, screenConfig: { background: '#000' } })];
			mockRepo.updateScreenConfig.mockResolvedValue(
				createMockScreen({ id: 1, stateVersion: 3, screenConfig: { background: '#fff' } }),
			);
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('reaches the server when the surface unmounts', async () => {
			const scope = effectScope();
			editScreenConfig(scope);
			scope.stop();
			await vi.advanceTimersByTimeAsync(1_000);

			expect(mockRepo.updateScreenConfig).toHaveBeenCalledWith(1, 1, { background: '#fff' }, 2);
		});

		it('reaches the server when the Event scope is torn down before the surface unmounts', async () => {
			// Leaving the Event runs the route middleware before the page unmounts, so
			// the reset arrives while the edit is still held in the composable. The
			// intent outlives the reset; a synthetic cancellation would revert a
			// setting the operator was shown as saved.
			const scope = effectScope();
			editScreenConfig(scope);
			resetAllEventStores();
			scope.stop();
			await vi.advanceTimersByTimeAsync(1_000);

			expect(mockRepo.updateScreenConfig).toHaveBeenCalledWith(1, 1, { background: '#fff' }, 2);
		});

		it('reaches the server when the Event scope is torn down after the first debounce fired', async () => {
			const scope = effectScope();
			editScreenConfig(scope);
			await vi.advanceTimersByTimeAsync(100);
			store.$reset();
			scope.stop();
			await vi.advanceTimersByTimeAsync(1_000);

			expect(mockRepo.updateScreenConfig).toHaveBeenCalledWith(1, 1, { background: '#fff' }, 2);
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

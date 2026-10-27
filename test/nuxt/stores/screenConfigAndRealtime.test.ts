import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { STATE_CONFLICT_CODE } from '~~/shared/utils/stateConflict';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

/**
 * A lost concurrency race as `$fetch` delivers it: the 409 whose body
 * `mapPublicNitroError` marked as a state conflict. Only this shape may be
 * absorbed by a refresh-and-retry; an unmarked 409 is a refusal (#381).
 */
function stateConflictFailure() {
	return {
		statusCode: 409,
		data: {
			data: { code: STATE_CONFLICT_CODE },
		},
	};
}

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	getBySlug: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	updateModeConfig: vi.fn(),
	remove: vi.fn(),
};

const mockAbly = createMockRealtime();
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));

mockNuxtImport('useScreenRepository', () => () => mockRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useToast', () => () => ({
	add: vi.fn(),
}));

const { deliver } = realtimeHandlersFor();

describe('useScreenStore config and realtime', () => {
	let store: ReturnType<typeof useScreenStore>;

	beforeEach(() => {
		store = useScreenStore();
		store.$reset();
		mockFetch.mockResolvedValue({ ok: true });
	});

	// A test that fails before restoring real timers must not time out the ones after it.
	afterEach(() => {
		vi.useRealTimers();
	});

	describe('updateModeConfig', () => {
		it('shows rapid patches merged, nulls stripped, at once, and writes them as one per mode', async () => {
			vi.useFakeTimers();
			store.screens = [
				createMockScreen({
					id: 1,
					modeConfigs: {
						deck: { showDeckStats: true, showDeckName: true },
					},
					stateVersion: 2,
				}),
			];
			mockRepo.updateModeConfig.mockResolvedValue(createMockScreen({
				id: 1,
				modeConfigs: {
					deck: { showDeckName: false },
				},
				stateVersion: 3,
			}));

			const first = store.updateModeConfig(1, 1, 'deck', { showDeckName: false });
			const second = store.updateModeConfig(1, 1, 'deck', { showDeckStats: null as any });

			expect(store.screens[0]!.modeConfigs).toEqual({
				deck: { showDeckName: false },
			});
			expect(mockRepo.updateModeConfig).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(300);
			await Promise.all([first, second]);

			expect(mockRepo.updateModeConfig).toHaveBeenCalledOnce();
			expect(mockRepo.updateModeConfig).toHaveBeenCalledWith(1, 1, 'deck', { showDeckName: false, showDeckStats: null }, 2);
		});

		it('holds the server\'s Screen, in the collection and as the active Screen', async () => {
			const screen = createMockScreen({ id: 1, modeConfigs: {} });
			store.screens = [screen];
			store.activeScreen = screen;
			const updated = createMockScreen({
				id: 1,
				modeConfigs: {
					background: { layers: [] },
				},
			});
			mockRepo.updateModeConfig.mockResolvedValue(updated);

			await store.updateModeConfig(1, 1, 'background', {});

			expect(store.screens[0]).toEqual(updated);
			expect(store.activeScreen).toEqual(updated);
		});

		it('rejects its caller, reports to the banner and rolls back when the save fails', async () => {
			const screen = createMockScreen({
				id: 1,
				modeConfigs: {
					deck: { showDeckName: true },
				},
				stateVersion: 2,
			});
			store.screens = [screen];
			mockRepo.updateModeConfig.mockRejectedValue(new Error('Save failed'));

			await expect(store.updateModeConfig(1, 1, 'deck', { showDeckName: false })).rejects.toThrow('Save failed');

			expect(store.screens[0]).toEqual(screen);
			expect(store.error).toBe('Save failed');
		});

		// An edit already shown as saved is spent, not cancelled, when the operator leaves the Event (#308).
		it('spends a pending write when the store resets for another Event', async () => {
			vi.useFakeTimers();
			store.screens = [
				createMockScreen({ id: 1, modeConfigs: {}, stateVersion: 2 }),
			];
			mockRepo.updateModeConfig.mockResolvedValue(createMockScreen({
				id: 1,
				modeConfigs: {
					deck: { showDeckName: false },
				},
				stateVersion: 3,
			}));

			const write = store.updateModeConfig(1, 1, 'deck', { showDeckName: false });
			store.$reset();
			await vi.advanceTimersByTimeAsync(1000);
			await write;

			expect(mockRepo.updateModeConfig).toHaveBeenCalledWith(1, 1, 'deck', { showDeckName: false }, 2);
			expect(store.screens).toEqual([]);
		});

		it('refreshes and retries once when a batched write loses a state conflict', async () => {
			store.screens = [
				createMockScreen({ id: 1, modeConfigs: {}, stateVersion: 2 }),
			];
			const updated = createMockScreen({
				id: 1,
				modeConfigs: {
					deck: { showQuantities: false, showDeckName: false },
				},
				stateVersion: 4,
			});
			mockRepo.updateModeConfig
				.mockRejectedValueOnce(stateConflictFailure())
				.mockResolvedValueOnce(updated);
			mockRepo.getById.mockResolvedValue(createMockScreen({
				id: 1,
				modeConfigs: {
					deck: { showQuantities: false },
				},
				stateVersion: 3,
			}));

			await store.updateModeConfig(1, 1, 'deck', { showDeckName: false });

			expect(mockRepo.getById).toHaveBeenCalledWith(1, 1);
			expect(mockRepo.updateModeConfig).toHaveBeenNthCalledWith(1, 1, 1, 'deck', { showDeckName: false }, 2);
			expect(mockRepo.updateModeConfig).toHaveBeenNthCalledWith(2, 1, 1, 'deck', { showDeckName: false }, 3);
			expect(store.screens[0]).toEqual(updated);
		});

		// A refusal is the authority's judgement about the request; no refresh changes it (#381).
		it('surfaces an unmarked 409 refusal in the authority\'s words without refreshing or replaying the write', async () => {
			store.screens = [
				createMockScreen({ id: 1, modeConfigs: {}, stateVersion: 2 }),
			];
			mockRepo.updateModeConfig.mockRejectedValue({
				statusCode: 409,
				data: { message: 'Graphic Asset Reference at graphics.lower-third.items.logo.asset is not selectable' },
			});

			await expect(store.updateModeConfig(1, 1, 'deck', { showDeckName: false })).rejects.toThrow(
				'Graphic Asset Reference at graphics.lower-third.items.logo.asset is not selectable',
			);

			expect(mockRepo.getById).not.toHaveBeenCalled();
			expect(mockRepo.updateModeConfig).toHaveBeenCalledTimes(1);
		});
	});

	// A Screen change is announced by id, never as the Screen, which is too large for one message (#95); clients catch up from the API.
	describe('a peer\'s Screen announcements', () => {
		const announce = {
			created: (data: Record<string, unknown>) => store.applyRemoteCreated(data as never),
			updated: (data: Record<string, unknown>) => store.applyRemoteUpdated(data as never),
		};

		describe('screen:created', () => {
			it('loads the announced Screen once into the collection', async () => {
				store.screens = [];
				store.currentEventId = 1;
				mockRepo.getById.mockResolvedValue(createMockScreen({ id: 10, name: 'Remote' }));

				await announce.created({ eventId: 1, screenId: 10 });
				await announce.created({ eventId: 1, screenId: 10 });

				expect(mockRepo.getById).toHaveBeenCalledWith(1, 10);
				expect(store.screens.map(s => s.name)).toEqual(['Remote']);
			});

			it('loads nothing for a Screen Output, which holds no Screen collection', async () => {
				store.currentEventId = null;

				await announce.created({ eventId: 1, screenId: 10 });

				expect(mockRepo.getById).not.toHaveBeenCalled();
			});
		});

		describe('screen:updated', () => {
			it('reloads the announced Screen into the collection and the active Screen', async () => {
				const screen = createMockScreen({ id: 10, name: 'Old' });
				store.screens = [screen];
				store.activeScreen = screen;
				mockRepo.getById.mockResolvedValue(createMockScreen({ id: 10, name: 'New' }));

				await announce.updated({ eventId: 1, screenId: 10 });

				expect(mockRepo.getById).toHaveBeenCalledWith(1, 10);
				expect(store.screens[0]!.name).toBe('New');
				expect(store.activeScreen!.name).toBe('New');
			});

			it('catches up a Screen Output, which holds its Screen without holding the collection', async () => {
				store.activeScreen = createMockScreen({ id: 10, name: 'Old' });
				store.currentEventId = null;
				mockRepo.getById.mockResolvedValue(createMockScreen({ id: 10, name: 'New' }));

				await announce.updated({ eventId: 1, screenId: 10 });

				expect(store.activeScreen!.name).toBe('New');
			});

			it('ignores a Screen this client neither holds nor collects', async () => {
				store.screens = [
					createMockScreen({ id: 10 }),
				];
				store.currentEventId = null;

				await announce.updated({ eventId: 1, screenId: 99 });

				expect(mockRepo.getById).not.toHaveBeenCalled();
			});

			it('keeps the latest answer when two changes are announced in quick succession', async () => {
				store.screens = [
					createMockScreen({ id: 10, name: 'Old' }),
				];
				let releaseFirst: (screen: unknown) => void = () => {};
				mockRepo.getById
					.mockReturnValueOnce(new Promise((resolve) => {
						releaseFirst = resolve;
					}))
					.mockResolvedValueOnce(createMockScreen({ id: 10, name: 'Second' }));

				const first = announce.updated({ eventId: 1, screenId: 10 });
				await announce.updated({ eventId: 1, screenId: 10 });
				releaseFirst(createMockScreen({ id: 10, name: 'First' }));
				await first;

				expect(store.screens[0]!.name).toBe('Second');
			});

			it('does not cache a reload that resolves after the store was reset', async () => {
				store.screens = [
					createMockScreen({ id: 10, name: 'Old' }),
				];
				let release: (screen: unknown) => void = () => {};
				mockRepo.getById.mockReturnValue(new Promise((resolve) => {
					release = resolve;
				}));

				const inFlight = announce.updated({ eventId: 1, screenId: 10 });
				store.$reset();
				release(createMockScreen({ id: 10, name: 'New' }));
				await inFlight;

				expect(store.screens).toHaveLength(0);
			});

			// A GET served before this client's save committed must not visibly undo it once it settles.
			it('does not let a reload triggered by an older announce overwrite a save that already settled', async () => {
				vi.useFakeTimers();
				const cached = createMockScreen({
					id: 10,
					modeConfigs: {
						deck: { showDeckName: true },
					},
					stateVersion: 3,
				});
				store.screens = [cached];
				store.activeScreen = cached;

				let serveAnnouncedReload: (screen: unknown) => void = () => {};
				mockRepo.getById.mockReturnValueOnce(new Promise((resolve) => {
					serveAnnouncedReload = resolve;
				}));
				const reload = announce.updated({ eventId: 1, screenId: 10 });

				mockRepo.updateModeConfig.mockResolvedValue(createMockScreen({
					id: 10,
					modeConfigs: {
						deck: { showDeckName: false },
					},
					stateVersion: 4,
				}));
				const save = store.updateModeConfig(1, 10, 'deck', { showDeckName: false });
				await vi.advanceTimersByTimeAsync(300);
				await save;

				serveAnnouncedReload(createMockScreen({
					id: 10,
					modeConfigs: {
						deck: { showDeckName: true },
					},
					stateVersion: 3,
				}));
				await reload;

				expect(store.screens[0]!.modeConfigs).toEqual({
					deck: { showDeckName: false },
				});
				expect(store.activeScreen!.modeConfigs).toEqual({
					deck: { showDeckName: false },
				});
			});

			// Another operator's write took the Screen to 4; this client's save collided, retried onto it and settled at 5.
			it('keeps a save that settled through a conflict refresh when the announce that provoked it lands late', async () => {
				vi.useFakeTimers();
				store.screens = [
					createMockScreen({
						id: 10,
						modeConfigs: {
							deck: { showDeckName: true },
						},
						stateVersion: 3,
					}),
				];
				const remote = createMockScreen({
					id: 10,
					modeConfigs: {
						deck: { showDeckName: true, showQuantities: false },
					},
					stateVersion: 4,
				});

				let serveAnnouncedReload: (screen: unknown) => void = () => {};
				mockRepo.getById
					.mockReturnValueOnce(new Promise((resolve) => {
						serveAnnouncedReload = resolve;
					}))
					.mockResolvedValue(remote);
				const reload = announce.updated({ eventId: 1, screenId: 10 });

				const merged = createMockScreen({
					id: 10,
					modeConfigs: {
						deck: { showDeckName: false, showQuantities: false },
					},
					stateVersion: 5,
				});
				mockRepo.updateModeConfig
					.mockRejectedValueOnce(stateConflictFailure())
					.mockResolvedValueOnce(merged);

				const save = store.updateModeConfig(1, 10, 'deck', { showDeckName: false });
				await vi.advanceTimersByTimeAsync(300);
				await save;
				expect(store.screens[0]!.stateVersion).toBe(5);

				serveAnnouncedReload(remote);
				await reload;

				expect(store.screens[0]).toEqual(merged);
			});

			it('leaves the cached Screen alone, reporting nothing, when the reload fails', async () => {
				store.screens = [
					createMockScreen({ id: 10, name: 'Old' }),
				];
				mockRepo.getById.mockRejectedValue(new Error('offline'));

				await announce.updated({ eventId: 1, screenId: 10 });

				expect(store.screens[0]!.name).toBe('Old');
				expect(store.error).toBeNull();
			});
		});

		it('screen:deleted drops the Screen and clears it as the active Screen', () => {
			const screen = createMockScreen({ id: 10 });
			store.screens = [screen];
			store.activeScreen = screen;

			deliver('screen:deleted', { screenId: 10 } as never);

			expect(store.screens).toEqual([]);
			expect(store.activeScreen).toBeNull();
		});
	});

	describe('presence and commands', () => {
		it('watches a Screen\'s presence on its Event-scoped channel, and forgets presence on reset', () => {
			store.currentEventId = 1;

			store.subscribeToScreenPresence(10);

			expect(mockAbly.watchPresence).toHaveBeenCalledWith('screen:1:10', expect.any(Function));

			store.screenPresence = new Map([
				[
					1,
					{ count: 2, members: [] },
				],
			]);
			store.$reset();

			expect(store.getConnectedCount(1)).toBe(0);
		});

		it('sends a Screen command through the server endpoint', async () => {
			store.currentEventId = 1;

			await store.sendScreenCommand(10, 'refresh');

			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/screens/10/command', {
				method: 'POST',
				body: { command: 'refresh' },
			});
		});
	});

	/**
	 * "Saved" means both debounces fired: `useConfigUpdate`'s and `updateModeConfig`'s.
	 * Ending the surface between them must not drop what the first handed the second (#308).
	 */
	describe('a config edit whose surface goes away inside the debounce window', () => {
		function editModeConfig(scope: ReturnType<typeof effectScope>) {
			const { updateConfig } = scope.run(() =>
				useModeConfigUpdate(1, 1, 'deck', { debounceMs: 100 }),
			)!;
			updateConfig({ showDeckName: false });
		}

		beforeEach(() => {
			vi.useFakeTimers();
			store.screens = [
				createMockScreen({
					id: 1,
					stateVersion: 2,
					modeConfigs: {
						deck: { showDeckName: true },
					},
				}),
			];
			mockRepo.updateModeConfig.mockResolvedValue(
				createMockScreen({
					id: 1,
					stateVersion: 3,
					modeConfigs: {
						deck: { showDeckName: false },
					},
				}),
			);
		});

		it('reaches the server when the surface unmounts', async () => {
			const scope = effectScope();
			editModeConfig(scope);
			scope.stop();
			await vi.advanceTimersByTimeAsync(1_000);

			expect(mockRepo.updateModeConfig).toHaveBeenCalledWith(1, 1, 'deck', { showDeckName: false }, 2);
		});

		// Leaving the Event runs the route middleware before the page unmounts.
		it('reaches the server when the Event scope is torn down before the surface unmounts', async () => {
			const scope = effectScope();
			editModeConfig(scope);
			resetAllEventStores();
			scope.stop();
			await vi.advanceTimersByTimeAsync(1_000);

			expect(mockRepo.updateModeConfig).toHaveBeenCalledWith(1, 1, 'deck', { showDeckName: false }, 2);
		});

		it('reaches the server when the Event scope is torn down after the first debounce fired', async () => {
			const scope = effectScope();
			editModeConfig(scope);
			await vi.advanceTimersByTimeAsync(100);
			store.$reset();
			scope.stop();
			await vi.advanceTimersByTimeAsync(1_000);

			expect(mockRepo.updateModeConfig).toHaveBeenCalledWith(1, 1, 'deck', { showDeckName: false }, 2);
		});
	});
});

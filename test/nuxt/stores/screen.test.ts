import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isReactive } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';

/**
 * Put the same Screen id in the cache more than once, by assignment. No door into
 * `screens` builds this any more (#261), but `cachedRevision` must still select one
 * entry for both the comparison and a refusal's answer when it does (#251).
 */
function seedDuplicateCacheEntries(store: ReturnType<typeof useScreenStore>, versions: number[]) {
	store.screens = versions.map(stateVersion => createMockScreen({ id: 10, name: `v${stateVersion}`, stateVersion }));
}

// ── Mock Dependencies ──

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	getBySlug: vi.fn(),
	getScreenOutputById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	updateModeConfig: vi.fn(),
	remove: vi.fn(),
};

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));

mockNuxtImport('useScreenRepository', () => () => mockRepo);
mockNuxtImport('$fetch', () => mockFetch);

describe('useScreenStore', () => {
	let store: ReturnType<typeof useScreenStore>;

	beforeEach(() => {
		store = useScreenStore();
		store.$reset();
		mockFetch.mockResolvedValue({ ok: true });
	});

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

		it('keeps a cached Screen the fetched list serves at an older revision', async () => {
			store.screens = [
				createMockScreen({ id: 1, name: 'Saved', stateVersion: 4 }),
			];
			mockRepo.list.mockResolvedValue([
				createMockScreen({ id: 1, name: 'Stale', stateVersion: 3 }),
			]);

			await store.loadScreensByEventId(1);

			expect(store.screens[0]!.name).toBe('Saved');
			expect(store.screens[0]!.stateVersion).toBe(4);
		});

		it('takes the fetched Screen when the list serves the revision the cache already holds', async () => {
			// Equal is not older: the server bumps `stateVersion` once per write, so a
			// list serving the same revision carries the same Screen, and refusing it
			// would leave a reload unable to correct anything.
			store.screens = [
				createMockScreen({ id: 1, name: 'Old', stateVersion: 4 }),
			];
			mockRepo.list.mockResolvedValue([
				createMockScreen({ id: 1, name: 'Fresh', stateVersion: 4 }),
			]);

			await store.loadScreensByEventId(1);

			expect(store.screens[0]!.name).toBe('Fresh');
		});

		it('drops a cached Screen the fetched list no longer contains, however new the cache holds it', async () => {
			// The list is the authority on membership; a reload is how a missed delete is caught.
			store.screens = [
				createMockScreen({ id: 1, name: 'Deleted elsewhere', stateVersion: 9 }),
				createMockScreen({ id: 2, name: 'Still there', stateVersion: 1 }),
			];
			mockRepo.list.mockResolvedValue([
				createMockScreen({ id: 2, name: 'Still there', stateVersion: 1 }),
			]);

			await store.loadScreensByEventId(1);

			expect(store.screens.map(s => s.id)).toEqual([2]);
		});

		it('adds a Screen the fetched list brings that the cache lacks, in the order the list gives', async () => {
			store.screens = [
				createMockScreen({ id: 1, stateVersion: 4 }),
			];
			mockRepo.list.mockResolvedValue([
				createMockScreen({ id: 2, stateVersion: 1 }),
				createMockScreen({ id: 1, stateVersion: 4 }),
			]);

			await store.loadScreensByEventId(1);

			expect(store.screens.map(s => s.id)).toEqual([2, 1]);
		});

		it('keeps the newest held revision when the cache holds the Screen more than once', async () => {
			seedDuplicateCacheEntries(store, [1, 5, 2]);
			mockRepo.list.mockResolvedValue([
				createMockScreen({ id: 10, name: 'v3', stateVersion: 3 }),
			]);

			await store.loadScreensByEventId(1);

			expect(store.screens.map(s => s.stateVersion)).toEqual([5]);
		});

		it('does not let a refresh that raced a settled save overwrite it', async () => {
			// A GET issued before the save commits and served after it would visibly undo the edit (#251).
			vi.useFakeTimers();
			store.screens = [
				createMockScreen({
					id: 5,
					modeConfigs: {
						card: { animationSpeed: 'slow' },
					},
					stateVersion: 3,
				}),
			];

			let serveRefresh: (screens: unknown) => void = () => {};
			mockRepo.list.mockReturnValueOnce(new Promise((resolve) => {
				serveRefresh = resolve;
			}));
			const refresh = store.loadScreensByEventId(1);

			const saved = createMockScreen({
				id: 5,
				modeConfigs: {
					card: { animationSpeed: 'fast' },
				},
				stateVersion: 4,
			});
			mockRepo.updateModeConfig.mockResolvedValue(saved);
			const save = store.updateModeConfig(1, 5, 'card', { animationSpeed: 'fast' });
			await vi.advanceTimersByTimeAsync(300);
			await save;
			expect(store.screens[0]!.modeConfigs).toEqual({
				card: { animationSpeed: 'fast' },
			});

			serveRefresh([
				createMockScreen({
					id: 5,
					modeConfigs: {
						card: { animationSpeed: 'slow' },
					},
					stateVersion: 3,
				}),
			]);
			const loaded = await refresh;

			expect(store.screens[0]!.modeConfigs).toEqual({
				card: { animationSpeed: 'fast' },
			});
			expect(loaded![0]!.modeConfigs).toEqual({
				card: { animationSpeed: 'fast' },
			});
			vi.useRealTimers();
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

		it('keeps a held revision newer than the one the slug answer brings', async () => {
			store.screens = [
				createMockScreen({
					id: 7,
					slug: 'main',
					name: 'Saved',
					stateVersion: 4,
				}),
			];
			mockRepo.getBySlug.mockResolvedValue(createMockScreen({
				id: 7,
				slug: 'main',
				name: 'Stale',
				stateVersion: 3,
			}));

			const loaded = await store.loadScreenBySlug(1, 'main');

			expect(store.activeScreen!.name).toBe('Saved');
			expect(loaded!.name).toBe('Saved');
			expect(isReactive(loaded)).toBe(false);
		});

		it('takes the slug answer at the revision the cache already holds', async () => {
			// The server bumps `stateVersion` once per write, so an equal revision is the same Screen.
			store.screens = [
				createMockScreen({
					id: 7,
					slug: 'main',
					name: 'Old',
					stateVersion: 4,
				}),
			];
			mockRepo.getBySlug.mockResolvedValue(createMockScreen({
				id: 7,
				slug: 'main',
				name: 'Fresh',
				stateVersion: 4,
			}));

			await store.loadScreenBySlug(1, 'main');

			expect(store.activeScreen!.name).toBe('Fresh');
		});

		it('answers a refusal with the newest held revision when the cache holds the Screen more than once', async () => {
			seedDuplicateCacheEntries(store, [1, 5, 2]);
			mockRepo.getBySlug.mockResolvedValue(createMockScreen({ id: 10, name: 'v3', stateVersion: 3 }));

			const loaded = await store.loadScreenBySlug(1, 'screen');

			expect(loaded!.stateVersion).toBe(5);
			expect(store.activeScreen!.stateVersion).toBe(5);
		});

		it('does not let a slug load that raced a settled save overwrite it', async () => {
			// The loader nulls `activeScreen` before its GET, so the comparison reads `screens` (#261).
			vi.useFakeTimers();
			store.screens = [
				createMockScreen({
					id: 5,
					slug: 'main',
					modeConfigs: {
						card: { animationSpeed: 'slow' },
					},
					stateVersion: 3,
				}),
			];

			let serveLoad: (screen: unknown) => void = () => {};
			mockRepo.getBySlug.mockReturnValueOnce(new Promise((resolve) => {
				serveLoad = resolve;
			}));
			const load = store.loadScreenBySlug(1, 'main');

			const saved = createMockScreen({
				id: 5,
				slug: 'main',
				modeConfigs: {
					card: { animationSpeed: 'fast' },
				},
				stateVersion: 4,
			});
			mockRepo.updateModeConfig.mockResolvedValue(saved);
			const save = store.updateModeConfig(1, 5, 'card', { animationSpeed: 'fast' });
			await vi.advanceTimersByTimeAsync(300);
			await save;

			serveLoad(createMockScreen({
				id: 5,
				slug: 'main',
				modeConfigs: {
					card: { animationSpeed: 'slow' },
				},
				stateVersion: 3,
			}));
			const loaded = await load;

			expect(store.activeScreen!.modeConfigs).toEqual({
				card: { animationSpeed: 'fast' },
			});
			expect(loaded!.modeConfigs).toEqual({
				card: { animationSpeed: 'fast' },
			});
			vi.useRealTimers();
		});
	});

	/**
	 * The re-read a Screen Output takes coming back from a suspended connection (#307):
	 * like `loadScreenBySlug`, but it is on program, so it never blanks and never throws.
	 */
	describe('refreshActiveScreen', () => {
		function deferGetScreenOutputById() {
			let serve!: (screen: unknown) => void;
			mockRepo.getScreenOutputById.mockReturnValueOnce(new Promise((resolve) => {
				serve = resolve;
			}));
			return (screen: unknown) => serve(screen);
		}

		it('never empties what is on program while it fetches', async () => {
			const onProgram = createMockScreen({ id: 7, slug: 'main', name: 'On air' });
			store.activeScreen = onProgram;
			const serve = deferGetScreenOutputById();

			const refresh = store.refreshActiveScreen(1, 7);
			await Promise.resolve();

			// The whole point of the second loader. A flash of nothing on program is
			// the one failure an operator cannot recover from in time.
			expect(store.activeScreen).toEqual(onProgram);

			serve(createMockScreen({ id: 7, slug: 'main', name: 'Current mode' }));
			await refresh;

			expect(store.activeScreen!.name).toBe('Current mode');
		});

		it('is superseded by a slug change started after it', async () => {
			// It shares `activeScreenLoads` with the switching loader, so a real
			// navigation begun while a resync is in flight wins rather than races.
			store.activeScreen = createMockScreen({ id: 7, slug: 'main' });
			const serveRefresh = deferGetScreenOutputById();

			const refresh = store.refreshActiveScreen(1, 7);
			const switched = createMockScreen({ id: 8, slug: 'other' });
			mockRepo.getBySlug.mockResolvedValueOnce(switched);
			await store.loadScreenBySlug(1, 'other');

			serveRefresh(createMockScreen({ id: 7, slug: 'main' }));

			expect(await refresh).toBeNull();
			expect(store.activeScreen).toEqual(switched);
		});

		it('keeps a held revision newer than the one the answer brings', async () => {
			// The same comparison the three loaders share (#251): a GET issued before a
			// save commits can be served after it settles.
			store.screens = [
				createMockScreen({
					id: 7,
					slug: 'main',
					name: 'Saved',
					stateVersion: 4,
				}),
			];
			store.activeScreen = createMockScreen({
				id: 7,
				slug: 'main',
				name: 'Saved',
				stateVersion: 4,
			});
			mockRepo.getScreenOutputById.mockResolvedValue(createMockScreen({
				id: 7,
				slug: 'main',
				name: 'Stale',
				stateVersion: 3,
			}));

			const refreshed = await store.refreshActiveScreen(1, 7);

			expect(store.activeScreen!.name).toBe('Saved');
			expect(refreshed!.name).toBe('Saved');
		});

		it('holds the rendering when the Screen cannot be fetched, and reports why', async () => {
			// `loadScreenBySlug` throws here, because a caller switching Screens has to
			// know it failed. Nothing is waiting on a resync to decide what to render,
			// and program keeps what it last accepted.
			const onProgram = createMockScreen({ id: 7, slug: 'main', name: 'On air' });
			store.activeScreen = onProgram;
			mockRepo.getScreenOutputById.mockRejectedValue(transportFailure({ status: 503 }));

			await expect(store.refreshActiveScreen(1, 7)).resolves.toBeNull();

			expect(store.activeScreen).toEqual(onProgram);
			expect(store.error).toContain('Service Unavailable');
		});

		it('holds the rendering when the Screen is gone', async () => {
			const onProgram = createMockScreen({ id: 7, slug: 'main', name: 'On air' });
			store.activeScreen = onProgram;
			mockRepo.getScreenOutputById.mockResolvedValue(null);

			expect(await store.refreshActiveScreen(1, 7)).toBeNull();

			expect(store.activeScreen).toEqual(onProgram);
		});

		it('reads the held Screen by its id, so a rename under program cannot strand it', async () => {
			// The slug the output was opened on names nothing once the Screen is renamed
			// (#705); the id it holds still names the Screen.
			store.activeScreen = createMockScreen({ id: 7, slug: 'main' });
			const renamed = createMockScreen({ id: 7, slug: 'renamed', name: 'Missed change' });
			mockRepo.getScreenOutputById.mockResolvedValue(renamed);

			const refreshed = await store.refreshActiveScreen(1, 7, 'capability');

			expect(mockRepo.getScreenOutputById).toHaveBeenCalledWith(1, 7, 'capability');
			expect(mockRepo.getBySlug).not.toHaveBeenCalled();
			expect(refreshed).toEqual(renamed);
			expect(store.activeScreen).toEqual(renamed);
		});

		it('drops an answer for a Screen this client no longer holds', async () => {
			store.activeScreen = createMockScreen({ id: 8, slug: 'other' });
			mockRepo.getScreenOutputById.mockResolvedValue(createMockScreen({ id: 7, slug: 'main' }));

			expect(await store.refreshActiveScreen(1, 7)).toBeNull();
			expect(store.activeScreen!.id).toBe(8);
		});
	});

	describe('getScreenById', () => {
		it('caches the Screen it reads, for that Event', async () => {
			const screen = createMockScreen({ id: 5 });
			mockRepo.getById.mockResolvedValue(screen);

			await store.getScreenById(42, 5);

			expect(store.screens).toEqual([screen]);
			expect(store.currentEventId).toBe(42);
		});

		it('refuses an answer older than the cached revision, and answers with the cached one', async () => {
			store.screens = [
				createMockScreen({ id: 5, name: 'Saved', stateVersion: 4 }),
			];
			mockRepo.getById.mockResolvedValue(createMockScreen({ id: 5, name: 'Stale', stateVersion: 3 }));

			const loaded = await store.getScreenById(1, 5);

			expect(store.screens[0]!.name).toBe('Saved');
			// The page mirrors this answer into its own `screen` ref, so handing back the
			// refused payload would put it on screen anyway.
			expect(loaded!.name).toBe('Saved');
			// And it is handed back raw, like every other Screen a cache write stores,
			// rather than the reactive proxy a read out of `screens` gives.
			expect(isReactive(loaded)).toBe(false);
		});

		it('answers a refusal with the newest revision held, whatever its position, when the cache holds the Screen more than once', async () => {
			// The comparison maxes over every entry for the id; the answer must select
			// the same one. Take the first (or the last) instead and a refusal hands back
			// a revision older than both the cache's newest and the payload it refused —
			// worse than the version-blind overwrite this guard replaced.
			seedDuplicateCacheEntries(store, [1, 5, 2]);
			expect(store.screens).toHaveLength(3);
			mockRepo.getById.mockResolvedValue(createMockScreen({ id: 10, name: 'v3', stateVersion: 3 }));

			const loaded = await store.getScreenById(1, 10);

			expect(loaded!.stateVersion).toBe(5);
			expect(store.screens.map(s => s.stateVersion)).toEqual([1, 5, 2]);
		});

		it('caches an answer at the revision the cache already holds', async () => {
			store.screens = [
				createMockScreen({ id: 5, name: 'Old', stateVersion: 4 }),
			];
			mockRepo.getById.mockResolvedValue(createMockScreen({ id: 5, name: 'Fresh', stateVersion: 4 }));

			await store.getScreenById(1, 5);

			expect(store.screens[0]!.name).toBe('Fresh');
		});

		it('does not let a load that raced a settled save overwrite it', async () => {
			// Same interleaving as the list refresh above, reached through the single
			// Screen load the configuration page runs on mount and on route change.
			vi.useFakeTimers();
			store.screens = [
				createMockScreen({
					id: 5,
					modeConfigs: {
						card: { animationSpeed: 'slow' },
					},
					stateVersion: 3,
				}),
			];

			let serveLoad: (screen: unknown) => void = () => {};
			mockRepo.getById.mockReturnValueOnce(new Promise((resolve) => {
				serveLoad = resolve;
			}));
			const load = store.getScreenById(1, 5);

			const saved = createMockScreen({
				id: 5,
				modeConfigs: {
					card: { animationSpeed: 'fast' },
				},
				stateVersion: 4,
			});
			mockRepo.updateModeConfig.mockResolvedValue(saved);
			const save = store.updateModeConfig(1, 5, 'card', { animationSpeed: 'fast' });
			await vi.advanceTimersByTimeAsync(300);
			await save;
			expect(store.screens[0]!.modeConfigs).toEqual({
				card: { animationSpeed: 'fast' },
			});

			serveLoad(createMockScreen({
				id: 5,
				modeConfigs: {
					card: { animationSpeed: 'slow' },
				},
				stateVersion: 3,
			}));
			const loaded = await load;

			expect(store.screens[0]!.modeConfigs).toEqual({
				card: { animationSpeed: 'fast' },
			});
			expect(loaded!.modeConfigs).toEqual({
				card: { animationSpeed: 'fast' },
			});
			vi.useRealTimers();
		});
	});

	describe('createScreen', () => {
		it('holds and answers the created Screen', async () => {
			const created = createMockScreen({ id: 3, name: 'New Screen' });
			mockRepo.create.mockResolvedValue(created);

			const result = await store.createScreen(1, { name: 'New Screen', slug: 'new-screen', currentMode: 'background' });

			expect(result).toEqual(created);
			expect(store.screens).toContainEqual(created);
		});

		it('holds one entry when two creates answer with the same id (#261)', async () => {
			mockRepo.create
				.mockResolvedValueOnce(createMockScreen({ id: 10, name: 'first', stateVersion: 1 }))
				.mockResolvedValueOnce(createMockScreen({ id: 10, name: 'second', stateVersion: 2 }));

			await store.createScreen(1, { name: 'Screen', slug: 'screen', currentMode: 'background' });
			await store.createScreen(1, { name: 'Screen', slug: 'screen', currentMode: 'background' });

			expect(store.screens.map(s => s.id)).toEqual([10]);
			expect(store.screens[0]!.name).toBe('second');
		});

		it('keeps the newer held revision when a create answers with an older one', async () => {
			// Newest wins, as through every other door into `screens`.
			store.screens = [
				createMockScreen({ id: 10, name: 'Saved', stateVersion: 4 }),
			];
			mockRepo.create.mockResolvedValue(createMockScreen({ id: 10, name: 'Created', stateVersion: 3 }));

			const created = await store.createScreen(1, { name: 'Screen', slug: 'screen', currentMode: 'background' });

			expect(store.screens.map(s => s.name)).toEqual(['Saved']);
			// Nothing mirrors a create's answer into the cache, so it is what the server made.
			expect(created!.name).toBe('Created');
		});

		it('takes a create answering at the revision the cache already holds', async () => {
			store.screens = [
				createMockScreen({ id: 10, name: 'Old', stateVersion: 4 }),
			];
			mockRepo.create.mockResolvedValue(createMockScreen({ id: 10, name: 'Fresh', stateVersion: 4 }));

			await store.createScreen(1, { name: 'Screen', slug: 'screen', currentMode: 'background' });

			expect(store.screens.map(s => s.name)).toEqual(['Fresh']);
		});
	});

	describe('updateScreen', () => {
		it('holds the server\'s Screen, in the collection and as the active Screen', async () => {
			const screen = createMockScreen({ id: 1, name: 'Old' });
			store.screens = [screen];
			store.activeScreen = screen;
			mockRepo.update.mockResolvedValue({ ...screen, name: 'Server Updated' });

			await store.updateScreen(1, 1, { name: 'Updated' });

			expect(store.screens[0]!.name).toBe('Server Updated');
			expect(store.activeScreen!.name).toBe('Server Updated');
		});

		it('sends the held stateVersion with the update', async () => {
			const screen = createMockScreen({ id: 1, stateVersion: 5 });
			store.screens = [screen];
			mockRepo.update.mockResolvedValue(screen);

			await store.updateScreen(1, 1, { name: 'Updated' });

			expect(mockRepo.update).toHaveBeenCalledWith(1, 1, expect.objectContaining({ stateVersion: 5 }));
		});

		it('answers null, rolls the optimistic edit back, and reports what the authority said', async () => {
			const screen = createMockScreen({ id: 1, name: 'Old', stateVersion: 2 });
			store.screens = [screen];
			// Deliberately not a 409: that status is the conflict-refresh-and-retry
			// path, and this row is about what a plain refusal produces.
			mockRepo.update.mockRejectedValue(transportFailure({
				status: 403,
				body: { statusCode: 403, statusMessage: 'Forbidden', message: 'This Screen belongs to another Event' },
			}));

			const answer = await store.updateScreen(1, 1, { name: 'Updated' });

			expect(answer).toBeNull();
			expect(store.screens[0]!.name).toBe('Old');
			expect(store.error).toBe('This Screen belongs to another Event');
		});
	});

	// A Screen write is answered for the Event it was made in; it adds, changes and restores nothing in another (#606, ADR-0024).
	describe.each([
		[
			'Event B',
			[2],
		],
		[
			'Event A, loaded again since',
			[2, 1],
		],
	])('a Screen write answered after the operator moved on to %s', (_, switches) => {
		/** Ends on Screens 1 and 2 at the revision the write would answer with, as Event A's own are when loaded again. */
		async function switchAway() {
			for (const eventId of switches) {
				store.$reset();
				mockRepo.list.mockResolvedValueOnce([
					createMockScreen({
						id: 1,
						eventId,
						name: `One as loaded for ${eventId}`,
						stateVersion: 2,
					}),
					createMockScreen({
						id: 2,
						eventId,
						name: `Two as loaded for ${eventId}`,
						stateVersion: 2,
					}),
				]);
				await store.loadScreensByEventId(eventId);
			}
			return structuredClone(toRaw(store.screens));
		}

		it('a late create adds no Screen', async () => {
			const create = deferred<ReturnType<typeof createMockScreen>>();
			mockRepo.create.mockReturnValueOnce(create.promise);

			const creating = store.createScreen(1, { name: 'New Screen', slug: 'new-screen', currentMode: 'background' });
			const shown = await switchAway();
			create.resolve(createMockScreen({ id: 3, name: 'New Screen', stateVersion: 2 }));
			await creating;

			expect(store.screens).toEqual(shown);
		});

		it('a late update changes no Screen, whether it succeeds or fails', async () => {
			store.screens = [
				createMockScreen({ id: 1, name: 'One', stateVersion: 1 }),
				createMockScreen({ id: 2, name: 'Two', stateVersion: 1 }),
			];
			const succeeded = deferred<ReturnType<typeof createMockScreen>>();
			const failed = deferred<never>();
			mockRepo.update
				.mockReturnValueOnce(succeeded.promise)
				.mockReturnValueOnce(failed.promise);

			const renaming = store.updateScreen(1, 1, { name: 'One renamed' });
			const renamingOther = store.updateScreen(1, 2, { name: 'Two renamed' });
			const shown = await switchAway();
			succeeded.resolve(createMockScreen({ id: 1, name: 'One renamed', stateVersion: 2 }));
			failed.reject(new Error('Update refused'));
			await Promise.all([renaming, renamingOther]);

			expect(store.screens).toEqual(shown);
			expect(store.error).toBeNull();
		});

		it('a late failed delete puts back no Screen', async () => {
			store.screens = [
				createMockScreen({ id: 3, name: 'Three', stateVersion: 1 }),
			];
			const remove = deferred<never>();
			mockRepo.remove.mockReturnValueOnce(remove.promise);

			const removing = store.removeScreen(1, 3);
			const shown = await switchAway();
			remove.reject(new Error('Delete refused'));
			await removing;

			expect(store.screens).toEqual(shown);
			expect(store.error).toBeNull();
		});
	});
});

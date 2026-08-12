import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isReactive } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

const UPDATE_REQUEST = `[PATCH] "/api/events/1/screens/1"`;
const GET_BY_ID_REQUEST = `[GET] "/api/events/1/screens/10"`;

/**
 * Put the same Screen id in the cache more than once, by assignment.
 *
 * It used to be seeded through the public store API — `createScreen` pushed its
 * answer unconditionally, so two creates answering with one id left one entry each,
 * and that is how #251's review first reached this state. #261 closed that door, and
 * the pin for it is in the `createScreen` block below.
 *
 * The state is still worth holding tests to. `cachedRevision` is the single selection
 * that both the version comparison and every refusal's answer read, and what makes
 * one selection worth having is precisely that it cannot disagree with itself when an
 * id is held twice — the split #251's review constructed. No door into `screens` will
 * build that state any more, so a seeded cache is the only thing that can hold the
 * property to it.
 */
function seedDuplicateCacheEntries(store: ReturnType<typeof useScreenStore>, versions: number[]) {
	store.screens = versions.map(stateVersion => createMockScreen({ id: 10, name: `v${stateVersion}`, stateVersion }));
}

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

		it('keeps a cached Screen the fetched list serves at an older revision', async () => {
			store.screens = [createMockScreen({ id: 1, name: 'Saved', stateVersion: 4 })];
			mockRepo.list.mockResolvedValue([createMockScreen({ id: 1, name: 'Stale', stateVersion: 3 })]);

			await store.loadScreensByEventId(1);

			expect(store.screens[0]!.name).toBe('Saved');
			expect(store.screens[0]!.stateVersion).toBe(4);
		});

		it('takes the fetched Screen when the list serves the revision the cache already holds', async () => {
			// Equal is not older: the server bumps `stateVersion` once per write, so a
			// list serving the same revision carries the same Screen, and refusing it
			// would leave a reload unable to correct anything.
			store.screens = [createMockScreen({ id: 1, name: 'Old', stateVersion: 4 })];
			mockRepo.list.mockResolvedValue([createMockScreen({ id: 1, name: 'Fresh', stateVersion: 4 })]);

			await store.loadScreensByEventId(1);

			expect(store.screens[0]!.name).toBe('Fresh');
		});

		it('drops a cached Screen the fetched list no longer contains, however new the cache holds it', async () => {
			// The list is the authority on membership. Absence carries no `stateVersion`
			// to compare against, and a reload is how a client that missed the delete
			// announcement finds out — keeping the cached entry would resurrect it on
			// every subsequent load.
			store.screens = [
				createMockScreen({ id: 1, name: 'Deleted elsewhere', stateVersion: 9 }),
				createMockScreen({ id: 2, name: 'Still there', stateVersion: 1 }),
			];
			mockRepo.list.mockResolvedValue([createMockScreen({ id: 2, name: 'Still there', stateVersion: 1 })]);

			await store.loadScreensByEventId(1);

			expect(store.screens.map(s => s.id)).toEqual([2]);
		});

		it('adds a Screen the fetched list brings that the cache lacks, in the order the list gives', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 4 })];
			mockRepo.list.mockResolvedValue([
				createMockScreen({ id: 2, stateVersion: 1 }),
				createMockScreen({ id: 1, stateVersion: 4 }),
			]);

			await store.loadScreensByEventId(1);

			expect(store.screens.map(s => s.id)).toEqual([2, 1]);
		});

		it('keeps the newest held revision when the cache holds the Screen more than once', async () => {
			// Same split-authority hazard as the single-Screen loader: selecting a
			// different entry than the comparison did writes a revision older than the
			// one the fetched list brought, which is worse than replacing wholesale.
			seedDuplicateCacheEntries(store, [1, 5, 2]);
			mockRepo.list.mockResolvedValue([createMockScreen({ id: 10, name: 'v3', stateVersion: 3 })]);

			await store.loadScreensByEventId(1);

			expect(store.screens.map(s => s.stateVersion)).toEqual([5]);
		});

		it('does not let a refresh that raced a settled save overwrite it', async () => {
			// A page load or explicit refresh issues its GET before the operator's own
			// save commits and can be served after it settles, by which point the
			// editing field has stopped masking the store — so caching the list's
			// answer wholesale is an edit visibly undone (#251, #236's clobber reached
			// through a loader instead of an announce).
			//
			// Every step is driven explicitly — the save's debounce by fake timers, the
			// list's answer by its own resolver — so the ordering is the test's.
			vi.useFakeTimers();
			store.screens = [createMockScreen({ id: 5, screenConfig: { width: 100 }, stateVersion: 3 })];

			let serveRefresh: (screens: unknown) => void = () => {};
			mockRepo.list.mockReturnValueOnce(new Promise((resolve) => {
				serveRefresh = resolve;
			}));
			const refresh = store.loadScreensByEventId(1);

			const saved = createMockScreen({ id: 5, screenConfig: { width: 1920 }, stateVersion: 4 });
			mockRepo.updateScreenConfig.mockResolvedValue(saved);
			const save = store.updateScreenConfig(1, 5, { width: 1920 });
			await vi.advanceTimersByTimeAsync(300);
			await save;
			expect(store.screens[0]!.screenConfig).toEqual({ width: 1920 });

			// Served before that save committed, so it answers with the revision the
			// save superseded.
			serveRefresh([createMockScreen({ id: 5, screenConfig: { width: 100 }, stateVersion: 3 })]);
			const loaded = await refresh;

			expect(store.screens[0]!.screenConfig).toEqual({ width: 1920 });
			expect(loaded![0]!.screenConfig).toEqual({ width: 1920 });
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
			store.screens = [createMockScreen({ id: 7, slug: 'main', name: 'Saved', stateVersion: 4 })];
			mockRepo.getBySlug.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', name: 'Stale', stateVersion: 3 }));

			const loaded = await store.loadScreenBySlug(1, 'main');

			expect(store.activeScreen!.name).toBe('Saved');
			// Same rule as the other two loaders: the answer is the revision kept, since
			// the display session compares what it is handed against `activeScreen` and
			// renders from there.
			expect(loaded!.name).toBe('Saved');
			// And handed back raw, like every other Screen a cache write stores.
			expect(isReactive(loaded)).toBe(false);
		});

		it('takes the slug answer at the revision the cache already holds', async () => {
			// Equal is not older: the server bumps `stateVersion` once per write, so the
			// same revision carries the same Screen (#236, #251).
			store.screens = [createMockScreen({ id: 7, slug: 'main', name: 'Old', stateVersion: 4 })];
			mockRepo.getBySlug.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', name: 'Fresh', stateVersion: 4 }));

			await store.loadScreenBySlug(1, 'main');

			expect(store.activeScreen!.name).toBe('Fresh');
		});

		it('answers a refusal with the newest held revision when the cache holds the Screen more than once', async () => {
			// The third loader reads the same single selection as the other two: take a
			// different entry than the comparison did and the refusal hands back — and
			// puts on the output — a revision older than both the cache's newest and the
			// payload it just refused.
			seedDuplicateCacheEntries(store, [1, 5, 2]);
			mockRepo.getBySlug.mockResolvedValue(createMockScreen({ id: 10, name: 'v3', stateVersion: 3 }));

			const loaded = await store.loadScreenBySlug(1, 'screen');

			expect(loaded!.stateVersion).toBe(5);
			expect(store.activeScreen!.stateVersion).toBe(5);
		});

		it('does not let a slug load that raced a settled save overwrite it', async () => {
			// The interleaving item 3 of #261 is about, reached the only way it can be
			// reached: a client that both writes and loads by slug. The loader nulls
			// `activeScreen` before its GET, so the holder the comparison reads here is
			// `screens` — which is exactly where a writing client's save lands, since
			// `updateScreenConfig` refuses a Screen it does not hold there.
			vi.useFakeTimers();
			store.screens = [createMockScreen({ id: 5, slug: 'main', screenConfig: { width: 100 }, stateVersion: 3 })];

			let serveLoad: (screen: unknown) => void = () => {};
			mockRepo.getBySlug.mockReturnValueOnce(new Promise((resolve) => {
				serveLoad = resolve;
			}));
			const load = store.loadScreenBySlug(1, 'main');

			const saved = createMockScreen({ id: 5, slug: 'main', screenConfig: { width: 1920 }, stateVersion: 4 });
			mockRepo.updateScreenConfig.mockResolvedValue(saved);
			const save = store.updateScreenConfig(1, 5, { width: 1920 });
			await vi.advanceTimersByTimeAsync(300);
			await save;

			// Served before that save committed, so it answers with the revision the save
			// superseded.
			serveLoad(createMockScreen({ id: 5, slug: 'main', screenConfig: { width: 100 }, stateVersion: 3 }));
			const loaded = await load;

			expect(store.activeScreen!.screenConfig).toEqual({ width: 1920 });
			expect(loaded!.screenConfig).toEqual({ width: 1920 });
			vi.useRealTimers();
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

		it('refuses an answer older than the cached revision, and answers with the cached one', async () => {
			store.screens = [createMockScreen({ id: 5, name: 'Saved', stateVersion: 4 })];
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
			store.screens = [createMockScreen({ id: 5, name: 'Old', stateVersion: 4 })];
			mockRepo.getById.mockResolvedValue(createMockScreen({ id: 5, name: 'Fresh', stateVersion: 4 }));

			await store.getScreenById(1, 5);

			expect(store.screens[0]!.name).toBe('Fresh');
		});

		it('answers null and reports the transport line when the authority wrote no sentence', async () => {
			// A 5xx body is the server failing rather than answering, and its prose has
			// been rewritten to a placeholder on the way out — so what is left to report
			// is the status line, which at least reads as machinery.
			mockRepo.getById.mockRejectedValue(transportFailure({
				status: 500,
				body: { statusCode: 500, statusMessage: 'Internal Server Error', message: 'Internal Server Error' },
				request: GET_BY_ID_REQUEST,
			}));

			const answer = await store.getScreenById(1, 10);

			expect(answer).toBeNull();
			expect(store.error).toBe(`${GET_BY_ID_REQUEST}: 500 Internal Server Error`);
		});

		it('does not let a load that raced a settled save overwrite it', async () => {
			// Same interleaving as the list refresh above, reached through the single
			// Screen load the configuration page runs on mount and on route change.
			vi.useFakeTimers();
			store.screens = [createMockScreen({ id: 5, screenConfig: { width: 100 }, stateVersion: 3 })];

			let serveLoad: (screen: unknown) => void = () => {};
			mockRepo.getById.mockReturnValueOnce(new Promise((resolve) => {
				serveLoad = resolve;
			}));
			const load = store.getScreenById(1, 5);

			const saved = createMockScreen({ id: 5, screenConfig: { width: 1920 }, stateVersion: 4 });
			mockRepo.updateScreenConfig.mockResolvedValue(saved);
			const save = store.updateScreenConfig(1, 5, { width: 1920 });
			await vi.advanceTimersByTimeAsync(300);
			await save;
			expect(store.screens[0]!.screenConfig).toEqual({ width: 1920 });

			serveLoad(createMockScreen({ id: 5, screenConfig: { width: 100 }, stateVersion: 3 }));
			const loaded = await load;

			expect(store.screens[0]!.screenConfig).toEqual({ width: 1920 });
			expect(loaded!.screenConfig).toEqual({ width: 1920 });
			vi.useRealTimers();
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

		it('holds one entry when two creates answer with the same id', async () => {
			// The push used to be unconditional, so this left two entries for id 10 —
			// the duplicate #251's review constructed through the public store API, and
			// the state in which the version comparison and the revision a refusal
			// answers with could name different entries (#261).
			mockRepo.create
				.mockResolvedValueOnce(createMockScreen({ id: 10, name: 'first', stateVersion: 1 }))
				.mockResolvedValueOnce(createMockScreen({ id: 10, name: 'second', stateVersion: 2 }));

			await store.createScreen(1, { name: 'Screen', slug: 'screen', currentMode: 'idle' });
			await store.createScreen(1, { name: 'Screen', slug: 'screen', currentMode: 'idle' });

			expect(store.screens.map(s => s.id)).toEqual([10]);
			expect(store.screens[0]!.name).toBe('second');
		});

		it('keeps the newer held revision when a create answers with an older one', async () => {
			// Collision semantics, decided: newest wins, through the same selection every
			// other door into `screens` uses. A create's answer is refused exactly when a
			// load's would be, so no door can move a Screen's `stateVersion` backwards.
			store.screens = [createMockScreen({ id: 10, name: 'Saved', stateVersion: 4 })];
			mockRepo.create.mockResolvedValue(createMockScreen({ id: 10, name: 'Created', stateVersion: 3 }));

			const created = await store.createScreen(1, { name: 'Screen', slug: 'screen', currentMode: 'idle' });

			expect(store.screens.map(s => s.name)).toEqual(['Saved']);
			// Unlike a loader — whose caller mirrors the answer into its own view of the
			// cache — nothing mirrors this one: the create modal names the Screen in a
			// success toast, and otherwise reads the answer only to tell success from
			// failure. So it is handed what the server made, not the entry sharing the id.
			expect(created!.name).toBe('Created');
		});

		it('takes a create answering at the revision the cache already holds', async () => {
			store.screens = [createMockScreen({ id: 10, name: 'Old', stateVersion: 4 })];
			mockRepo.create.mockResolvedValue(createMockScreen({ id: 10, name: 'Fresh', stateVersion: 4 }));

			await store.createScreen(1, { name: 'Screen', slug: 'screen', currentMode: 'idle' });

			expect(store.screens.map(s => s.name)).toEqual(['Fresh']);
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

		/*
		 * The three facts a refused write produces, which the removed `executeAction`
		 * stand-in could produce none of: it rethrew, and it ignored `errorRef`
		 * entirely. So a suite could not have told a store that reports refusals from
		 * one that reports nothing (#311).
		 */
		it('answers null, rolls the optimistic edit back, and reports what the authority said', async () => {
			const screen = createMockScreen({ id: 1, name: 'Old', stateVersion: 2 });
			store.screens = [screen];
			// Deliberately not a 409: that status is the conflict-refresh-and-retry
			// path, and this row is about what a plain refusal produces.
			mockRepo.update.mockRejectedValue(transportFailure({
				status: 403,
				body: { statusCode: 403, statusMessage: 'Forbidden', message: 'This Screen belongs to another Event' },
				request: UPDATE_REQUEST,
			}));

			const answer = await store.updateScreen(1, 1, { name: 'Updated' });

			expect(answer).toBeNull();
			expect(store.screens[0]!.name).toBe('Old');
			expect(store.error).toBe('This Screen belongs to another Event');
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

import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE_CONFLICT_CODE } from '~~/shared/utils/stateConflict';
import { createMockScreen } from '~~/test/helpers/fixtures';

/**
 * The Screen store's writes against everything else that can move a held Screen
 * while they are out (#703): an announcement's reload, a newer local edit, a
 * conflict refresh, and the end of the Event Lifetime they began in.
 *
 * Every answer is served by the test, so the order under test is the test's.
 */

const mockRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	getBySlug: vi.fn(),
	getScreenOutputById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	updateModeConfig: vi.fn(),
	updateScreenConfig: vi.fn(),
	remove: vi.fn(),
};

mockNuxtImport('useScreenRepository', () => () => mockRepo);
mockNuxtImport('useToast', () => () => ({ add: vi.fn() }));

function stateConflictFailure() {
	return { statusCode: 409, data: { data: { code: STATE_CONFLICT_CODE } } };
}

interface Served<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
}

function served<T = Screen>(): Served<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Waits out the store's own debounce, so the write is on the wire. */
async function sendPending() {
	await vi.advanceTimersByTimeAsync(1_000);
}

describe('screen store writes and what overtakes them', () => {
	let store: ReturnType<typeof useScreenStore>;

	beforeEach(() => {
		vi.useFakeTimers();
		store = useScreenStore();
		store.$reset();
		vi.clearAllMocks();
		store.currentEventId = 1;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('a write answered after a newer revision was held', () => {
		it('keeps the newer revision a reload brought while a mode-configuration write was out', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, modeConfigs: { metagame: { topN: 8 } } })];
			const write = served();
			mockRepo.updateModeConfig.mockReturnValueOnce(write.promise);

			const save = store.updateModeConfig(1, 1, 'metagame', { topN: 16 });
			await sendPending();

			// Another operator's write lands after this one and is announced.
			const v3 = createMockScreen({ id: 1, stateVersion: 3, name: 'Renamed', modeConfigs: { metagame: { topN: 16 } } });
			mockRepo.getById.mockResolvedValueOnce(v3);
			await store.applyRemoteUpdated({ eventId: 1, screenId: 1 } as never);

			write.resolve(createMockScreen({ id: 1, stateVersion: 2, modeConfigs: { metagame: { topN: 16 } } }));
			const answered = await save;

			expect(store.screens[0]!.stateVersion).toBe(3);
			expect(store.screens[0]!.name).toBe('Renamed');
			expect(answered?.stateVersion).toBe(3);
		});

		it('keeps the newer revision a reload brought while a Screen-configuration write was out', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, screenConfig: { background: '#000' } })];
			const write = served();
			mockRepo.updateScreenConfig.mockReturnValueOnce(write.promise);

			const save = store.updateScreenConfig(1, 1, { background: '#fff' });
			await sendPending();
			mockRepo.getById.mockResolvedValueOnce(createMockScreen({ id: 1, stateVersion: 3, name: 'Renamed', screenConfig: { background: '#fff' } }));
			await store.applyRemoteUpdated({ eventId: 1, screenId: 1 } as never);

			write.resolve(createMockScreen({ id: 1, stateVersion: 2, screenConfig: { background: '#fff' } }));
			const answered = await save;

			expect(store.screens[0]!).toMatchObject({ stateVersion: 3, name: 'Renamed' });
			expect(answered?.stateVersion).toBe(3);
		});

		it('keeps the newer revision a reload brought while an ordinary Screen update was out', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, name: 'One' })];
			const write = served();
			mockRepo.update.mockReturnValueOnce(write.promise);

			const save = store.updateScreen(1, 1, { currentMode: 'card' });
			await vi.advanceTimersByTimeAsync(0);
			mockRepo.getById.mockResolvedValueOnce(createMockScreen({ id: 1, stateVersion: 3, name: 'Renamed', currentMode: 'card' }));
			await store.applyRemoteUpdated({ eventId: 1, screenId: 1 } as never);

			write.resolve(createMockScreen({ id: 1, stateVersion: 2, name: 'One', currentMode: 'card' }));
			const answered = await save;

			expect(store.screens[0]!).toMatchObject({ stateVersion: 3, name: 'Renamed', currentMode: 'card' });
			expect(answered?.stateVersion).toBe(3);
		});

		it('keeps the newer revision when a conflict refresh answers with an older one, and retries onto the newest', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, modeConfigs: { metagame: { topN: 8 } } })];
			const refresh = served();
			const retry = served();
			mockRepo.updateModeConfig
				.mockRejectedValueOnce(stateConflictFailure())
				.mockReturnValueOnce(retry.promise);
			mockRepo.getById
				.mockReturnValueOnce(refresh.promise)
				.mockResolvedValueOnce(createMockScreen({ id: 1, stateVersion: 3, name: 'Renamed', modeConfigs: { metagame: { topN: 8 } } }));

			const save = store.updateModeConfig(1, 1, 'metagame', { topN: 16 });
			await sendPending();
			// The announcement's reload lands before the conflict's own refresh.
			await store.applyRemoteUpdated({ eventId: 1, screenId: 1 } as never);
			refresh.resolve(createMockScreen({ id: 1, stateVersion: 2, modeConfigs: { metagame: { topN: 8 } } }));
			await vi.advanceTimersByTimeAsync(0);

			expect(store.screens[0]!.stateVersion).toBe(3);
			expect(store.screens[0]!.modeConfigs?.metagame).toEqual({ topN: 16 });
			expect(mockRepo.updateModeConfig).toHaveBeenLastCalledWith(1, 1, 'metagame', { topN: 16 }, 3);
			retry.resolve(createMockScreen({ id: 1, stateVersion: 4, name: 'Renamed', modeConfigs: { metagame: { topN: 16 } } }));
			const answered = await save;
			expect(answered?.stateVersion).toBe(4);
			expect(store.screens[0]!).toMatchObject({ stateVersion: 4, name: 'Renamed' });
		});
	});

	describe('a failed write', () => {
		it('rolls back only its own field, keeping a remote change that landed meanwhile', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, modeConfigs: { metagame: { topN: 8 } } })];
			const write = served();
			mockRepo.updateModeConfig.mockReturnValueOnce(write.promise);

			const save = store.updateModeConfig(1, 1, 'metagame', { topN: 16 });
			await sendPending();
			mockRepo.getById.mockResolvedValueOnce(createMockScreen({ id: 1, stateVersion: 2, name: 'Renamed', modeConfigs: { metagame: { topN: 8, minPoints: 3 } } }));
			await store.applyRemoteUpdated({ eventId: 1, screenId: 1 } as never);
			// The reload does not take back the edit still out.
			expect(store.screens[0]!.modeConfigs?.metagame).toMatchObject({ topN: 16, minPoints: 3 });

			write.reject(new Error('Refused'));
			await expect(save).rejects.toThrow('Refused');

			expect(store.screens[0]!).toMatchObject({ stateVersion: 2, name: 'Renamed' });
			expect(store.screens[0]!.modeConfigs?.metagame).toEqual({ topN: 8, minPoints: 3 });
		});

		it('keeps a newer local edit, of the same field or another, made while it was out', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, modeConfigs: { metagame: { topN: 8, limit: 50 } } })];
			const first = served();
			mockRepo.updateModeConfig
				.mockReturnValueOnce(first.promise)
				.mockResolvedValueOnce(createMockScreen({ id: 1, stateVersion: 2, modeConfigs: { metagame: { topN: 32, limit: 20 } } }));

			const firstSave = store.updateModeConfig(1, 1, 'metagame', { topN: 16 });
			await sendPending();
			const secondSave = store.updateModeConfig(1, 1, 'metagame', { topN: 32, limit: 20 });

			first.reject(new Error('Refused'));
			await expect(firstSave).rejects.toThrow('Refused');
			expect(store.screens[0]!.modeConfigs?.metagame).toEqual({ topN: 32, limit: 20 });

			await sendPending();
			await secondSave;
			expect(store.screens[0]!.modeConfigs?.metagame).toEqual({ topN: 32, limit: 20 });
		});

		it('rolls back an ordinary Screen update without taking back a configuration edit still out', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, name: 'One', screenConfig: { background: '#000' } })];
			const rename = served();
			const config = served();
			mockRepo.update.mockReturnValueOnce(rename.promise);
			mockRepo.updateScreenConfig.mockReturnValueOnce(config.promise);

			const renaming = store.updateScreen(1, 1, { name: 'Renamed' });
			const configuring = store.updateScreenConfig(1, 1, { background: '#fff' });
			rename.resolve(null as never);
			rename.promise.catch(() => {});
			await vi.advanceTimersByTimeAsync(0);
			expect(store.screens[0]!.screenConfig).toEqual({ background: '#fff' });

			await sendPending();
			config.resolve(createMockScreen({ id: 1, stateVersion: 2, name: 'One', screenConfig: { background: '#fff' } }));
			await Promise.allSettled([renaming, configuring]);
			expect(store.screens[0]!).toMatchObject({ name: 'One', screenConfig: { background: '#fff' } });
		});
	});

	describe('a failed write of a Screen deleted meanwhile', () => {
		it('does not bring the Screen back', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, screenConfig: { background: '#000' } })];
			const write = served();
			mockRepo.updateScreenConfig.mockReturnValueOnce(write.promise);

			const save = store.updateScreenConfig(1, 1, { background: '#fff' });
			await sendPending();
			store.applyRemoteDeleted({ eventId: 1, screenId: 1 } as never);
			write.reject(Object.assign(new Error('Screen not found'), { statusCode: 404 }));
			await expect(save).rejects.toThrow('Screen not found');

			expect(store.screens).toEqual([]);
		});
	});

	describe('simultaneous edits of independent settings', () => {
		it('settle without one erasing the other', async () => {
			// A server holding one revision and refusing a write made against an older one.
			let held = createMockScreen({ id: 1, stateVersion: 1, modeConfigs: { metagame: { topN: 8 } }, screenConfig: { background: '#000' } });
			const commit = (version: number, change: Partial<Screen>) => {
				if (version !== held.stateVersion)
					return Promise.reject(stateConflictFailure());
				held = { ...held, ...change, stateVersion: held.stateVersion + 1 };
				return Promise.resolve(structuredClone(held));
			};
			mockRepo.getById.mockImplementation(async () => structuredClone(held));
			mockRepo.updateModeConfig.mockImplementation(async (_e, _s, mode: 'metagame', patch, version: number) =>
				commit(version, { modeConfigs: { ...held.modeConfigs, [mode]: { ...held.modeConfigs?.[mode], ...patch } } }));
			mockRepo.updateScreenConfig.mockImplementation(async (_e, _s, patch, version: number) =>
				commit(version, { screenConfig: { ...held.screenConfig, ...patch } }));
			mockRepo.update.mockImplementation(async (_e, _s, { stateVersion, ...change }) => commit(stateVersion, change));
			store.screens = [structuredClone(held)];

			const saves = Promise.all([
				store.updateModeConfig(1, 1, 'metagame', { topN: 16 }),
				store.updateModeConfig(1, 1, 'metagame', { limit: 20 }),
				store.updateScreenConfig(1, 1, { background: '#fff' }),
				store.updateScreen(1, 1, { name: 'Renamed' }),
			]);
			await sendPending();
			await saves;

			expect(held).toMatchObject({ name: 'Renamed', modeConfigs: { metagame: { topN: 16, limit: 20 } }, screenConfig: { background: '#fff' } });
			expect(store.screens[0]!).toEqual(held);
		});
	});

	/**
	 * The operator moves to Event 2 while Event 1's writes are out. They finish for
	 * Event 1 and its Screen, and touch nothing of Event 2's (ADR-0024).
	 */
	describe('a write that outlives its Event Lifetime', () => {
		const eventTwoScreen = createMockScreen({ id: 1, eventId: 2, stateVersion: 7, name: 'Event two', modeConfigs: { metagame: { topN: 4 } } });

		async function moveToEventTwo() {
			store.$reset();
			mockRepo.list.mockResolvedValueOnce([eventTwoScreen]);
			await store.loadScreensByEventId(2);
		}

		it('sends a write queued behind one in flight at the revision that one answers with', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, modeConfigs: { metagame: { topN: 8 } } })];
			const first = served();
			const second = served();
			mockRepo.updateModeConfig
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise);

			const firstSave = store.updateModeConfig(1, 1, 'metagame', { topN: 16 });
			await sendPending();
			const secondSave = store.updateModeConfig(1, 1, 'metagame', { limit: 20 });
			await moveToEventTwo();

			first.resolve(createMockScreen({ id: 1, stateVersion: 2, modeConfigs: { metagame: { topN: 16 } } }));
			await expect(firstSave).resolves.toMatchObject({ stateVersion: 2 });
			await vi.advanceTimersByTimeAsync(0);
			expect(mockRepo.updateModeConfig).toHaveBeenLastCalledWith(1, 1, 'metagame', { limit: 20 }, 2);
			second.resolve(createMockScreen({ id: 1, stateVersion: 3, modeConfigs: { metagame: { topN: 16, limit: 20 } } }));
			await expect(secondSave).resolves.toMatchObject({ stateVersion: 3 });

			expect(store.screens).toEqual([eventTwoScreen]);
		});

		it('retries a lost race for its own Event at the revision the refresh found', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, screenConfig: { background: '#000' } })];
			const conflict = served();
			mockRepo.updateScreenConfig
				.mockReturnValueOnce(conflict.promise)
				.mockResolvedValueOnce(createMockScreen({ id: 1, stateVersion: 6, screenConfig: { background: '#fff' } }));
			mockRepo.getById.mockResolvedValueOnce(createMockScreen({ id: 1, stateVersion: 5, screenConfig: { background: '#000' } }));

			const save = store.updateScreenConfig(1, 1, { background: '#fff' });
			await sendPending();
			await moveToEventTwo();
			conflict.reject(stateConflictFailure());

			await expect(save).resolves.toMatchObject({ stateVersion: 6 });
			expect(mockRepo.getById).toHaveBeenCalledWith(1, 1);
			expect(mockRepo.updateScreenConfig).toHaveBeenLastCalledWith(1, 1, { background: '#fff' }, 5);
			expect(store.screens).toEqual([eventTwoScreen]);
		});

		it('rejects its caller when refused, and leaves the next Event its own state and error', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, modeConfigs: { metagame: { topN: 8 } } })];
			const write = served();
			mockRepo.updateModeConfig.mockReturnValueOnce(write.promise);

			const save = store.updateModeConfig(1, 1, 'metagame', { topN: 16 });
			await sendPending();
			await moveToEventTwo();
			write.reject(new Error('Refused'));

			await expect(save).rejects.toThrow('Refused');
			expect(store.screens).toEqual([eventTwoScreen]);
			expect(store.error).toBeNull();
		});

		it('caches no late answer into the next Event, and answers its caller with it', async () => {
			store.screens = [createMockScreen({ id: 1, stateVersion: 1, screenConfig: { background: '#000' } })];
			const write = served();
			mockRepo.updateScreenConfig.mockReturnValueOnce(write.promise);

			const save = store.updateScreenConfig(1, 1, { background: '#fff' });
			await sendPending();
			await moveToEventTwo();
			const answer = createMockScreen({ id: 1, stateVersion: 2, screenConfig: { background: '#fff' } });
			write.resolve(answer);

			await expect(save).resolves.toEqual(answer);
			expect(store.screens).toEqual([eventTwoScreen]);
		});
	});
});

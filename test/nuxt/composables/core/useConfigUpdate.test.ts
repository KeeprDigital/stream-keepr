import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = { add: vi.fn() };
mockNuxtImport('useToast', () => () => mockToast);

describe('useConfigUpdate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	interface TestConfig {
		color: string;
		size: number;
	}

	function createTestSetup(overrides?: Partial<TestConfig>) {
		const storeConfig = ref<Partial<TestConfig>>(overrides ?? {});
		const saveToStore = vi.fn().mockResolvedValue(undefined);

		const { config, saving, updateConfig } = useConfigUpdate<TestConfig>({
			getStoreConfig: () => storeConfig.value,
			saveToStore,
			defaults: { color: 'red', size: 10 },
			debounceMs: 100,
			errorMessage: 'Test error',
		});

		return { config, saving, updateConfig, storeConfig, saveToStore };
	}

	function deferred<T = void>() {
		let resolve!: (value: T | PromiseLike<T>) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<T>((promiseResolve, promiseReject) => {
			resolve = promiseResolve;
			reject = promiseReject;
		});
		return { promise, resolve, reject };
	}

	it('returns merged config with defaults', () => {
		const { config } = createTestSetup();
		expect(config.value).toEqual({ color: 'red', size: 10 });
	});

	it('merges store config over defaults', () => {
		const { config } = createTestSetup({ color: 'blue' });
		expect(config.value.color).toBe('blue');
		expect(config.value.size).toBe(10);
	});

	it('applies local overrides immediately on updateConfig', () => {
		const { config, updateConfig } = createTestSetup();

		updateConfig({ color: 'green' });
		expect(config.value.color).toBe('green');
	});

	it('sets saving to true when updateConfig is called', () => {
		const { saving, updateConfig } = createTestSetup();

		updateConfig({ color: 'green' });
		expect(saving.value).toBe(true);
	});

	it('batches multiple updates into a single save', async () => {
		const { updateConfig, saveToStore } = createTestSetup();

		updateConfig({ color: 'green' });
		updateConfig({ size: 20 });

		await vi.advanceTimersByTimeAsync(200);
		expect(saveToStore).toHaveBeenCalledOnce();
		expect(saveToStore).toHaveBeenCalledWith({ color: 'green', size: 20 });
	});

	it('serializes saves and flushes edits made while a save is in flight', async () => {
		const storeConfig = ref<Partial<TestConfig>>({});
		const firstSave = deferred();
		const secondSave = deferred();
		const saveToStore = vi
			.fn()
			.mockImplementationOnce(() => firstSave.promise)
			.mockImplementationOnce(() => secondSave.promise);

		const { updateConfig } = useConfigUpdate<TestConfig>({
			getStoreConfig: () => storeConfig.value,
			saveToStore,
			defaults: { color: 'red', size: 10 },
			debounceMs: 100,
		});

		updateConfig({ color: 'green' });
		await vi.advanceTimersByTimeAsync(100);
		expect(saveToStore).toHaveBeenCalledOnce();

		updateConfig({ size: 20 });
		await vi.advanceTimersByTimeAsync(200);
		expect(saveToStore).toHaveBeenCalledOnce();

		firstSave.resolve();
		await vi.advanceTimersByTimeAsync(0);

		expect(saveToStore).toHaveBeenCalledTimes(2);
		expect(saveToStore).toHaveBeenNthCalledWith(1, { color: 'green' });
		expect(saveToStore).toHaveBeenNthCalledWith(2, { size: 20 });
	});

	it('keeps newer local edits when an older in-flight save fails', async () => {
		const storeConfig = ref<Partial<TestConfig>>({});
		const firstSave = deferred();
		const secondSave = deferred();
		const saveToStore = vi
			.fn()
			.mockImplementationOnce(() => firstSave.promise)
			.mockImplementationOnce(() => secondSave.promise);

		const { config, updateConfig } = useConfigUpdate<TestConfig>({
			getStoreConfig: () => storeConfig.value,
			saveToStore,
			defaults: { color: 'red', size: 10 },
			debounceMs: 100,
			errorMessage: 'Test error',
		});

		updateConfig({ color: 'green' });
		await vi.advanceTimersByTimeAsync(100);

		updateConfig({ color: 'blue' });
		firstSave.reject(new Error('failed'));
		await vi.advanceTimersByTimeAsync(0);

		expect(config.value.color).toBe('blue');
		expect(saveToStore).toHaveBeenCalledTimes(2);
		expect(saveToStore).toHaveBeenNthCalledWith(2, { color: 'blue' });

		storeConfig.value = { color: 'blue' };
		secondSave.resolve();
		await vi.advanceTimersByTimeAsync(0);
		expect(config.value.color).toBe('blue');
	});

	it('treats a null store result as a failed save and retains the local override for retry', async () => {
		const storeConfig = ref<Partial<TestConfig>>({ color: 'red' });
		const saveToStore = vi.fn()
			.mockResolvedValueOnce(null)
			.mockImplementationOnce(async (updates: Partial<TestConfig>) => {
				storeConfig.value = { ...storeConfig.value, ...updates };
				return { ok: true };
			});

		const { config, saving, saveError, updateConfig, retry } = useConfigUpdate<TestConfig>({
			getStoreConfig: () => storeConfig.value,
			saveToStore,
			defaults: { color: 'red', size: 10 },
			debounceMs: 100,
			errorMessage: 'Test error',
		});

		updateConfig({ color: 'green' });
		await vi.advanceTimersByTimeAsync(100);

		expect(config.value.color).toBe('green');
		expect(saveError.value).toBe('Test error');
		expect(saving.value).toBe(false);

		await retry();
		expect(saveToStore).toHaveBeenCalledTimes(2);
		expect(saveToStore).toHaveBeenLastCalledWith({ color: 'green' });
		expect(saveError.value).toBeNull();
		expect(config.value.color).toBe('green');
	});

	/*
	 * Disposal used to cancel the pending write, and this suite pinned that (#308).
	 *
	 * Local-first is what made it silent: the edit is applied to `localOverrides` the
	 * moment it is made, so the operator has already been shown it as saved. Navigate
	 * away inside the three hundred milliseconds and the write that would have made
	 * that true never happened — the setting reverts, and nothing anywhere says so.
	 * A disposal is the last moment the intent exists, so it is the moment to spend
	 * it, not the moment to discard it.
	 */
	it('flushes a pending debounced save when its component scope is disposed', async () => {
		const scope = effectScope();
		const saveToStore = vi.fn().mockResolvedValue({ ok: true });

		scope.run(() => {
			const { updateConfig } = useConfigUpdate<TestConfig>({
				getStoreConfig: () => ({}),
				saveToStore,
				defaults: { color: 'red', size: 10 },
				debounceMs: 100,
			});
			updateConfig({ color: 'green' });
		});
		scope.stop();
		await vi.advanceTimersByTimeAsync(0);

		expect(saveToStore).toHaveBeenCalledWith({ color: 'green' });
	});

	it('writes nothing on a disposal with no edit waiting', async () => {
		const scope = effectScope();
		const saveToStore = vi.fn().mockResolvedValue({ ok: true });

		scope.run(() => {
			useConfigUpdate<TestConfig>({
				getStoreConfig: () => ({}),
				saveToStore,
				defaults: { color: 'red', size: 10 },
				debounceMs: 100,
			});
		});
		scope.stop();
		await vi.advanceTimersByTimeAsync(200);

		expect(saveToStore).not.toHaveBeenCalled();
	});

	it('still writes an edit made while an earlier save was in flight when disposed', async () => {
		const scope = effectScope();
		const first = deferred<{ ok: boolean }>();
		const saveToStore = vi.fn()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValue({ ok: true });

		const { updateConfig } = scope.run(() => useConfigUpdate<TestConfig>({
			getStoreConfig: () => ({}),
			saveToStore,
			defaults: { color: 'red', size: 10 },
			debounceMs: 100,
		}))!;

		updateConfig({ color: 'green' });
		await vi.advanceTimersByTimeAsync(100);
		updateConfig({ size: 20 });
		scope.stop();
		first.resolve({ ok: true });
		await vi.advanceTimersByTimeAsync(200);

		// The queued edit is picked up by the in-flight save's own continuation, so
		// disposal must not empty the queue out from under it.
		expect(saveToStore).toHaveBeenCalledTimes(2);
		expect(saveToStore).toHaveBeenLastCalledWith({ size: 20 });
	});

	it('filters out null values from merged config', () => {
		const { config, updateConfig } = createTestSetup();

		updateConfig({ color: null } as any);
		// null values are treated as "unset" and filtered from config
		expect(config.value.color).toBeUndefined();
	});
});

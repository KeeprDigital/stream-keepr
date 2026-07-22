import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('useAsyncAction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the result of a successful action', async () => {
		const { executeAction } = useAsyncAction();
		const result = await executeAction(async () => 'success');
		expect(result).toBe('success');
	});

	it('sets loadingRef to true during execution and false after', async () => {
		const { executeAction } = useAsyncAction();
		const loading = ref(false);
		let loadingDuringExec = false;

		await executeAction(async () => {
			loadingDuringExec = loading.value;
			return 'done';
		}, { loadingRef: loading });

		expect(loadingDuringExec).toBe(true);
		expect(loading.value).toBe(false);
	});

	it('clears errorRef before execution', async () => {
		const { executeAction } = useAsyncAction();
		const error = ref<string | null>('previous error');

		await executeAction(async () => 'ok', { errorRef: error });
		expect(error.value).toBeNull();
	});

	it('sets errorRef on failure', async () => {
		const { executeAction } = useAsyncAction();
		const error = ref<string | null>(null);

		await executeAction(async () => {
			throw new Error('test error');
		}, { errorRef: error });

		expect(error.value).toBe('test error');
	});

	it('returns null on failure by default', async () => {
		const { executeAction } = useAsyncAction();

		const result = await executeAction(async () => {
			throw new Error('fail');
		});

		expect(result).toBeNull();
	});

	it('calls onError callback on failure', async () => {
		const { executeAction } = useAsyncAction();
		const onError = vi.fn();

		await executeAction(async () => {
			throw new Error('fail');
		}, { onError });

		expect(onError).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(expect.any(Error));
	});

	it('sets loadingRef to false even on failure', async () => {
		const { executeAction } = useAsyncAction();
		const loading = ref(false);

		await executeAction(async () => {
			throw new Error('fail');
		}, { loadingRef: loading });

		expect(loading.value).toBe(false);
	});

	it('handles non-Error thrown values with generic message', async () => {
		const { executeAction } = useAsyncAction();
		const error = ref<string | null>(null);

		await executeAction(async () => {
			throw 'string error'; // eslint-disable-line no-throw-literal
		}, { errorRef: error });

		expect(error.value).toBe('An error occurred');
	});
});

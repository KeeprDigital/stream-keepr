import { describe, expect, it, vi } from 'vitest';

describe('useAsyncAction', () => {
	it('answers a successful action, loading while it runs and clearing a stale error', async () => {
		const { executeAction } = useAsyncAction();
		const loading = ref(false);
		const error = ref<string | null>('previous error');
		let loadingWhileRunning = false;

		const result = await executeAction(async () => {
			loadingWhileRunning = loading.value;
			return 'done';
		}, { loadingRef: loading, errorRef: error });

		expect(result).toBe('done');
		expect(loadingWhileRunning).toBe(true);
		expect(loading.value).toBe(false);
		expect(error.value).toBeNull();
	});

	it.each([
		['an Error', new Error('test error'), 'test error'],
		['anything else', 'string error', 'An error occurred'],
	])('answers null for a throw of %s, reporting it and ending the load', async (_, thrown, message) => {
		const { executeAction } = useAsyncAction();
		const loading = ref(false);
		const error = ref<string | null>(null);
		const onError = vi.fn();

		const result = await executeAction(async () => {
			throw thrown;
		}, { loadingRef: loading, errorRef: error, onError });

		expect(result).toBeNull();
		expect(error.value).toBe(message);
		expect(loading.value).toBe(false);
		expect(onError).toHaveBeenCalledOnce();
	});
});

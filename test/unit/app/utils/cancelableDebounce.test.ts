import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCancelableDebounce } from '~~/app/utils/cancelableDebounce';

describe('createCancelableDebounce', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('coalesces calls and honours the maximum wait', async () => {
		const callback = vi.fn();
		const debounce = createCancelableDebounce(callback, 100, 250);

		debounce.schedule();
		await vi.advanceTimersByTimeAsync(80);
		debounce.schedule();
		await vi.advanceTimersByTimeAsync(80);
		debounce.schedule();
		await vi.advanceTimersByTimeAsync(90);

		expect(callback).toHaveBeenCalledOnce();
	});

	it('cancels a scheduled callback', async () => {
		const callback = vi.fn();
		const debounce = createCancelableDebounce(callback, 100, 250);
		debounce.schedule();
		debounce.cancel();

		await vi.advanceTimersByTimeAsync(300);
		expect(callback).not.toHaveBeenCalled();
	});
});

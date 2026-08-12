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

	describe('flushIfPending', () => {
		it('fires the waiting call and disarms the timers', async () => {
			const callback = vi.fn();
			const debounce = createCancelableDebounce(callback, 100, 250);
			debounce.schedule();

			debounce.flushIfPending();
			await vi.advanceTimersByTimeAsync(300);

			expect(callback).toHaveBeenCalledOnce();
		});

		it('stays quiet when nothing is waiting', async () => {
			const callback = vi.fn();
			const debounce = createCancelableDebounce(callback, 100, 250);

			debounce.flushIfPending();
			await vi.advanceTimersByTimeAsync(300);

			expect(callback).not.toHaveBeenCalled();
		});

		it('stays quiet after a call it already made', async () => {
			// Callers flush on a lifecycle event — a disposal, an Event scope ending —
			// and those arrive whether or not an edit is waiting. One that fired anyway
			// would turn every such event into a write.
			const callback = vi.fn();
			const debounce = createCancelableDebounce(callback, 100, 250);
			debounce.schedule();
			await vi.advanceTimersByTimeAsync(100);

			debounce.flushIfPending();

			expect(callback).toHaveBeenCalledOnce();
		});
	});
});

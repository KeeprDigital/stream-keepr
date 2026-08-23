import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';

const mockRead = vi.fn();
const onAuthorizationLost = vi.fn();
const onReading = vi.fn();
let paused = false;

function mountReading() {
	let result!: ReturnType<typeof useGraphicsAdminReading<{ count: number }>>;
	const wrapper = mount(defineComponent({
		setup() {
			result = useGraphicsAdminReading<{ count: number }>({
				read: mockRead,
				failureMessage: 'The reading failed.',
				onAuthorizationLost,
				onReading,
				paused: () => paused,
			});
			return () => h('div');
		},
	}));

	return { wrapper, ...result };
}

const authorizationRefusal = transportFailure({
	status: 403,
	body: { message: 'Graphics Administrator authorization is required' },
});

describe('useGraphicsAdminReading', () => {
	beforeEach(() => {
		mockRead.mockReset();
		onAuthorizationLost.mockReset();
		onReading.mockReset();
		paused = false;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('takes a reading with the administrator token in its headers', async () => {
		mockRead.mockResolvedValue({ count: 3 });

		const reading = mountReading();
		reading.administratorToken.value = 'secret-token';
		await reading.load();

		expect(mockRead).toHaveBeenCalledWith({ 'x-graphics-admin-token': 'secret-token' });
		expect(reading.reading.value).toEqual({ count: 3 });
		expect(reading.hasReading.value).toBe(true);
		expect(reading.loadError.value).toBeNull();
		expect(onReading).toHaveBeenCalledTimes(1);
	});

	it('quotes the sentence the library wrote about a refused reading', async () => {
		mockRead.mockRejectedValue(authorizationRefusal);

		const reading = mountReading();
		await reading.load();

		expect(reading.loadError.value).toBe('Graphics Administrator authorization is required');
	});

	it('drops the reading and reports the loss when the token stops being accepted', async () => {
		mockRead.mockResolvedValueOnce({ count: 3 });
		const reading = mountReading();
		await reading.load();

		mockRead.mockRejectedValueOnce(authorizationRefusal);
		await reading.load();

		expect(reading.reading.value).toBeNull();
		expect(reading.hasReading.value).toBe(false);
		expect(onAuthorizationLost).toHaveBeenCalledTimes(1);
	});

	it('keeps a stale reading on screen through a non-authorization failure', async () => {
		mockRead.mockResolvedValueOnce({ count: 3 });
		const reading = mountReading();
		await reading.load();

		mockRead.mockRejectedValueOnce(transportFailure({ status: 503, body: { message: 'The Graphics Asset Library store cannot be reached' } }));
		await reading.load();

		expect(reading.reading.value).toEqual({ count: 3 });
		expect(reading.loadError.value).toBe('The Graphics Asset Library store cannot be reached');
		expect(onAuthorizationLost).not.toHaveBeenCalled();
	});

	it('falls back to the caller\'s failure message when the failure carries none', async () => {
		mockRead.mockRejectedValue({ some: 'object' });

		const reading = mountReading();
		await reading.load();

		expect(reading.loadError.value).toBe('The reading failed.');
	});

	it('counts a throwing onReading as a failed load', async () => {
		mockRead.mockResolvedValue({ count: 3 });
		onReading.mockRejectedValue(new Error('derived state failed'));

		const reading = mountReading();
		await reading.load();

		expect(reading.loadError.value).toBe('derived state failed');
	});

	it('classifies only 401 and 403 as authorization failures', () => {
		const reading = mountReading();

		expect(reading.isAuthorizationFailure(transportFailure({ status: 401 }))).toBe(true);
		expect(reading.isAuthorizationFailure(transportFailure({ status: 403 }))).toBe(true);
		expect(reading.isAuthorizationFailure(transportFailure({ status: 409 }))).toBe(false);
		expect(reading.statusOf(transportFailure({ status: 409 }))).toBe(409);
	});

	describe('polling', () => {
		beforeEach(() => {
			// Advancing the clock exercises the poll itself; shouldAdvanceTime
			// keeps the zero-delay awaits in flushPromises() resolving.
			vi.useFakeTimers({ shouldAdvanceTime: true });
		});

		it('does not poll until a reading is being shown', async () => {
			mountReading();

			await vi.advanceTimersByTimeAsync(15_000);

			expect(mockRead).not.toHaveBeenCalled();
		});

		it('refreshes a healthy reading every five seconds', async () => {
			mockRead.mockResolvedValue({ count: 3 });
			const reading = mountReading();
			await reading.load();

			await vi.advanceTimersByTimeAsync(5000);
			await flushPromises();

			expect(mockRead).toHaveBeenCalledTimes(2);
		});

		it('holds off while the caller reports an action in flight', async () => {
			mockRead.mockResolvedValue({ count: 3 });
			const reading = mountReading();
			await reading.load();

			paused = true;
			await vi.advanceTimersByTimeAsync(15_000);

			expect(mockRead).toHaveBeenCalledTimes(1);

			paused = false;
			await vi.advanceTimersByTimeAsync(5000);
			await flushPromises();

			expect(mockRead).toHaveBeenCalledTimes(2);
		});

		it('skips ticks after failures, doubling the wait, and resets on success', async () => {
			mockRead.mockResolvedValueOnce({ count: 3 });
			const reading = mountReading();
			await reading.load();
			expect(mockRead).toHaveBeenCalledTimes(1);

			// First polled reading fails (non-authorization, so the stale reading
			// stays on screen and polling continues): one tick is now skipped.
			mockRead.mockRejectedValueOnce(transportFailure({ status: 503, body: { message: 'down' } }));
			await vi.advanceTimersByTimeAsync(5000);
			await flushPromises();
			expect(mockRead).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(5000);
			expect(mockRead).toHaveBeenCalledTimes(2);

			// Second failure: two ticks are skipped before the next attempt.
			mockRead.mockRejectedValueOnce(transportFailure({ status: 503, body: { message: 'down' } }));
			await vi.advanceTimersByTimeAsync(5000);
			await flushPromises();
			expect(mockRead).toHaveBeenCalledTimes(3);

			await vi.advanceTimersByTimeAsync(10_000);
			expect(mockRead).toHaveBeenCalledTimes(3);

			// The next attempt succeeds and resets the backoff to every tick.
			mockRead.mockResolvedValue({ count: 4 });
			await vi.advanceTimersByTimeAsync(5000);
			await flushPromises();
			expect(mockRead).toHaveBeenCalledTimes(4);

			await vi.advanceTimersByTimeAsync(5000);
			await flushPromises();
			expect(mockRead).toHaveBeenCalledTimes(5);
		});

		it('stops polling on unmount', async () => {
			mockRead.mockResolvedValue({ count: 3 });
			const reading = mountReading();
			await reading.load();

			reading.wrapper.unmount();
			await vi.advanceTimersByTimeAsync(15_000);

			expect(mockRead).toHaveBeenCalledTimes(1);
		});
	});
});

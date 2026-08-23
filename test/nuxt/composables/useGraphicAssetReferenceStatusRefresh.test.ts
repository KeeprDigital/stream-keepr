import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNuxtState } from '#app';

describe('useGraphicAssetReferenceStatusRefresh', () => {
	beforeEach(() => {
		clearNuxtState();
	});

	it('notifies watchers on every refresh request, including consecutive ones', async () => {
		const { signal, requestRefresh } = useGraphicAssetReferenceStatusRefresh();
		const seen = vi.fn();
		watch(signal, seen);

		requestRefresh();
		await nextTick();
		requestRefresh();
		await nextTick();

		expect(seen).toHaveBeenCalledTimes(2);
	});

	it('shares one signal across every consumer', async () => {
		const producer = useGraphicAssetReferenceStatusRefresh();
		const consumer = useGraphicAssetReferenceStatusRefresh();
		const seen = vi.fn();
		watch(consumer.signal, seen);

		producer.requestRefresh();
		await nextTick();

		expect(seen).toHaveBeenCalledTimes(1);
		expect(consumer.signal.value).toBe(producer.signal.value);
	});
});

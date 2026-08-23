import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockFetch);

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

function mountCapability(eventId: Ref<number>, screenId: Ref<number | undefined>) {
	let result!: ReturnType<typeof useScreenOutputAssetCapability>;
	const wrapper = mount(defineComponent({
		setup() {
			result = useScreenOutputAssetCapability(() => eventId.value, () => screenId.value);
			return () => h('div');
		},
	}));

	return { wrapper, ...result };
}

describe('useScreenOutputAssetCapability', () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	it('resolves the capability for a screen and settles', async () => {
		const load = deferred<{ assetCapability: string }>();
		mockFetch.mockReturnValue(load.promise);

		const { assetCapability, assetCapabilitySettled } = mountCapability(ref(1), ref(5));

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/screens/5/asset-capability');
		expect(assetCapability.value).toBeNull();
		expect(assetCapabilitySettled.value).toBe(false);

		load.resolve({ assetCapability: 'capability-token' });
		await flushPromises();

		expect(assetCapability.value).toBe('capability-token');
		expect(assetCapabilitySettled.value).toBe(true);
	});

	it('settles immediately without fetching when there is no screen', () => {
		const { assetCapability, assetCapabilitySettled } = mountCapability(ref(1), ref(undefined));

		expect(mockFetch).not.toHaveBeenCalled();
		expect(assetCapability.value).toBeNull();
		expect(assetCapabilitySettled.value).toBe(true);
	});

	it('settles with a null capability when the request fails', async () => {
		mockFetch.mockRejectedValue(new Error('boom'));

		const { assetCapability, assetCapabilitySettled } = mountCapability(ref(1), ref(5));
		await flushPromises();

		expect(assetCapability.value).toBeNull();
		expect(assetCapabilitySettled.value).toBe(true);
	});

	it('unsettles and refetches when the screen changes', async () => {
		mockFetch.mockResolvedValueOnce({ assetCapability: 'first' });
		const screenId = ref<number | undefined>(5);

		const { assetCapability, assetCapabilitySettled } = mountCapability(ref(1), screenId);
		await flushPromises();

		expect(assetCapability.value).toBe('first');

		const second = deferred<{ assetCapability: string }>();
		mockFetch.mockReturnValue(second.promise);
		screenId.value = 6;
		await nextTick();

		expect(mockFetch).toHaveBeenLastCalledWith('/api/events/1/screens/6/asset-capability');
		expect(assetCapability.value).toBeNull();
		expect(assetCapabilitySettled.value).toBe(false);

		second.resolve({ assetCapability: 'second' });
		await flushPromises();

		expect(assetCapability.value).toBe('second');
		expect(assetCapabilitySettled.value).toBe(true);
	});

	it('discards a superseded response that resolves after a newer one', async () => {
		const first = deferred<{ assetCapability: string }>();
		const second = deferred<{ assetCapability: string }>();
		mockFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const screenId = ref<number | undefined>(5);

		const { assetCapability } = mountCapability(ref(1), screenId);
		screenId.value = 6;
		await nextTick();

		second.resolve({ assetCapability: 'newer' });
		await flushPromises();
		first.resolve({ assetCapability: 'stale' });
		await flushPromises();

		expect(assetCapability.value).toBe('newer');
	});

	it('never applies a response that lands after unmount', async () => {
		const load = deferred<{ assetCapability: string }>();
		mockFetch.mockReturnValue(load.promise);

		const { wrapper, assetCapability, assetCapabilitySettled } = mountCapability(ref(1), ref(5));
		wrapper.unmount();

		load.resolve({ assetCapability: 'late' });
		await flushPromises();

		expect(assetCapability.value).toBeNull();
		expect(assetCapabilitySettled.value).toBe(false);
	});
});

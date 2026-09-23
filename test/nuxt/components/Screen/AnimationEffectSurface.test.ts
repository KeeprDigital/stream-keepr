import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const animationMocks = vi.hoisted(() => ({
	loadAnimationEffect: vi.fn(),
}));

vi.mock('~/utils/animation-effects', () => ({
	loadAnimationEffect: animationMocks.loadAnimationEffect,
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

function effectInstance() {
	return {
		setParams: vi.fn(),
		resize: vi.fn(),
		render: vi.fn(),
		dispose: vi.fn(),
	};
}

async function mountSurface(props: Record<string, unknown>) {
	const { default: AnimationEffectSurface } = await import('../../../../app/components/Screen/AnimationEffectSurface.vue');
	return mount(AnimationEffectSurface, { props: props as never });
}

describe('screenAnimationEffectSurface', () => {
	afterEach(() => vi.clearAllMocks());

	it('mounts the named effect with its schema defaults when no params are given, at the given size', async () => {
		const instance = effectInstance();
		const factory = vi.fn(() => instance);
		animationMocks.loadAnimationEffect.mockResolvedValue(factory);

		const wrapper = await mountSurface({ effect: 'fog', width: 1920, height: 1080 });
		await flushPromises();

		expect(animationMocks.loadAnimationEffect).toHaveBeenCalledWith('fog');
		expect(factory).toHaveBeenCalledOnce();
		const [, params] = factory.mock.calls[0] as unknown as [HTMLElement, Record<string, unknown>];
		expect(params.blurFactor).toBe(0.55);
		expect(params.highlightColor).toBe('#f59e0b');
		expect(instance.resize).toHaveBeenCalledWith(1920, 1080);

		wrapper.unmount();
		expect(instance.dispose).toHaveBeenCalledOnce();
	});

	it('applies a param change to the live instance instead of remounting', async () => {
		const instance = effectInstance();
		const factory = vi.fn(() => instance);
		animationMocks.loadAnimationEffect.mockResolvedValue(factory);

		const wrapper = await mountSurface({ effect: 'fog', width: 100, height: 100 });
		await flushPromises();

		await wrapper.setProps({ params: { blurFactor: 0.55, highlightColor: '#f59e0b', midtoneColor: '#7c3aed', lowlightColor: '#06b6d4', baseColor: '#111111', speed: 2, zoom: 1 } });
		await flushPromises();

		expect(factory).toHaveBeenCalledOnce();
		expect(instance.setParams).toHaveBeenCalledWith(expect.objectContaining({ speed: 2, blurFactor: 0.55 }));

		wrapper.unmount();
	});

	it('discards an asynchronously loaded effect when a newer effect wins the race', async () => {
		const oldLoad = deferred<unknown>();
		const newLoad = deferred<unknown>();
		const oldFactory = vi.fn(() => effectInstance());
		const newInstance = effectInstance();
		const newFactory = vi.fn(() => newInstance);
		animationMocks.loadAnimationEffect.mockImplementation((effect: string) => effect === 'fog' ? oldLoad.promise : newLoad.promise);

		const wrapper = await mountSurface({ effect: 'fog', width: 100, height: 100 });
		await flushPromises();

		await wrapper.setProps({ effect: 'caustics' });
		newLoad.resolve(newFactory);
		await flushPromises();
		oldLoad.resolve(oldFactory);
		await flushPromises();

		expect(newFactory).toHaveBeenCalledOnce();
		expect(oldFactory).not.toHaveBeenCalled();

		wrapper.unmount();
		expect(newInstance.dispose).toHaveBeenCalledOnce();
	});

	it('sizes the renderer after mount even when the ResizeObserver reports the host size while the effect is still loading', async () => {
		const load = deferred<unknown>();
		const instance = effectInstance();
		const factory = vi.fn(() => instance);
		animationMocks.loadAnimationEffect.mockReturnValue(load.promise);

		const resizeDeliveries: Array<() => void> = [];
		class StubResizeObserver {
			constructor(callback: () => void) {
				resizeDeliveries.push(callback);
			}

			observe = vi.fn();
			disconnect = vi.fn();
		}
		vi.stubGlobal('ResizeObserver', StubResizeObserver);

		try {
			// No width/height: the surface follows its own element, via the observer.
			const wrapper = await mountSurface({ effect: 'fog' });
			const host = wrapper.element as HTMLElement;
			Object.defineProperty(host, 'clientWidth', { value: 1920, configurable: true });
			Object.defineProperty(host, 'clientHeight', { value: 1080, configurable: true });

			// The observer's mandatory initial delivery lands while the effect
			// module import is still in flight — before any instance exists.
			resizeDeliveries.forEach(deliver => deliver());

			load.resolve(factory);
			await flushPromises();

			expect(instance.resize).toHaveBeenCalledWith(1920, 1080);

			wrapper.unmount();
			expect(instance.dispose).toHaveBeenCalledOnce();
		}
		finally {
			vi.unstubAllGlobals();
		}
	});

	it('disposes the old renderer when the effect changes, and mounts the new one', async () => {
		const fogInstance = effectInstance();
		const causticsInstance = effectInstance();
		animationMocks.loadAnimationEffect.mockImplementation(async (effect: string) =>
			() => effect === 'fog' ? fogInstance : causticsInstance);

		const wrapper = await mountSurface({ effect: 'fog', width: 100, height: 100 });
		await flushPromises();
		await wrapper.setProps({ effect: 'caustics' });
		await flushPromises();

		expect(fogInstance.dispose).toHaveBeenCalledOnce();
		expect(causticsInstance.setParams).not.toHaveBeenCalled();
		expect(causticsInstance.resize).toHaveBeenCalledWith(100, 100);

		wrapper.unmount();
		expect(causticsInstance.dispose).toHaveBeenCalledOnce();
	});
});

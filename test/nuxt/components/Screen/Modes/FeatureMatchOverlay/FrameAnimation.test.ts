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

function animation(effect: 'fog' | 'caustics') {
	return {
		enabled: true,
		effect,
		opacity: 0.5,
	};
}

function effectInstance() {
	return {
		setParams: vi.fn(),
		resize: vi.fn(),
		render: vi.fn(),
		dispose: vi.fn(),
	};
}

async function mountFrameAnimation(props: Record<string, unknown>) {
	const { default: FrameAnimation } = await import('../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/FrameAnimation.vue');
	return mount(FrameAnimation, {
		props: {
			canvasWidth: 1920,
			canvasHeight: 1080,
			cutoutPaths: ['M 100 100 H 500 V 300 H 100 Z'],
			output: 'fill',
			...props,
		} as never,
	});
}

describe('featureMatchOverlayFrameAnimation', () => {
	afterEach(() => vi.clearAllMocks());

	it('masks the composited canvas itself instead of its SVG foreignObject ancestor', async () => {
		animationMocks.loadAnimationEffect.mockResolvedValue(() => effectInstance());

		const wrapper = await mountFrameAnimation({ animation: animation('fog') });
		await flushPromises();

		expect(wrapper.get('foreignObject').attributes('mask')).toBeUndefined();
		const style = (wrapper.get('.frame-animation').element as HTMLElement).style;
		expect(style.maskImage).toContain('data:image/svg+xml');
		expect(decodeURIComponent(style.maskImage)).toContain('fill-rule="evenodd"');
		expect(decodeURIComponent(style.maskImage)).toContain('M 100 100 H 500 V 300 H 100 Z');

		wrapper.unmount();
	});

	it('discards an asynchronously loaded effect when a newer effect wins the race', async () => {
		const oldLoad = deferred<unknown>();
		const newLoad = deferred<unknown>();
		const oldFactory = vi.fn(() => effectInstance());
		const newInstance = effectInstance();
		const newFactory = vi.fn(() => newInstance);
		animationMocks.loadAnimationEffect.mockImplementation((effect: string) => effect === 'fog' ? oldLoad.promise : newLoad.promise);

		const wrapper = await mountFrameAnimation({ animation: animation('fog') });
		await flushPromises();

		await wrapper.setProps({ animation: animation('caustics') });
		newLoad.resolve(newFactory);
		await flushPromises();
		oldLoad.resolve(oldFactory);
		await flushPromises();

		expect(newFactory).toHaveBeenCalledOnce();
		expect(oldFactory).not.toHaveBeenCalled();

		wrapper.unmount();
		expect(newInstance.dispose).toHaveBeenCalledOnce();
	});

	it('mounts the effect with its schema defaults when the stored params are absent', async () => {
		const instance = effectInstance();
		const factory = vi.fn(() => instance);
		animationMocks.loadAnimationEffect.mockResolvedValue(factory);

		const wrapper = await mountFrameAnimation({ animation: animation('fog') });
		await flushPromises();

		expect(animationMocks.loadAnimationEffect).toHaveBeenCalledWith('fog');
		expect(factory).toHaveBeenCalledOnce();
		const [, params] = factory.mock.calls[0] as unknown as [HTMLElement, Record<string, unknown>];
		expect(params.blurFactor).toBe(0.55);
		expect(params.highlightColor).toBe('#f59e0b');
		expect(instance.resize).toHaveBeenCalledWith(1920, 1080);

		wrapper.unmount();
	});

	it('applies a param change to the live instance instead of remounting', async () => {
		const instance = effectInstance();
		const factory = vi.fn(() => instance);
		animationMocks.loadAnimationEffect.mockResolvedValue(factory);

		const wrapper = await mountFrameAnimation({ animation: animation('fog') });
		await flushPromises();

		await wrapper.setProps({ animation: { ...animation('fog'), params: { speed: 2 } } });
		await flushPromises();

		expect(factory).toHaveBeenCalledOnce();
		expect(instance.setParams).toHaveBeenCalledWith(expect.objectContaining({ speed: 2, blurFactor: 0.55 }));

		wrapper.unmount();
	});

	it('renders nothing for a stored config that predates the Animation Effect rebuild', async () => {
		const wrapper = await mountFrameAnimation({
			animation: {
				enabled: true,
				effect: 'fog',
				opacity: 0.45,
				highlightColor: '#f59e0b',
				mouseDriftEnabled: true,
				mouseDriftMode: 'orbit',
				mouseDriftSeconds: 18,
				mouseDriftRadius: 0.28,
			},
		});
		await flushPromises();

		expect(animationMocks.loadAnimationEffect).not.toHaveBeenCalled();
		expect(wrapper.find('foreignObject').exists()).toBe(false);

		wrapper.unmount();
	});

	it('renders nothing on the key output', async () => {
		const wrapper = await mountFrameAnimation({ animation: animation('fog'), output: 'key' });
		await flushPromises();

		expect(animationMocks.loadAnimationEffect).not.toHaveBeenCalled();
		expect(wrapper.find('foreignObject').exists()).toBe(false);

		wrapper.unmount();
	});
});

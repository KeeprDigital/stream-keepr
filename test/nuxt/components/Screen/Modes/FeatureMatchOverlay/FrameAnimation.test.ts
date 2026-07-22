import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const animationMocks = vi.hoisted(() => ({
	loadAnimationEffect: vi.fn(),
}));

vi.mock('~/utils/animation-effects', () => ({
	loadAnimationEffect: animationMocks.loadAnimationEffect,
}));

vi.mock('three', () => ({}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

function animation(effect: 'fog' | 'cells') {
	return {
		enabled: true,
		effect,
		opacity: 0.5,
		mouseDriftEnabled: false,
		mouseDriftMode: 'orbit',
		mouseDriftSeconds: 10,
		mouseDriftRadius: 0.2,
	} as any;
}

describe('featureMatchOverlayFrameAnimation', () => {
	afterEach(() => vi.clearAllMocks());

	it('discards an asynchronously loaded effect when a newer effect wins the race', async () => {
		const oldLoad = deferred<any>();
		const newLoad = deferred<any>();
		const oldFactory = vi.fn(() => ({ destroy: vi.fn() }));
		const newDestroy = vi.fn();
		const newFactory = vi.fn(() => ({ destroy: newDestroy }));
		animationMocks.loadAnimationEffect.mockImplementation((effect: string) => effect === 'fog' ? oldLoad.promise : newLoad.promise);

		const { default: FrameAnimation } = await import('../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/FrameAnimation.vue');
		const wrapper = mount(FrameAnimation, {
			props: {
				animation: animation('fog'),
				canvasWidth: 1920,
				canvasHeight: 1080,
				maskId: 'frame-mask',
				output: 'fill',
			},
		});
		await flushPromises();

		await wrapper.setProps({ animation: animation('cells') });
		newLoad.resolve(newFactory);
		await flushPromises();
		oldLoad.resolve(oldFactory);
		await flushPromises();

		expect(newFactory).toHaveBeenCalledOnce();
		expect(oldFactory).not.toHaveBeenCalled();

		wrapper.unmount();
		expect(newDestroy).toHaveBeenCalledOnce();
	});
});

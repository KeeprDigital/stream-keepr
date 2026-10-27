import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FrameAnimation from '~/components/Screen/Modes/FeatureMatchOverlay/FrameAnimation.vue';

const animationMocks = vi.hoisted(() => ({
	loadAnimationEffect: vi.fn(),
}));

vi.mock('~/utils/animation-effects', () => ({
	loadAnimationEffect: animationMocks.loadAnimationEffect,
}));

const ON = { enabled: true, opacity: 0.5 };

function effectInstance() {
	return {
		setParams: vi.fn(),
		resize: vi.fn(),
		render: vi.fn(),
		dispose: vi.fn(),
	};
}

async function mountFrameAnimation(props: Record<string, unknown>) {
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

// Loading, racing and live params are AnimationEffectSurface's own tests.
describe('featureMatchOverlayFrameAnimation', () => {
	afterEach(() => vi.clearAllMocks());

	it('masks the composited canvas itself instead of its SVG foreignObject ancestor', async () => {
		animationMocks.loadAnimationEffect.mockResolvedValue(() => effectInstance());

		const wrapper = await mountFrameAnimation({
			animation: ON,
			effect: { effect: 'fog' },
		});
		await flushPromises();

		expect(animationMocks.loadAnimationEffect).toHaveBeenCalledWith('fog');
		expect(wrapper.get('foreignObject').attributes('mask')).toBeUndefined();
		const style = (wrapper.get('.frame-animation').element as HTMLElement).style;
		expect(style.maskImage).toContain('data:image/svg+xml');
		expect(decodeURIComponent(style.maskImage)).toContain('fill-rule="evenodd"');
		expect(decodeURIComponent(style.maskImage)).toContain('M 100 100 H 500 V 300 H 100 Z');

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
			effect: { effect: 'fog' },
		});
		await flushPromises();

		expect(animationMocks.loadAnimationEffect).not.toHaveBeenCalled();
		expect(wrapper.find('foreignObject').exists()).toBe(false);

		wrapper.unmount();
	});

	it('renders nothing on the key output', async () => {
		const wrapper = await mountFrameAnimation({
			animation: ON,
			effect: { effect: 'fog' },
			output: 'key',
		});
		await flushPromises();

		expect(animationMocks.loadAnimationEffect).not.toHaveBeenCalled();
		expect(wrapper.find('foreignObject').exists()).toBe(false);

		wrapper.unmount();
	});

	it('renders nothing for an effect this build does not ship', async () => {
		const wrapper = await mountFrameAnimation({
			animation: ON,
			effect: { effect: 'not-an-effect' },
		});
		await flushPromises();

		expect(wrapper.find('foreignObject').exists()).toBe(false);

		wrapper.unmount();
	});
});

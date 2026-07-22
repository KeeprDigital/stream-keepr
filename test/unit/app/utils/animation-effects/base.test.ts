import { afterEach, describe, expect, it, vi } from 'vitest';

// base.ts is vendored (@ts-nocheck) Vanta-style code that instantiates a real
// THREE.WebGLRenderer + DOM canvas in its constructor. Rather than stub a full
// THREE/DOM environment, we build instances via Object.create(AnimationBase.prototype)
// and exercise destroy() directly - this is the monkeypatch approach the task brief
// allows for testing resource disposal without a real WebGL context.

describe('animationBase destroy()', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('disposes the renderer and forces context loss before removing the canvas', async () => {
		vi.stubGlobal('window', {
			removeEventListener: vi.fn(),
			cancelAnimationFrame: vi.fn(),
		});

		const { default: AnimationBase, ANIMATION_EFFECTS } = await import('~/utils/animation-effects/base');

		const instance = Object.create(AnimationBase.prototype) as any;
		const dispose = vi.fn();
		const forceContextLoss = vi.fn();
		const removeChild = vi.fn();
		const domElement = {};

		instance.el = { removeChild };
		instance.renderer = { domElement, dispose, forceContextLoss };
		instance.scene = { children: [] };
		ANIMATION_EFFECTS.current = instance;

		instance.destroy();

		expect(dispose).toHaveBeenCalledOnce();
		expect(forceContextLoss).toHaveBeenCalledOnce();
		expect(removeChild).toHaveBeenCalledWith(domElement);
		expect(instance.renderer).toBeNull();
		expect(instance.scene).toBeNull();
		expect(ANIMATION_EFFECTS.current).toBeNull();
	});

	it('disposes the renderer before nulling it out, so no reference to the GL context is dropped first', async () => {
		vi.stubGlobal('window', {
			removeEventListener: vi.fn(),
			cancelAnimationFrame: vi.fn(),
		});

		const { default: AnimationBase } = await import('~/utils/animation-effects/base');

		const instance = Object.create(AnimationBase.prototype) as any;
		const callOrder: string[] = [];

		instance.el = { removeChild: vi.fn() };
		instance.renderer = {
			domElement: {},
			dispose: vi.fn(() => callOrder.push('dispose')),
			forceContextLoss: vi.fn(() => callOrder.push('forceContextLoss')),
		};
		instance.scene = { children: [] };

		instance.destroy();

		expect(callOrder).toEqual(['dispose', 'forceContextLoss']);
	});

	it('does not throw when the renderer is null (p5 rendering path)', async () => {
		vi.stubGlobal('window', {
			removeEventListener: vi.fn(),
			cancelAnimationFrame: vi.fn(),
		});

		const { default: AnimationBase } = await import('~/utils/animation-effects/base');

		const instance = Object.create(AnimationBase.prototype) as any;
		instance.el = { removeChild: vi.fn() };
		instance.renderer = null;
		instance.scene = null;

		expect(() => instance.destroy()).not.toThrow();
		expect(instance.renderer).toBeNull();
	});
});

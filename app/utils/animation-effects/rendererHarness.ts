import type * as THREE from 'three';

/**
 * The renderer plumbing both Animation Effect bases share: one WebGL canvas
 * filling the host, and the teardown that provably releases it. `three` is
 * injected rather than imported so each effect's chunk carries the dependency
 * and the bases stay constructible against a stub in tests.
 */
export interface EffectRendererHarness {
	renderer: THREE.WebGLRenderer;
	dispose: () => void;
}

export function createEffectRenderer(three: typeof THREE, host: HTMLElement): EffectRendererHarness {
	const renderer = new three.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
	const canvas = renderer.domElement;
	Object.assign(canvas.style, {
		position: 'absolute',
		inset: '0',
		width: '100%',
		height: '100%',
		display: 'block',
	});
	host.appendChild(canvas);
	return {
		renderer,
		dispose: () => {
			renderer.dispose();
			// Contexts are browser-limited and hosts switch effects in place, so the
			// context is lost eagerly rather than left to garbage collection.
			renderer.forceContextLoss();
			canvas.remove();
		},
	};
}

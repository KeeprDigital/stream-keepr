import type * as THREE from 'three';
import type { AnimationEffectInstance } from './types';
import { createEffectRenderer } from './rendererHarness';

/**
 * The base for scene Animation Effects: real meshes under a camera, for the
 * effects a fullscreen fragment shader cannot express (waves, nets, rings — the
 * mesh-based ports ADR-0014 keeps three.js for). The base owns the renderer,
 * the frame loop's render call, camera aspect, and teardown of whatever the
 * delegate built; the delegate owns everything effect-shaped.
 */
export interface SceneEffectContext<Params> {
	three: typeof THREE;
	scene: THREE.Scene;
	params: Params;
}

export interface SceneEffectDelegate<Params> {
	createCamera: (three: typeof THREE, viewport: { width: number; height: number }) => THREE.Camera;
	/** Populate the scene for the starting params. Called once. */
	build: (context: SceneEffectContext<Params>) => void;
	/** Reflect changed params in the built scene, without a rebuild. */
	applyParams: (context: SceneEffectContext<Params>) => void;
	/** Advance the scene to this elapsed time; runs before every render. */
	update: (context: { three: typeof THREE; scene: THREE.Scene; camera: THREE.Camera; elapsedSeconds: number }) => void;
	/** Extra viewport handling beyond the camera aspect the base already keeps. */
	resize?: (context: { three: typeof THREE; scene: THREE.Scene; camera: THREE.Camera; width: number; height: number }) => void;
}

function disposeSceneContents(scene: THREE.Scene) {
	scene.traverse((object) => {
		const mesh = object as Partial<THREE.Mesh>;
		mesh.geometry?.dispose();
		if (Array.isArray(mesh.material))
			mesh.material.forEach(material => material.dispose());
		else
			mesh.material?.dispose();
	});
}

export function createSceneEffect<Params>(
	options: { three: typeof THREE; host: HTMLElement; delegate: SceneEffectDelegate<Params> },
	params: Params,
): AnimationEffectInstance<Params> {
	const { three, host, delegate } = options;
	const harness = createEffectRenderer(three, host);
	const scene = new three.Scene();

	const viewport = {
		width: Math.max(1, host.clientWidth),
		height: Math.max(1, host.clientHeight),
	};
	const camera = delegate.createCamera(three, viewport);
	let currentParams = params;
	delegate.build({ three, scene, params: currentParams });

	return {
		setParams: (next) => {
			currentParams = next;
			delegate.applyParams({ three, scene, params: currentParams });
		},
		resize: (width, height) => {
			harness.renderer.setSize(width, height, false);
			const perspective = camera as Partial<THREE.PerspectiveCamera>;
			if (typeof perspective.aspect === 'number') {
				perspective.aspect = width / height;
				perspective.updateProjectionMatrix?.();
			}
			delegate.resize?.({ three, scene, camera, width, height });
		},
		render: (elapsedSeconds) => {
			delegate.update({ three, scene, camera, elapsedSeconds });
			harness.renderer.render(scene, camera);
		},
		dispose: () => {
			disposeSceneContents(scene);
			harness.dispose();
		},
	};
}

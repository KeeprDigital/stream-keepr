import type { AnimationEffectParams } from '~~/shared/animationEffects';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { animationEffectDefaultParams } from '~~/shared/animationEffects';
import { createWavesDelegate } from '~/utils/animation-effects/waves';

/** Against the real `three` module: geometry and scene-graph work needs no WebGL context. */

function mountDelegate(overrides: Partial<AnimationEffectParams<'waves'>> = {}) {
	const params = {
		...animationEffectDefaultParams('waves'),
		...overrides,
	};
	const delegate = createWavesDelegate();
	const scene = new THREE.Scene();
	const camera = delegate.createCamera(THREE, { width: 800, height: 450 });
	const context = { three: THREE, scene, camera };
	delegate.build({ ...context, params });
	return {
		delegate,
		scene,
		camera: camera as THREE.PerspectiveCamera,
		context,
		params,
	};
}

function wavesMesh(scene: THREE.Scene): THREE.Mesh {
	const mesh = scene.children.find((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh);
	expect(mesh).toBeDefined();
	return mesh!;
}

describe('createWavesDelegate', () => {
	it('positions the camera at the fork position divided by zoom, looking at the fork target', () => {
		// The fork eased the camera toward its base position divided by zoom as
		// the pointer centred; with no pointer, that steady state is the position.
		// Scale 1 is the pre-rebuild default zoom of 0.85 (#503).
		const { camera } = mountDelegate({ scale: 1 });
		expect(camera.position.x).toBeCloseTo(240 / 0.85);
		expect(camera.position.y).toBeCloseTo(200 / 0.85);
		expect(camera.position.z).toBeCloseTo(390 / 0.85);

		const { camera: closer } = mountDelegate({ scale: 2 });
		expect(closer.position.x).toBeCloseTo(240 / 1.7);
		expect(closer.position.y).toBeCloseTo(200 / 1.7);
		expect(closer.position.z).toBeCloseTo(390 / 1.7);
	});

	it('builds the 101×81 jittered grid the fork built, on a dynamic position attribute', () => {
		const { scene } = mountDelegate();
		const mesh = wavesMesh(scene);
		const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
		expect(position.count).toBe(101 * 81);
		expect(position.usage).toBe(THREE.DynamicDrawUsage);
		// Corner vertex of the fork's grid: (i - ww/2) * 18, ((hh/2) - j) * 18.
		expect(position.getX(0)).toBe(-50 * 18);
		expect(position.getZ(0)).toBe(40 * 18);
		// Rest height jitters within the fork's waveNoise band, below -6.
		for (const index of [0, 1000, position.count - 1]) {
			expect(position.getY(index)).toBeGreaterThanOrEqual(-10);
			expect(position.getY(index)).toBeLessThanOrEqual(-6);
		}
		// Two triangles per cell.
		expect(mesh.geometry.index!.count).toBe(100 * 80 * 6);
	});

	it('shades the water in its colour and shininess params', () => {
		const { scene, params } = mountDelegate();
		const material = wavesMesh(scene).material as THREE.MeshPhongMaterial;
		expect(material.color.getHexString()).toBe(params.waveColor.slice(1));
		expect(material.shininess).toBe(params.shininess);
	});

	it('clears to the background colour the fork\'s base cleared to, where the plane leaves the frame', () => {
		const { scene, delegate, context, params } = mountDelegate();
		expect((scene.background as THREE.Color).getHexString()).toBe(params.backgroundColor.slice(1));
		delegate.applyParams({
			...context,
			params: { ...params, backgroundColor: '#224466' },
		});
		expect((scene.background as THREE.Color).getHexString()).toBe('224466');
	});

	it('lifts each vertex by a trochoid of at most waveHeight above its rest height', () => {
		const { delegate, scene, context } = mountDelegate({ waveHeight: 20 });
		const position = wavesMesh(scene).geometry.getAttribute('position') as THREE.BufferAttribute;
		const restHeights = Array.from({ length: position.count }, (_, index) => position.getY(index));

		delegate.update({ ...context, elapsedSeconds: 1.25 });
		let moved = 0;
		for (let index = 0; index < position.count; index++) {
			const lift = position.getY(index) - restHeights[index]!;
			expect(lift).toBeGreaterThanOrEqual(0);
			expect(lift).toBeLessThanOrEqual(20 + 1e-9);
			if (lift > 1)
				moved++;
		}
		expect(moved).toBeGreaterThan(0);
	});

	it('animates across frames, and re-marks positions and normals for upload each frame', () => {
		const { delegate, scene, context } = mountDelegate();
		const geometry = wavesMesh(scene).geometry;
		const position = geometry.getAttribute('position') as THREE.BufferAttribute;

		delegate.update({ ...context, elapsedSeconds: 0.5 });
		const firstFrame = position.getY(0);
		const versionAfterFirst = position.version;
		expect(geometry.getAttribute('normal')).toBeDefined();

		delegate.update({ ...context, elapsedSeconds: 1.5 });
		expect(position.getY(0)).not.toBe(firstFrame);
		expect(position.version).toBeGreaterThan(versionAfterFirst);
	});

	it('holds the water still at speed 0, as the fork did', () => {
		const { delegate, scene, context } = mountDelegate({ speed: 0 });
		const position = wavesMesh(scene).geometry.getAttribute('position') as THREE.BufferAttribute;
		delegate.update({ ...context, elapsedSeconds: 1 });
		const frozen = Array.from({ length: position.count }, (_, index) => position.getY(index));
		delegate.update({ ...context, elapsedSeconds: 7 });
		for (let index = 0; index < position.count; index++)
			expect(position.getY(index)).toBe(frozen[index]!);
	});

	it('applies colour, shininess, and scale to the live scene without a rebuild', () => {
		const { delegate, scene, camera, context, params } = mountDelegate({ scale: 1 });
		const material = wavesMesh(scene).material as THREE.MeshPhongMaterial;
		delegate.applyParams({
			...context,
			params: {
				...params,
				waveColor: '#123456',
				shininess: 75,
				scale: 2,
			},
		});
		expect(material.color.getHexString()).toBe('123456');
		expect(material.shininess).toBe(75);
		expect(camera.position.x).toBeCloseTo(240 / 1.7);
		expect(camera.position.y).toBeCloseTo(200 / 1.7);
		expect(camera.position.z).toBeCloseTo(390 / 1.7);
	});

	it('reads waveHeight and speed changes on the next frame', () => {
		const { delegate, scene, context, params } = mountDelegate({ waveHeight: 20 });
		const position = wavesMesh(scene).geometry.getAttribute('position') as THREE.BufferAttribute;
		const restHeights = Array.from({ length: position.count }, (_, index) => position.getY(index));

		delegate.applyParams({
			...context,
			params: { ...params, waveHeight: 0 },
		});
		delegate.update({ ...context, elapsedSeconds: 2 });
		for (const index of [0, 500, position.count - 1])
			expect(position.getY(index)).toBeCloseTo(restHeights[index]!);
	});
});

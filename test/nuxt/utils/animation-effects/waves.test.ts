import type { WavesAnimationParams } from '~~/shared/animationEffects';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { animationEffectDefaultParams } from '~~/shared/animationEffects';
import { createWavesDelegate } from '~/utils/animation-effects/waves';

/**
 * The waves delegate is exercised against the real `three` module: everything
 * it does — build a jittered grid, light it, displace vertices per frame —
 * is plain geometry and scene-graph work that needs no WebGL context, so the
 * assertions here are on the actual numbers the pre-rebuild application
 * rendered with rather than on a stub's call log.
 */

function mountDelegate(overrides: Partial<WavesAnimationParams> = {}) {
	const params = { ...animationEffectDefaultParams('waves'), ...overrides };
	const delegate = createWavesDelegate();
	const scene = new THREE.Scene();
	const camera = delegate.createCamera(THREE, { width: 800, height: 450 });
	const context = { three: THREE, scene, camera };
	delegate.build({ ...context, params });
	return { delegate, scene, camera: camera as THREE.PerspectiveCamera, context, params };
}

function wavesMesh(scene: THREE.Scene): THREE.Mesh {
	const mesh = scene.children.find((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh);
	expect(mesh).toBeDefined();
	return mesh!;
}

function sceneLight<Light extends THREE.Light>(scene: THREE.Scene, marker: 'isAmbientLight' | 'isPointLight' | 'isDirectionalLight'): Light {
	const light = scene.children.find((child): child is Light => Boolean((child as unknown as Record<string, unknown>)[marker]));
	expect(light).toBeDefined();
	return light!;
}

describe('createWavesDelegate', () => {
	it('creates the perspective camera the fork framed the water with', () => {
		const { camera } = mountDelegate();
		expect(camera.isPerspectiveCamera).toBe(true);
		expect(camera.fov).toBe(35);
		expect(camera.near).toBe(50);
		expect(camera.far).toBe(10000);
		expect(camera.aspect).toBeCloseTo(800 / 450);
	});

	it('positions the camera at the fork position scaled by zoom, looking at the fork target', () => {
		const { camera } = mountDelegate({ zoom: 1 });
		// The fork eased the camera toward its base position divided by zoom as
		// the pointer centred; with no pointer, that steady state is the position.
		expect(camera.position.x).toBeCloseTo(240);
		expect(camera.position.y).toBeCloseTo(200);
		expect(camera.position.z).toBeCloseTo(390);

		const { camera: zoomed } = mountDelegate({ zoom: 2 });
		expect(zoomed.position.x).toBeCloseTo(120);
		expect(zoomed.position.y).toBeCloseTo(100);
		expect(zoomed.position.z).toBeCloseTo(195);
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

	it('lights and shades the water the way the pre-rebuild application did', () => {
		const { scene, params } = mountDelegate();
		const material = wavesMesh(scene).material as THREE.MeshPhongMaterial;
		expect(material.color.getHexString()).toBe(params.color.slice(1));
		expect(material.shininess).toBe(params.shininess);
		expect(material.flatShading).toBe(true);
		expect(material.side).toBe(THREE.DoubleSide);

		expect(sceneLight<THREE.AmbientLight>(scene, 'isAmbientLight').intensity).toBe(0.25);
		const point = sceneLight<THREE.PointLight>(scene, 'isPointLight');
		expect(point.intensity).toBe(2.4);
		expect(point.position.toArray()).toEqual([-100, 250, -100]);
		const directional = sceneLight<THREE.DirectionalLight>(scene, 'isDirectionalLight');
		expect(directional.intensity).toBe(2.2);
		expect(directional.position.toArray()).toEqual([260, 420, 180]);
	});

	it('clears to the background colour the fork\'s base cleared to, where the plane leaves the frame', () => {
		const { scene, delegate, context, params } = mountDelegate();
		expect((scene.background as THREE.Color).getHexString()).toBe(params.backgroundColor.slice(1));
		delegate.applyParams({ ...context, params: { ...params, backgroundColor: '#224466' } });
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

	it('holds the water still at waveSpeed 0, as the fork did', () => {
		const { delegate, scene, context } = mountDelegate({ waveSpeed: 0 });
		const position = wavesMesh(scene).geometry.getAttribute('position') as THREE.BufferAttribute;
		delegate.update({ ...context, elapsedSeconds: 1 });
		const frozen = Array.from({ length: position.count }, (_, index) => position.getY(index));
		delegate.update({ ...context, elapsedSeconds: 7 });
		for (let index = 0; index < position.count; index++)
			expect(position.getY(index)).toBe(frozen[index]!);
	});

	it('applies colour, shininess, and zoom to the live scene without a rebuild', () => {
		const { delegate, scene, camera, context, params } = mountDelegate({ zoom: 1 });
		const material = wavesMesh(scene).material as THREE.MeshPhongMaterial;
		delegate.applyParams({ ...context, params: { ...params, color: '#123456', shininess: 75, zoom: 2 } });
		expect(material.color.getHexString()).toBe('123456');
		expect(material.shininess).toBe(75);
		expect(camera.position.x).toBeCloseTo(120);
		expect(camera.position.y).toBeCloseTo(100);
		expect(camera.position.z).toBeCloseTo(195);
	});

	it('reads waveHeight and waveSpeed changes on the next frame', () => {
		const { delegate, scene, context, params } = mountDelegate({ waveHeight: 20 });
		const position = wavesMesh(scene).geometry.getAttribute('position') as THREE.BufferAttribute;
		const restHeights = Array.from({ length: position.count }, (_, index) => position.getY(index));

		delegate.applyParams({ ...context, params: { ...params, waveHeight: 0 } });
		delegate.update({ ...context, elapsedSeconds: 2 });
		for (const index of [0, 500, position.count - 1])
			expect(position.getY(index)).toBeCloseTo(restHeights[index]!);
	});
});

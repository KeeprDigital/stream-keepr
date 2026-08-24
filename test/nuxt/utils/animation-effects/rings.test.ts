import type { RingsAnimationParams } from '~~/shared/animationEffects';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { animationEffectDefaultParams } from '~~/shared/animationEffects';
import { createRingsDelegate, RINGS_PALETTE } from '~/utils/animation-effects/rings';

/**
 * Like the other mesh ports, rings is exercised against the real `three`
 * module: extruded geometry, group transforms, and camera easing need no WebGL
 * context, so the assertions land on the fork's actual numbers. The ring stack
 * itself is random by design (the fork's), so those assertions are on bounds
 * and invariants rather than exact values.
 */

function mountDelegate(overrides: Partial<RingsAnimationParams> = {}) {
	const params = { ...animationEffectDefaultParams('rings'), ...overrides };
	const delegate = createRingsDelegate();
	const scene = new THREE.Scene();
	const camera = delegate.createCamera(THREE, { width: 800, height: 450 });
	const context = { three: THREE, scene, camera };
	delegate.build({ ...context, params });
	return { delegate, scene, camera: camera as THREE.PerspectiveCamera, context, params };
}

function ringsGroup(scene: THREE.Scene): THREE.Group {
	const group = scene.children.find((child): child is THREE.Group => (child as THREE.Group).isGroup);
	expect(group).toBeDefined();
	return group!;
}

function ringMeshes(scene: THREE.Scene): THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshLambertMaterial>[] {
	return ringsGroup(scene).children.filter(
		(child): child is THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshLambertMaterial> => (child as THREE.Mesh).isMesh,
	);
}

describe('createRingsDelegate', () => {
	it('creates the perspective camera the fork framed the stack with', () => {
		const { camera } = mountDelegate();
		expect(camera.isPerspectiveCamera).toBe(true);
		expect(camera.fov).toBe(25);
		expect(camera.far).toBe(10000);
		expect(camera.position.toArray()).toEqual([0, 150, 200]);
	});

	it('eases the camera to the centred-pointer resting height and pins the fork\'s near-plane fix', () => {
		const { delegate, context, camera } = mountDelegate();
		delegate.update({ ...context, elapsedSeconds: 0 });
		expect(camera.position.y).toBe(150);
		// The fork's per-frame anti-flicker: near = max(z * 0.5 - 20, 1), constant
		// at 80 because z never moves.
		expect(camera.near).toBe(80);
		delegate.update({ ...context, elapsedSeconds: 5 });
		expect(camera.position.y).toBeLessThan(150);
		expect(camera.position.y).toBeGreaterThan(125);
		delegate.update({ ...context, elapsedSeconds: 120 });
		// Resting height is the centred-pointer steady state the fork's base
		// always fired at init: ty = 150 - 0.5 * 50.
		expect(camera.position.x).toBeCloseTo(0, 1);
		expect(camera.position.y).toBeCloseTo(125, 1);
		expect(camera.position.z).toBe(200);
	});

	it('builds the fork\'s tilted group of at least sixty extruded rings in its palette', () => {
		const { scene } = mountDelegate();
		const group = ringsGroup(scene);
		expect(group.position.toArray()).toEqual([30, 0, 0]);
		const meshes = ringMeshes(scene);
		expect(meshes.length).toBeGreaterThanOrEqual(60);
		const palette = new Set(RINGS_PALETTE.map(color => color.slice(1)));
		for (const mesh of meshes) {
			expect(mesh.rotation.x).toBe(Math.PI / 2);
			expect(palette.has(mesh.material.color.getHexString())).toBe(true);
			if (mesh.material.transparent)
				expect(mesh.material.opacity).toBeGreaterThanOrEqual(0.1);
		}
	});

	it('spins each ring at its own stored speed, absolute in elapsed time', () => {
		const { delegate, scene, context } = mountDelegate();
		const meshes = ringMeshes(scene);
		delegate.update({ ...context, elapsedSeconds: 2 });
		for (const mesh of meshes.slice(0, 5)) {
			const { startAngle, spinSpeed } = mesh.userData as { startAngle: number; spinSpeed: number };
			expect(mesh.rotation.z).toBeCloseTo(startAngle + 0.06 * spinSpeed * 2);
		}
	});

	it('wobbles the group around the fork\'s base tilt as the closed form of its per-frame nudges', () => {
		const { delegate, scene, context } = mountDelegate();
		const group = ringsGroup(scene);
		expect(group.rotation.x).toBeCloseTo(0.06667);
		expect(group.rotation.z).toBeCloseTo(0.16667);
		delegate.update({ ...context, elapsedSeconds: 3 });
		expect(group.rotation.x).toBeCloseTo(0.06667 + 0.1 * (1 - Math.cos(0.06 * 3)));
		expect(group.rotation.z).toBeCloseTo(0.16667 + 0.07 * Math.sin(0.06 * 3));
	});

	it('lights the stack the way the fork did, spot aimed at the group', () => {
		const { scene } = mountDelegate();
		const ambient = scene.children.find((child): child is THREE.AmbientLight => (child as THREE.AmbientLight).isAmbientLight);
		expect(ambient?.intensity).toBe(0.5);
		const point = scene.children.find((child): child is THREE.PointLight => (child as THREE.PointLight).isPointLight);
		expect(point?.intensity).toBe(0.5);
		expect(point?.position.toArray()).toEqual([0, 150, 200]);
		const spot = scene.children.find((child): child is THREE.SpotLight => (child as THREE.SpotLight).isSpotLight);
		expect(spot?.intensity).toBe(1);
		expect(spot?.position.toArray()).toEqual([-15, 50, 100]);
		expect(spot?.penumbra).toBe(1);
		expect(spot?.angle).toBe(0.5);
		expect(spot?.decay).toBe(1);
		expect(spot?.distance).toBe(300);
		expect(spot?.target).toBe(ringsGroup(scene));
	});

	it('clears to the background colour the fork\'s base cleared to, live on param change', () => {
		const { scene, delegate, context, params } = mountDelegate();
		expect((scene.background as THREE.Color).getHexString()).toBe(params.backgroundColor.slice(1));
		delegate.applyParams({ ...context, params: { backgroundColor: '#224466' } });
		expect((scene.background as THREE.Color).getHexString()).toBe('224466');
	});
});

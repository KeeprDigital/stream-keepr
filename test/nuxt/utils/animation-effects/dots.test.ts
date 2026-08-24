import type { DotsAnimationParams } from '~~/shared/animationEffects';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { animationEffectDefaultParams } from '~~/shared/animationEffects';
import { createDotsDelegate } from '~/utils/animation-effects/dots';

/**
 * Like the waves delegate, dots is exercised against the real `three` module:
 * point fields, line segments, and camera easing are scene-graph work that
 * needs no WebGL context, so the assertions land on the fork's actual numbers.
 */

function mountDelegate(overrides: Partial<DotsAnimationParams> = {}) {
	const params = { ...animationEffectDefaultParams('dots'), ...overrides };
	const delegate = createDotsDelegate();
	const scene = new THREE.Scene();
	const camera = delegate.createCamera(THREE, { width: 800, height: 450 });
	const context = { three: THREE, scene, camera };
	delegate.build({ ...context, params });
	return { delegate, scene, camera: camera as THREE.PerspectiveCamera, context, params };
}

function starField(scene: THREE.Scene): THREE.Points {
	const points = scene.children.find((child): child is THREE.Points => (child as THREE.Points).isPoints);
	expect(points).toBeDefined();
	return points!;
}

function linesMesh(scene: THREE.Scene): THREE.LineSegments | undefined {
	return scene.children.find((child): child is THREE.LineSegments => (child as THREE.LineSegments).isLineSegments);
}

describe('createDotsDelegate', () => {
	it('creates the perspective camera the fork framed the field with, at its intro position', () => {
		const { camera } = mountDelegate();
		expect(camera.isPerspectiveCamera).toBe(true);
		expect(camera.fov).toBe(50);
		expect(camera.near).toBe(0.1);
		expect(camera.far).toBe(5000);
		expect(camera.position.toArray()).toEqual([0, 250, 50]);
	});

	it('eases the camera from the intro position toward the fork\'s resting target over elapsed time', () => {
		const { delegate, context, camera } = mountDelegate();
		delegate.update({ ...context, elapsedSeconds: 0 });
		expect(camera.position.toArray()).toEqual([0, 250, 50]);
		delegate.update({ ...context, elapsedSeconds: 5 });
		const midway = camera.position.clone();
		expect(midway.y).toBeLessThan(250);
		expect(midway.y).toBeGreaterThan(50);
		expect(midway.z).toBeGreaterThan(50);
		expect(midway.z).toBeLessThan(350);
		delegate.update({ ...context, elapsedSeconds: 90 });
		expect(camera.position.x).toBeCloseTo(0, 1);
		expect(camera.position.y).toBeCloseTo(50, 1);
		expect(camera.position.z).toBeCloseTo(350, 1);
	});

	it('builds the fork\'s 61×61 star grid from the spacing param, on a dynamic position attribute', () => {
		const { scene, params } = mountDelegate();
		const stars = starField(scene);
		const position = stars.geometry.getAttribute('position') as THREE.BufferAttribute;
		expect(position.count).toBe(61 * 61);
		expect(position.usage).toBe(THREE.DynamicDrawUsage);
		// First vertex is grid corner (-30, -30): i * spacing + spacing / 2.
		expect(position.getX(0)).toBe(-30 * params.spacing + params.spacing / 2);
		expect(position.getZ(0)).toBe(-30 * params.spacing + params.spacing / 2);
		// Rest height jitters within the fork's band above -150.
		for (const index of [0, 1000, position.count - 1]) {
			expect(position.getY(index)).toBeGreaterThanOrEqual(-150);
			expect(position.getY(index)).toBeLessThanOrEqual(-145);
		}
		const material = stars.material as THREE.PointsMaterial;
		expect(material.color.getHexString()).toBe(params.color.slice(1));
		expect(material.size).toBe(params.size);
	});

	it('strings the fork\'s 200 radial accent segments between its sphere shells', () => {
		const { scene, params } = mountDelegate();
		const lines = linesMesh(scene);
		expect(lines).toBeDefined();
		expect((lines!.material as THREE.LineBasicMaterial).color.getHexString()).toBe(params.color2.slice(1));
		const position = lines!.geometry.getAttribute('position') as THREE.BufferAttribute;
		expect(position.count).toBe(400);
		for (const segment of [0, 66, 199]) {
			const inner = new THREE.Vector3().fromBufferAttribute(position, segment * 2);
			const outer = new THREE.Vector3().fromBufferAttribute(position, segment * 2 + 1);
			expect(inner.length()).toBeGreaterThanOrEqual(40);
			expect(inner.length()).toBeLessThanOrEqual(60);
			expect(outer.length() - inner.length()).toBeGreaterThanOrEqual(12 - 1e-9);
			expect(outer.length() - inner.length()).toBeLessThanOrEqual(20 + 1e-9);
		}
	});

	it('builds no line segments when showLines is off', () => {
		const { scene } = mountDelegate({ showLines: false });
		expect(linesMesh(scene)).toBeUndefined();
	});

	it('drifts each star within the fork\'s accumulated-sine band of its rest height', () => {
		const { delegate, scene, context } = mountDelegate();
		const position = starField(scene).geometry.getAttribute('position') as THREE.BufferAttribute;
		const restHeights = Array.from({ length: position.count }, (_, index) => position.getY(index));

		delegate.update({ ...context, elapsedSeconds: 2 });
		let moved = 0;
		for (let index = 0; index < position.count; index++) {
			const drift = position.getY(index) - restHeights[index]!;
			expect(Math.abs(drift)).toBeLessThanOrEqual(10 + 1e-9);
			if (Math.abs(drift) > 0.5)
				moved++;
		}
		expect(moved).toBeGreaterThan(0);

		const versionAfterFirst = position.version;
		const firstFrame = position.getY(0);
		delegate.update({ ...context, elapsedSeconds: 4 });
		expect(position.getY(0)).not.toBe(firstFrame);
		expect(position.version).toBeGreaterThan(versionAfterFirst);
	});

	it('tumbles the line segments at the fork\'s per-frame rates over elapsed time', () => {
		const { delegate, scene, context } = mountDelegate();
		const lines = linesMesh(scene)!;
		delegate.update({ ...context, elapsedSeconds: 2 });
		expect(lines.rotation.z).toBeCloseTo(0.002 * 60 * 2);
		expect(lines.rotation.x).toBeCloseTo(0.0008 * 60 * 2);
		expect(lines.rotation.y).toBeCloseTo(0.0005 * 60 * 2);
	});

	it('clears to the background colour the fork\'s base cleared to', () => {
		const { scene, delegate, context, params } = mountDelegate();
		expect((scene.background as THREE.Color).getHexString()).toBe(params.backgroundColor.slice(1));
		delegate.applyParams({ ...context, params: { ...params, backgroundColor: '#224466' } });
		expect((scene.background as THREE.Color).getHexString()).toBe('224466');
	});

	it('applies colours, size, and spacing to the live scene without a rebuild', () => {
		const { delegate, scene, context, params } = mountDelegate();
		const stars = starField(scene);
		delegate.applyParams({ ...context, params: { ...params, color: '#123456', color2: '#654321', size: 7, spacing: 50 } });
		const material = stars.material as THREE.PointsMaterial;
		expect(material.color.getHexString()).toBe('123456');
		expect(material.size).toBe(7);
		expect((linesMesh(scene)!.material as THREE.LineBasicMaterial).color.getHexString()).toBe('654321');
		const position = stars.geometry.getAttribute('position') as THREE.BufferAttribute;
		expect(position.getX(0)).toBe(-30 * 50 + 25);
		expect(position.getZ(0)).toBe(-30 * 50 + 25);
	});

	it('adds and removes the line segments as showLines toggles live', () => {
		const { delegate, scene, context, params } = mountDelegate();
		expect(linesMesh(scene)).toBeDefined();
		delegate.applyParams({ ...context, params: { ...params, showLines: false } });
		expect(linesMesh(scene)).toBeUndefined();
		delegate.applyParams({ ...context, params: { ...params, showLines: true } });
		expect(linesMesh(scene)).toBeDefined();
	});
});

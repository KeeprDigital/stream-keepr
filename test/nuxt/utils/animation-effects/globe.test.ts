import type { GlobeAnimationParams } from '~~/shared/animationEffects';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { animationEffectDefaultParams } from '~~/shared/animationEffects';
import { createGlobeDelegate } from '~/utils/animation-effects/globe';

/**
 * Globe against the real `three` module, like its siblings. Unlike net, the
 * fork's globe grid carries no jitter, so the point-plane assertions here are
 * exact rather than bounds.
 */

function mountDelegate(overrides: Partial<GlobeAnimationParams> = {}) {
	const params = { ...animationEffectDefaultParams('globe'), ...overrides };
	const delegate = createGlobeDelegate();
	const scene = new THREE.Scene();
	const camera = delegate.createCamera(THREE, { width: 800, height: 450 });
	const context = { three: THREE, scene, camera };
	delegate.build({ ...context, params });
	return { delegate, scene, camera: camera as THREE.PerspectiveCamera, context, params };
}

function groupAt(scene: THREE.Scene, x: number): THREE.Group {
	const group = scene.children.find(
		(child): child is THREE.Group => (child as THREE.Group).isGroup && child.position.x === x,
	);
	expect(group).toBeDefined();
	return group!;
}

const fieldGroup = (scene: THREE.Scene) => groupAt(scene, -50);
const globeGroup = (scene: THREE.Scene) => groupAt(scene, 0);

function globeLineSegments(scene: THREE.Scene) {
	const segments = globeGroup(scene).children.filter(
		(child): child is THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> =>
			(child as THREE.LineSegments).isLineSegments,
	);
	const sphere = segments.find(segment => segment.geometry.type === 'EdgesGeometry');
	const ball = segments.find(segment => segment.geometry.getAttribute('position')?.count === 160);
	const poles = segments.find(segment => segment.geometry.getAttribute('position')?.count === 2 + 4 * 18 * 2);
	expect(sphere).toBeDefined();
	expect(ball).toBeDefined();
	expect(poles).toBeDefined();
	return { sphere: sphere!, ball: ball!, poles: poles! };
}

function fieldDots(scene: THREE.Scene): THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>[] {
	return fieldGroup(scene).children.filter(
		(child): child is THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial> => (child as THREE.Mesh).isMesh,
	);
}

describe('createGlobeDelegate', () => {
	it('creates the fork\'s static camera aimed at its widest-viewport look target', () => {
		const { delegate, context, camera } = mountDelegate();
		expect(camera.fov).toBe(20);
		expect(camera.near).toBe(0.01);
		expect(camera.position.toArray()).toEqual([50, 100, 150]);
		delegate.update({ ...context, elapsedSeconds: 30 });
		expect(camera.position.toArray()).toEqual([50, 100, 150]);
	});

	it('builds the fork\'s flat, unjittered point plane at its offset', () => {
		const { scene, params } = mountDelegate();
		const group = fieldGroup(scene);
		expect(group.position.toArray()).toEqual([-50, -20, 0]);
		const dots = fieldDots(scene);
		expect(dots.length).toBe(11 * 11);
		// No jitter: the corner point sits exactly on the grid.
		expect(dots[0]!.position.toArray()).toEqual([-5 * params.spacing, 0, -5 * params.spacing]);
		expect(dots[0]!.material.color.getHexString()).toBe(params.color.slice(1));
	});

	it('waves the plane with the fork\'s absolute sine of position and time', () => {
		const { delegate, scene, context } = mountDelegate();
		const dots = fieldDots(scene);
		delegate.update({ ...context, elapsedSeconds: 2 });
		for (const dot of [dots[0]!, dots[60]!, dots.at(-1)!]) {
			expect(dot.position.y).toBeCloseTo(
				2 * Math.sin(dot.position.x / 10 + 0.6 * 2 + dot.position.z / 20),
			);
		}
		// Absolute, not accumulated: replaying a time reproduces it.
		const replay = dots[0]!.position.y;
		delegate.update({ ...context, elapsedSeconds: 5 });
		delegate.update({ ...context, elapsedSeconds: 2 });
		expect(dots[0]!.position.y).toBe(replay);
	});

	it('builds the wireframe globe, radial ball, and pole lines in the fork\'s tilted group', () => {
		const { scene, params } = mountDelegate();
		const group = globeGroup(scene);
		expect(group.position.toArray()).toEqual([0, 15, 0]);
		expect(group.rotation.x).toBe(-0.25);
		const { sphere, ball, poles } = globeLineSegments(scene);
		expect(sphere.material.color.getHexString()).toBe(params.color.slice(1));
		expect(ball.material.color.getHexString()).toBe(params.color2.slice(1));
		expect(poles.material.color.getHexString()).toBe(params.color2.slice(1));
		sphere.geometry.computeBoundingSphere();
		expect(sphere.geometry.boundingSphere!.radius).toBeCloseTo(18, 0);
	});

	it('spins the globe pieces at the fork\'s per-frame rates over elapsed time', () => {
		const { delegate, scene, context } = mountDelegate();
		const { sphere, ball, poles } = globeLineSegments(scene);
		delegate.update({ ...context, elapsedSeconds: 2 });
		expect(ball.rotation.x).toBeCloseTo(0.0008 * 60 * 2);
		expect(ball.rotation.y).toBeCloseTo(0.0005 * 60 * 2);
		expect(ball.rotation.z).toBeCloseTo(0.002 * 60 * 2);
		expect(sphere.rotation.y).toBeCloseTo(0.002 * 60 * 2);
		expect(poles.rotation.y).toBeCloseTo(-0.004 * 60 * 2);
	});

	it('strings vertex-coloured connection lines through the waving plane', () => {
		const { delegate, scene, context } = mountDelegate();
		const lines = fieldGroup(scene).children.find(
			(child): child is THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> =>
				(child as THREE.LineSegments).isLineSegments,
		);
		expect(lines).toBeDefined();
		expect(lines!.material.vertexColors).toBe(true);
		expect(lines!.material.blending).toBe(THREE.AdditiveBlending);
		delegate.update({ ...context, elapsedSeconds: 1 });
		expect(lines!.geometry.drawRange.count).toBeGreaterThan(0);
	});

	it('builds bare placeholders when showDots is off, and the lines still string', () => {
		const { delegate, scene, context } = mountDelegate({ showDots: false });
		expect(fieldDots(scene).length).toBe(0);
		expect(fieldGroup(scene).children.length).toBe(11 * 11 + 1);
		delegate.update({ ...context, elapsedSeconds: 1 });
	});

	it('applies colours live, and rebuilds what a construction param change requires', () => {
		const { delegate, scene, context, params } = mountDelegate();
		delegate.applyParams({ ...context, params: { ...params, color: '#123456', color2: '#654321', backgroundColor: '#224466' } });
		expect((scene.background as THREE.Color).getHexString()).toBe('224466');
		const { sphere, ball, poles } = globeLineSegments(scene);
		expect(sphere.material.color.getHexString()).toBe('123456');
		expect(ball.material.color.getHexString()).toBe('654321');
		expect(poles.material.color.getHexString()).toBe('654321');
		expect(fieldDots(scene)[0]!.material.color.getHexString()).toBe('123456');

		delegate.applyParams({ ...context, params: { ...params, size: 2 } });
		const rebuilt = globeLineSegments(scene).sphere;
		rebuilt.geometry.computeBoundingSphere();
		expect(rebuilt.geometry.boundingSphere!.radius).toBeCloseTo(36, 0);

		delegate.applyParams({ ...context, params: { ...params, size: 2, points: 4 } });
		expect(fieldDots(scene).length).toBe(5 * 5);
		delegate.update({ ...context, elapsedSeconds: 1 });
	});
});

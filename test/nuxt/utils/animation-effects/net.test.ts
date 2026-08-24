import type { NetAnimationParams } from '~~/shared/animationEffects';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { animationEffectDefaultParams } from '~~/shared/animationEffects';
import { createNetDelegate } from '~/utils/animation-effects/net';

/**
 * Like the other mesh ports, net is exercised against the real `three` module.
 * The field is random by design (the fork's), so assertions are on counts,
 * bounds, and invariants rather than exact positions.
 */

function mountDelegate(overrides: Partial<NetAnimationParams> = {}) {
	const params = { ...animationEffectDefaultParams('net'), ...overrides };
	const delegate = createNetDelegate();
	const scene = new THREE.Scene();
	const camera = delegate.createCamera(THREE, { width: 800, height: 450 });
	const context = { three: THREE, scene, camera };
	delegate.build({ ...context, params });
	return { delegate, scene, camera: camera as THREE.PerspectiveCamera, context, params };
}

function netGroup(scene: THREE.Scene): THREE.Group {
	const group = scene.children.find((child): child is THREE.Group => (child as THREE.Group).isGroup);
	expect(group).toBeDefined();
	return group!;
}

function linesMesh(scene: THREE.Scene): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
	const lines = netGroup(scene).children.find(
		(child): child is THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> => (child as THREE.LineSegments).isLineSegments,
	);
	expect(lines).toBeDefined();
	return lines!;
}

function dotMeshes(scene: THREE.Scene): THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>[] {
	return netGroup(scene).children.filter(
		(child): child is THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial> => (child as THREE.Mesh).isMesh,
	);
}

describe('createNetDelegate', () => {
	it('creates the fork\'s static camera — the centred-pointer target is its start position', () => {
		const { delegate, context, camera } = mountDelegate();
		expect(camera.isPerspectiveCamera).toBe(true);
		expect(camera.fov).toBe(25);
		expect(camera.near).toBe(0.01);
		expect(camera.far).toBe(10000);
		expect(camera.position.toArray()).toEqual([50, 100, 150]);
		delegate.update({ ...context, elapsedSeconds: 30 });
		expect(camera.position.toArray()).toEqual([50, 100, 150]);
	});

	it('builds the fork\'s doubled grid of point markers inside its height band', () => {
		const { scene, params } = mountDelegate();
		const dots = dotMeshes(scene);
		expect(dots.length).toBe(11 * 11 * 2);
		for (const dot of [dots[0]!, dots[100]!, dots.at(-1)!]) {
			expect(dot.geometry.parameters.radius).toBe(0.25);
			expect(dot.material.color.getHexString()).toBe(params.color.slice(1));
			expect(Math.abs(dot.position.y)).toBeLessThanOrEqual(18);
		}
	});

	it('builds bare placeholders instead of markers when showDots is off', () => {
		const { scene } = mountDelegate({ showDots: false });
		expect(dotMeshes(scene).length).toBe(0);
		// The points still exist for the lines to connect.
		expect(netGroup(scene).children.length).toBe(11 * 11 * 2 + 1);
	});

	it('restores the fork\'s per-vertex line gradient, additive over a darker background', () => {
		const { scene } = mountDelegate();
		const material = linesMesh(scene).material;
		// The restoration the port makes knowingly: the fork passed the removed
		// THREE.VertexColors constant, so on air vertex colours stayed off and
		// lines rendered flat white.
		expect(material.vertexColors).toBe(true);
		expect(material.transparent).toBe(true);
		expect(material.blending).toBe(THREE.AdditiveBlending);
	});

	it('falls back to normal blending when the background is brighter than the line colour', () => {
		const { scene } = mountDelegate({ color: '#111111', backgroundColor: '#ffffff' });
		expect(linesMesh(scene).material.blending).toBe(THREE.NormalBlending);
	});

	it('connects points within the connection distance, and only those', () => {
		const { delegate, scene, context } = mountDelegate();
		const lines = linesMesh(scene);
		delegate.update({ ...context, elapsedSeconds: 1 });
		const drawn = lines.geometry.drawRange.count;
		expect(drawn).toBeGreaterThan(0);
		expect(drawn % 2).toBe(0);
		const position = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
		for (const segment of [0, Math.floor(drawn / 4)]) {
			const a = new THREE.Vector3().fromBufferAttribute(position, segment * 2);
			const b = new THREE.Vector3().fromBufferAttribute(position, segment * 2 + 1);
			expect(a.distanceTo(b)).toBeLessThan(22);
		}
	});

	it('fills the buffer exactly at full connectivity, with no self-segments and no overflow', () => {
		// The densest reachable field: a tiny doubled grid whose 18 points all
		// sit within the maximum connection distance of each other, so every
		// distinct pair connects. The fork's self-pair segments are skipped and
		// its heuristic buffer could overflow here; the exact bound cannot.
		const { delegate, scene, context } = mountDelegate({ points: 2, spacing: 2, maxDistance: 80 });
		const lines = linesMesh(scene);
		delegate.update({ ...context, elapsedSeconds: 1 });
		const pointCount = 3 * 3 * 2;
		const distinctPairs = pointCount * (pointCount - 1) / 2;
		expect(lines.geometry.drawRange.count).toBe(distinctPairs * 2);
		const position = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
		expect(position.count).toBe(distinctPairs * 2);
	});

	it('tightening the connection distance live draws fewer segments', () => {
		const { delegate, scene, context, params } = mountDelegate();
		const lines = linesMesh(scene);
		delegate.update({ ...context, elapsedSeconds: 1 });
		const atDefault = lines.geometry.drawRange.count;
		delegate.applyParams({ ...context, params: { ...params, maxDistance: 1 } });
		delegate.update({ ...context, elapsedSeconds: 1 });
		expect(lines.geometry.drawRange.count).toBeLessThan(atDefault);
	});

	it('orbits each point about the vertical axis, absolute in elapsed time', () => {
		const { delegate, scene, context } = mountDelegate();
		const dots = dotMeshes(scene);
		const before = dots.map(dot => ({
			radius: Math.hypot(dot.position.x, dot.position.z),
			y: dot.position.y,
			x: dot.position.x,
		}));
		delegate.update({ ...context, elapsedSeconds: 40 });
		const after = dots.map(dot => dot.position.clone());
		let moved = 0;
		dots.forEach((dot, index) => {
			expect(Math.hypot(dot.position.x, dot.position.z)).toBeCloseTo(before[index]!.radius);
			expect(dot.position.y).toBe(before[index]!.y);
			if (Math.abs(dot.position.x - before[index]!.x) > 0.01)
				moved++;
		});
		expect(moved).toBeGreaterThan(0);
		// Absolute: replaying the same time reproduces the same positions.
		delegate.update({ ...context, elapsedSeconds: 40 });
		dots.forEach((dot, index) => {
			expect(dot.position.x).toBeCloseTo(after[index]!.x);
			expect(dot.position.z).toBeCloseTo(after[index]!.z);
		});
	});

	it('lights the field the way the fork did, spot aimed at the group', () => {
		const { scene } = mountDelegate();
		const ambient = scene.children.find((child): child is THREE.AmbientLight => (child as THREE.AmbientLight).isAmbientLight);
		expect(ambient?.intensity).toBe(0.75);
		const spot = scene.children.find((child): child is THREE.SpotLight => (child as THREE.SpotLight).isSpotLight);
		expect(spot?.intensity).toBe(1);
		expect(spot?.position.toArray()).toEqual([0, 200, 0]);
		expect(spot?.distance).toBe(400);
		expect(spot?.target).toBe(netGroup(scene));
	});

	it('applies colours live, and rebuilds the field when its construction params change', () => {
		const { delegate, scene, context, params } = mountDelegate();
		delegate.applyParams({ ...context, params: { ...params, color: '#123456', backgroundColor: '#224466' } });
		expect((scene.background as THREE.Color).getHexString()).toBe('224466');
		expect(dotMeshes(scene)[0]!.material.color.getHexString()).toBe('123456');

		delegate.applyParams({ ...context, params: { ...params, points: 4 } });
		expect(dotMeshes(scene).length).toBe(5 * 5 * 2);

		delegate.applyParams({ ...context, params: { ...params, points: 4, showDots: false } });
		expect(dotMeshes(scene).length).toBe(0);
	});

	it('recomputes the blending choice live, as a fresh mount of the same params would', () => {
		const { delegate, scene, context, params } = mountDelegate();
		expect(linesMesh(scene).material.blending).toBe(THREE.AdditiveBlending);
		delegate.applyParams({ ...context, params: { ...params, color: '#111111', backgroundColor: '#ffffff' } });
		expect(linesMesh(scene).material.blending).toBe(THREE.NormalBlending);
	});
});

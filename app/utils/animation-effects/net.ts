import type { NetAnimationParams } from '~~/shared/animationEffects';
import type { SceneEffectDelegate } from './sceneEffect';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createSceneEffect } from './sceneEffect';

/**
 * Net: a slowly orbiting point field strung with distance-faded connection
 * lines, ported from the retired Vanta fork under its old name. The field is
 * the fork's construction verbatim — a doubled, jittered grid whose points
 * each orbit the vertical axis at their own rate — and the per-frame orbit is
 * carried as its closed form over elapsed seconds at the fork's 60fps clock.
 * The camera needs no easing at all: the centred synthetic pointer the fork's
 * base always fired resolves its orbit target to exactly the start position,
 * so it simply stands at (50, 100, 150) looking at the origin.
 *
 * One knowing restoration (see the schema comment): the fork enabled vertex
 * colours with the `THREE.VertexColors` constant three had removed, so on air
 * its per-vertex line gradient silently degraded to flat default-white lines.
 * The port passes `vertexColors: true`, restoring the gradient the fork wrote.
 * Its `blending: null` on the brighter-background branch normalises to
 * `NormalBlending` for the same reason. Two inert fork behaviours drop: the
 * pointer-proximity point scaling (its raycaster was never constructed, so
 * scale held 1) and the mobile field reduction (a Screen Output is never a
 * mobile browser).
 */

/** The fork's per-frame orbit step, 0.00025 · rate rad at its ~60fps loop. */
const ORBIT_RATE = 0.00025 * 60;
const CAMERA_POSITION = { x: 50, y: 100, z: 150 };

/** The fork's `getBrightness`: rec601 luma over the colour channels. */
function luminance(color: THREE.Color): number {
	return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

interface OrbitingPoint {
	holder: THREE.Object3D;
	radius: number;
	angle: number;
	spinRate: number;
}

function randomBetween(start: number, end: number): number {
	return start + Math.random() * (end - start);
}

function randomInt(start: number, end: number): number {
	return Math.floor(start + Math.random() * (end - start + 1));
}

export function createNetDelegate(): SceneEffectDelegate<NetAnimationParams> {
	let current: NetAnimationParams;
	let group: THREE.Group;
	let points: OrbitingPoint[];
	let lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
	let linePositions: Float32Array;
	let lineColors: Float32Array;
	let dotGeometry: THREE.SphereGeometry | undefined;
	let dotMaterial: THREE.MeshLambertMaterial | undefined;

	/** Additive over a darker background, normal over a brighter one — the fork's choice. */
	function usesAdditiveBlending(params: NetAnimationParams): boolean {
		return luminance(new THREE.Color(params.color)) > luminance(new THREE.Color(params.backgroundColor));
	}

	function addPoint(three: typeof THREE, x: number, y: number, z: number) {
		const holder = current.showDots && dotGeometry && dotMaterial
			? new three.Mesh(dotGeometry, dotMaterial)
			: new three.Object3D();
		holder.position.set(x, y, z);
		group.add(holder);
		points.push({
			holder,
			radius: Math.hypot(x, z),
			angle: Math.atan2(z, x),
			spinRate: randomBetween(-2, 2),
		});
	}

	/**
	 * (Re)build the point field and line buffers for the current construction
	 * params. Called at build, and again when `points`, `spacing`, or
	 * `showDots` change — the fork read those only at init, so a live change is
	 * given what a fresh mount of the same params would show.
	 */
	function buildField(three: typeof THREE) {
		for (const child of [...group.children])
			group.remove(child);
		lines?.geometry.dispose();
		lines?.material.dispose();
		dotGeometry?.dispose();
		dotMaterial?.dispose();

		dotGeometry = current.showDots ? new three.SphereGeometry(0.25, 12, 12) : undefined;
		dotMaterial = current.showDots ? new three.MeshLambertMaterial({ color: current.color }) : undefined;

		points = [];
		const n = current.points;
		const spacing = current.spacing;
		for (let i = 0; i <= n; i++) {
			for (let j = 0; j <= n; j++) {
				const y = randomInt(-3, 3);
				const x = (i - n / 2) * spacing + randomInt(-5, 5);
				let z = (j - n / 2) * spacing + randomInt(-5, 5);
				if (i % 2)
					z += spacing * 0.5;
				addPoint(three, x, y - randomInt(5, 15), z);
				addPoint(three, x + randomInt(-5, 5), y + randomInt(5, 15), z + randomInt(-5, 5));
			}
		}

		// Sized for every distinct pair connecting at once — the true upper bound
		// now that the pair loop skips self-pairs, where the fork's heuristic
		// allocation could silently drop segments when a tight spacing connected
		// more pairs than it had room for.
		const maxSegments = points.length * (points.length - 1) / 2;
		linePositions = new Float32Array(maxSegments * 6);
		lineColors = new Float32Array(maxSegments * 6);
		const geometry = new three.BufferGeometry();
		geometry.setAttribute('position', new three.BufferAttribute(linePositions, 3).setUsage(three.DynamicDrawUsage));
		geometry.setAttribute('color', new three.BufferAttribute(lineColors, 3).setUsage(three.DynamicDrawUsage));
		geometry.computeBoundingSphere();
		geometry.setDrawRange(0, 0);
		lines = new three.LineSegments(geometry, new three.LineBasicMaterial({
			vertexColors: true,
			blending: usesAdditiveBlending(current) ? three.AdditiveBlending : three.NormalBlending,
			transparent: true,
		}));
		group.add(lines);
	}

	return {
		createCamera: (three, viewport) => {
			const camera = new three.PerspectiveCamera(25, viewport.width / viewport.height, 0.01, 10000);
			camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
			camera.lookAt(0, 0, 0);
			return camera;
		},

		build: ({ three, scene, params }) => {
			current = params;
			scene.background = new three.Color(params.backgroundColor);
			group = new three.Group();
			scene.add(group);
			buildField(three);

			const ambience = new three.AmbientLight(0xFFFFFF, 0.75);
			scene.add(ambience);
			const spot = new three.SpotLight(0xFFFFFF, 1);
			spot.position.set(0, 200, 0);
			spot.distance = 400;
			spot.target = group;
			scene.add(spot);
		},

		applyParams: ({ three, scene, params }) => {
			const fieldChanged = params.points !== current.points
				|| params.spacing !== current.spacing
				|| params.showDots !== current.showDots;
			current = params;
			scene.background = new three.Color(params.backgroundColor);
			if (fieldChanged) {
				buildField(three);
				return;
			}
			dotMaterial?.color.set(params.color);
			lines.material.blending = usesAdditiveBlending(params) ? three.AdditiveBlending : three.NormalBlending;
		},

		update: ({ three, elapsedSeconds }) => {
			for (const point of points) {
				if (point.spinRate === 0)
					continue;
				const angle = point.angle + ORBIT_RATE * point.spinRate * elapsedSeconds;
				point.holder.position.x = point.radius * Math.cos(angle);
				point.holder.position.z = point.radius * Math.sin(angle);
			}

			const backgroundColor = new three.Color(current.backgroundColor);
			const color = new three.Color(current.color);
			const additive = usesAdditiveBlending(current);
			const differenceColor = color.clone().sub(backgroundColor);
			// One scratch colour reused across the pair loop, which runs thousands
			// of times a frame.
			const lineColor = new three.Color();

			let vertexIndex = 0;
			let colorIndex = 0;
			let connected = 0;
			// `j = i + 1`, where the fork started at `j = i`: its self-pair drew a
			// zero-length, invisible segment per point, and skipping them is what
			// makes `maxSegments` the true bound.
			for (let i = 0; i < points.length; i++) {
				const a = points[i]!.holder.position;
				for (let j = i + 1; j < points.length; j++) {
					const b = points[j]!.holder.position;
					const distance = a.distanceTo(b);
					if (distance >= current.maxDistance)
						continue;
					const alpha = Math.min(Math.max((1 - distance / current.maxDistance) * 2, 0), 1);
					if (additive)
						lineColor.setScalar(0).lerp(differenceColor, alpha);
					else
						lineColor.copy(backgroundColor).lerp(color, alpha);

					linePositions[vertexIndex++] = a.x;
					linePositions[vertexIndex++] = a.y;
					linePositions[vertexIndex++] = a.z;
					linePositions[vertexIndex++] = b.x;
					linePositions[vertexIndex++] = b.y;
					linePositions[vertexIndex++] = b.z;
					// Both ends of the segment carry the same colour, as in the fork.
					lineColors[colorIndex++] = lineColor.r;
					lineColors[colorIndex++] = lineColor.g;
					lineColors[colorIndex++] = lineColor.b;
					lineColors[colorIndex++] = lineColor.r;
					lineColors[colorIndex++] = lineColor.g;
					lineColors[colorIndex++] = lineColor.b;
					connected++;
				}
			}
			lines.geometry.setDrawRange(0, connected * 2);
			lines.geometry.getAttribute('position').needsUpdate = true;
			lines.geometry.getAttribute('color').needsUpdate = true;
		},
	};
}

export default function createNetEffect(
	host: HTMLElement,
	params: NetAnimationParams,
): AnimationEffectInstance<NetAnimationParams> {
	return createSceneEffect({ three: THREE, host, delegate: createNetDelegate() }, params);
}

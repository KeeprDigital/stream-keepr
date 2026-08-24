import type { DotsAnimationParams } from '~~/shared/animationEffects';
import type { SceneEffectDelegate } from './sceneEffect';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createSceneEffect } from './sceneEffect';

/**
 * Dots: a drifting field of point sprites under a slow camera pull-back, with
 * tumbling radial accent segments, ported from the retired Vanta fork under
 * its old name. The fork animated per rendered frame — easing the camera a
 * fixed fraction toward its target and nudging the line rotation each pass of
 * its ~60fps loop, and accumulating a sine step onto each star at its
 * 60fps-normalised clock — so each motion is carried here as the closed form
 * of that accumulation over elapsed seconds: the same look, now independent of
 * frame rate. The pointer easing retires with the mouse pair; the fork's base
 * always fired a centred synthetic pointer at init, so the resting target the
 * camera eased toward on air is `onMouseMove(0.5, 0.5)`'s — the centred-pointer
 * steady state, per the waves-zoom precedent. The fork's base cleared the
 * canvas to `backgroundColor`, and a dot field never covers the frame, so the
 * scene background carries that here.
 */

/** The fork's star grid: 61×61 points, jittered just above y = -150. */
const GRID_HALF_EXTENT = 30;
const REST_HEIGHT = -150;
const REST_HEIGHT_JITTER = 5;
/** The fork's accumulated star drift: y += 0.1·sin(0.02z + 0.015x + 0.02t) per frame. */
const DRIFT_PHASE_X = 0.015;
const DRIFT_PHASE_Z = 0.02;
const DRIFT_AMPLITUDE = 5; // step 0.1 integrated over the 0.02/frame phase rate
const DRIFT_RATE = 0.02 * 60; // phase advance per second at the fork's 60fps clock
/**
 * The fork's camera: intro position easing 0.003/frame toward the resting
 * target its always-fired centred pointer set — tx = 0, ty = 50 + 0.5 · 50.
 */
const CAMERA_START = { x: 0, y: 250, z: 50 };
const CAMERA_TARGET = { x: 0, y: 75, z: 350 };
const CAMERA_REMAINING_PER_SECOND = 0.997 ** 60;
/** The fork's line tumble, per-frame increments times its 60fps clock. */
const LINE_ROTATION_Z = 0.002 * 60;
const LINE_ROTATION_X = 0.0008 * 60;
const LINE_ROTATION_Y = 0.0005 * 60;
const LINE_SEGMENT_COUNT = 200;

function buildLineSegments(
	three: typeof THREE,
): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
	// The fork's accent lines: radial spokes between two nested sphere shells,
	// each direction drawn uniformly on the sphere.
	const points: THREE.Vector3[] = [];
	for (let segment = 0; segment < LINE_SEGMENT_COUNT; segment++) {
		const inner = 40 + Math.random() * 20;
		const outer = inner + 12 + Math.random() * 8;
		const z = Math.random() * 2 - 1;
		const radius = Math.sqrt(1 - z * z);
		const theta = Math.random() * Math.PI * 2;
		const x = Math.cos(theta) * radius;
		const y = Math.sin(theta) * radius;
		points.push(new three.Vector3(x * inner, y * inner, z * inner));
		points.push(new three.Vector3(x * outer, y * outer, z * outer));
	}
	const geometry = new three.BufferGeometry().setFromPoints(points);
	return new three.LineSegments(geometry, new three.LineBasicMaterial());
}

export function createDotsDelegate(): SceneEffectDelegate<DotsAnimationParams> {
	let stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
	let lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | undefined;
	let restHeights: Float32Array;

	function placeStars(spacing: number) {
		// Vertex order is the fork's: column-major over grid indices [-30, 30].
		const position = stars.geometry.getAttribute('position') as THREE.BufferAttribute;
		let index = 0;
		for (let i = -GRID_HALF_EXTENT; i <= GRID_HALF_EXTENT; i++) {
			for (let j = -GRID_HALF_EXTENT; j <= GRID_HALF_EXTENT; j++) {
				position.setX(index, i * spacing + spacing / 2);
				position.setZ(index, j * spacing + spacing / 2);
				index++;
			}
		}
		position.needsUpdate = true;
	}

	/** Build or tear down the line segments so their presence matches `showLines`. */
	function syncLines(three: typeof THREE, scene: THREE.Scene, wanted: boolean) {
		if (wanted === Boolean(lines))
			return;
		if (lines) {
			scene.remove(lines);
			lines.geometry.dispose();
			lines.material.dispose();
			lines = undefined;
			return;
		}
		lines = buildLineSegments(three);
		scene.add(lines);
	}

	return {
		createCamera: (three, viewport) => {
			const camera = new three.PerspectiveCamera(50, viewport.width / viewport.height, 0.1, 5000);
			camera.position.set(CAMERA_START.x, CAMERA_START.y, CAMERA_START.z);
			camera.lookAt(0, 0, 0);
			return camera;
		},

		build: ({ three, scene, params }) => {
			scene.background = new three.Color(params.backgroundColor);

			const count = (GRID_HALF_EXTENT * 2 + 1) ** 2;
			restHeights = new Float32Array(count);
			const positions = new Float32Array(count * 3);
			for (let index = 0; index < count; index++) {
				restHeights[index] = REST_HEIGHT + Math.random() * REST_HEIGHT_JITTER;
				positions[index * 3 + 1] = restHeights[index]!;
			}
			const geometry = new three.BufferGeometry();
			const position = new three.BufferAttribute(positions, 3);
			position.setUsage(three.DynamicDrawUsage);
			geometry.setAttribute('position', position);
			stars = new three.Points(geometry, new three.PointsMaterial({
				color: params.color,
				size: params.size,
			}));
			scene.add(stars);
			placeStars(params.spacing);

			syncLines(three, scene, params.showLines);
			lines?.material.color.set(params.color2);
		},

		applyParams: ({ three, scene, params }) => {
			scene.background = new three.Color(params.backgroundColor);
			stars.material.color.set(params.color);
			stars.material.size = params.size;
			placeStars(params.spacing);
			syncLines(three, scene, params.showLines);
			lines?.material.color.set(params.color2);
		},

		update: ({ camera, elapsedSeconds }) => {
			const position = stars.geometry.getAttribute('position') as THREE.BufferAttribute;
			for (let index = 0; index < position.count; index++) {
				const phase = DRIFT_PHASE_Z * position.getZ(index) + DRIFT_PHASE_X * position.getX(index);
				position.setY(index, restHeights[index]!
					+ DRIFT_AMPLITUDE * (Math.cos(phase) - Math.cos(phase + DRIFT_RATE * elapsedSeconds)));
			}
			position.needsUpdate = true;

			const remaining = CAMERA_REMAINING_PER_SECOND ** elapsedSeconds;
			camera.position.set(
				CAMERA_TARGET.x + (CAMERA_START.x - CAMERA_TARGET.x) * remaining,
				CAMERA_TARGET.y + (CAMERA_START.y - CAMERA_TARGET.y) * remaining,
				CAMERA_TARGET.z + (CAMERA_START.z - CAMERA_TARGET.z) * remaining,
			);
			camera.lookAt(0, 0, 0);

			if (lines)
				lines.rotation.set(LINE_ROTATION_X * elapsedSeconds, LINE_ROTATION_Y * elapsedSeconds, LINE_ROTATION_Z * elapsedSeconds);
		},
	};
}

export default function createDotsEffect(
	host: HTMLElement,
	params: DotsAnimationParams,
): AnimationEffectInstance<DotsAnimationParams> {
	return createSceneEffect({ three: THREE, host, delegate: createDotsDelegate() }, params);
}

import type { RingsAnimationParams } from '~~/shared/animationEffects';
import type { SceneEffectDelegate } from './sceneEffect';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createSceneEffect } from './sceneEffect';

/**
 * Rings: a tilted, slowly wobbling stack of extruded arc segments, each
 * spinning at its own speed, ported from the retired Vanta fork under its old
 * name. The stack is the fork's random construction verbatim — sixty seed
 * rings whose radius, width, height, and speed come from its distributions,
 * each with a chance of recursively spawning tighter children — in its fixed
 * thirteen-colour palette (the colour option the pre-rebuild editor offered
 * was never read; see the schema). The fork's per-frame motions — ring spin,
 * group wobble, camera easing — are carried as closed forms over elapsed
 * seconds at its 60fps clock, and the camera's resting height is the
 * centred-pointer steady state its base always fired at init (ty = 150 −
 * 0.5 · 50), per the dots precedent. The fork's base cleared the canvas to
 * `backgroundColor`, and the rings never cover the frame, so the scene
 * background carries that here. The fork's mobile halving of the stack drops:
 * a Screen Output is never a mobile browser. Its per-ring shadow flags drop
 * too — it never enabled shadow maps on the renderer, so they were inert.
 */

export const RINGS_PALETTE = [
	'#ff2255', // red
	'#ff1199', // pink
	'#ff66cc', // light pink
	'#88ff00', // green
	'#77cc11', // dark green
	'#ffff00', // yellow
	'#ff7733', // orange
	'#11ffff', // light blue
	'#1188dd', // blue
	'#ffdd22', // yellow
	'#2255cc', // dark blue
	'#79b0bc', // slate
	'#53707b', // dark slate
] as const;

const SEED_RING_COUNT = 60;
/** The fork applied `speed * 0.001` per frame of its ~60fps loop. */
const SPIN_RATE = 0.001 * 60;
/** The fork's group wobble: ±0.0001 · sin and ±0.00007 · cos steps per frame, integrated. */
const GROUP_TILT_X = 0.06667;
const GROUP_TILT_Z = 0.16667;
const WOBBLE_PHASE_RATE = 0.001 * 60;
const WOBBLE_AMPLITUDE_X = 0.0001 / 0.001;
const WOBBLE_AMPLITUDE_Z = 0.00007 / 0.001;
/** The fork's camera easing, 0.02/frame toward the centred-pointer target. */
const CAMERA_START_Y = 150;
const CAMERA_TARGET_Y = 125;
const CAMERA_REMAINING_PER_SECOND = 0.98 ** 60;
const CAMERA_Z = 200;
const CAMERA_LOOK_TARGET = { x: 0, y: 25, z: 7 };

function randomBetween(start: number, end: number): number {
	return start + Math.random() * (end - start);
}

function randomInt(start: number, end: number): number {
	return Math.floor(start + Math.random() * (end - start + 1));
}

function samplePalette(): string {
	return RINGS_PALETTE[Math.floor(Math.random() * RINGS_PALETTE.length)]!;
}

/** One ring the delegate spins: the mesh and the spin the fork stored on it. */
interface SpinningRing {
	mesh: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshLambertMaterial>;
	startAngle: number;
	spinSpeed: number;
}

/** The fork's per-ring construction inputs, threaded through its child recursion. */
interface RingSpec {
	color: string;
	radius: number;
	width: number;
	startAngle: number;
	arc: number;
	y: number;
	speed: number;
}

export function createRingsDelegate(): SceneEffectDelegate<RingsAnimationParams> {
	let group: THREE.Group;
	let rings: SpinningRing[];

	function generateRing(three: typeof THREE, spec: RingSpec): void {
		const { color, width, startAngle, arc, y, speed } = spec;
		const radius = Math.max(spec.radius, 1);
		const shape = new three.Shape();
		shape.absarc(0, 0, radius + width, 0, arc, false);
		shape.lineTo(radius * Math.cos(arc), radius * Math.sin(arc));
		shape.absarc(0, 0, radius, arc, 0, true);
		const geometry = new three.ExtrudeGeometry(shape, {
			depth: 0.4,
			bevelEnabled: false,
			steps: 1,
			curveSegments: Math.trunc((64 * arc) / 6.14),
		});
		const material = new three.MeshLambertMaterial({ color });
		if (randomInt(0, 1) === 0 || radius > 60) {
			material.transparent = true;
			material.opacity = Math.max(50 / radius + randomBetween(-0.3, 0.3), 0.1);
		}
		const mesh = new three.Mesh(geometry, material);
		mesh.rotation.x = Math.PI / 2;
		mesh.rotation.z = startAngle;
		mesh.position.y = y;
		rings.push({ mesh, startAngle, spinSpeed: speed });
		group.add(mesh);

		// A tight, narrow ring may spawn a child continuing its arc — the fork
		// swallowed any geometry error a degenerate child produced, so this does.
		if (radius < 20 && arc < Math.PI * 1.3 && randomInt(0, 2) !== 0) {
			try {
				generateRing(three, {
					color: samplePalette(),
					radius: radius + randomBetween(-1, 3),
					width: width + randomBetween(-2, 0),
					startAngle: startAngle + arc,
					arc: arc + randomBetween(-0.5, 0.5),
					y: y + randomBetween(-3, 1),
					speed,
				});
			}
			catch {}
		}
	}

	return {
		createCamera: (three, viewport) => {
			const camera = new three.PerspectiveCamera(25, viewport.width / viewport.height, 10, 10000);
			// The fork's per-frame anti-flicker near plane, max(z * 0.5 - 20, 1) —
			// constant here because the camera never moves in z.
			camera.near = Math.max(CAMERA_Z * 0.5 - 20, 1);
			camera.updateProjectionMatrix();
			camera.position.set(0, CAMERA_START_Y, CAMERA_Z);
			return camera;
		},

		build: ({ three, scene, params }) => {
			scene.background = new three.Color(params.backgroundColor);

			group = new three.Group();
			group.position.set(30, 0, 0);
			group.rotation.x = GROUP_TILT_X;
			group.rotation.z = GROUP_TILT_Z;
			scene.add(group);

			rings = [];
			for (let seed = 0; seed < SEED_RING_COUNT; seed++) {
				let radius: number;
				let width: number;
				if (randomInt(0, 3)) {
					radius = randomBetween(2, 4)
						+ randomBetween(1, 30) * randomBetween(1, 2) * randomBetween(1, 2) * randomBetween(1, 2);
					width = randomBetween(0, 3.5) + randomBetween(0, 3.5)
						- randomInt(0, radius / 4) - radius / 50;
				}
				else {
					radius = randomBetween(1, 3) * randomBetween(2, 4);
					width = randomBetween(1, 2) * randomBetween(1, 2) * randomBetween(1.1, 1.5);
				}
				const minimumWidth = 2 ** randomInt(0, 4) * 0.05;
				width = Math.max(width, minimumWidth);

				generateRing(three, {
					color: samplePalette(),
					radius,
					width,
					startAngle: randomBetween(0, 1000),
					arc: randomBetween(1, 6),
					y: randomBetween(0, 50 / (radius + 1) + 5) + 5 / width / (radius + 0.5),
					speed: Math.max(-randomBetween(0.5, 2), randomBetween(1, 50 - radius / 2) - radius / 2) * 0.25,
				});
			}

			const ambience = new three.AmbientLight(0xFFFFFF, 0.5);
			scene.add(ambience);
			const pointLight = new three.PointLight(0xFFFFFF, 0.5);
			pointLight.position.set(0, CAMERA_START_Y, CAMERA_Z);
			scene.add(pointLight);
			const spot = new three.SpotLight(0xFFFFFF, 1);
			spot.position.set(-15, 50, 100);
			spot.penumbra = 1;
			spot.angle = 0.5;
			spot.decay = 1;
			spot.distance = 300;
			spot.target = group;
			scene.add(spot);
		},

		applyParams: ({ three, scene, params }) => {
			scene.background = new three.Color(params.backgroundColor);
		},

		update: ({ camera, elapsedSeconds }) => {
			const remaining = CAMERA_REMAINING_PER_SECOND ** elapsedSeconds;
			camera.position.set(0, CAMERA_TARGET_Y + (CAMERA_START_Y - CAMERA_TARGET_Y) * remaining, CAMERA_Z);
			camera.lookAt(CAMERA_LOOK_TARGET.x, CAMERA_LOOK_TARGET.y, CAMERA_LOOK_TARGET.z);

			for (const { mesh, startAngle, spinSpeed } of rings)
				mesh.rotation.z = startAngle + SPIN_RATE * spinSpeed * elapsedSeconds;

			const wobblePhase = WOBBLE_PHASE_RATE * elapsedSeconds;
			group.rotation.x = GROUP_TILT_X + WOBBLE_AMPLITUDE_X * (1 - Math.cos(wobblePhase));
			group.rotation.z = GROUP_TILT_Z + WOBBLE_AMPLITUDE_Z * Math.sin(wobblePhase);
		},
	};
}

export default function createRingsEffect(
	host: HTMLElement,
	params: RingsAnimationParams,
): AnimationEffectInstance<RingsAnimationParams> {
	return createSceneEffect({ three: THREE, host, delegate: createRingsDelegate() }, params);
}

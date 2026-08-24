import type { GlobeAnimationParams } from '~~/shared/animationEffects';
import type { ConnectionLineField } from './connectionLines';
import type { SceneEffectDelegate } from './sceneEffect';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createConnectionLineField } from './connectionLines';
import { randomBetween } from './random';
import { createSceneEffect } from './sceneEffect';

/**
 * Globe: a wireframe sphere with radial accents and pole lines turning over a
 * waving, line-strung point plane, ported from the retired Vanta fork under
 * its old name — net's sibling, sharing its connection-line machinery and its
 * vertex-colour restoration (`connectionLines.ts`). The point plane's wave is
 * the fork's own absolute sine of position and time, and the fixed per-frame
 * spins of the sphere, radial ball, and pole lines are carried as closed forms
 * over elapsed seconds at the fork's 60fps clock. The camera stands still: the
 * centred synthetic pointer the fork's base always fired resolves its orbit
 * target to exactly the start position. Its viewport-width-dependent look
 * target collapses to the widest branch (−40, 0, 0) — a Screen Output is never
 * a phone — and the never-constructed raycaster's proximity scaling drops, as
 * in net.
 */

/** The fork's wave: y = 2 · sin(x/10 + 0.01·t + z/20), t in its 60fps frames. */
const WAVE_RATE = 0.01 * 60;
/** The fork's fixed per-frame spins, at its ~60fps loop. */
const BALL_ROTATION = { x: 0.0008 * 60, y: 0.0005 * 60, z: 0.002 * 60 };
const SPHERE_ROTATION_Y = 0.002 * 60;
const POLES_ROTATION_Y = -0.004 * 60;
const CAMERA_POSITION = { x: 50, y: 100, z: 150 };
const CAMERA_LOOK_TARGET = { x: -40, y: 0, z: 0 };
const FIELD_GROUP_POSITION = { x: -50, y: -20, z: 0 };
const GLOBE_GROUP_POSITION = { x: 0, y: 15, z: 0 };
const GLOBE_GROUP_TILT_X = -0.25;
const GLOBE_RADIUS = 18;

export function createGlobeDelegate(): SceneEffectDelegate<GlobeAnimationParams> {
	let current: GlobeAnimationParams;
	let fieldGroup: THREE.Group;
	let globeGroup: THREE.Group;
	let positions: THREE.Vector3[];
	let lines: ConnectionLineField | undefined;
	let dotGeometry: THREE.SphereGeometry | undefined;
	let dotMaterial: THREE.MeshLambertMaterial | undefined;
	let ball: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
	let poles: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
	let sphere: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> | undefined;

	/**
	 * (Re)build the waving point plane and its line buffers. Called at build,
	 * and again when `points`, `spacing`, or `showDots` change — the fork read
	 * those only at init, so a live change is given what a fresh mount of the
	 * same params would show.
	 */
	function buildField(three: typeof THREE) {
		for (const child of [...fieldGroup.children])
			fieldGroup.remove(child);
		lines?.dispose();
		dotGeometry?.dispose();
		dotMaterial?.dispose();

		dotGeometry = current.showDots ? new three.SphereGeometry(0.25, 12, 12) : undefined;
		dotMaterial = current.showDots ? new three.MeshLambertMaterial({ color: current.color }) : undefined;

		positions = [];
		const n = current.points;
		const spacing = current.spacing;
		for (let i = 0; i <= n; i++) {
			for (let j = 0; j <= n; j++) {
				const holder = current.showDots && dotGeometry && dotMaterial
					? new three.Mesh(dotGeometry, dotMaterial)
					: new three.Object3D();
				holder.position.set((i - n / 2) * spacing, 0, (j - n / 2) * spacing);
				fieldGroup.add(holder);
				positions.push(holder.position);
			}
		}

		lines = createConnectionLineField(three, positions.length, current);
		fieldGroup.add(lines.mesh);
	}

	/** The wireframe globe itself, rebuilt when `size` changes. */
	function buildSphere(three: typeof THREE) {
		if (sphere) {
			globeGroup.remove(sphere);
			sphere.geometry.dispose();
			sphere.material.dispose();
		}
		const sphereGeometry = new three.SphereGeometry(GLOBE_RADIUS * current.size, 18, 14);
		sphere = new three.LineSegments(
			new three.EdgesGeometry(sphereGeometry),
			new three.LineBasicMaterial({ color: current.color }),
		);
		sphereGeometry.dispose();
		globeGroup.add(sphere);
	}

	return {
		createCamera: (three, viewport) => {
			const camera = new three.PerspectiveCamera(20, viewport.width / viewport.height, 0.01, 10000);
			camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
			camera.lookAt(CAMERA_LOOK_TARGET.x, CAMERA_LOOK_TARGET.y, CAMERA_LOOK_TARGET.z);
			return camera;
		},

		build: ({ three, scene, params }) => {
			current = params;
			scene.background = new three.Color(params.backgroundColor);

			fieldGroup = new three.Group();
			fieldGroup.position.set(FIELD_GROUP_POSITION.x, FIELD_GROUP_POSITION.y, FIELD_GROUP_POSITION.z);
			scene.add(fieldGroup);
			buildField(three);

			globeGroup = new three.Group();
			globeGroup.position.set(GLOBE_GROUP_POSITION.x, GLOBE_GROUP_POSITION.y, GLOBE_GROUP_POSITION.z);
			globeGroup.rotation.x = GLOBE_GROUP_TILT_X;
			scene.add(globeGroup);

			// The radial accent ball: spokes between two nested shells, uniform on
			// the sphere.
			const ballPoints: THREE.Vector3[] = [];
			for (let segment = 0; segment < 80; segment++) {
				const inner = randomBetween(18, 24);
				const outer = inner + randomBetween(1, 6);
				const z = randomBetween(-1, 1);
				const radius = Math.sqrt(1 - z * z);
				const theta = randomBetween(0, Math.PI * 2);
				const x = Math.cos(theta) * radius;
				const y = Math.sin(theta) * radius;
				ballPoints.push(new three.Vector3(x * inner, y * inner, z * inner));
				ballPoints.push(new three.Vector3(x * outer, y * outer, z * outer));
			}
			ball = new three.LineSegments(
				new three.BufferGeometry().setFromPoints(ballPoints),
				new three.LineBasicMaterial({ color: params.color2 }),
			);
			globeGroup.add(ball);

			// The pole lines: the axis, and four azimuths of field-line verticals
			// shrinking outward through the fork's height table.
			const poleHeights = [17.9, 12, 8, 5, 3, 2, 1.5, 1.1, 0.8, 0.6, 0.45, 0.3, 0.2, 0.1, 0.05, 0.03, 0.02, 0.01];
			const polePoints: THREE.Vector3[] = [
				new three.Vector3(0, 30, 0),
				new three.Vector3(0, -30, 0),
			];
			const azimuths = 4;
			for (let azimuth = 0; azimuth < azimuths; azimuth++) {
				const x = 0.15 * Math.cos(azimuth / azimuths * Math.PI * 2);
				const z = 0.15 * Math.sin(azimuth / azimuths * Math.PI * 2);
				poleHeights.forEach((height, index) => {
					const radius = 6 * (index + 1);
					polePoints.push(new three.Vector3(x * radius, height, z * radius));
					polePoints.push(new three.Vector3(x * radius, -height, z * radius));
				});
			}
			poles = new three.LineSegments(
				new three.BufferGeometry().setFromPoints(polePoints),
				new three.LineBasicMaterial({ color: params.color2 }),
			);
			globeGroup.add(poles);

			buildSphere(three);

			const ambience = new three.AmbientLight(0xFFFFFF, 0.75);
			scene.add(ambience);
			const spot = new three.SpotLight(0xFFFFFF, 1);
			spot.position.set(0, 200, 0);
			spot.distance = 400;
			spot.target = fieldGroup;
			scene.add(spot);
		},

		applyParams: ({ three, scene, params }) => {
			const fieldChanged = params.points !== current.points
				|| params.spacing !== current.spacing
				|| params.showDots !== current.showDots;
			const sizeChanged = params.size !== current.size;
			current = params;
			scene.background = new three.Color(params.backgroundColor);
			if (fieldChanged)
				buildField(three);
			if (sizeChanged)
				buildSphere(three);
			dotMaterial?.color.set(params.color);
			sphere?.material.color.set(params.color);
			ball.material.color.set(params.color2);
			poles.material.color.set(params.color2);
			lines?.applyBlending(params);
		},

		update: ({ elapsedSeconds }) => {
			for (const position of positions)
				position.y = 2 * Math.sin(position.x / 10 + WAVE_RATE * elapsedSeconds + position.z / 10 * 0.5);
			lines?.update(positions, current);

			ball.rotation.set(
				BALL_ROTATION.x * elapsedSeconds,
				BALL_ROTATION.y * elapsedSeconds,
				BALL_ROTATION.z * elapsedSeconds,
			);
			sphere!.rotation.y = SPHERE_ROTATION_Y * elapsedSeconds;
			poles.rotation.y = POLES_ROTATION_Y * elapsedSeconds;
		},
	};
}

export default function createGlobeEffect(
	host: HTMLElement,
	params: GlobeAnimationParams,
): AnimationEffectInstance<GlobeAnimationParams> {
	return createSceneEffect({ three: THREE, host, delegate: createGlobeDelegate() }, params);
}

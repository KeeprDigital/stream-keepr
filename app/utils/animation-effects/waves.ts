import type { WavesAnimationParams } from '~~/shared/animationEffects';
import type { SceneEffectDelegate } from './sceneEffect';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createSceneEffect } from './sceneEffect';

/**
 * Waves: a lit, choppy water plane, ported from the retired Vanta fork under
 * its old name — the first effect on the scene/mesh base. The geometry, the
 * trochoid displacement, and the camera framing are the fork's; the lighting is
 * the fork's as the pre-rebuild application re-tuned it in `enhanceWavesInstance`
 * (dimmed ambience, brightened point light, added directional), which is what
 * actually rendered on air. The fork eased the camera toward its base position
 * divided by zoom as the pointer centred; with the mouse pair retired, that
 * steady state simply is the camera position, which keeps zoom meaningful with
 * no pointer to chase.
 */

const GRID_COLUMNS = 100;
const GRID_ROWS = 80;
const CELL_SIZE = 18;
/** The fork's `waveNoise`: how far each vertex's rest height jitters, for chop. */
const REST_HEIGHT_JITTER = 4;
const REST_HEIGHT = -10;
/** The fork's camera placement, its `xOffset`/`zOffset` folded in. */
const CAMERA_POSITION = { x: 240, y: 200, z: 390 };
const CAMERA_TARGET = { x: 140, y: -30, z: 190 };
/** The fork advanced `t` in 60fps-normalised frames, and the wave phase uses it. */
const FORK_FRAMES_PER_SECOND = 60;

export function createWavesDelegate(): SceneEffectDelegate<WavesAnimationParams> {
	let current: WavesAnimationParams;
	let mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
	let restHeights: Float32Array;

	function frameCamera(camera: THREE.Camera, zoom: number) {
		camera.position.set(CAMERA_POSITION.x / zoom, CAMERA_POSITION.y / zoom, CAMERA_POSITION.z / zoom);
		camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);
	}

	return {
		createCamera: (three, viewport) =>
			new three.PerspectiveCamera(35, viewport.width / viewport.height, 50, 10000),

		build: ({ three, scene, camera, params }) => {
			current = params;

			const points: THREE.Vector3[] = [];
			for (let column = 0; column <= GRID_COLUMNS; column++) {
				for (let row = 0; row <= GRID_ROWS; row++) {
					points.push(new three.Vector3(
						(column - GRID_COLUMNS * 0.5) * CELL_SIZE,
						REST_HEIGHT + Math.random() * REST_HEIGHT_JITTER,
						(GRID_ROWS * 0.5 - row) * CELL_SIZE,
					));
				}
			}

			const geometry = new three.BufferGeometry().setFromPoints(points);
			// Each grid cell splits into two triangles across a randomly chosen
			// diagonal, as in the fork — with flat shading, the irregular seams are
			// what breaks the water into facets instead of uniform stripes.
			const vertexId = (column: number, row: number) => column * (GRID_ROWS + 1) + row;
			const indices: number[] = [];
			for (let column = 1; column <= GRID_COLUMNS; column++) {
				for (let row = 1; row <= GRID_ROWS; row++) {
					const a = vertexId(column - 1, row - 1);
					const b = vertexId(column, row - 1);
					const c = vertexId(column - 1, row);
					const d = vertexId(column, row);
					if (Math.random() < 0.5)
						indices.push(a, b, c, b, c, d);
					else
						indices.push(a, b, d, a, c, d);
				}
			}
			geometry.setIndex(indices);

			const position = geometry.getAttribute('position') as THREE.BufferAttribute;
			position.setUsage(three.DynamicDrawUsage);
			restHeights = new Float32Array(position.count);
			for (let index = 0; index < position.count; index++)
				restHeights[index] = position.getY(index);

			mesh = new three.Mesh(geometry, new three.MeshPhongMaterial({
				color: params.color,
				shininess: params.shininess,
				flatShading: true,
				side: three.DoubleSide,
			}));
			scene.add(mesh);

			const ambience = new three.AmbientLight(0xFFFFFF, 0.25);
			scene.add(ambience);
			const pointLight = new three.PointLight(0xFFFFFF, 2.4);
			pointLight.position.set(-100, 250, -100);
			scene.add(pointLight);
			const directional = new three.DirectionalLight(0xFFFFFF, 2.2);
			directional.position.set(260, 420, 180);
			scene.add(directional);

			frameCamera(camera, params.zoom);
		},

		applyParams: ({ camera, params }) => {
			current = params;
			mesh.material.color.set(params.color);
			mesh.material.shininess = params.shininess;
			frameCamera(camera, params.zoom);
		},

		update: ({ elapsedSeconds }) => {
			const speed = current.waveSpeed;
			const t = elapsedSeconds * FORK_FRAMES_PER_SECOND;
			const geometry = mesh.geometry;
			const position = geometry.getAttribute('position') as THREE.BufferAttribute;
			for (let index = 0; index < position.count; index++) {
				const x = position.getX(index);
				const z = position.getZ(index);
				const crossChop = Math.sqrt(speed) * Math.cos(-x - (z * 0.7));
				const delta = Math.sin((speed * t * 0.02) - (speed * x * 0.025) + (speed * z * 0.015) + crossChop);
				const trochoidDelta = ((delta + 1) ** 2) / 4;
				position.setY(index, restHeights[index]! + trochoidDelta * current.waveHeight);
			}
			geometry.computeVertexNormals();
			position.needsUpdate = true;
		},
	};
}

export default function createWavesEffect(
	host: HTMLElement,
	params: WavesAnimationParams,
): AnimationEffectInstance<WavesAnimationParams> {
	return createSceneEffect({ three: THREE, host, delegate: createWavesDelegate() }, params);
}

import type * as THREE from 'three';

/**
 * The connection-line field net and globe share: a dynamic LineSegments mesh
 * re-strung every frame between the points that sit within a connection
 * distance of each other, each segment coloured by a distance-faded gradient.
 *
 * The blending choice is the fork's: additive when the line colour is brighter
 * than the background (rec601 luma), normal otherwise — where the fork wrote
 * `blending: null`, which three treated as normal blending. Vertex colours are
 * enabled deliberately: the fork passed the removed `THREE.VertexColors`
 * constant, so its written gradient silently degraded to flat white on air
 * (#473, the net slice records the proof).
 *
 * Buffers are sized for every distinct pair connecting at once — the true
 * upper bound, with self-pairs skipped (the fork drew a zero-length, invisible
 * segment per point).
 */

export interface ConnectionLineParams {
	color: string;
	backgroundColor: string;
	maxDistance: number;
}

export interface ConnectionLineField {
	mesh: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
	/** Re-string the field between the current point positions. */
	update: (positions: readonly THREE.Vector3[], params: ConnectionLineParams) => void;
	/** Re-pick the blending mode, as a fresh mount of these params would. */
	applyBlending: (params: ConnectionLineParams) => void;
	dispose: () => void;
}

/** The fork's `getBrightness`: rec601 luma over the colour channels. */
function luminance(color: THREE.Color): number {
	return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

function usesAdditiveBlending(three: typeof THREE, params: ConnectionLineParams): boolean {
	return luminance(new three.Color(params.color)) > luminance(new three.Color(params.backgroundColor));
}

export function createConnectionLineField(
	three: typeof THREE,
	pointCount: number,
	params: ConnectionLineParams,
): ConnectionLineField {
	const maxSegments = pointCount * (pointCount - 1) / 2;
	const linePositions = new Float32Array(maxSegments * 6);
	const lineColors = new Float32Array(maxSegments * 6);
	const geometry = new three.BufferGeometry();
	geometry.setAttribute('position', new three.BufferAttribute(linePositions, 3).setUsage(three.DynamicDrawUsage));
	geometry.setAttribute('color', new three.BufferAttribute(lineColors, 3).setUsage(three.DynamicDrawUsage));
	geometry.computeBoundingSphere();
	geometry.setDrawRange(0, 0);
	const mesh = new three.LineSegments(geometry, new three.LineBasicMaterial({
		vertexColors: true,
		blending: usesAdditiveBlending(three, params) ? three.AdditiveBlending : three.NormalBlending,
		transparent: true,
	}));

	return {
		mesh,
		update: (positions, current) => {
			const backgroundColor = new three.Color(current.backgroundColor);
			const color = new three.Color(current.color);
			const additive = usesAdditiveBlending(three, current);
			const differenceColor = color.clone().sub(backgroundColor);
			// One scratch colour reused across the pair loop, which runs thousands
			// of times a frame.
			const lineColor = new three.Color();

			let vertexIndex = 0;
			let colorIndex = 0;
			let connected = 0;
			for (let i = 0; i < positions.length; i++) {
				const a = positions[i]!;
				for (let j = i + 1; j < positions.length; j++) {
					const b = positions[j]!;
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
			geometry.setDrawRange(0, connected * 2);
			geometry.getAttribute('position').needsUpdate = true;
			geometry.getAttribute('color').needsUpdate = true;
		},
		applyBlending: (current) => {
			mesh.material.blending = usesAdditiveBlending(three, current) ? three.AdditiveBlending : three.NormalBlending;
		},
		dispose: () => {
			geometry.dispose();
			mesh.material.dispose();
		},
	};
}

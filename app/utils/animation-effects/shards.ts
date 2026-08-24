import type { ShardsAnimationParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Shards: a pane of shattered glass. Animated Voronoi — each grid cell owns
 * one feature point orbiting its hashed rest position — tiles the frame into
 * slowly shifting facets. Each facet takes a hashed tint between the
 * background and the shard colour plus a directional term from its offset to
 * the feature point (a fake per-facet normal, so shards read as tilted
 * planes), crack lines of the edge colour glow where the two nearest feature
 * points run close (F2 - F1), and a sweeping band glints single facets whose
 * hashed orientation matches its phase. Written for Stream Keepr — no Vanta
 * ancestry.
 */
const SHARDS_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform vec3 shardColor;
uniform vec3 edgeColor;
uniform vec3 backgroundColor;
uniform float size;
uniform float intensity;

float hashShard(vec2 cell, float salt) {
	return fract(sin(dot(cell, vec2(127.1, 311.7)) + salt * 74.7) * 43758.5453);
}

// A cell's feature point: a hashed rest position well inside the cell, plus a
// small orbit at a hashed rate and phase — the stateless animated-Voronoi form.
vec2 featurePoint(vec2 cell) {
	vec2 rest = cell + vec2(
		0.3 + 0.4 * hashShard(cell, 1.0),
		0.3 + 0.4 * hashShard(cell, 2.0)
	);
	float rate = 0.3 + 0.5 * hashShard(cell, 3.0);
	float phase = 6.2832 * hashShard(cell, 4.0);
	return rest + 0.13 * vec2(cos(iTime * rate + phase), sin(iTime * rate * 0.9 + phase));
}

void main() {
	// Fewer, larger facets as size grows.
	vec2 p = gl_FragCoord.xy / iResolution.y * (5.0 / size);
	vec2 homeCell = floor(p);

	// Nearest and second-nearest feature points from the 3x3 neighbourhood.
	float nearest = 1.0e3;
	float second = 1.0e3;
	vec2 nearestCell = homeCell;
	vec2 toNearest = vec2(0.0);
	for (int cy = -1; cy <= 1; cy++) {
		for (int cx = -1; cx <= 1; cx++) {
			vec2 cell = homeCell + vec2(float(cx), float(cy));
			vec2 offset = featurePoint(cell) - p;
			float dist = length(offset);
			if (dist < nearest) {
				second = nearest;
				nearest = dist;
				nearestCell = cell;
				toNearest = offset;
			}
			else if (dist < second) {
				second = dist;
			}
		}
	}

	// Facet fill: a hashed shade of the shard colour over the background, with
	// a linear directional term across the facet standing in for a normal.
	float tint = 0.35 + 0.5 * hashShard(nearestCell, 5.0);
	float facing = clamp(dot(toNearest, normalize(vec2(0.62, 0.79))), -1.0, 1.0);
	vec3 facet = mix(backgroundColor, shardColor, tint) * (0.85 + 0.3 * facing);

	// Cracks: the facet boundary is where the two nearest points run close.
	float crack = pow(smoothstep(0.10, 0.0, second - nearest), 2.0);

	// Glint: a band sweeps the pane, and a facet flashes only while its hashed
	// orientation is near the band's cycling phase — single shards, not strobe.
	float band = pow(max(sin(dot(p, normalize(vec2(0.83, 0.55))) * 0.5 - iTime * 0.45), 0.0), 24.0);
	float orientation = hashShard(nearestCell, 6.0);
	float gate = smoothstep(0.22, 0.02, abs(orientation - fract(iTime * 0.05)));
	vec3 glint = mix(edgeColor, vec3(1.0), 0.4) * band * gate;

	vec3 color = facet + (edgeColor * crack * 0.9 + glint * 0.5) * intensity;
	gl_FragColor = vec4(color, 1.0);
}
`;

export default function createShardsEffect(
	host: HTMLElement,
	params: ShardsAnimationParams,
): AnimationEffectInstance<ShardsAnimationParams> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: SHARDS_FRAGMENT_SHADER,
		uniforms: current => ({
			shardColor: current.shardColor,
			edgeColor: current.edgeColor,
			backgroundColor: current.backgroundColor,
			size: current.size,
			intensity: current.intensity,
		}),
		timeScale: current => current.speed,
	}, params);
}

import type { EmberAnimationParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Ember: drifting embers rising through a dark frame, like sparks hanging above
 * a fire that burned down out of frame. Three parallax layers of a hashed
 * grid-cell particle field — the field scrolls downward in sample space so the
 * embers rise, and each cell's ember takes its position, sway, flicker, and
 * lifecycle from per-cell hashes, so the frame is a pure function of time and
 * nothing loops in sync. Written for Stream Keepr — no Vanta ancestry.
 */
const EMBER_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform vec3 emberColor;
uniform vec3 coreColor;
uniform vec3 backgroundColor;
uniform float density;
uniform float size;
uniform float intensity;

float hashCell(vec2 cell, float salt) {
	return fract(sin(dot(cell, vec2(127.1, 311.7)) + salt * 74.7) * 43758.5453);
}

void main() {
	vec3 glow = vec3(0.0);
	// A cell is lit when its hash clears the density-derived probability, so
	// density thins or crowds the field without resizing any ember.
	float litThreshold = clamp(density * 0.34, 0.0, 1.0);

	for (int layer = 0; layer < 3; layer++) {
		float depth = float(layer);
		// Nearer layers: fewer cells across the height (bigger embers), a faster
		// screen-space rise, and more brightness — which together read as depth.
		float cellsAcross = 5.0 + 3.5 * depth;
		float rise = 0.55 + 0.08 * depth;
		float dim = 1.0 - 0.28 * depth;
		// Layers hash with disjoint salts so they never mirror one another.
		float salt = depth * 31.7;

		// Square-aspect cells, offset per layer, scrolled down over time so the
		// embers ride upward with the field.
		vec2 p = gl_FragCoord.xy / iResolution.y * cellsAcross;
		p.x += depth * 17.3;
		p.y -= iTime * rise;
		vec2 homeCell = floor(p);
		vec2 f = p - homeCell;

		// An ember's halo can reach past its own cell, so each fragment gathers
		// from its 3x3 neighbourhood rather than clipping at cell walls. The
		// halo radius is capped at one cell to keep every reachable halo inside
		// that neighbourhood: the nearest ungathered ember sits at least 1.06
		// cells away (offset 2, minus in-cell placement and sway), so past the
		// cap — size above ~3.7 — the core keeps growing while the halo
		// saturates instead of stepping at the neighbourhood edge.
		for (int cy = -1; cy <= 1; cy++) {
			for (int cx = -1; cx <= 1; cx++) {
				vec2 offset = vec2(float(cx), float(cy));
				vec2 cell = homeCell + offset;
				if (hashCell(cell, 1.0 + salt) > litThreshold)
					continue;

				vec2 emberPosition = offset + vec2(
					0.2 + 0.6 * hashCell(cell, 2.0 + salt),
					0.2 + 0.6 * hashCell(cell, 3.0 + salt)
				);
				// Sideways sway at a hashed rate and phase.
				emberPosition.x += 0.14 * sin(iTime * (0.4 + 0.5 * hashCell(cell, 4.0 + salt)) + 6.2832 * hashCell(cell, 5.0 + salt));

				// Each ember fades in, burns, and fades out on its own hashed
				// period, so embers die rather than visibly loop.
				float lifeRate = 0.07 + 0.08 * hashCell(cell, 6.0 + salt);
				float life = fract(iTime * lifeRate + hashCell(cell, 7.0 + salt));
				float envelope = smoothstep(0.0, 0.25, life) * (1.0 - smoothstep(0.65, 1.0, life));
				float flicker = 0.78 + 0.22 * sin(iTime * (5.0 + 9.0 * hashCell(cell, 8.0 + salt)) + 6.2832 * hashCell(cell, 9.0 + salt));

				// A tight hot core resolving toward the core colour, inside a
				// wider soft halo of the ember colour.
				float coreRadius = 0.085 * size;
				float haloRadius = min(coreRadius * 3.2, 1.0);
				float dist = length(f - emberPosition);
				float halo = pow(clamp(1.0 - dist / haloRadius, 0.0, 1.0), 3.0);
				float core = pow(clamp(1.0 - dist / coreRadius, 0.0, 1.0), 2.0);
				glow += (emberColor * halo * 0.85 + mix(emberColor, coreColor, 0.85) * core) * envelope * flicker * dim;
			}
		}
	}

	vec3 color = backgroundColor + glow * intensity;
	gl_FragColor = vec4(color, 1.0);
}
`;

export default function createEmberEffect(
	host: HTMLElement,
	params: EmberAnimationParams,
): AnimationEffectInstance<EmberAnimationParams> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: EMBER_FRAGMENT_SHADER,
		uniforms: current => ({
			emberColor: current.emberColor,
			coreColor: current.coreColor,
			backgroundColor: current.backgroundColor,
			density: current.density,
			size: current.size,
			intensity: current.intensity,
		}),
		timeScale: current => current.speed,
	}, params);
}

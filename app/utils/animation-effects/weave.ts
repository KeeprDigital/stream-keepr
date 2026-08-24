import type { WeaveAnimationParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Weave: an interlaced fabric of undulating threads — vertical warp and
 * horizontal weft bands crossing over and under in strict index-parity
 * alternation. Each thread sways with a phase hashed from its index so the
 * cloth ripples rather than marching in step, the under-thread darkens as it
 * dips beneath a crossing, and a soft sheen sweeps the cloth diagonally. The
 * gaps between threads show the background. Written for Stream Keepr — no
 * Vanta ancestry.
 */
const WEAVE_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform vec3 warpColor;
uniform vec3 weftColor;
uniform vec3 backgroundColor;
uniform float scale;
uniform float thickness;
uniform float sheen;

float hashThread(float n, float salt) {
	return fract(sin((n + salt * 101.3) * 127.1) * 43758.5453);
}

// One thread family at a fragment: coverage, cylindrical shade, the covering
// thread's index, and the distance to its centreline. A swaying band can spill
// past its own cell, so the neighbouring threads are candidates too and the
// best coverage wins.
vec4 threadAt(float across, float along, float salt, float halfWidth, float timePhase, float aaCell) {
	vec4 best = vec4(0.0, 0.0, 0.0, 1.0e3);
	for (int o = -1; o <= 1; o++) {
		float index = floor(across) + float(o);
		float phase = 6.2832 * hashThread(index, salt);
		float center = index + 0.5 + 0.16 * sin(along * 0.9 + timePhase + phase);
		float distance = abs(across - center);
		float q = distance / halfWidth;
		float coverage = 1.0 - smoothstep(1.0 - aaCell / halfWidth, 1.0, q);
		if (coverage > best.x) {
			// Rounded profile: brightest at the centreline, so bands read as threads.
			best = vec4(coverage, sqrt(max(1.0 - q * q, 0.0)), index, distance);
		}
	}
	return best;
}

void main() {
	// Square cells in frame-height units, one thread per cell and family.
	vec2 p = gl_FragCoord.xy / iResolution.y * (6.0 * scale);
	float aaCell = 6.0 * scale * 1.5 / iResolution.y;
	float halfWidth = thickness * 0.5;

	vec4 warp = threadAt(p.x, p.y, 3.7, halfWidth, iTime * 0.7, aaCell);
	vec4 weft = threadAt(p.y, p.x, 9.1, halfWidth, iTime * 0.8, aaCell);

	vec3 warpBase = warpColor * (0.35 + 0.65 * warp.y);
	vec3 weftBase = weftColor * (0.35 + 0.65 * weft.y);

	// The under-thread dips beneath the crossing: it darkens near the
	// over-thread's centreline, which is what makes the grid read as woven.
	float warpShadow = 1.0 - 0.55 * exp(-pow(warp.w / (halfWidth * 1.2), 2.0));
	float weftShadow = 1.0 - 0.55 * exp(-pow(weft.w / (halfWidth * 1.2), 2.0));

	// Interlacing: thread-index parity says which family rides over here.
	float weftOnTop = step(0.5, mod(warp.z + weft.z, 2.0));

	vec3 warpTopColor = mix(mix(backgroundColor, weftBase * warpShadow, weft.x), warpBase, warp.x);
	vec3 weftTopColor = mix(mix(backgroundColor, warpBase * weftShadow, warp.x), weftBase, weft.x);
	vec3 color = mix(warpTopColor, weftTopColor, weftOnTop);

	// A broad highlight band sweeping the cloth diagonally, catching threads only.
	float sheenBand = pow(max(sin((p.x + p.y) * 0.35 - iTime * 0.6), 0.0), 8.0);
	color += vec3(1.0) * sheenBand * 0.35 * sheen * max(warp.x, weft.x);

	gl_FragColor = vec4(color, 1.0);
}
`;

export default function createWeaveEffect(
	host: HTMLElement,
	params: WeaveAnimationParams,
): AnimationEffectInstance<WeaveAnimationParams> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: WEAVE_FRAGMENT_SHADER,
		uniforms: current => ({
			warpColor: current.warpColor,
			weftColor: current.weftColor,
			backgroundColor: current.backgroundColor,
			scale: current.scale,
			thickness: current.thickness,
			sheen: current.sheen,
		}),
		timeScale: current => current.speed,
	}, params);
}

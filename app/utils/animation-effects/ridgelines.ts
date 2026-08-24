import type { RidgelinesAnimationParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Ridgelines: stacked mountain-ridge silhouettes receding into the frame — a
 * joyplot horizon. Each ridge is a two-octave 1D value-noise profile scrolled
 * horizontally at a layer-dependent rate (nearer ridges faster — parallax),
 * painted far to near with the fill fading into the background like haze, and
 * a glowing crest line along each profile's top edge. Written for Stream
 * Keepr — no Vanta ancestry.
 */
const RIDGELINES_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform vec3 crestColor;
uniform vec3 fillColor;
uniform vec3 backgroundColor;
uniform float ridges;
uniform float relief;
uniform float glow;

float hashRidge(float n) {
	return fract(sin(n * 127.1) * 43758.5453);
}

// 1D value noise with smooth interpolation between per-integer hashes.
float noiseRidge(float x) {
	float i = floor(x);
	float f = x - i;
	float u = f * f * (3.0 - 2.0 * f);
	return mix(hashRidge(i), hashRidge(i + 1.0), u);
}

// A ridge's height profile: two octaves, salted per ridge so no two mirror.
float profileRidge(float x, float salt) {
	return 0.65 * noiseRidge(x + salt * 91.3) + 0.35 * noiseRidge(x * 2.7 + salt * 57.1 + 11.0);
}

void main() {
	// Frame-height units: y runs 0..1 bottom to top, x carries the aspect.
	vec2 uv = gl_FragCoord.xy / iResolution.y;
	// One pixel-ish of antialiasing at the crest edge, in frame-height units.
	float aa = 1.5 / iResolution.y;

	vec3 color = backgroundColor;
	float count = clamp(ridges, 3.0, 12.0);

	// Far to near: ridge 0 sits highest and haziest, the last lowest and
	// fullest, each overpainting the ones behind it.
	for (int i = 0; i < 12; i++) {
		if (float(i) >= count)
			break;
		float depth = float(i) / (count - 1.0);

		float base = mix(0.78, 0.14, depth);
		float amplitude = (0.10 + 0.08 * depth) * relief;
		// Nearer ridges scroll faster and carry chunkier features — parallax.
		float scroll = iTime * (0.03 + 0.09 * depth);
		float frequency = 3.0 - 1.2 * depth;
		float x = (uv.x + scroll) * frequency;

		float height = base + amplitude * (profileRidge(x, float(i) + 1.0) - 0.5) * 2.0;
		float coverage = smoothstep(height + aa, height - aa, uv.y);
		if (coverage <= 0.0)
			continue;

		// Atmospheric perspective: far ridges sink toward the background.
		vec3 fill = mix(backgroundColor, fillColor, mix(0.30, 1.0, depth));

		// The crest: a bright line at the profile's top edge with a soft glow
		// falling off below it, both brighter on nearer ridges.
		float below = height - uv.y;
		float crestLine = smoothstep(0.012, 0.0, below);
		float crestHalo = exp(-below * 22.0) * 0.5 * glow;
		vec3 ridgeColor = fill + crestColor * (crestLine + crestHalo) * mix(0.4, 1.0, depth);

		color = mix(color, ridgeColor, coverage);
	}

	gl_FragColor = vec4(color, 1.0);
}
`;

export default function createRidgelinesEffect(
	host: HTMLElement,
	params: RidgelinesAnimationParams,
): AnimationEffectInstance<RidgelinesAnimationParams> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: RIDGELINES_FRAGMENT_SHADER,
		uniforms: current => ({
			crestColor: current.crestColor,
			fillColor: current.fillColor,
			backgroundColor: current.backgroundColor,
			ridges: current.ridges,
			relief: current.relief,
			glow: current.glow,
		}),
		timeScale: current => current.speed,
	}, params);
}

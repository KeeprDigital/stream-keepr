import type { CausticsAnimationParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Caustics: light refracted through slow water. Three octaves of a drifting,
 * domain-warped interference field; each octave brightens the thin bands where
 * its wave crosses zero, which reads as the focused filament web sunlight
 * throws on a pool floor. Written for Stream Keepr — no Vanta ancestry.
 */
const CAUSTICS_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform vec3 lightColor;
uniform vec3 waterColor;
uniform float intensity;
uniform float zoom;

void main() {
	// Square-aspect coordinates so filaments do not stretch on wide frames.
	vec2 p = gl_FragCoord.xy / iResolution.y * 6.0 * zoom;
	float t = iTime;

	vec2 q = p;
	float filaments = 0.0;
	float amplitude = 1.0;
	float total = 0.0;
	for (int i = 0; i < 3; i++) {
		float layer = float(i);
		// Drift the domain before sampling, so the web wobbles instead of scrolling.
		q += 0.45 * vec2(
			sin(q.y * 1.6 + t * 0.8 + layer * 2.4),
			cos(q.x * 1.5 - t * 0.6 + layer * 1.7)
		);
		// Two obliquely-crossing wave sets per layer; sharpening each zero
		// crossing into a thin bright line makes their union read as the cell
		// walls of a caustic web rather than parallel bands.
		float bandA = abs(sin(q.x * 1.2 + q.y * 0.8 + t * 0.4 + layer * 1.1));
		float bandB = abs(sin(q.x * -0.7 + q.y * 1.3 - t * 0.3 + layer * 2.6));
		filaments += amplitude * (pow(1.0 - bandA, 6.0) + pow(1.0 - bandB, 6.0));
		total += amplitude;
		amplitude *= 0.6;
		q *= 1.25;
	}

	float caustic = clamp(filaments / total, 0.0, 1.0);
	vec3 color = waterColor + lightColor * caustic * intensity * 1.6;
	gl_FragColor = vec4(color, 1.0);
}
`;

export default function createCausticsEffect(
	host: HTMLElement,
	params: CausticsAnimationParams,
): AnimationEffectInstance<CausticsAnimationParams> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: CAUSTICS_FRAGMENT_SHADER,
		uniforms: current => ({
			lightColor: current.lightColor,
			waterColor: current.waterColor,
			intensity: current.intensity,
			zoom: current.zoom,
		}),
		timeScale: current => current.speed,
	}, params);
}

import type { FogAnimationParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Fog: fractal-noise domain warping, ported from the retired Vanta fork under
 * its old name. The shader is unchanged apart from dropping the mouse uniform
 * nothing fed; Animation Effects animate from elapsed time alone.
 *
 * Noise construction after http://thebookofshaders.com/13/ (Patricio Gonzalez
 * Vivo), via the fork's fog effect.
 */
const FOG_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform float blurFactor;
uniform vec3 baseColor;
uniform vec3 lowlightColor;
uniform vec3 midtoneColor;
uniform vec3 highlightColor;
uniform float zoom;

float random(in vec2 _st) {
	return fract(sin(dot(_st.xy, vec2(0.129898, 0.78233))) * 437.585453123);
}

// Based on Morgan McGuire @morgan3d
// https://www.shadertoy.com/view/4dS3Wd
float noise(in vec2 _st) {
	vec2 i = floor(_st);
	vec2 f = fract(_st);

	// Four corners in 2D of a tile
	float a = random(i);
	float b = random(i + vec2(1.0, 0.0));
	float c = random(i + vec2(0.0, 1.0));
	float d = random(i + vec2(1.0, 1.0));

	vec2 u = f * f * (3.0 - 2.0 * f);

	return mix(a, b, u.x) +
		(c - a) * u.y * (1.0 - u.x) +
		(d - b) * u.x * u.y;
}

#define NUM_OCTAVES 6

float fbm(in vec2 _st) {
	float v = 0.0;
	float a = blurFactor;
	vec2 shift = vec2(100.0);
	// Rotate to reduce axial bias
	mat2 rot = mat2(cos(0.5), sin(0.5),
		-sin(0.5), cos(0.50));
	for (int i = 0; i < NUM_OCTAVES; ++i) {
		v += a * noise(_st);
		_st = rot * _st * 2.0 + shift;
		a *= (1. - blurFactor);
	}
	return v;
}

void main() {
	vec2 st = gl_FragCoord.xy / iResolution.xy * 3.;
	st.x *= 0.7 * iResolution.x / iResolution.y; // Still keep it more landscape than square
	st *= zoom;

	vec3 color = vec3(0.0);

	vec2 q = vec2(0.);
	q.x = fbm(st + 0.00 * iTime);
	q.y = fbm(st + vec2(1.0));

	vec2 dir = vec2(0.15, 0.126);
	vec2 r = vec2(0.);
	r.x = fbm(st + 1.0 * q + vec2(1.7, 9.2) + dir.x * iTime);
	r.y = fbm(st + 1.0 * q + vec2(8.3, 2.8) + dir.y * iTime);

	float f = fbm(st + r);

	color = mix(baseColor,
		lowlightColor,
		clamp((f * f) * 4.0, 0.0, 1.0));

	color = mix(color,
		midtoneColor,
		clamp(length(q), 0.0, 1.0));

	color = mix(color,
		highlightColor,
		clamp(length(r.x), 0.0, 1.0));

	vec3 finalColor = mix(baseColor, color, f * f * f + .6 * f * f + .5 * f);
	gl_FragColor = vec4(finalColor, 1.0);
}
`;

export default function createFogEffect(
	host: HTMLElement,
	params: FogAnimationParams,
): AnimationEffectInstance<FogAnimationParams> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: FOG_FRAGMENT_SHADER,
		uniforms: current => ({
			highlightColor: current.highlightColor,
			midtoneColor: current.midtoneColor,
			lowlightColor: current.lowlightColor,
			baseColor: current.baseColor,
			blurFactor: current.blurFactor,
			zoom: current.zoom,
		}),
		timeScale: current => current.speed,
	}, params);
}

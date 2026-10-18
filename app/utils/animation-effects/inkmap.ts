import type { AnimationEffectParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { GLSL_HASH_2D, GLSL_VALUE_NOISE_2D } from './glslPrelude';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Inkmap: slow-morphing ink islands on dark paper, drawn like a living map.
 * A domain-warped three-octave value-noise field — whose warp and octave
 * offsets orbit over time, so islands merge, split, and migrate rather than
 * scrolling — is thresholded into hard-edged pools with a luminous rim at the
 * shoreline, ringed by faint topographic contour lines through the paper
 * outside. Where fog is the soft-gradient reading of this noise family,
 * inkmap is the thresholded, cartographic one. Written for Stream Keepr — no
 * Vanta ancestry.
 */
const INKMAP_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform vec3 inkColor;
uniform vec3 edgeColor;
uniform vec3 backgroundColor;
uniform float coverage;
uniform float contours;
uniform float scale;

${GLSL_HASH_2D}

${GLSL_VALUE_NOISE_2D}

// Each octave carries its own slowly orbiting time phase, at mutually prime
// rates, so the field morphs internally instead of sliding as one sheet.
float fbmInk(vec2 p, float t) {
	return 0.5 * valueNoise2D(p + vec2(cos(t * 0.05), sin(t * 0.06)) * 0.5)
		+ 0.3 * valueNoise2D(p * 2.13 + 7.7 + vec2(cos(t * 0.083), sin(t * 0.071)) * 0.7)
		+ 0.2 * valueNoise2D(p * 4.7 + 13.1 + vec2(cos(t * 0.127), sin(t * 0.113)) * 0.9);
}

void main() {
	vec2 p = gl_FragCoord.xy / iResolution.y * 3.0 / scale;

	// The warp and the field's own offset orbit rather than translate, so the
	// map morphs in place instead of scrolling past.
	vec2 orbit = vec2(cos(iTime * 0.13), sin(iTime * 0.11)) * 0.8;
	vec2 warp = vec2(fbmInk(p * 0.9 + orbit, iTime), fbmInk(p * 0.9 + orbit.yx + 5.2, iTime));
	float field = fbmInk(p + 1.8 * warp + 0.3 * vec2(cos(iTime * 0.07), sin(iTime * 0.09)), iTime);

	// More coverage, lower threshold, more ink.
	float threshold = 0.75 - 0.45 * coverage;
	float inkMask = smoothstep(threshold - 0.015, threshold + 0.015, field);

	// Inside the islands: the ink pools toward the shoreline, where a rim of
	// the edge colour glows and decays inward — the wet edge.
	float depthIn = field - threshold;
	float rim = exp(-max(depthIn, 0.0) * 30.0);
	vec3 ink = inkColor * (0.75 + 0.25 * smoothstep(0.0, 0.25, depthIn)) + edgeColor * rim * 0.8;

	// Outside: faint topographic contour rings, evenly spaced in field value
	// below the threshold and fading as they recede from the coast.
	float contourLine = 0.0;
	for (int k = 1; k <= 8; k++) {
		if (float(k) > contours)
			break;
		float level = threshold - float(k) * 0.045;
		float fade = 1.0 - float(k) / (contours + 1.0);
		contourLine += (1.0 - smoothstep(0.0, 0.006, abs(field - level))) * fade;
	}
	vec3 paper = backgroundColor + edgeColor * contourLine * 0.25;

	gl_FragColor = vec4(mix(paper, ink, inkMask), 1.0);
}
`;

export default function createInkmapEffect(
	host: HTMLElement,
	params: AnimationEffectParams<'inkmap'>,
): AnimationEffectInstance<AnimationEffectParams<'inkmap'>> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: INKMAP_FRAGMENT_SHADER,
		uniforms: current => ({
			inkColor: current.inkColor,
			edgeColor: current.edgeColor,
			backgroundColor: current.backgroundColor,
			coverage: current.coverage,
			contours: current.contours,
			scale: current.scale,
		}),
		timeScale: current => current.speed,
	}, params);
}

import type { CellsAnimationParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Cells: a Worley-noise cellular field, ported from the retired Vanta fork
 * under its old name. The shader is unchanged apart from dropping the uniforms
 * nothing read — the mouse pair, and the `blurFactor`, `backgroundColor`,
 * `amplitudeFactor`, `ringFactor`, and `rotationFactor` the fork declared for
 * every shader effect whether or not its fragment used them.
 */
const CELLS_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform vec3 color1;
uniform vec3 color2;
uniform float size;

float length2(vec2 p) { return dot(p, p); }

float noise(vec2 p){
	return fract(sin(fract(sin(p.x) * (43.13311)) + p.y) * 31.0011);
}

float worley(vec2 p) {
	float d = 1e30;
	for (int xo = -1; xo <= 1; ++xo) {
		for (int yo = -1; yo <= 1; ++yo) {
			vec2 tp = floor(p) + vec2(xo, yo);
			d = min(d, length2(p - tp - vec2(noise(tp))));
		}
	}
	vec2 uv = gl_FragCoord.xy / iResolution.xy;
	float timeOffset =  0.15 * sin(iTime * 2.0 + 10.0*(uv.x - uv.y));
	return 3.0*exp(-4.0*abs(2.0*d - 1.0 + timeOffset));
}

float fworley(vec2 p) {
	return sqrt(sqrt(sqrt(
	1.1 * // light
	worley(p*5. + .3 + iTime*.0525) *
	sqrt(worley(p * 50. / size + 0.3 + iTime * -0.15)) *
	sqrt(sqrt(worley(p * -10. + 9.3))))));
}

void main() {
	vec2 uv = gl_FragCoord.xy / iResolution.xy;
	float t = fworley(uv * iResolution.xy / 1500.0);
	t *= exp(-length2(abs(0.7*uv - 1.0)));

	float tExp = pow(t, 0.5 - t);
	vec3 c1 = color1 * (1.0 - t);
	vec3 c2 = color2 * tExp;

	gl_FragColor = vec4(pow(t, 1.0 - t) * (c1 + c2), 1.0);
}
`;

export default function createCellsEffect(
	host: HTMLElement,
	params: CellsAnimationParams,
): AnimationEffectInstance<CellsAnimationParams> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: CELLS_FRAGMENT_SHADER,
		uniforms: current => ({
			color1: current.color1,
			color2: current.color2,
			size: current.size,
		}),
		timeScale: current => current.speed,
	}, params);
}

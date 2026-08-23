import type { HaloAnimationParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Halo: a flower-edged ring of cycling hues smearing through a feedback
 * buffer, ported from the retired Vanta fork under its old name — the first
 * effect on the shader-plane base's feedback buffer. The live shader path is
 * unchanged apart from the mouse pair (the ring now sits at the frame centre
 * plus the offsets, where the fork eased it toward a pointer no headless
 * browser source has) and folding the retired `iDpr` uniform into
 * `iResolution`, which the base already supplies in device pixels. The fork's
 * large commented-out blocks and the helpers only they called, its unused
 * `spectrum`/`factor` locals, and the uniforms the shader declared but never
 * read (`color2`, `ringFactor`, `rotationFactor`, `shape`) do not make the
 * trip.
 */
const HALO_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform float xOffset;
uniform float yOffset;
uniform vec3 baseColor;
uniform vec3 backgroundColor;
uniform float size;
uniform float amplitudeFactor;

uniform sampler2D iBuffer;

vec4 j2hue(float c) {
  return .5+.5*cos(6.28*c+vec4(0,-2.1,2.1,0));
}

void main() {
  vec2 res2 = iResolution.xy;
  vec2 pixel = vec2(gl_FragCoord.xy - 0.5 * res2) / res2.y; // center-origin pixel coord
  pixel.x -= xOffset * res2.x / res2.y;
  pixel.y -= yOffset;

  vec2 uv = gl_FragCoord.xy / res2; // 0 to 1
  vec2 uvBig = (uv - 0.5) * 0.996 + 0.5;

  vec4 oldImage = texture2D(iBuffer, uv);
  vec3 mixedColor = oldImage.rgb - backgroundColor;

  float cropDist = 0.01;
  float cropXOffset = 0.2;
  float cropYOffset = 0.2;

  vec2 offset = uv + vec2((mixedColor.g - cropXOffset) * cropDist, (mixedColor.r - cropYOffset) * cropDist);

  float spinDist = 0.001;
  float spinSpeed = 0.2 + 0.15 * cos(iTime * 0.5);
  float timeFrac = mod(iTime, 6.5);
  vec2 offset2 = uvBig + vec2(cos(timeFrac * spinSpeed) * spinDist, sin(timeFrac * spinSpeed) * spinDist);

  mixedColor = texture2D(iBuffer, offset).rgb * 0.4
    + texture2D(iBuffer, offset2).rgb * 0.6
    - backgroundColor;

  float fadeAmt = 0.0015; // fade this amount each frame
  mixedColor = (mixedColor - fadeAmt) * .995;

  float angle = atan(pixel.x, pixel.y);
  float dist = length(pixel) * 8. + sin(iTime) * .01;

  // Flowery shapes
  float flowerPeaks = .05 * amplitudeFactor * size;
  float flowerPetals = 7.;
  float edge = abs((dist + sin(angle * flowerPetals + iTime * 0.5) * sin(iTime * 1.5) * flowerPeaks) * 0.65 / size);

  float colorChangeSpeed = 0.75 + 0.05 * sin(iTime) * 1.5;
  float rainbowInput = timeFrac * colorChangeSpeed;

  float brightness = 0.7;
  vec4 rainbow = sqrt(j2hue(cos(rainbowInput))) + vec4(baseColor,0) - 1.0 + brightness;
  vec3 color = rainbow.rgb * smoothstep(1., .9, edge) * pow(edge, 20.);
  gl_FragColor = vec4(
    backgroundColor + clamp( mixedColor + color, 0., 1.)
    , 1.0);
}
`;

export default function createHaloEffect(
	host: HTMLElement,
	params: HaloAnimationParams,
): AnimationEffectInstance<HaloAnimationParams> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: HALO_FRAGMENT_SHADER,
		feedback: true,
		uniforms: current => ({
			baseColor: current.baseColor,
			backgroundColor: current.backgroundColor,
			amplitudeFactor: current.amplitudeFactor,
			size: current.size,
			xOffset: current.xOffset,
			yOffset: current.yOffset,
		}),
		timeScale: current => current.speed,
	}, params);
}

import type { RippleAnimationParams } from '~~/shared/animationEffects';
import type { AnimationEffectInstance } from './types';
import * as THREE from 'three';
import { createShaderPlaneEffect } from './shaderPlane';

/**
 * Ripple: rings of orbiting lights accumulating over a background colour,
 * ported from the retired Vanta fork under its old name. The unused mouse and
 * blur uniforms are gone; centre and pulse frequency are authored controls.
 */
const RIPPLE_FRAGMENT_SHADER = `
uniform vec2 iResolution;
uniform float iTime;

uniform vec3 color1;
uniform vec3 color2;
uniform vec3 backgroundColor;
uniform float amplitudeFactor;
uniform float ringFactor;
uniform float rotationFactor;
uniform float centerX;
uniform float centerY;
uniform float frequency;

float size = 0.002;

void main( void ) {
	vec2 view = ( gl_FragCoord.xy - iResolution / 2.0 ) / ( iResolution.y / 2.0);
	vec2 centerOffset = vec2(centerX * iResolution.x / iResolution.y, centerY);
	float time = - iTime + length(view - centerOffset)*8. - 7.0;
	float rippleTime = time * frequency;
	vec4 color = vec4(0);
	vec2 center = vec2(0);
	float accumMix = 0.0;
	float rotationVelocity = 2.0;
	for( int j = 0; j < 20; j++ ) {
		for( int i = 0; i < 20; i++ ) {
			float amplitude = ( cos( rippleTime / 10.0 ) + sin( rippleTime / 5.0 ) );

			amplitude = amplitude * amplitudeFactor;

			float angle =   sin( float(j) * time * 0.05 * ringFactor) * rotationVelocity + 2.0 * 3.14 * float(i) / 20.0;
			center.x = centerOffset.x + cos( 7.0 * float(j) / 20.0 * 2.0 * 3.14 ) + sin( time / 4.0) * rotationFactor;
			center.y = centerOffset.y + sin( 3.0 * float(j) / 20.0 * 2.0 * 3.14 )+ cos( time / 8.0) * rotationFactor;
			vec2 light = center + amplitude * vec2( cos( angle ), sin( angle ));
			float l = size / length( view - light );
			accumMix += l * 0.5;
		}
	}
	float accumMix1 = pow(clamp(accumMix * 1.2, 0., 1.15), 1.5); // lowlights
	float accumMix2 = pow(clamp(accumMix1 * 1.2, 0., 1.15), 3.0); // highlights
	vec3 lowlights = mix(backgroundColor, color2, clamp(accumMix1, -0.1, 1.15));
	gl_FragColor = vec4(mix(lowlights, color1, clamp(accumMix2, -0.1, 1.15)), 1);
}
`;

export default function createRippleEffect(
	host: HTMLElement,
	params: RippleAnimationParams,
): AnimationEffectInstance<RippleAnimationParams> {
	return createShaderPlaneEffect({
		three: THREE,
		host,
		fragmentShader: RIPPLE_FRAGMENT_SHADER,
		uniforms: current => ({
			color1: current.color1,
			color2: current.color2,
			backgroundColor: current.backgroundColor,
			amplitudeFactor: current.amplitudeFactor,
			ringFactor: current.ringFactor,
			rotationFactor: current.rotationFactor,
			centerX: current.centerX,
			centerY: current.centerY,
			frequency: current.frequency,
		}),
		timeScale: current => current.speed,
	}, params);
}

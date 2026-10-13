/**
 * GLSL helpers shared by the shader-plane Animation Effects written for Stream
 * Keepr: the sin-dot hash family and the value noise built on it. Each export is
 * one self-contained snippet an effect interpolates into its fragment shader,
 * after its uniforms; a snippet that calls another names it, and the effect
 * includes that one first.
 *
 * The fork ports (fog, cells) keep their own fork-faithful helpers inline: port
 * fidelity outranks dedup there, and their hashes differ from these anyway.
 */

/** A pseudo-random value in [0, 1) per float — per integer, in practice. */
export const GLSL_HASH_1D = `
float hash1D(float n) {
	return fract(sin(n * 127.1) * 43758.5453);
}
`.trim();

/**
 * Smoothly interpolated 1D value noise in [0, 1): `GLSL_HASH_1D` at the two
 * surrounding integers, blended with a smoothstep curve. Needs `GLSL_HASH_1D`
 * first.
 */
export const GLSL_VALUE_NOISE_1D = `
float valueNoise1D(float x) {
	float i = floor(x);
	float f = x - i;
	float u = f * f * (3.0 - 2.0 * f);
	return mix(hash1D(i), hash1D(i + 1.0), u);
}
`.trim();

/** A pseudo-random value in [0, 1) per 2D point — per grid cell, in practice. */
export const GLSL_HASH_2D = `
float hash2D(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`.trim();

/**
 * Smoothly interpolated 2D value noise in [0, 1): `GLSL_HASH_2D` at the four
 * surrounding integer corners, blended with a smoothstep curve. Needs
 * `GLSL_HASH_2D` first.
 */
export const GLSL_VALUE_NOISE_2D = `
float valueNoise2D(vec2 p) {
	vec2 i = floor(p);
	vec2 f = p - i;
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash2D(i), hash2D(i + vec2(1.0, 0.0)), u.x),
		mix(hash2D(i + vec2(0.0, 1.0)), hash2D(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}
`.trim();

/**
 * A pseudo-random value in [0, 1) per 2D point and salt — per grid cell, in
 * practice, with each salt drawing an independent value from the same cell.
 */
export const GLSL_HASH_2D_SALTED = `
float hash2DSalted(vec2 cell, float salt) {
	return fract(sin(dot(cell, vec2(127.1, 311.7)) + salt * 74.7) * 43758.5453);
}
`.trim();

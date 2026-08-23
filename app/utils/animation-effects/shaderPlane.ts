import type * as THREE from 'three';
import type { AnimationEffectInstance } from './types';
import { createEffectRenderer } from './rendererHarness';

/**
 * The base for shader-plane Animation Effects: one fullscreen quad whose
 * fragment shader is the whole effect. The base owns the standard uniforms —
 * `iTime` in seconds and `iResolution` in device pixels — and derives the
 * effect's own uniforms from its params: hex-colour strings become `vec3`
 * colours, numbers become floats. An effect is just a fragment shader plus the
 * mapping from its params to those uniforms.
 */
export interface ShaderPlaneEffectOptions<Params> {
	three: typeof THREE;
	host: HTMLElement;
	fragmentShader: string;
	/** The effect's uniforms for one params value; keys must not change between calls. */
	uniforms: (params: Params) => Record<string, string | number>;
	/**
	 * Seconds-multiplier applied to elapsed time before it reaches `iTime`.
	 * Speed is handled here rather than as a uniform so a speed change alters
	 * the rate from now on instead of jumping the whole animation phase.
	 */
	timeScale?: (params: Params) => number;
	/**
	 * Give the fragment shader its own previous frame as the `iBuffer` sampler,
	 * for effects that accumulate — trails, smears, decay. Each frame draws once
	 * into an offscreen buffer reading the frame before it from the other buffer,
	 * then again onto the screen; the pair swap roles every frame so the shader
	 * never samples the buffer it is writing. Both buffers match the drawing
	 * buffer's device-pixel size, and resizing restarts the accumulation.
	 */
	feedback?: boolean;
}

const FULLSCREEN_VERTEX_SHADER = `
void main() {
	gl_Position = vec4(position, 1.0);
}
`;

export function createShaderPlaneEffect<Params>(
	options: ShaderPlaneEffectOptions<Params>,
	params: Params,
): AnimationEffectInstance<Params> {
	const { three, host } = options;
	const harness = createEffectRenderer(three, host);

	const feedbackTargets = options.feedback
		? {
				read: new three.WebGLRenderTarget(1, 1, { minFilter: three.LinearFilter, magFilter: three.LinearFilter }),
				write: new three.WebGLRenderTarget(1, 1, { minFilter: three.LinearFilter, magFilter: three.LinearFilter }),
			}
		: null;

	const uniforms: Record<string, { value: unknown }> = {
		iTime: { value: 0 },
		iResolution: { value: new three.Vector2(1, 1) },
		...feedbackTargets ? { iBuffer: { value: feedbackTargets.read.texture } } : {},
	};
	for (const [key, value] of Object.entries(options.uniforms(params))) {
		uniforms[key] = { value: typeof value === 'string' ? new three.Color(value) : value };
	}

	const material = new three.ShaderMaterial({
		uniforms,
		vertexShader: FULLSCREEN_VERTEX_SHADER,
		fragmentShader: options.fragmentShader,
	});
	const geometry = new three.PlaneGeometry(2, 2);
	const scene = new three.Scene();
	scene.add(new three.Mesh(geometry, material));
	const camera = new three.OrthographicCamera(-1, 1, 1, -1, 0, 1);

	let timeScale = options.timeScale?.(params) ?? 1;
	// Effect time is accumulated from deltas rather than derived from elapsed
	// time, so a speed change scales only the time still to come — deriving it
	// would rescale the whole history and jump the animation phase.
	let effectSeconds = 0;
	let lastElapsedSeconds = 0;

	return {
		setParams: (next) => {
			for (const [key, value] of Object.entries(options.uniforms(next))) {
				const uniform = uniforms[key]!;
				if (typeof value === 'string')
					(uniform.value as THREE.Color).set(value);
				else
					uniform.value = value;
			}
			timeScale = options.timeScale?.(next) ?? 1;
		},
		resize: (width, height) => {
			harness.renderer.setSize(width, height, false);
			const pixelRatio = harness.renderer.getPixelRatio();
			(uniforms.iResolution!.value as THREE.Vector2).set(width * pixelRatio, height * pixelRatio);
			if (feedbackTargets) {
				feedbackTargets.read.setSize(width * pixelRatio, height * pixelRatio);
				feedbackTargets.write.setSize(width * pixelRatio, height * pixelRatio);
			}
		},
		render: (elapsedSeconds) => {
			effectSeconds += (elapsedSeconds - lastElapsedSeconds) * timeScale;
			lastElapsedSeconds = elapsedSeconds;
			uniforms.iTime!.value = effectSeconds;
			if (feedbackTargets) {
				// One pass into the write buffer reading the previous frame from the
				// read buffer, one identical pass onto the screen, then swap so the
				// next frame reads what this one wrote.
				uniforms.iBuffer!.value = feedbackTargets.read.texture;
				harness.renderer.setRenderTarget(feedbackTargets.write);
				harness.renderer.render(scene, camera);
				harness.renderer.setRenderTarget(null);
				harness.renderer.render(scene, camera);
				[feedbackTargets.read, feedbackTargets.write] = [feedbackTargets.write, feedbackTargets.read];
			}
			else {
				harness.renderer.render(scene, camera);
			}
		},
		dispose: () => {
			feedbackTargets?.read.dispose();
			feedbackTargets?.write.dispose();
			geometry.dispose();
			material.dispose();
			harness.dispose();
		},
	};
}

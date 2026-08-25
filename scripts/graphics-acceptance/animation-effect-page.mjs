/**
 * The browser half of the Animation Effect rendering proof, bundled by esbuild
 * and served to unattended Chromium.
 *
 * It mounts every scenario the table names through the application's own
 * `loadAnimationEffect`, draws two frames of each, and publishes what it counted.
 * It never decides anything: the floors, the coverage rules, and the verdict all
 * live in Node (`animation-effect-proof.mjs`), so a page that has gone wrong
 * cannot report itself healthy.
 *
 * Three facts are measured per scenario, and each answers a failure the rest of
 * the suite is blind to:
 *
 * - **compile failures** — every `compileShader` and `linkProgram` is asked for
 *   its status, so a shader that fails to build is caught where it happens
 *   rather than inferred from a black frame. Nothing here reads console output:
 *   three logs a shader error and carries on, and a check that watched the log
 *   would be a check on three's logging.
 * - **lit and bright pixels** — read back through a 2D canvas immediately after
 *   the draw, which is the only moment a WebGL canvas without
 *   `preserveDrawingBuffer` still holds its frame. Two counts at two different
 *   luminances, answering "did it draw" and "did it blow out"; the floors they
 *   are held to live with the scenario table.
 * - **changed pixels** — between two frames two seconds apart on the effect's own
 *   clock. A shader can compile and light the frame and still be frozen; this is
 *   the only check that notices.
 */

import * as THREE from 'three';
import { loadAnimationEffect } from '../../app/utils/animation-effects/index';
import { createShaderPlaneEffect } from '../../app/utils/animation-effects/shaderPlane';
import { ANIMATION_EFFECT_VALUES, animationEffectDefaultParams } from '../../shared/animationEffects';
import {
	ANIMATION_EFFECT_PROOF_CONTROL,
	ANIMATION_EFFECT_PROOF_FRAME,
	ANIMATION_EFFECT_PROOF_PIXELS,
	animationEffectProofScenarios,
} from './animation-effect-scenarios.mjs';

const { width, height, seconds } = ANIMATION_EFFECT_PROOF_FRAME;
const { litLuminance, brightLuminance, changedChannel } = ANIMATION_EFFECT_PROOF_PIXELS;

/**
 * Count every shader that would not compile and every program that would not
 * link, across both WebGL generations, for as long as the run lasts.
 *
 * Asking for the status the instant the call returns is deliberate: with
 * parallel shader compilation the query blocks until the driver has an answer,
 * which is what turns "the shader is broken" from something that surfaces three
 * frames later into something this scenario's counter holds.
 */
function countShaderFailures() {
	let failures = 0;
	const contexts = [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext].filter(Boolean);
	for (const context of contexts) {
		const { compileShader, linkProgram } = context.prototype;
		context.prototype.compileShader = function (shader) {
			compileShader.call(this, shader);
			if (!this.getShaderParameter(shader, this.COMPILE_STATUS))
				failures += 1;
		};
		context.prototype.linkProgram = function (program) {
			linkProgram.call(this, program);
			if (!this.getProgramParameter(program, this.LINK_STATUS))
				failures += 1;
		};
	}
	return {
		since(mark) {
			return failures - mark;
		},
		mark() {
			return failures;
		},
	};
}

/** Which rasteriser the run got, so a failure can be read against the backend. */
function detectBackend() {
	const probe = document.createElement('canvas');
	const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
	if (!gl)
		return 'unavailable';
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	return /swiftshader/i.test(renderer) ? 'swiftshader' : 'other';
}

/**
 * The frame as it was drawn, copied out of the WebGL canvas.
 *
 * The copy has to happen in the same task as the draw. The renderer does not
 * preserve its drawing buffer, so by the time the browser has composited a frame
 * the canvas reads back empty — and an empty readback is indistinguishable from
 * the black frame this harness exists to catch.
 */
function captureFrame(canvas) {
	const readback = document.createElement('canvas');
	readback.width = canvas.width;
	readback.height = canvas.height;
	const context = readback.getContext('2d', { willReadFrequently: true });
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function countFrame(pixels) {
	let lit = 0;
	let bright = 0;
	for (let index = 0; index < pixels.length; index += 4) {
		const luminance = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
		if (luminance >= litLuminance)
			lit += 1;
		if (luminance >= brightLuminance)
			bright += 1;
	}
	return { lit, bright, total: pixels.length / 4 };
}

function countChangedPixels(before, after) {
	let changed = 0;
	for (let index = 0; index < before.length; index += 4) {
		if (Math.abs(before[index] - after[index]) >= changedChannel
			|| Math.abs(before[index + 1] - after[index + 1]) >= changedChannel
			|| Math.abs(before[index + 2] - after[index + 2]) >= changedChannel) {
			changed += 1;
		}
	}
	return changed;
}

/**
 * Every elapsed time the effect is drawn at, in order, and which of them are
 * measured.
 *
 * Without a frame rate that is just the sampled times: two draws, seconds apart,
 * which is all a stateless shader needs to prove it moves. With one, the clock
 * is stepped at that rate all the way to each sample, so an effect that builds
 * its image across frames arrives at the sampled moment having drawn the frames
 * it would have drawn on air.
 */
function renderSchedule(frameRate) {
	if (!frameRate)
		return seconds.map(elapsed => ({ elapsed, sampled: true }));
	const last = seconds[seconds.length - 1];
	// Counted in frames rather than accumulated in seconds: a running `+= step`
	// drifts, and every sampled time here is recognised by value.
	const stepped = Array.from({ length: Math.ceil(last * frameRate) }, (_, frame) => (frame + 1) / frameRate);
	const times = [...new Set([...seconds, ...stepped.filter(elapsed => elapsed < last)])];
	return times
		.sort((first, second) => first - second)
		.map(elapsed => ({ elapsed, sampled: seconds.includes(elapsed) }));
}

/**
 * Mount one scenario, draw its frames, and count the sampled ones.
 *
 * Every sampled frame is held to the floors, so the reported counts are the
 * worst of them — fewest lit, most bright. An effect that renders its first
 * frame and then goes black is as broken as one that never rendered, and
 * reporting an average would hide it.
 *
 * Everything the mount or the draw can throw is caught here. An effect that dies
 * is a measurement — no frames, so no lit pixels and no motion — and the run
 * carries on to the next one rather than losing the other fourteen.
 */
function measureScenario({ effect, scenario, frameRate, mount, compilation }) {
	const stage = document.getElementById('stage');
	const mark = compilation.mark();
	let instance;
	const frames = [];
	try {
		instance = mount(stage);
		instance.resize(width, height);
		const canvas = stage.querySelector('canvas');
		for (const { elapsed, sampled } of renderSchedule(frameRate)) {
			instance.render(elapsed);
			if (sampled)
				frames.push(captureFrame(canvas));
		}
	}
	catch {
		// A throw anywhere between the mount and the last frame leaves whatever was
		// captured before it, and the counts below say the rest: an effect that
		// died measures as one that did not draw, which is the truth about it.
	}
	finally {
		try {
			instance?.dispose();
		}
		catch {
			// A half-built effect can fail to tear down. The measurement is already
			// taken, and the stage is cleared below either way.
		}
		stage.replaceChildren();
	}

	const counted = frames.map(countFrame);
	return {
		effect,
		scenario,
		mounted: instance !== undefined,
		compileFailures: compilation.since(mark),
		frames: frames.length,
		totalPixels: counted[0]?.total ?? width * height,
		litPixels: counted.length > 0 ? Math.min(...counted.map(frame => frame.lit)) : 0,
		brightPixels: counted.length > 0 ? Math.max(...counted.map(frame => frame.bright)) : 0,
		// The least any sampled frame differs from the one before it, so every
		// interval has to move rather than one lively pair carrying a dead one.
		changedPixels: frames.length === seconds.length && frames.length > 1
			? Math.min(...frames.slice(1).map((frame, index) => countChangedPixels(frames[index], frame)))
			: 0,
	};
}

async function measureEverything() {
	const compilation = countShaderFailures();
	const scenarios = [];
	for (const scenario of animationEffectProofScenarios()) {
		const factory = await loadAnimationEffect(scenario.effect);
		const params = { ...animationEffectDefaultParams(scenario.effect), ...scenario.params };
		scenarios.push(measureScenario({
			effect: scenario.effect,
			scenario: scenario.scenario,
			frameRate: scenario.frameRate,
			mount: stage => factory(stage, params),
			compilation,
		}));
	}

	// The control goes through the same base, the same mount, and the same
	// counting as everything above it — the only difference is a fragment shader
	// that cannot compile.
	const control = measureScenario({
		effect: ANIMATION_EFFECT_PROOF_CONTROL.effect,
		scenario: ANIMATION_EFFECT_PROOF_CONTROL.scenario,
		mount: stage => createShaderPlaneEffect({
			three: THREE,
			host: stage,
			fragmentShader: ANIMATION_EFFECT_PROOF_CONTROL.fragmentShader,
			uniforms: () => ({}),
		}, {}),
		compilation,
	});

	return { catalogue: [...ANIMATION_EFFECT_VALUES], scenarios, control };
}

/**
 * Publish the measurements, then say they are there.
 *
 * In that order, and through `data-measurements` rather than the family's
 * `data-result`: a page in that contract publishes a *verdict* (`passed` /
 * `failed`, with a code and a description), and this one deliberately has none
 * to publish — reusing those names for "the numbers are ready" would put a word
 * that means "this content is good" on a page whose whole design is that it does
 * not decide.
 */
function publish(report) {
	document.getElementById('report').textContent = JSON.stringify(report);
	document.body.dataset.measurements = 'complete';
}

/** A run that reached no effects, in the shape Node judges every run in. */
function nothingMeasured(backend, pageFailed) {
	return { backend, pageFailed, catalogue: [], scenarios: [], control: { mounted: false } };
}

async function run() {
	let backend = 'other';
	try {
		backend = detectBackend();
		if (backend === 'unavailable')
			publish(nothingMeasured(backend, false));
		else
			publish({ backend, pageFailed: false, ...await measureEverything() });
	}
	catch {
		// Whatever went wrong is the page's own plumbing rather than an effect's —
		// every effect failure is already caught per scenario. The run says so and
		// proves nothing, which is what `pageFailed` means in Node.
		publish(nothingMeasured(backend, true));
	}
}

// Started rather than awaited: the bundle is an IIFE, which has no top-level
// await, and the page's whole contract is that `data-measurements` appears when
// the measurements do.
void run();

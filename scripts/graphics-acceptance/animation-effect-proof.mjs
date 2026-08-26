/**
 * The Node half of the Animation Effect rendering proof: what the browser is
 * given, and what its measurements are worth.
 *
 * The page measures and this file judges, and the split is the point. A page
 * that decided its own verdict could only be believed as far as the page is
 * trusted, and the failure this whole harness exists for — a shader that
 * compiles and renders black — is exactly the kind that leaves a page looking
 * healthy. So the browser publishes counts, the floors live beside the scenario
 * table in Node, and `judgeAnimationEffectReport` is a pure function over
 * numbers: reviewable, unit-tested, and unable to be talked out of a failure by
 * the thing it is measuring.
 */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
	ANIMATION_EFFECT_PROOF_CONTROL,
	ANIMATION_EFFECT_PROOF_FLOORS,
	ANIMATION_EFFECT_PROOF_FRAME,
	ANIMATION_EFFECT_PROOF_KNOWN_GOOD,
	ANIMATION_EFFECT_PROOF_SCENARIOS,
	animationEffectProofScenarios,
} from './animation-effect-scenarios.mjs';
import { AcceptanceFailure } from './evidence.mjs';

export const ANIMATION_EFFECT_PROOF_PAGE_PATH = '/_acceptance/animation-effect-v1.html';
export const ANIMATION_EFFECT_PROOF_SCRIPT_PATH = '/_acceptance/animation-effect-v1.js';

/**
 * SwiftShader, on purpose.
 *
 * Unattended Chromium has no GPU — the shared launch flags include
 * `--disable-gpu` — and its answer to a WebGL context request without one is
 * `null`, which would make every effect measure as an unmountable black frame
 * for a reason that has nothing to do with the shaders. These three flags put
 * ANGLE on SwiftShader's software Vulkan device instead, so the same GLSL is
 * compiled and rasterised on the CPU. `--enable-unsafe-swiftshader` is what
 * keeps Chrome from refusing the fallback it otherwise treats as a security
 * downgrade for untrusted pages.
 */
export const SWIFTSHADER_ARGS = Object.freeze([
	'--use-gl=angle',
	'--use-angle=swiftshader',
	'--enable-unsafe-swiftshader',
]);

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Bundle the page that mounts the effects, from the application's own sources.
 *
 * The bundle is what makes this a proof of the shipped renderers rather than of
 * a copy of them: the entry imports `loadAnimationEffect` and the catalogue
 * schemas exactly as a Screen Output does, so an effect edited in
 * `app/utils/animation-effects` is the effect measured here, and an effect added
 * to the catalogue arrives in the run without anything being registered twice.
 *
 * esbuild is the whole toolchain, because the alternative is standing up Nuxt to
 * serve four hundred lines of test page.
 */
export async function bundleAnimationEffectPage() {
	const built = await build({
		entryPoints: [fileURLToPath(new URL('./animation-effect-page.mjs', import.meta.url))],
		bundle: true,
		write: false,
		format: 'iife',
		platform: 'browser',
		// The browser is the one this run launches, so the output only has to
		// parse there and nothing is transpiled down for older engines.
		target: 'chrome120',
		alias: { '~~': repositoryRoot, '~': `${repositoryRoot}app` },
		logLevel: 'silent',
	}).catch(() => {
		throw new AcceptanceFailure('animation-effect-bundle-failed');
	});
	const [output] = built.outputFiles ?? [];
	if (!output)
		throw new AcceptanceFailure('animation-effect-bundle-failed');
	return output.text;
}

/**
 * The page itself: a stage the effects mount into at the frame size they are
 * measured at, and the two things the run reads — `#report` for the
 * measurements, `data-measurements` for "they are all there".
 *
 * The stage is laid out rather than hidden: the scene effects size their camera
 * from `host.clientWidth` at mount, so a display-less host would build every one
 * of them against a 1×1 viewport.
 */
export function animationEffectProofPage() {
	const { width, height } = ANIMATION_EFFECT_PROOF_FRAME;
	return `<!doctype html>
<meta charset="utf-8">
<title>animation-effect-v1</title>
<style>
	html, body { margin: 0; background: #000; }
	#stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
</style>
<body>
	<div id="stage"></div>
	<script type="application/json" id="report"></script>
	<script src="${ANIMATION_EFFECT_PROOF_SCRIPT_PATH}"></script>
</body>
`;
}

/** The expression the run polls: the report, once the page says it is finished. */
export const ANIMATION_EFFECT_PROOF_EXPRESSION = `document.body.dataset.measurements === 'complete'
	? document.getElementById('report').textContent
	: undefined`;

function fraction(part, whole) {
	return whole > 0 ? part / whole : 0;
}

/** Fractions are evidence, so they print at the precision they were judged at. */
function measured(value) {
	return Number(value.toFixed(4));
}

/**
 * What one mounted scenario has to show for itself: it compiled, it drew, it
 * did not blow out the frame it has to sit behind graphics in, and it moved
 * between the two sampled frames.
 *
 * The four are separate codes rather than one "did not render", because they
 * fail for different reasons and a reader who knows which one broke knows where
 * to look: a compile failure is the shader source, an unlit frame is the
 * uniforms or the geometry, a washed-out one is the shading, and a static one is
 * the clock.
 */
export function judgeAnimationEffectScenario(measurement, floors) {
	const where = { effect: measurement.effect, scenario: measurement.scenario };
	if (!measurement.mounted)
		return [{ code: 'animation-effect-mount-failed', detail: where }];

	const failures = [];
	if (measurement.compileFailures > 0) {
		failures.push({
			code: 'animation-effect-shader-compile-failed',
			detail: { ...where, failures: measurement.compileFailures },
		});
	}

	const lit = fraction(measurement.litPixels, measurement.totalPixels);
	if (lit < floors.minLitFraction)
		failures.push({ code: 'animation-effect-frame-unlit', detail: { ...where, lit: measured(lit), floor: floors.minLitFraction } });

	const dark = fraction(measurement.darkPixels, measurement.totalPixels);
	if (dark < floors.minDarkFraction)
		failures.push({ code: 'animation-effect-frame-washed-out', detail: { ...where, dark: measured(dark), floor: floors.minDarkFraction } });

	const changed = fraction(measurement.changedPixels, measurement.totalPixels);
	if (changed < floors.minChangedFraction)
		failures.push({ code: 'animation-effect-frame-static', detail: { ...where, changed: measured(changed), floor: floors.minChangedFraction } });

	return failures;
}

/**
 * What the planted broken shader has to trip, named by the codes themselves so
 * a `check=` on the way out is the code a reader can go and find.
 *
 * The washed-out check is not here: a shader that draws nothing leaves the
 * whole frame dark, so the control says nothing about that check either way. It
 * is proven by mutation instead (#499), which is the only honest way to bite it.
 */
const CONTROL_MUST_TRIP = Object.freeze([
	'animation-effect-shader-compile-failed',
	'animation-effect-frame-unlit',
	'animation-effect-frame-static',
]);

/**
 * Which of those checks the control actually tripped.
 *
 * A run only means anything if a shader that cannot compile fails every one, so
 * the control is judged by the same function as every real effect and its
 * failures are read as coverage rather than as defects. A control that would not
 * mount at all trips nothing by name, and proves nothing about the pixel checks:
 * the browser refused it before any of them ran, so it is exactly as unproven as
 * a control that passed.
 */
function checksTheControlTripped(control) {
	return new Set(judgeAnimationEffectScenario(
		{ ...control, effect: ANIMATION_EFFECT_PROOF_CONTROL.effect, scenario: ANIMATION_EFFECT_PROOF_CONTROL.scenario },
		ANIMATION_EFFECT_PROOF_FLOORS,
	).map(failure => failure.code));
}

/**
 * The whole run, judged: coverage first, then every scenario, then the control
 * that has to fail.
 *
 * Order matters to a reader more than to the run. An unavailable WebGL backend
 * ends the judging immediately — every measurement after it is a black frame
 * about the environment rather than about a shader, and printing fifteen of them
 * would bury the one line that says why.
 *
 * @param {{
 *   backend: string,
 *   pageFailed: boolean,
 *   catalogue: string[],
 *   scenarios: object[],
 *   control: object,
 * }} report The measurements as the page published them.
 * @returns {{ code: string, detail?: object }[]} Everything the run has to
 * answer for, empty when every effect rendered and the control did not.
 */
export function judgeAnimationEffectReport(report) {
	if (report.backend === 'unavailable')
		return [{ code: 'animation-effect-webgl-unavailable' }];
	if (report.backend !== 'swiftshader')
		return [{ code: 'animation-effect-backend-unexpected', detail: { backend: report.backend } }];

	const failures = [];
	if (report.pageFailed)
		failures.push({ code: 'animation-effect-page-failed' });

	// The catalogue the bundle saw, against the one the table covers: an effect
	// shipped without a scenario here would otherwise be proven by nobody, and
	// silently.
	const covered = new Set(Object.keys(ANIMATION_EFFECT_PROOF_SCENARIOS));
	const shipped = new Set(report.catalogue ?? []);
	for (const effect of new Set([...covered, ...shipped])) {
		if (!covered.has(effect) || !shipped.has(effect))
			failures.push({ code: 'animation-effect-catalogue-uncovered', detail: { effect } });
	}

	const measurements = new Map(
		(report.scenarios ?? []).map(entry => [`${entry.effect}/${entry.scenario}`, entry]),
	);
	const knownGoodFailed = [];
	for (const scenario of animationEffectProofScenarios()) {
		const measurement = measurements.get(`${scenario.effect}/${scenario.scenario}`);
		if (!measurement) {
			failures.push({
				code: 'animation-effect-scenario-missing',
				detail: { effect: scenario.effect, scenario: scenario.scenario },
			});
			continue;
		}
		const found = judgeAnimationEffectScenario(
			{ ...measurement, effect: scenario.effect, scenario: scenario.scenario },
			scenario.floors,
		);
		failures.push(...found);
		if (scenario.effect === ANIMATION_EFFECT_PROOF_KNOWN_GOOD)
			knownGoodFailed.push(...found);
	}

	// The effect that has rendered on air since the first slice of #473 failing
	// is a fact about this run — a driver, a flag, a readback — before it is a
	// fact about the catalogue, and it is said in one line rather than left for
	// the reader to infer from which rows are in the block.
	if (knownGoodFailed.length > 0) {
		failures.push({
			code: 'animation-effect-known-good-control-failed',
			detail: { effect: ANIMATION_EFFECT_PROOF_KNOWN_GOOD },
		});
	}

	// Last, because it is the line that says whether any of the above was worth
	// anything: a check the broken shader walked past is a check that would let a
	// broken effect past too.
	const tripped = checksTheControlTripped(report.control ?? { mounted: false });
	for (const check of CONTROL_MUST_TRIP) {
		if (!tripped.has(check))
			failures.push({ code: 'animation-effect-checks-not-biting', detail: { check } });
	}

	return failures;
}

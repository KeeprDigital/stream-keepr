import { describe, expect, it } from 'vitest';
import { ANIMATION_EFFECT_PROOF_EXPRESSION, judgeAnimationEffectReport } from '../../../scripts/graphics-acceptance/animation-effect-proof.mjs';
import {
	ANIMATION_EFFECT_PROOF_SCENARIOS,
	animationEffectProofScenarios,
	animationEffectSettleScenarios,
} from '../../../scripts/graphics-acceptance/animation-effect-scenarios.mjs';
import { ANIMATION_EFFECT_CATALOGUE, ANIMATION_EFFECT_VALUES } from '../../../shared/animationEffects';

/**
 * A measurement of one scenario as the page publishes it, healthy by default so
 * each test names only the fact it is about.
 */
function measurement(overrides: Record<string, unknown> = {}) {
	return {
		mounted: true,
		compileFailures: 0,
		totalPixels: 1000,
		litPixels: 500,
		darkPixels: 800,
		changedPixels: 300,
		...overrides,
	};
}

/** A whole run in which every scenario the table names rendered correctly. */
function healthyReport(overrides: Record<string, unknown> = {}) {
	return {
		backend: 'swiftshader',
		pageFailed: false,
		catalogue: [...ANIMATION_EFFECT_VALUES],
		scenarios: animationEffectProofScenarios().map(({ effect, scenario }) => ({
			effect,
			scenario,
			...measurement(),
		})),
		settles: animationEffectSettleScenarios().map(({ effect, scenario }) => ({
			effect,
			scenario,
			...settled(),
		})),
		control: measurement({
			mounted: true,
			compileFailures: 1,
			litPixels: 0,
			changedPixels: 0,
		}),
		...overrides,
	};
}

/** A settle in which the effect drew, then faded all the way back. */
function settled(overrides: Record<string, unknown> = {}) {
	return {
		mounted: true,
		compileFailures: 0,
		totalPixels: 1000,
		litPixels: 500,
		residualPixels: 0,
		largestResidualChannel: 0,
		referenceVariedPixels: 0,
		...overrides,
	};
}

/** The measurement of halo's settle, replaced with `overrides`. */
function withSettle(overrides: Record<string, unknown>) {
	const report = healthyReport();
	report.settles = report.settles.map(entry => ({
		...entry,
		...overrides,
	}));
	return report;
}

function codes(report: Parameters<typeof judgeAnimationEffectReport>[0]) {
	return judgeAnimationEffectReport(report).map(failure => failure.code);
}

/** The measurement of one named scenario, replaced with a broken one. */
function withScenario(effect: string, scenario: string, overrides: Record<string, unknown>) {
	const report = healthyReport();
	report.scenarios = report.scenarios.map(entry =>
		entry.effect === effect && entry.scenario === scenario
			? {
					...entry,
					...overrides,
				}
			: entry);
	return report;
}

describe('the animation effect scenario table', () => {
	it('names every effect the catalogue ships', () => {
		expect(Object.keys(ANIMATION_EFFECT_PROOF_SCENARIOS).sort()).toEqual([...ANIMATION_EFFECT_VALUES].sort());
	});

	it('mounts every effect at its defaults, and its extremes beside them', () => {
		const scenarios = animationEffectProofScenarios();

		for (const effect of ANIMATION_EFFECT_VALUES) {
			const mounted = scenarios.filter(scenario => scenario.effect === effect);
			expect(mounted.map(scenario => scenario.scenario)).toContain('defaults');
			expect(mounted).toHaveLength(1 + ANIMATION_EFFECT_PROOF_SCENARIOS[effect].extremes.length);
		}
	});

	it('names only params its effect declares, so no scenario silently proves the defaults', () => {
		// The page spreads a scenario's params over the defaults without parsing
		// them, so a key the schema no longer declares (a renamed param, #583)
		// would mount the defaults under the extreme's name.
		const scenarios = [
			...animationEffectProofScenarios(),
			...animationEffectSettleScenarios(),
		];
		for (const { effect, scenario, params } of scenarios) {
			const outcome = ANIMATION_EFFECT_CATALOGUE[effect as keyof typeof ANIMATION_EFFECT_CATALOGUE].paramsSchema.safeParse(params);
			expect(outcome.error?.issues, `${effect} ${scenario}`).toBeUndefined();
		}
	});

	it('carries the inkmap and shards range ends proven in the catalogue build', () => {
		const scenarios = animationEffectProofScenarios();
		const params = (effect: string, scenario: string) =>
			scenarios.find(entry => entry.effect === effect && entry.scenario === scenario)?.params;

		expect(params('inkmap', 'max-scale')).toEqual({ scale: 2 });
		expect(params('inkmap', 'min-scale')).toEqual({ scale: 0.35 });
		expect(params('shards', 'min-intensity')).toEqual({ intensity: 0.5 });
		expect(params('shards', 'max-intensity')).toEqual({ intensity: 2 });
	});

	it('gives every scenario the floors it is judged against', () => {
		for (const scenario of animationEffectProofScenarios()) {
			expect(scenario.floors.minLitFraction).toBeGreaterThan(0);
			expect(scenario.floors.minDarkFraction).toBeGreaterThan(0);
			expect(scenario.floors.minChangedFraction).toBeGreaterThan(0);
		}
	});
});

describe('judging an animation effect rendering proof', () => {
	it('passes a run in which every scenario compiled, lit the frame, and moved', () => {
		expect(judgeAnimationEffectReport(healthyReport())).toEqual([]);
	});

	it('refuses a run with no WebGL, and judges nothing else from it', () => {
		expect(codes(healthyReport({ backend: 'unavailable' }))).toEqual(['animation-effect-webgl-unavailable']);
	});

	it('refuses a WebGL backend other than SwiftShader', () => {
		expect(codes(healthyReport({ backend: 'hardware' }))).toEqual(['animation-effect-backend-unexpected']);
	});

	it('reports a page that never finished measuring', () => {
		expect(codes(healthyReport({ pageFailed: true }))).toContain('animation-effect-page-failed');
	});

	it('says what the page caught when it gave up measuring (#687)', () => {
		const failures = judgeAnimationEffectReport(healthyReport({
			pageFailed: true,
			pageError: 'RangeError: Array buffer allocation failed\n    at captureFrame (http://127.0.0.1:5/_acceptance/animation-effect-v1.js:9:1)',
		}));

		expect(failures).toContainEqual({
			code: 'animation-effect-page-failed',
			detail: { source: 'page', thrown: 'RangeError: Array buffer allocation failed' },
		});
	});

	it('reports an effect the catalogue ships and the run never mounted', () => {
		const report = healthyReport();
		report.catalogue = report.catalogue.filter(effect => effect !== 'weave');

		expect(codes(report)).toContain('animation-effect-catalogue-uncovered');
	});

	it('reports a scenario the table names and the page did not measure', () => {
		const report = healthyReport();
		report.scenarios = report.scenarios.filter(entry => entry.scenario !== 'defaults' || entry.effect !== 'shards');

		expect(codes(report)).toContain('animation-effect-scenario-missing');
	});

	it('reports a shader that failed to compile', () => {
		expect(codes(withScenario('inkmap', 'defaults', { compileFailures: 1 })))
			.toContain('animation-effect-shader-compile-failed');
	});

	it('reports an effect that would not mount', () => {
		expect(codes(withScenario('inkmap', 'defaults', { mounted: false })))
			.toContain('animation-effect-mount-failed');
	});

	it('reports a frame that compiled and rendered nothing', () => {
		expect(codes(withScenario('shards', 'max-scale', { litPixels: 0 })))
			.toContain('animation-effect-frame-unlit');
	});

	it('reports a frame too bright to sit behind broadcast graphics', () => {
		expect(codes(withScenario('weave', 'defaults', { darkPixels: 100 })))
			.toContain('animation-effect-frame-washed-out');
	});

	it('lets lit pixels belong to the dark-majority count at mid-tone luminance', () => {
		expect(codes(withScenario('waves', 'defaults', { litPixels: 1000, darkPixels: 1000 })))
			.toEqual([]);
	});

	it('reports a lit frame that never moved', () => {
		expect(codes(withScenario('cells', 'defaults', { changedPixels: 0 })))
			.toContain('animation-effect-frame-static');
	});

	it('holds the sparsest effect to its own lit floor rather than the shared one', () => {
		const sparse = animationEffectProofScenarios().find(scenario => scenario.effect === 'ember')!;
		const litForSparseField = Math.ceil(sparse.floors.minLitFraction * 1000);

		expect(codes(withScenario('ember', 'defaults', { litPixels: litForSparseField })))
			.not
			.toContain('animation-effect-frame-unlit');
		expect(codes(withScenario('cells', 'defaults', { litPixels: litForSparseField })))
			.toContain('animation-effect-frame-unlit');
	});

	it('says the run itself is suspect when the known-good effect is the one that failed', () => {
		expect(codes(withScenario('fog', 'defaults', { litPixels: 0 })))
			.toContain('animation-effect-known-good-control-failed');
		expect(codes(withScenario('cells', 'defaults', { litPixels: 0 })))
			.not
			.toContain('animation-effect-known-good-control-failed');
	});

	describe('the planted broken shader', () => {
		it('refuses a run in which the broken shader compiled', () => {
			const report = healthyReport({
				control: measurement({ compileFailures: 0, litPixels: 0, changedPixels: 0 }),
			});

			expect(judgeAnimationEffectReport(report)).toEqual([
				{
					code: 'animation-effect-checks-not-biting',
					detail: { check: 'animation-effect-shader-compile-failed' },
				},
			]);
		});

		it('refuses a run in which the broken shader still lit the frame', () => {
			const report = healthyReport({
				control: measurement({ compileFailures: 1, changedPixels: 0 }),
			});

			expect(codes(report)).toEqual(['animation-effect-checks-not-biting']);
		});

		it('refuses a run in which the broken shader still animated', () => {
			const report = healthyReport({
				control: measurement({ compileFailures: 1, litPixels: 0 }),
			});

			expect(codes(report)).toEqual(['animation-effect-checks-not-biting']);
		});
	});
});

describe('judging an accumulating effect settling back to its background', () => {
	it('measures halo, the catalogue\'s one accumulating effect', () => {
		expect(animationEffectSettleScenarios().map(({ effect }) => effect)).toEqual(['halo']);
	});

	it('reports trails still on screen after the effect stopped feeding them', () => {
		expect(judgeAnimationEffectReport(withSettle({ residualPixels: 1, largestResidualChannel: 3 }))).toEqual([
			{
				code: 'animation-effect-trail-lingered',
				detail: {
					effect: 'halo',
					scenario: 'settles-to-background',
					residual: 0.001,
					largestChannel: 3,
				},
			},
		]);
	});

	it('refuses a settle that never drew anything to fade', () => {
		expect(codes(withSettle({ litPixels: 0 }))).toEqual(['animation-effect-settle-unproven']);
	});

	it('refuses a settle compared against a frame that was not plain background', () => {
		expect(codes(withSettle({ referenceVariedPixels: 12 }))).toEqual(['animation-effect-settle-unproven']);
	});

	it('steps every settle on a frame clock, since the fade happens per frame', () => {
		for (const settle of animationEffectSettleScenarios())
			expect(settle.frameRate).toBeGreaterThan(0);
	});

	it('reports a settle the page did not measure', () => {
		expect(codes(healthyReport({ settles: [] }))).toEqual(['animation-effect-scenario-missing']);
	});

	it('reports a settle whose shader failed to compile or would not mount', () => {
		expect(codes(withSettle({ compileFailures: 1 }))).toContain('animation-effect-shader-compile-failed');
		expect(codes(withSettle({ mounted: false }))).toEqual(['animation-effect-mount-failed']);
	});
});

/**
 * The run polls from the moment the page is created, and on a loaded machine
 * the first poll can land before the parser has reached `<body>` (#687). A
 * stalled response proves it in Chromium: the poll threw `Cannot read
 * properties of null (reading 'dataset')`, which the run read as a page that
 * threw and printed as `animation-effect-page-failed`. Still loading is not
 * finished, and not failed either.
 */
describe('the expression the run polls', () => {
	function poll(document: object) {
		// eslint-disable-next-line no-new-func
		return new Function('document', `return (${ANIMATION_EFFECT_PROOF_EXPRESSION})`)(document);
	}

	it('reads a page whose body has not been parsed yet as still working', () => {
		expect(poll({
			body: null,
			getElementById: () => null,
		})).toBeUndefined();
	});

	it('reads the report once the page says it is complete', () => {
		expect(poll({
			body: {
				dataset: { measurements: 'complete' },
			},
			getElementById: () => ({ textContent: '{"backend":"swiftshader"}' }),
		})).toBe('{"backend":"swiftshader"}');
	});
});

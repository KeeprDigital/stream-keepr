import { describe, expect, it } from 'vitest';
import { judgeAnimationEffectReport } from '../../../scripts/graphics-acceptance/animation-effect-proof.mjs';
import {
	ANIMATION_EFFECT_PROOF_SCENARIOS,
	animationEffectProofScenarios,
} from '../../../scripts/graphics-acceptance/animation-effect-scenarios.mjs';
import { ANIMATION_EFFECT_VALUES } from '../../../shared/animationEffects';

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
		control: measurement({ mounted: true, compileFailures: 1, litPixels: 0, changedPixels: 0 }),
		...overrides,
	};
}

function codes(report: Parameters<typeof judgeAnimationEffectReport>[0]) {
	return judgeAnimationEffectReport(report).map(failure => failure.code);
}

/** The measurement of one named scenario, replaced with a broken one. */
function withScenario(effect: string, scenario: string, overrides: Record<string, unknown>) {
	const report = healthyReport();
	report.scenarios = report.scenarios.map(entry =>
		entry.effect === effect && entry.scenario === scenario ? { ...entry, ...overrides } : entry);
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

	it('reports a page that never finished measuring', () => {
		expect(codes(healthyReport({ pageFailed: true }))).toContain('animation-effect-page-failed');
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
		expect(codes(withScenario('shards', 'max-size', { litPixels: 0 })))
			.toContain('animation-effect-frame-unlit');
	});

	it('reports a frame too bright to sit behind broadcast graphics', () => {
		expect(codes(withScenario('weave', 'defaults', { darkPixels: 100 })))
			.toContain('animation-effect-frame-washed-out');
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
			const report = healthyReport({ control: measurement({ compileFailures: 0, litPixels: 0, changedPixels: 0 }) });

			expect(judgeAnimationEffectReport(report)).toEqual([
				{ code: 'animation-effect-checks-not-biting', detail: { check: 'compile' } },
			]);
		});

		it('refuses a run in which the broken shader still lit the frame', () => {
			const report = healthyReport({ control: measurement({ compileFailures: 1, changedPixels: 0 }) });

			expect(codes(report)).toEqual(['animation-effect-checks-not-biting']);
		});

		it('refuses a run in which the broken shader still animated', () => {
			const report = healthyReport({ control: measurement({ compileFailures: 1, litPixels: 0 }) });

			expect(codes(report)).toEqual(['animation-effect-checks-not-biting']);
		});
	});
});

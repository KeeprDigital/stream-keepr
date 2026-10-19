import { describe, expect, it } from 'vitest';
import { judgeKeyMatteReport } from '../../../scripts/graphics-acceptance/key-matte-proof.mjs';
import { KEY_MATTE_PROOF_CONTROL, KEY_MATTE_PROOF_HOSTS } from '../../../scripts/graphics-acceptance/key-matte-scenarios.mjs';

/** One host scene as the page publishes it, healthy by default. */
function scene(name: string, overrides: Record<string, unknown> = {}) {
	return { name, maxMatteError: 0, greyPixels: 5000, maxChroma: 0, ...overrides };
}

/** A run in which every host keys its glow and the planted control misses it. */
function healthyReport(overrides: Record<string, Record<string, unknown>> = {}) {
	return {
		scenes: [
			...KEY_MATTE_PROOF_HOSTS.map(name => scene(name, overrides[name])),
			scene(KEY_MATTE_PROOF_CONTROL, { maxMatteError: 16, greyPixels: 0, ...overrides[KEY_MATTE_PROOF_CONTROL] }),
		],
	};
}

describe('judging a Key matte rendering proof', () => {
	it('passes when every host keys its glow and the control is caught', () => {
		expect(judgeKeyMatteReport(healthyReport())).toEqual([]);
	});

	it('fails a Key Output that strays from the Overlay alpha', () => {
		expect(judgeKeyMatteReport(healthyReport({ 'frame-glow': { maxMatteError: 57 } })))
			.toEqual([{ code: 'key-matte-diverges-from-fill', detail: { scene: 'frame-glow', measured: 57 } }]);
	});

	it('tolerates a few units of rounding', () => {
		expect(judgeKeyMatteReport(healthyReport({ 'source-item-glow': { maxMatteError: 4 } }))).toEqual([]);
	});

	it('fails a glow that is not grey in the matte', () => {
		expect(judgeKeyMatteReport(healthyReport({ 'source-item-glow': { greyPixels: 0 } })))
			.toEqual([{ code: 'key-matte-glow-not-grey', detail: { scene: 'source-item-glow', measured: 0 } }]);
	});

	it('fails a matte that carries colour', () => {
		expect(judgeKeyMatteReport(healthyReport({ 'graphic-item-glow': { maxChroma: 40 } })))
			.toEqual([{ code: 'key-matte-not-grayscale', detail: { scene: 'graphic-item-glow', measured: 40 } }]);
	});

	it('fails a measurement the page did not publish rather than reading it as a pass', () => {
		expect(judgeKeyMatteReport(healthyReport({ 'frame-glow': { maxMatteError: undefined } })).map(failure => failure.code))
			.toEqual(['key-matte-diverges-from-fill']);
	});

	it('fails a host scene the report is missing', () => {
		const report = healthyReport();
		report.scenes = report.scenes.filter(({ name }) => name !== 'frame-glow');

		expect(judgeKeyMatteReport(report)).toEqual([{ code: 'key-matte-scene-missing', detail: { scene: 'frame-glow' } }]);
	});

	it('fails the whole run when the planted unkeyed glow passes', () => {
		expect(judgeKeyMatteReport(healthyReport({ [KEY_MATTE_PROOF_CONTROL]: { maxMatteError: 0 } })))
			.toEqual([{ code: 'key-matte-checks-not-biting', detail: { scene: KEY_MATTE_PROOF_CONTROL } }]);
	});

	it('fails an empty report on every count', () => {
		expect(judgeKeyMatteReport({}).map(failure => failure.code))
			.toEqual(Array.from({ length: KEY_MATTE_PROOF_HOSTS.length + 1 }).fill('key-matte-scene-missing'));
	});
});

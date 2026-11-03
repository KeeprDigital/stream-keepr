import { describe, expect, it } from 'vitest';
import { conversionTargetLabel, eventConversionTarget } from '~~/shared/conversionTarget';

describe('the Conversion Target', () => {
	it.each([
		[
			{ conversionMetric: 'topN', conversionThreshold: 8 },
			'Top 8',
		],
		[
			{ conversionMetric: 'minPoints', conversionThreshold: 18 },
			'18+ pts',
		],
		[
			{ conversionMetric: 'minPoints', conversionThreshold: 0 },
			'0+ pts',
		],
	] as const)('names %o as the Metagame page does: %s', (target, label) => {
		expect(conversionTargetLabel(target)).toBe(label);
	});

	// An Event context not yet loaded, or held before the target existed, reads Top 8.
	it.each([
		[
			null,
			{ conversionMetric: 'topN', conversionThreshold: 8 },
		],
		[
			{ conversionMetric: 'minPoints' },
			{ conversionMetric: 'topN', conversionThreshold: 8 },
		],
		[
			{ conversionMetric: 'minPoints', conversionThreshold: 0 },
			{ conversionMetric: 'minPoints', conversionThreshold: 0 },
		],
	] as const)('reads %o as %o', (event, target) => {
		expect(eventConversionTarget(event)).toEqual(target);
	});
});

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FEATURE_MATCH_DEFAULTS,
	fromFeatureMatchDefaults,
	toFeatureMatchDefaults,
} from '~~/shared/types/featureMatchDefaults';

describe('dEFAULT_FEATURE_MATCH_DEFAULTS', () => {
	it('has expected default values', () => {
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.bestOf).toBe(3);
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.startingLife).toBe(20);
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.clockType).toBe('countdown');
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.clockDuration).toBe(50);
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.countUpAfterCountdown).toBe(false);
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.turnTrackingEnabled).toBe(false);
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.extraTurnsEnabled).toBe(false);
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.extraTurns).toBe(5);
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.extraTurnsLabel).toBe('Extra Turns');
		expect(DEFAULT_FEATURE_MATCH_DEFAULTS.mulliganTrackingEnabled).toBe(false);
	});
});

describe('toFeatureMatchDefaults', () => {
	it('returns defaults for null source', () => {
		expect(toFeatureMatchDefaults(null)).toEqual(DEFAULT_FEATURE_MATCH_DEFAULTS);
	});

	it('returns defaults for undefined source', () => {
		expect(toFeatureMatchDefaults(undefined)).toEqual(DEFAULT_FEATURE_MATCH_DEFAULTS);
	});

	it('extracts fields from flat column names', () => {
		const source = {
			featureMatchDefaultBestOf: 5,
			featureMatchDefaultStartingLife: 40,
			featureMatchDefaultClockType: 'countup' as const,
		};
		const result = toFeatureMatchDefaults(source);
		expect(result.bestOf).toBe(5);
		expect(result.startingLife).toBe(40);
		expect(result.clockType).toBe('countup');
	});

	it('ignores null values in source', () => {
		const source = { featureMatchDefaultBestOf: null } as any;
		const result = toFeatureMatchDefaults(source);
		expect(result.bestOf).toBe(3); // default, not null
	});

	it('ignores undefined values in source', () => {
		const source = { featureMatchDefaultBestOf: undefined } as any;
		const result = toFeatureMatchDefaults(source);
		expect(result.bestOf).toBe(3); // default
	});

	it('maps all 11 fields correctly', () => {
		const source = {
			featureMatchDefaultBestOf: 1,
			featureMatchDefaultStartingLife: 8000,
			featureMatchDefaultClockType: 'countup' as const,
			featureMatchDefaultClockDuration: 30,
			featureMatchDefaultCountUpAfterCountdown: true,
			featureMatchDefaultTurnTrackingEnabled: true,
			featureMatchDefaultActivePlayerTrackingEnabled: true,
			featureMatchDefaultExtraTurnsEnabled: true,
			featureMatchDefaultExtraTurns: 3,
			featureMatchDefaultExtraTurnsLabel: 'Overtime',
			featureMatchDefaultMulliganTrackingEnabled: true,
		};
		const result = toFeatureMatchDefaults(source);
		expect(result).toEqual({
			bestOf: 1,
			startingLife: 8000,
			clockType: 'countup',
			clockDuration: 30,
			countUpAfterCountdown: true,
			turnTrackingEnabled: true,
			activePlayerTrackingEnabled: true,
			extraTurnsEnabled: true,
			extraTurns: 3,
			extraTurnsLabel: 'Overtime',
			mulliganTrackingEnabled: true,
		});
	});
});

describe('fromFeatureMatchDefaults', () => {
	it('converts all fields to flat column names', () => {
		const result = fromFeatureMatchDefaults(DEFAULT_FEATURE_MATCH_DEFAULTS);
		expect(result).toEqual({
			featureMatchDefaultBestOf: 3,
			featureMatchDefaultStartingLife: 20,
			featureMatchDefaultClockType: 'countdown',
			featureMatchDefaultClockDuration: 50,
			featureMatchDefaultCountUpAfterCountdown: false,
			featureMatchDefaultTurnTrackingEnabled: false,
			featureMatchDefaultActivePlayerTrackingEnabled: false,
			featureMatchDefaultExtraTurnsEnabled: false,
			featureMatchDefaultExtraTurns: 5,
			featureMatchDefaultExtraTurnsLabel: 'Extra Turns',
			featureMatchDefaultMulliganTrackingEnabled: false,
		});
	});

	it('handles partial input', () => {
		const result = fromFeatureMatchDefaults({ bestOf: 5, startingLife: 40 });
		expect(result).toEqual({
			featureMatchDefaultBestOf: 5,
			featureMatchDefaultStartingLife: 40,
		});
	});

	it('includes falsy but defined values (false, 0)', () => {
		const result = fromFeatureMatchDefaults({
			countUpAfterCountdown: false,
			extraTurns: 0,
		});
		expect(result).toMatchObject({
			featureMatchDefaultCountUpAfterCountdown: false,
			featureMatchDefaultExtraTurns: 0,
		});
	});

	it('roundtrips correctly with toFeatureMatchDefaults', () => {
		const original = { ...DEFAULT_FEATURE_MATCH_DEFAULTS, bestOf: 5, startingLife: 40 };
		const flat = fromFeatureMatchDefaults(original);
		const roundtripped = toFeatureMatchDefaults(flat as any);
		expect(roundtripped).toEqual(original);
	});
});

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FEATURE_MATCH_DEFAULTS,
	fromFeatureMatchDefaults,
	toFeatureMatchDefaults,
} from '~~/shared/types/featureMatchDefaults';

describe('toFeatureMatchDefaults', () => {
	it.each([null, undefined])('falls back to the defaults for a %s source', (source) => {
		expect(toFeatureMatchDefaults(source)).toEqual(DEFAULT_FEATURE_MATCH_DEFAULTS);
	});

	it.each([null, undefined])('keeps the default for a column holding %s', (value) => {
		expect(toFeatureMatchDefaults({ featureMatchDefaultBestOf: value } as any).bestOf).toBe(DEFAULT_FEATURE_MATCH_DEFAULTS.bestOf);
	});

	it('reads each Event column into its field', () => {
		expect(toFeatureMatchDefaults({
			featureMatchDefaultBestOf: 1,
			featureMatchDefaultStartingLife: 8000,
			featureMatchDefaultClockType: 'countup',
			featureMatchDefaultClockDuration: 30,
			featureMatchDefaultCountUpAfterCountdown: true,
			featureMatchDefaultTurnTrackingEnabled: true,
			featureMatchDefaultActivePlayerTrackingEnabled: true,
			featureMatchDefaultExtraTurnsEnabled: true,
			featureMatchDefaultExtraTurns: 3,
			featureMatchDefaultExtraTurnsLabel: 'Overtime',
			featureMatchDefaultMulliganTrackingEnabled: true,
		})).toEqual({
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
	it('writes only the fields given, falsy values included', () => {
		expect(fromFeatureMatchDefaults({ bestOf: 5, countUpAfterCountdown: false, extraTurns: 0 })).toEqual({
			featureMatchDefaultBestOf: 5,
			featureMatchDefaultCountUpAfterCountdown: false,
			featureMatchDefaultExtraTurns: 0,
		});
	});

	it('round-trips through toFeatureMatchDefaults', () => {
		const original = {
			...DEFAULT_FEATURE_MATCH_DEFAULTS,
			bestOf: 5,
			startingLife: 40,
			clockType: 'countup' as const,
			extraTurnsLabel: 'Overtime',
			mulliganTrackingEnabled: true,
		};

		expect(toFeatureMatchDefaults(fromFeatureMatchDefaults(original) as any)).toEqual(original);
	});
});

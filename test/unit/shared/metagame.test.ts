import { describe, expect, it } from 'vitest';
import { getFrontFaceCardType, isBasicLandCardType, isLandCardType, isMetagameAnalysisCard } from '~~/shared/utils/metagame';

describe('getFrontFaceCardType', () => {
	it('returns the full type for single-face cards', () => {
		expect(getFrontFaceCardType('Basic Land')).toBe('Basic Land');
	});

	it('uses the front face for double-faced cards', () => {
		expect(getFrontFaceCardType('Sorcery // Land')).toBe('Sorcery');
	});
});

describe('isLandCardType', () => {
	it('returns true for land-only cards', () => {
		expect(isLandCardType('Land')).toBe(true);
		expect(isLandCardType('Basic Land')).toBe(true);
		expect(isLandCardType('Basic Land — Island')).toBe(true);
		expect(isLandCardType('Artifact Land')).toBe(true);
	});

	it('returns false for nonland cards and spell-front MDFCs', () => {
		expect(isLandCardType('Instant')).toBe(false);
		expect(isLandCardType('Sorcery // Land')).toBe(false);
		expect(isLandCardType('Enchantment // Enchantment Creature — Reflection')).toBe(false);
	});
});

describe('isMetagameAnalysisCard', () => {
	it('excludes only basic lands from metagame analysis', () => {
		expect(isMetagameAnalysisCard('Basic Land')).toBe(false);
		expect(isMetagameAnalysisCard('Basic Land — Island')).toBe(false);
		expect(isMetagameAnalysisCard('Basic Snow Land — Forest')).toBe(false);
	});

	it('keeps nonbasic lands and nonland fronts in metagame analysis', () => {
		expect(isMetagameAnalysisCard('Land')).toBe(true);
		expect(isMetagameAnalysisCard('Artifact Land')).toBe(true);
		expect(isMetagameAnalysisCard('Sorcery // Land')).toBe(true);
		expect(isMetagameAnalysisCard(null)).toBe(true);
	});
});

describe('isBasicLandCardType', () => {
	it('returns true for front-face basic lands', () => {
		expect(isBasicLandCardType('Basic Land')).toBe(true);
		expect(isBasicLandCardType('Basic Land — Island')).toBe(true);
		expect(isBasicLandCardType('Basic Snow Land — Forest')).toBe(true);
	});

	it('returns false for nonbasic lands and spell-front MDFCs', () => {
		expect(isBasicLandCardType('Land')).toBe(false);
		expect(isBasicLandCardType('Artifact Land')).toBe(false);
		expect(isBasicLandCardType('Sorcery // Land')).toBe(false);
	});
});

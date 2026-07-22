import { describe, expect, it } from 'vitest';
import { defaultMtgCardData } from '~~/shared/utils/card/default';

describe('defaultMtgCardData', () => {
	it('has null front and back images', () => {
		expect(defaultMtgCardData.imageData.front).toBeNull();
		expect(defaultMtgCardData.imageData.back).toBeNull();
	});

	it('has all orientation flags set to false', () => {
		expect(defaultMtgCardData.orientationData.flipable).toBe(false);
		expect(defaultMtgCardData.orientationData.turnable).toBe(false);
		expect(defaultMtgCardData.orientationData.rotateable).toBe(false);
		expect(defaultMtgCardData.orientationData.counterRotateable).toBe(false);
	});

	it('has all display flags set to false', () => {
		expect(defaultMtgCardData.displayData.flipped).toBe(false);
		expect(defaultMtgCardData.displayData.rotated).toBe(false);
		expect(defaultMtgCardData.displayData.counterRotated).toBe(false);
		expect(defaultMtgCardData.displayData.turnedOver).toBe(false);
	});
});

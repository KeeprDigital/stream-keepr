import { describe, expect, it } from 'vitest';
import { mtgCardSize, mtgCardSizeFromHeight, mtgCardWidthFromHeight } from '~~/shared/utils/card/size';

describe('mtgCardSize', () => {
	it('sizes a square container to the card\'s diagonal, so it can rotate without clipping', () => {
		const result = mtgCardSize(200);

		expect(result.cardHeight).toBeCloseTo(200 * 85 / 61, 5);
		expect(result.diagonal).toBeCloseTo(Math.hypot(result.cardWidth, result.cardHeight), 5);
		expect(result.minWidth).toBe(result.diagonal);
		expect(result.minHeight).toBe(result.diagonal);
		expect(result.cardWidth + 2 * result.marginHorizontal).toBeCloseTo(result.diagonal, 5);
		expect(result.cardHeight + 2 * result.marginVertical).toBeCloseTo(result.diagonal, 5);
	});
});

describe('sizing from available height', () => {
	it('fits the rotated card\'s diagonal within the height less its margin', () => {
		expect(mtgCardSize(mtgCardWidthFromHeight(500)).diagonal).toBeCloseTo(500 - 40, 5);
		expect(mtgCardSizeFromHeight(600).diagonal).toBeCloseTo(600 - 80, 5);
	});

	it('caps the width at 800 however tall the space', () => {
		expect(mtgCardWidthFromHeight(10_000)).toBe(800);
	});
});

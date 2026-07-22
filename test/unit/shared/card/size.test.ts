import { describe, expect, it } from 'vitest';
import { mtgCardSize, mtgCardSizeFromHeight, mtgCardWidthFromHeight } from '~~/shared/utils/card/size';

describe('mtgCardSize', () => {
	it('calculates correct dimensions for a given width', () => {
		const result = mtgCardSize(200);

		expect(result.cardWidth).toBe(200);
		expect(result.cardHeight).toBeGreaterThan(200); // aspect ratio > 1
		expect(result.diagonal).toBeGreaterThan(result.cardHeight);
		expect(result.minWidth).toBe(result.diagonal);
		expect(result.minHeight).toBe(result.diagonal);
	});

	it('calculates that totalWidth equals diagonal', () => {
		const result = mtgCardSize(150);
		expect(result.totalWidth).toBeCloseTo(result.diagonal, 5);
		expect(result.totalHeight).toBeCloseTo(result.diagonal, 5);
	});

	it('calculates margins correctly', () => {
		const result = mtgCardSize(100);
		expect(result.marginHorizontal).toBeCloseTo((result.diagonal - result.cardWidth) / 2, 5);
		expect(result.marginVertical).toBeCloseTo((result.diagonal - result.cardHeight) / 2, 5);
	});

	it('accepts custom aspect ratio', () => {
		const result = mtgCardSize(100, 1);
		expect(result.cardHeight).toBe(100); // 1:1 ratio
	});
});

describe('mtgCardWidthFromHeight', () => {
	it('returns a positive width', () => {
		expect(mtgCardWidthFromHeight(500)).toBeGreaterThan(0);
	});

	it('clamps to 800 max', () => {
		expect(mtgCardWidthFromHeight(10000)).toBeLessThanOrEqual(800);
	});

	it('scales down for smaller heights', () => {
		const large = mtgCardWidthFromHeight(1000);
		const small = mtgCardWidthFromHeight(400);
		expect(large).toBeGreaterThan(small);
	});
});

describe('mtgCardSizeFromHeight', () => {
	it('returns full dimension object from available height', () => {
		const result = mtgCardSizeFromHeight(600);

		expect(result.cardWidth).toBeGreaterThan(0);
		expect(result.cardHeight).toBeGreaterThan(0);
		expect(result.diagonal).toBeGreaterThan(0);
		expect(result.minWidth).toBe(result.diagonal);
	});
});

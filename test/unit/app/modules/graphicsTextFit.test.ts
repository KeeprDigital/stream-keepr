import { describe, expect, it } from 'vitest';
import { fitGraphicTextFontSize } from '~/modules/graphics/textFit';

/** Stand-in measurement: text fits at or below `threshold` pixels. */
function fitsUpTo(threshold: number) {
	return (fontSize: number) => fontSize <= threshold;
}

describe('fitGraphicTextFontSize', () => {
	it('keeps the authored font size when the text already fits its bounds', () => {
		expect(fitGraphicTextFontSize({ minFontSize: 24, maxFontSize: 64 }, fitsUpTo(100))).toBe(64);
	});

	it('shrinks to the largest size that fits inside the authored bounds', () => {
		expect(fitGraphicTextFontSize({ minFontSize: 24, maxFontSize: 64 }, fitsUpTo(41))).toBe(41);
	});

	it('stops at the author-set minimum, leaving ellipsis to clip the rest', () => {
		expect(fitGraphicTextFontSize({ minFontSize: 30, maxFontSize: 64 }, fitsUpTo(10))).toBe(30);
	});

	it('never returns a size above the authored maximum or below the author-set minimum', () => {
		expect(fitGraphicTextFontSize({ minFontSize: 80, maxFontSize: 64 }, fitsUpTo(1000))).toBe(64);
		expect(fitGraphicTextFontSize({ minFontSize: 0, maxFontSize: 0 }, fitsUpTo(0))).toBe(0);
	});
});

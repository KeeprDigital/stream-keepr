import { describe, expect, it } from 'vitest';
import { tableRowLayout, tableRowLayoutStyle } from '~~/app/utils/tableRowLayout';

describe('tableRowLayout', () => {
	it('shares the measured height, less the page inset, across a page of rows', () => {
		expect(tableRowLayout({ density: 'compact', measuredHeight: 800, rowCount: 8 }).rowHeight).toBe(100);
		expect(tableRowLayout({
			density: 'compact',
			measuredHeight: 800,
			rowCount: 8,
			insetY: 80,
		}).rowHeight).toBe(90);
		expect(tableRowLayout({ density: 'roomy', measuredHeight: 800, rowCount: 4 }).rowHeight).toBe(200);
	});

	it('sizes rows at the density\'s natural height before the table is measured', () => {
		expect(tableRowLayout({ density: 'compact', measuredHeight: 0, rowCount: 10 }).rowHeight).toBe(44);
		expect(tableRowLayout({ density: 'roomy', measuredHeight: 0, rowCount: 10 }).rowHeight).toBe(72);
	});

	it('never squeezes a row below the density\'s floor', () => {
		expect(tableRowLayout({ density: 'compact', measuredHeight: 100, rowCount: 8 }).rowHeight).toBe(24);
		expect(tableRowLayout({ density: 'roomy', measuredHeight: 100, rowCount: 8 }).rowHeight).toBe(44);
	});

	it('lays out at least one row', () => {
		expect(tableRowLayout({ density: 'compact', measuredHeight: 800, rowCount: 0 }).rowHeight).toBe(800);
	});

	it('grows compact type and padding with the row height', () => {
		const layout = tableRowLayout({ density: 'compact', measuredHeight: 800, rowCount: 8 });

		expect(layout.fontSize).toBeCloseTo(24.24);
		expect(layout.secondaryFontSize).toBeCloseTo(20.3616);
		expect(layout.padding?.y).toBeCloseTo(12);
		expect(layout.padding?.x).toBeCloseTo(18.18);
	});

	it('keeps compact type and padding at their minimums in short rows', () => {
		const layout = tableRowLayout({ density: 'compact', measuredHeight: 192, rowCount: 8 });

		expect(layout).toEqual({
			rowHeight: 24,
			fontSize: 14,
			secondaryFontSize: 12,
			padding: { y: 4, x: 10.5 },
		});
	});

	it('grows roomy type with the row height and leaves padding to the stylesheet', () => {
		const layout = tableRowLayout({ density: 'roomy', measuredHeight: 800, rowCount: 8 });

		expect(layout.fontSize).toBeCloseTo(26.8);
		expect(layout.secondaryFontSize).toBeCloseTo(19.296);
		expect(layout.padding).toBeNull();
	});

	it('keeps roomy type at its minimums in short rows', () => {
		expect(tableRowLayout({ density: 'roomy', measuredHeight: 352, rowCount: 8 }))
			.toEqual({
				rowHeight: 44,
				fontSize: 18,
				secondaryFontSize: 13,
				padding: null,
			});
	});
});

describe('tableRowLayoutStyle', () => {
	it('names each measure as a custom property under the given prefix', () => {
		expect(tableRowLayoutStyle('standings', {
			rowHeight: 50,
			fontSize: 16,
			secondaryFontSize: 13,
			padding: { y: 6, x: 12 },
		})).toEqual({
			'--standings-row-height': '50px',
			'--standings-row-font-size': '16px',
			'--standings-row-secondary-font-size': '13px',
			'--standings-row-padding-y': '6px',
			'--standings-row-padding-x': '12px',
		});
	});

	it('leaves padding properties out when the density does not size padding', () => {
		expect(tableRowLayoutStyle('pairings', {
			rowHeight: 50,
			fontSize: 18,
			secondaryFontSize: 13,
			padding: null,
		})).toEqual({
			'--pairings-row-height': '50px',
			'--pairings-row-font-size': '18px',
			'--pairings-row-secondary-font-size': '13px',
		});
	});
});

import { describe, expect, it } from 'vitest';
import {
	parseScreenOutput,
	SCREEN_OUTPUT_VALUES,
	screenOutputBackground,
	screenOutputCanvasBackground,
	screenOutputCompositesOverBlack,
} from '~~/shared/utils/screenOutput';

describe('screen Output selection', () => {
	it('accepts an overlay, fill, or key output selection', () => {
		expect(parseScreenOutput('overlay')).toEqual({ output: 'overlay', warning: null });
		expect(parseScreenOutput('fill')).toEqual({ output: 'fill', warning: null });
		expect(parseScreenOutput('key')).toEqual({ output: 'key', warning: null });
	});

	it('offers exactly the overlay, fill, and key Screen Outputs', () => {
		expect(SCREEN_OUTPUT_VALUES).toEqual(['overlay', 'fill', 'key']);
	});

	it('renders the Overlay Output when the selection is omitted', () => {
		expect(parseScreenOutput(undefined)).toEqual({ output: 'overlay', warning: null });
		expect(parseScreenOutput(null)).toEqual({ output: 'overlay', warning: null });
		expect(parseScreenOutput('')).toEqual({ output: 'overlay', warning: null });
	});

	it('renders the Overlay Output and warns when the selection is invalid', () => {
		const parsed = parseScreenOutput('matte');

		expect(parsed.output).toBe('overlay');
		expect(parsed.warning).toBe('Invalid output mode "matte"; rendering overlay.');
	});

	it('uses the first query value when multiple are supplied', () => {
		expect(parseScreenOutput(['key', 'fill']).output).toBe('key');
	});

	it('captures the Fill Output and Key Output over black', () => {
		expect(screenOutputBackground('overlay')).toBeUndefined();
		expect(screenOutputBackground('fill')).toBe('#000000');
		expect(screenOutputBackground('key')).toBe('#000000');
	});

	it('composes the Fill Output and Key Output canvases over black and the Overlay Output over transparency', () => {
		expect(screenOutputCanvasBackground('overlay')).toBe('transparent');
		expect(screenOutputCanvasBackground('fill')).toBe('#000000');
		expect(screenOutputCanvasBackground('key')).toBe('#000000');
	});

	it('never lets a PNG capture disagree with the Screen Output it captures', () => {
		for (const output of SCREEN_OUTPUT_VALUES) {
			const capture = screenOutputBackground(output);
			const canvas = screenOutputCanvasBackground(output);

			expect(screenOutputCompositesOverBlack(output)).toBe(canvas !== 'transparent');
			expect(capture ?? 'transparent').toBe(canvas);
		}
	});
});

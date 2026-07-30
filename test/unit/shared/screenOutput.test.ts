import { describe, expect, it } from 'vitest';
import {
	parseScreenOutput,
	SCREEN_OUTPUT_VALUES,
	screenOutputBackground,
	screenOutputCanvasBackground,
	screenOutputCompositesOverBlack,
	screenOutputPath,
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

	it('builds a plain Screen Output URL with no preview flags', () => {
		expect(screenOutputPath({ eventId: 7, screenSlug: 'main' }))
			.toBe('/event/7/screen/main?output=overlay');
		expect(screenOutputPath({ eventId: 7, screenSlug: 'main', output: 'key' }))
			.toBe('/event/7/screen/main?output=key');
	});

	it('carries preview and guide flags only when the embedder asks for them', () => {
		const preview = screenOutputPath({
			eventId: 7,
			screenSlug: 'main',
			output: 'fill',
			fitToViewport: true,
			preview: true,
			itemGuides: true,
			safeAreaGuides: true,
		});

		expect(preview).toBe('/event/7/screen/main?output=fill&fit=1&preview=1&guides=1&safe=1');
		expect(screenOutputPath({ eventId: 7, screenSlug: 'main', preview: true }))
			.toBe('/event/7/screen/main?output=overlay&preview=1');
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

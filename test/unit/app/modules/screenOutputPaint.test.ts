import { describe, expect, it } from 'vitest';
import { borderGlow, colourAtOpacity, glowDropShadow, glowFlood, paintColour } from '~~/app/modules/screen/outputPaint';

/**
 * The Fill-versus-Key paint rules both graphics render models share. A Fill or
 * Overlay Output paints the authored colour at its opacity; a Key Output paints
 * white at that same opacity, which is what makes it an alpha matte.
 */

describe('screen output paint', () => {
	describe('a colour at an opacity', () => {
		it('keeps an opaque colour as authored', () => {
			expect(colourAtOpacity('fill', '#0077a3', 1)).toBe('#0077a3');
			expect(colourAtOpacity('overlay', 'rebeccapurple', 1)).toBe('rebeccapurple');
		});

		it('writes a hex colour at partial opacity as eight-digit hex', () => {
			expect(colourAtOpacity('fill', '#0077A3', 0.5)).toBe('#0077a380');
			expect(colourAtOpacity('overlay', '#001122', 0)).toBe('#00112200');
		});

		it('keeps the opacity of a colour that is not hex', () => {
			expect(colourAtOpacity('fill', 'rebeccapurple', 0.5))
				.toBe('color-mix(in srgb, rebeccapurple 50%, transparent)');
			expect(colourAtOpacity('overlay', 'rgb(10, 20, 30)', 0.25))
				.toBe('color-mix(in srgb, rgb(10, 20, 30) 25%, transparent)');
		});

		it('paints white at the same opacity in the Key Output, whatever the colour', () => {
			expect(colourAtOpacity('key', '#0077a3', 0.5)).toBe('#ffffff80');
			expect(colourAtOpacity('key', 'rebeccapurple', 0.25)).toBe('#ffffff40');
			expect(colourAtOpacity('key', '#ff0000', 1)).toBe('#ffffffff');
		});

		// A translucent Theme colour keys as the Fill shows it: its alpha times the consumer's opacity.
		it.each([
			['rgba(1, 2, 3, 0.5)', 1, '#ffffff80'],
			['rgba(1, 2, 3, 0.5)', 0.5, '#ffffff40'],
			['rgb(1 2 3 / 50%)', 1, '#ffffff80'],
			['#00000080', 1, '#ffffff80'],
			['rgb(10, 20, 30)', 0.5, '#ffffff80'],
			['transparent', 1, '#ffffff00'],
		])('keys %s at opacity %s as %s', (colour, opacity, keyed) => {
			expect(colourAtOpacity('key', colour, opacity)).toBe(keyed);
		});

		it.each([
			['#0077a3', '#ffffff'],
			['rgb(10, 20, 30)', '#ffffff'],
			['rgba(10, 20, 30, 0.25)', '#ffffff40'],
			['hsl(10 20% 30% / 0.5)', '#ffffff80'],
			['#0008', '#ffffff88'],
		])('paints %s in the Key Output as white at its own alpha, %s', (colour, keyed) => {
			expect(paintColour('key', colour)).toBe(keyed);
			expect(paintColour('fill', colour)).toBe(colour);
		});

		it('clamps an opacity outside zero to one', () => {
			expect(colourAtOpacity('key', '#ff0000', 2)).toBe('#ffffffff');
			expect(colourAtOpacity('fill', '#ff0000', -1)).toBe('#ff000000');
		});
	});

	describe('a border glow', () => {
		it('is off without a size', () => {
			expect(borderGlow({ borderColor: '#0077a3' })).toBeUndefined();
			expect(borderGlow({ borderColor: '#0077a3', glowSize: 0 })).toBeUndefined();
		});

		it('defaults to the border colour at three-quarter opacity', () => {
			expect(borderGlow({ borderColor: '#0077a3', glowSize: 7 }))
				.toEqual({ color: '#0077a3', size: 7, opacity: 0.75 });
			expect(borderGlow({ glowSize: 7 })).toEqual({ color: '#ffffff', size: 7, opacity: 0.75 });
		});

		it('keeps its own colour and opacity when it has them', () => {
			expect(borderGlow({
				borderColor: '#0077a3',
				glowColor: '#ff0000',
				glowSize: 7,
				glowOpacity: 0.5,
			}))
				.toEqual({ color: '#ff0000', size: 7, opacity: 0.5 });
		});
	});

	describe('a glow on each output', () => {
		const glow = { color: '#ff51c7', size: 20, opacity: 0.5 };

		it('paints a CSS drop-shadow at its colour and opacity, and white at that opacity in the Key Output', () => {
			expect(glowDropShadow('fill', glow)).toBe('drop-shadow(0 0 20px #ff51c780)');
			expect(glowDropShadow('key', glow)).toBe('drop-shadow(0 0 20px #ffffff80)');
		});

		it('paints an SVG drop-shadow flood the same way, its blur half the CSS radius', () => {
			expect(glowFlood('overlay', glow)).toEqual({ stdDeviation: 10, floodColor: '#ff51c7', floodOpacity: 0.5 });
			expect(glowFlood('key', glow)).toEqual({ stdDeviation: 10, floodColor: '#ffffff', floodOpacity: 0.5 });
		});

		it('paints nothing for a glow without size or opacity', () => {
			for (const off of [
				undefined,
				{ ...glow, size: 0 },
				{ ...glow, opacity: 0 },
			]) {
				expect(glowDropShadow('key', off)).toBeUndefined();
				expect(glowFlood('key', off)).toBeUndefined();
			}
		});
	});
});

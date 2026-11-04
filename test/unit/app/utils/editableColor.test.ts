import { describe, expect, it } from 'vitest';
import { formatEditableColor, parseEditableColor } from '~~/app/utils/editableColor';

// A stored colour comes apart into an opaque hex and its alpha, and goes back
// together as hex when opaque and `rgba()` otherwise, alpha to 2 decimals.

describe('an editable colour', () => {
	it.each([
		[
			'#abc',
			{ hex: '#aabbcc', alpha: 1 },
		],
		[
			'#A1B2C3',
			{ hex: '#a1b2c3', alpha: 1 },
		],
		[
			'#11223380',
			{ hex: '#112233', alpha: 0.5 },
		],
		[
			'rgb(1, 2, 3)',
			{ hex: '#010203', alpha: 1 },
		],
		[
			'rgba(255, 0, 16, 0.25)',
			{ hex: '#ff0010', alpha: 0.25 },
		],
		[
			'rgba(300, 0, 0, 2)',
			{ hex: '#ff0000', alpha: 1 },
		],
	])('parses %s', (css, parsed) => {
		expect(parseEditableColor(css)).toEqual(parsed);
	});

	it.each([
		'red',
		'hsl(10 20% 30%)',
		'linear-gradient(red, blue)',
		'#12',
		'',
	])('cannot take apart %j', (css) => {
		expect(parseEditableColor(css)).toBeNull();
	});

	it.each([
		[
			{ hex: '#A1B2C3', alpha: 1 },
			'#a1b2c3',
		],
		[
			{ hex: '#a1b2c3', alpha: 0.996 },
			'#a1b2c3',
		],
		[
			{ hex: '#a1b2c3', alpha: 0.994 },
			'rgba(161, 178, 195, 0.99)',
		],
		[
			{ hex: '#000000', alpha: 0 },
			'rgba(0, 0, 0, 0)',
		],
		[
			{ hex: '#ff0000', alpha: 0.123 },
			'rgba(255, 0, 0, 0.12)',
		],
	])('formats %j as %s', (color, css) => {
		expect(formatEditableColor(color)).toBe(css);
	});
});

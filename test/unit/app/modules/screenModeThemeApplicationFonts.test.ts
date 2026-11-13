import { describe, expect, it } from 'vitest';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { ASSET } from '~~/test/helpers/graphicsComposition';
import { screenModeThemeApplicationFonts } from '~/modules/screen-mode';

// A Screen host waits for the application faces its Theme's `heading` and `body` paint
// in, at the token's weight; a library font is the library path's to wait for.

describe('screenModeThemeApplicationFonts', () => {
	it.each([
		{
			row: 'application fonts at their token weights',
			theme: {
				heading: {
					...FOUNDATION_TOKENS.heading.default,
					font: { kind: 'application', fontId: 'poppins' },
					weight: 600,
				},
			},
			faces: [
				{ fontId: 'poppins', weight: 600, style: 'normal' },
				{ fontId: FOUNDATION_TOKENS.body.default.font.fontId, weight: FOUNDATION_TOKENS.body.default.weight, style: 'normal' },
			],
		},
		{
			row: 'a library font',
			theme: {
				body: {
					...FOUNDATION_TOKENS.body.default,
					font: { kind: 'asset', reference: ASSET },
				},
			},
			faces: [
				{ fontId: FOUNDATION_TOKENS.heading.default.font.fontId, weight: FOUNDATION_TOKENS.heading.default.weight, style: 'normal' },
			],
		},
	])('$row', ({ theme, faces }) => {
		expect(screenModeThemeApplicationFonts('standings', theme, {})).toEqual(faces);
	});
});

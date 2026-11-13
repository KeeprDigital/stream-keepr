import { describe, expect, it } from 'vitest';
import { APPLICATION_FONTS_OPTIONS, applicationFontFamilies, dropFontAssetsFromManifest } from '~~/build/applicationFonts';
import { GRAPHIC_FONTS } from '~~/shared/modules/graphics/typography';

describe('the application font families Nuxt Fonts packages', () => {
	// One family per packaged definition, in registry order; a system stack names no package and is never asked.
	it('names exactly the packaged definitions\' families', () => {
		expect(applicationFontFamilies().map(family => family.name))
			.toEqual(GRAPHIC_FONTS.flatMap(font => (font.package
				? [font.package.family]
				: [])));
	});

	it.each([
		{ family: 'Inter', asked: 'normal italic' },
		{ family: 'Oswald', asked: 'normal' },
	])('$family is asked for with styles \'$asked\'', ({ family, asked }) => {
		const [packaged] = applicationFontFamilies().filter(candidate => candidate.name === family);

		expect(packaged?.styles.join(' ')).toBe(asked);
	});
});

// The offline guarantee (ADR-0086): one provider, the npm one, and never its CDN.
it('packages application fonts from disk only', () => {
	expect(APPLICATION_FONTS_OPTIONS.provider).toBe('npm');
	expect(APPLICATION_FONTS_OPTIONS.npm.remote).toBe(false);
});

// Fonts load through the stylesheet's `@font-face`; a manifest entry only repeats each file in every chunk's dependencies.
it('drops font files from the build manifest and keeps every other asset', () => {
	const manifest = {
		'app.vue': {
			file: 'entry.js',
			resourceType: 'script',
			assets: ['fonts/a.woff2', 'logo.svg'],
		},
		'fonts/a.woff2': { file: 'fonts/a.woff2', resourceType: 'font' },
		'logo.svg': { file: 'logo.svg', resourceType: 'image' },
	};

	dropFontAssetsFromManifest(manifest);

	expect(manifest).toEqual({
		'app.vue': {
			file: 'entry.js',
			resourceType: 'script',
			assets: ['logo.svg'],
		},
		'logo.svg': { file: 'logo.svg', resourceType: 'image' },
	});
});

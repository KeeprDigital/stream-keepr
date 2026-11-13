import { describe, expect, it } from 'vitest';
import { applicationFontFamilies } from '~~/build/applicationFonts';
import { getGraphicFontDefinition } from '~~/shared/modules/graphics/typography';

// Nuxt Fonts asks a package for each style its family ships, and for nothing a system stack names.
describe('the application font families Nuxt Fonts packages', () => {
	it.each([
		{ id: 'inter', asked: 'normal italic' },
		{ id: 'oswald', asked: 'normal' },
		{ id: 'system-sans', asked: '' },
	])('$id is asked for with styles \'$asked\'', ({ id, asked }) => {
		const definition = getGraphicFontDefinition(id)!;
		const name = definition.package?.family ?? definition.label;
		const families = applicationFontFamilies().filter(family => family.name === name);

		expect(families.map(family => family.styles.join(' ')).join('|')).toBe(asked);
	});
});

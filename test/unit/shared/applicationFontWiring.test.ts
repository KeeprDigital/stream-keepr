import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRAPHIC_FONTS } from '~~/shared/modules/graphics/typography';

// The registry names packages; package.json must install each at an exact version.
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
	dependencies: Record<string, string>;
};
const packages = GRAPHIC_FONTS.flatMap(font => (font.package
	? [font.package]
	: []));

describe('application font packaging', () => {
	it('installs every packaged family at an exact version', () => {
		for (const { name } of packages)
			expect(manifest.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('names every @fontsource dependency from exactly one definition', () => {
		const installed = Object.keys(manifest.dependencies).filter(name => name.startsWith('@fontsource/'));
		for (const name of installed)
			expect(packages.filter(pkg => pkg.name === name), name).toHaveLength(1);
	});
});

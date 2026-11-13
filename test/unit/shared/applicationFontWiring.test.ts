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

	// `cssFamily` names `--font-<id>`; the stylesheet must declare it as the registry's stack, and only the UI roles besides.
	it('declares in :root a --font-<id> of every definition\'s stack, and no other font property but the UI roles', () => {
		const root = /:root\s*\{([^}]*)\}/.exec(readFileSync('app/assets/css/main.css', 'utf8'))![1]!;
		const roles = ['--font-display', '--font-body', '--font-mono'];
		const declared: Record<string, string> = {};
		for (const [, name, value] of root.matchAll(/(--font-[\w-]+):([^;]+);/g)) {
			if (!roles.includes(name!))
				declared[name!] = value!.trim();
		}

		expect(declared).toEqual(Object.fromEntries(GRAPHIC_FONTS.map(font => [`--font-${font.id}`, font.stack])));
	});
});

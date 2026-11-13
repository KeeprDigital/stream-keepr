import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	assertBuiltFonts,
	findFontDefects,
	parseFontFaces,
} from '../../../scripts/assert-built-fonts.mjs';

/** Built CSS is minified, one rule per weight x style x subset; these write it the same way. */
function face(family: string, weight: string, style = 'normal', src = 'url(./fonts/a.woff2)format("woff2")') {
	return `@font-face{font-family:${family};src:${src};font-display:swap;font-weight:${weight};font-style:${style}}`;
}

const inter = {
	family: 'Inter',
	weights: [400, 800],
	italic: true,
};
const interFaces = [
	face('Inter', '400'),
	face('Inter', '800'),
	face('Inter', '400', 'italic'),
	face('Inter', '800', 'italic'),
];
const without = (omit: string) => interFaces.filter(rule => !rule.includes(omit));

function defects(css: string[], expected: typeof inter[], forbidden: string[] = []) {
	return findFontDefects(parseFontFaces(css.join('')), expected, forbidden);
}

describe('findFontDefects', () => {
	it.each([
		{
			name: 'complete',
			css: interFaces,
			expected: [inter],
			found: [],
		},
		{
			name: 'weight dropped',
			css: without('font-weight:800;font-style:normal'),
			expected: [inter],
			found: [/^font-face-missing: Inter 800 normal/],
		},
		{
			name: 'italic dropped',
			css: without('font-weight:400;font-style:italic'),
			expected: [inter],
			found: [/^font-face-missing: Inter 400 italic/],
		},
		{
			name: 'no italic declared',
			css: [
				face('Oswald', '400'),
				face('Oswald', '700'),
			],
			expected: [
				{
					family: 'Oswald',
					weights: [400, 700],
					italic: false,
				},
			],
			found: [],
		},
		{
			name: 'range face',
			css: [
				face('Inter', '100 900'),
				face('Inter', '100 900', 'italic'),
			],
			expected: [
				{
					...inter,
					weights: [100, 500, 900],
				},
			],
			found: [],
		},
		{
			name: 'remote src',
			css: [
				...interFaces,
				face('Inter', '400', 'normal', 'url(https://fonts.gstatic.com/x.woff2)format("woff2")'),
			],
			expected: [inter],
			found: [/^font-remote-url: .*fonts\.gstatic\.com/],
		},
		{
			name: 'protocol-relative src',
			css: [
				...interFaces,
				face('Inter', '400', 'normal', 'url(//cdn.example/x.woff2)'),
			],
			expected: [inter],
			found: [/^font-remote-url/],
		},
		{
			name: 'local source',
			css: [
				...without('font-weight:400;font-style:normal'),
				face('Inter', '400', 'normal', 'local(Inter),url(./fonts/a.woff2)format("woff2")'),
			],
			expected: [inter],
			found: [/^font-local-source: Inter 400-400 normal/],
		},
		{
			name: 'fallback face',
			css: [...interFaces, '@font-face{font-family:Inter Fallback\\: Arial;src:local(Arial);size-adjust:107%;ascent-override:90%}'],
			expected: [inter],
			found: [],
		},
		{
			name: 'quoted family',
			css: interFaces.map(rule => rule.replace('Inter', '"Inter"')),
			expected: [inter],
			found: [],
		},
		{
			name: 'forbidden family',
			css: [
				...interFaces,
				face('"MPlantin"', '400'),
			],
			expected: [inter],
			forbidden: ['MPlantin'],
			found: [/^font-forbidden-family: MPlantin/],
		},
		{
			name: 'forbidden family in another case',
			css: [
				...interFaces,
				face('mplantin', '400'),
			],
			expected: [inter],
			forbidden: ['MPlantin'],
			found: [/^font-forbidden-family: mplantin/],
		},
	])('$name', ({ css, expected, forbidden, found }) => {
		const actual = defects(css, expected, forbidden);
		expect(actual).toHaveLength(found.length);
		found.forEach((pattern, index) => expect(actual[index]).toMatch(pattern));
	});
});

describe('assertBuiltFonts', () => {
	const directories: string[] = [];
	afterEach(() => {
		for (const root of directories.splice(0))
			rmSync(root, { recursive: true, force: true });
	});
	function build(files: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), 'stream-keepr-font-scan-'));
		directories.push(root);
		for (const [relative, contents] of Object.entries(files)) {
			mkdirSync(dirname(join(root, relative)), { recursive: true });
			writeFileSync(join(root, relative), contents);
		}
		return root;
	}

	it('finds a defect in a stylesheet under a subdirectory', () => {
		const root = build({
			'_nuxt/entry.css': without('font-weight:800;font-style:normal').join(''),
			'index.html': '',
		});

		expect(assertBuiltFonts(root, [inter])).toEqual([
			expect.stringMatching(/^font-face-missing: Inter 800 normal/),
		]);
	});

	it('finds a built file named for a forbidden family', () => {
		const root = build({
			'_nuxt/entry.css': interFaces.join(''),
			'_nuxt/mplantin.B1c2d3.woff': '',
		});

		expect(assertBuiltFonts(root, [inter], ['MPlantin'])).toEqual([
			expect.stringMatching(/^font-forbidden-family: .*mplantin\.B1c2d3\.woff/),
		]);
	});

	it('finds a remote @import in any stylesheet', () => {
		const root = build({
			'_nuxt/entry.css': interFaces.join(''),
			'_nuxt/page.css': '@import url("https://fonts.googleapis.com/css2?family=Inter");',
		});

		expect(assertBuiltFonts(root, [inter])).toEqual([
			expect.stringMatching(/^font-remote-url: .*page\.css imports https:\/\/fonts\.googleapis\.com/),
		]);
	});

	it('refuses a directory with no stylesheet', () => {
		expect(() => assertBuiltFonts(build({ 'index.html': '' }), [inter])).toThrow(/^font-nothing-scanned/);
	});
});

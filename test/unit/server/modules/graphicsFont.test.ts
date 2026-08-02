import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { processStaticFont } from '~~/server/modules/graphics-asset-library/font';
import {
	macintoshCmapLanguage,
	withCmapLanguages,
} from '../../../../scripts/graphics-acceptance/font-cmap-variants.mjs';

// Specimen thumbnails are hundreds of kilobytes, so deep-equalling them
// element by element dominates these tests. Compare their digests instead:
// identical bytes, one comparison.
function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

describe('the static-font-v1 Graphic Asset Compatibility Profile', () => {
	it.each([
		['TTF', 'public/fonts/mana.ttf', 'font/ttf', 'ttf'],
		['WOFF', 'public/fonts/mplantin.woff', 'font/woff', 'woff'],
		['WOFF2', 'public/fonts/mana.woff2', 'font/woff2', 'woff2'],
		['OTF', 'node_modules/mana-font/docs/fonts/beleren.otf', 'font/otf', 'otf'],
	] as const)('accepts one bounded static outline %s face', async (_, path, mime, format) => {
		const bytes = new Uint8Array(await readFile(path));
		const processed = await processStaticFont(bytes, {
			sourceFileName: path,
			declaredMime: mime,
		});

		expect(processed.report).toMatchObject({
			outcome: 'accepted',
			compatibilityProfile: 'static-font-v1',
			issues: [],
			facts: {
				kind: 'font',
				format,
				canonicalMime: mime,
				byteLength: bytes.byteLength,
				glyphCount: expect.any(Number),
				unicodeCodePoints: expect.arrayContaining([48]),
				style: expect.stringMatching(/^(normal|italic)$/),
			},
		});
		expect(processed.report.facts.glyphCount).toBeGreaterThan(0);
		expect(processed.thumbnail.slice(0, 8)).toEqual(
			Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
		);
		const reprocessed = await processStaticFont(bytes, {
			sourceFileName: path,
			declaredMime: mime,
		});
		expect(digestOf(reprocessed.thumbnail)).toBe(digestOf(processed.thumbnail));
	});

	it.each([
		['collection', Uint8Array.of(0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0), 'font-collection-not-supported'],
		['EOT', Uint8Array.of(8, 0, 0, 0, 0x4C, 0x50, 0, 0), 'unsupported-font-format'],
		['SVG', new TextEncoder().encode('<svg><font /></svg>'), 'font-svg-not-supported'],
		['malformed sfnt', Uint8Array.of(0, 1, 0, 0, 0, 1), 'font-table-invalid'],
	] as const)('rejects %s with a stable report code', async (_, bytes, code) => {
		await expect(processStaticFont(bytes, {})).rejects.toMatchObject({
			issue: { code },
		});
	});

	it('rejects conflicting declarations without trying fallback formats', async () => {
		const bytes = new Uint8Array(await readFile('public/fonts/mana.ttf'));
		await expect(processStaticFont(bytes, {
			sourceFileName: 'mana.woff',
			declaredMime: 'font/woff',
		})).rejects.toMatchObject({
			issue: { code: 'conflicting-font-extension' },
		});
	});

	it.each([
		['variable', 'fvar', 'font-variable-not-supported'],
		['bitmap', 'EBDT', 'font-bitmap-not-supported'],
		['colour glyph', 'COLR', 'font-colour-glyphs-not-supported'],
	] as const)('rejects %s tables with a stable code', async (_, replacementTag, code) => {
		const bytes = new Uint8Array(await readFile('public/fonts/mana.ttf'));
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const tableCount = view.getUint16(4);
		let replaced = false;
		for (let index = 0; index < tableCount; index++) {
			const offset = 12 + index * 16;
			const tag = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
			if (tag !== 'gasp')
				continue;
			bytes.set(new TextEncoder().encode(replacementTag), offset);
			replaced = true;
			break;
		}
		expect(replaced).toBe(true);
		await expect(processStaticFont(bytes, {
			sourceFileName: 'unsupported.ttf',
			declaredMime: 'font/ttf',
		})).rejects.toMatchObject({ issue: { code } });
	});

	it('enforces source and expanded SFNT size limits independently', async () => {
		const oversizedSource = new Uint8Array(10 * 1024 * 1024 + 1);
		await expect(processStaticFont(oversizedSource, {})).rejects.toMatchObject({
			issue: { code: 'font-source-size-exceeded' },
		});

		const woff = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
		new DataView(woff.buffer, woff.byteOffset, woff.byteLength)
			.setUint32(16, 32 * 1024 * 1024 + 1);
		await expect(processStaticFont(woff, {
			sourceFileName: 'expanded.woff',
			declaredMime: 'font/woff',
		})).rejects.toMatchObject({
			issue: { code: 'font-expanded-size-exceeded' },
		});

		const oversizedTable = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
		new DataView(oversizedTable.buffer, oversizedTable.byteOffset, oversizedTable.byteLength)
			.setUint32(44 + 12, 32 * 1024 * 1024);
		await expect(processStaticFont(oversizedTable, {
			sourceFileName: 'expanded-table.woff',
			declaredMime: 'font/woff',
		})).rejects.toMatchObject({
			issue: { code: 'font-expanded-size-exceeded' },
		});

		const woff2 = new Uint8Array(await readFile('public/fonts/mana.woff2'));
		new DataView(woff2.buffer, woff2.byteOffset, woff2.byteLength)
			.setUint32(16, 32 * 1024 * 1024 + 1);
		await expect(processStaticFont(woff2, {
			sourceFileName: 'expanded.woff2',
			declaredMime: 'font/woff2',
		})).rejects.toMatchObject({
			issue: { code: 'font-expanded-size-exceeded' },
		});
	});

	async function processTtf(bytes: Uint8Array) {
		return await processStaticFont(bytes, {
			sourceFileName: 'mplantin.ttf',
			declaredMime: 'font/ttf',
		});
	}

	/**
	 * The bundled MPlantin TTF, which no browser will load (#153).
	 *
	 * Its Microsoft-platform `(3, 1)` cmap subtable declares language 1, which a font
	 * sanitiser fails the whole table for — "Languages should be 0 (1)", then "cmap:
	 * Failed to parse table" — surfacing to script as `SyntaxError: Invalid font data
	 * in ArrayBuffer`. Every server-side check the profile ran passed, because none of
	 * them looked inside a cmap subtable, and `fontkitten` reads the coverage out of
	 * one perfectly happily.
	 *
	 * This face was the profile's *valid* TTF fixture until #153. Treating bytes no
	 * browser can load as the reference for "accepted" is the exact failure #28
	 * names: a font that would silently fall back, accepted.
	 */
	it('rejects the bundled MPlantin TTF, whose Microsoft cmap subtable no browser will parse', async () => {
		const bytes = new Uint8Array(await readFile('public/fonts/mplantin.ttf'));

		await expect(processTtf(bytes)).rejects.toMatchObject({
			issue: { code: 'font-cmap-language-invalid' },
		});
	});

	/**
	 * The platform split, which is the whole of this rule.
	 *
	 * On the Macintosh platform OpenType *defines* a format 0/4/6 subtable's
	 * `language` as the Mac language ID plus one, so a non-zero value is legal there
	 * and a sanitiser only warns: "cmap: language id should be zero: 1". Only the
	 * Microsoft-platform line, "cmap: Languages should be 0 (1)", is fatal. Reading
	 * both lines as one rule refused fonts that load and render perfectly well.
	 *
	 * Driven through real Chromium from `public/fonts/mplantin.ttf`, restating only
	 * the named subtable's language and fixing the checksum:
	 *
	 * | variant       | (1, 0) fmt 0 | (3, 1) fmt 4 | `FontFace.load()`      |
	 * | ------------- | ------------ | ------------ | ---------------------- |
	 * | original      | 1            | 1            | refused                |
	 * | ms-lang-only  | 0            | 1            | refused                |
	 * | mac-lang-only | 1            | 0            | loaded, glyphs render  |
	 * | both-zero     | 0            | 0            | loaded, glyphs render  |
	 *
	 * The bundled face is rejected by both the broad rule and this one, so it cannot
	 * tell them apart on its own — which is why the accepted case is pinned here, and
	 * why `mac-lang-only` is also a face the browser acceptance harness loads and
	 * renders for real.
	 */
	it('accepts a Macintosh-platform cmap language, which OpenType defines there', async () => {
		const source = new Uint8Array(await readFile('public/fonts/mplantin.ttf'));

		const accepted = await processTtf(withCmapLanguages(source, macintoshCmapLanguage));

		expect(accepted.report).toMatchObject({ outcome: 'accepted', issues: [] });
	});

	it('rejects a Microsoft-platform cmap language even when every other subtable is zero', async () => {
		const source = new Uint8Array(await readFile('public/fonts/mplantin.ttf'));

		await expect(processTtf(
			withCmapLanguages(source, platform => (platform === 3 ? 1 : 0)),
		)).rejects.toMatchObject({
			issue: { code: 'font-cmap-language-invalid' },
		});
	});

	it('accepts the same face once every cmap language is zero', async () => {
		// Guards the helper as much as the rule: if restating the languages did not
		// really change what the profile reads, the rejections above would prove
		// nothing. It also settles the other complaint the sanitiser logs about this
		// file — a wrong `rangeShift`, which it corrects and warns about rather than
		// refusing, and which the profile therefore has no reason to enforce.
		const source = new Uint8Array(await readFile('public/fonts/mplantin.ttf'));

		const accepted = await processTtf(withCmapLanguages(source, () => 0));

		expect(accepted.report).toMatchObject({ outcome: 'accepted', issues: [] });
	});

	it('reads the parsed cmap, so a WOFF2 is covered by the same rule', async () => {
		// A WOFF2's cmap lives inside a Brotli stream nothing in the validator
		// decodes, so a rule reading source bytes could not see it at all.
		const accepted = await processStaticFont(
			new Uint8Array(await readFile('public/fonts/mana.woff2')),
			{ sourceFileName: 'mana.woff2', declaredMime: 'font/woff2' },
		);
		expect(accepted.report.outcome).toBe('accepted');

		// Every subtable of the TTF build of this face shares one offset, so one
		// write states them all — including its Microsoft-platform one.
		const ttf = withCmapLanguages(
			new Uint8Array(await readFile('public/fonts/mana.ttf')),
			() => 1,
		);

		await expect(processStaticFont(ttf, {
			sourceFileName: 'mana.ttf',
			declaredMime: 'font/ttf',
		})).rejects.toMatchObject({
			issue: { code: 'font-cmap-language-invalid' },
		});
	});

	it('renders deterministic parsed glyph outlines rather than metric bars', async () => {
		const mana = await processStaticFont(
			new Uint8Array(await readFile('public/fonts/mana.ttf')),
			{ sourceFileName: 'mana.ttf', declaredMime: 'font/ttf' },
		);
		const beleren = await processStaticFont(
			new Uint8Array(await readFile('node_modules/mana-font/docs/fonts/beleren.otf')),
			{ sourceFileName: 'beleren.otf', declaredMime: 'font/otf' },
		);
		expect(digestOf(mana.thumbnail)).not.toBe(digestOf(beleren.thumbnail));
		expect(mana.report.facts.browserChallenge.codePoints.length).toBeGreaterThan(0);
	});
});

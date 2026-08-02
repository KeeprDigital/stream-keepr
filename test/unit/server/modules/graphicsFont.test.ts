import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { processStaticFont } from '~~/server/modules/graphics-asset-library/font';

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

	/**
	 * The bundled MPlantin TTF, which no browser will load (#153).
	 *
	 * Both of its cmap subtables declare language 1. Chromium's font sanitiser
	 * refuses the whole table for it — "Languages should be 0 (1)", then "cmap:
	 * Failed to parse table" — and `FontFace.load()` throws `SyntaxError: Invalid
	 * font data in ArrayBuffer`. Every server-side check the profile ran passed,
	 * because none of them looked inside a cmap subtable, and `fontkitten` reads
	 * the coverage out of it perfectly happily.
	 *
	 * This face was the profile's *valid* TTF fixture until #153. Treating bytes no
	 * browser can load as the reference for "accepted" is the exact failure #28
	 * names: a font that would silently fall back, accepted.
	 */
	it('rejects the bundled MPlantin TTF, whose cmap subtables no browser will parse', async () => {
		const bytes = new Uint8Array(await readFile('public/fonts/mplantin.ttf'));

		await expect(processStaticFont(bytes, {
			sourceFileName: 'mplantin.ttf',
			declaredMime: 'font/ttf',
		})).rejects.toMatchObject({
			issue: { code: 'font-cmap-language-invalid' },
		});
	});

	it('rejects a non-zero cmap subtable language in every container format', async () => {
		// The check reads the parsed cmap rather than the source bytes, so a WOFF2
		// whose cmap is inside a Brotli stream is covered by the same rule.
		const bytes = new Uint8Array(await readFile('public/fonts/mana.woff2'));
		const accepted = await processStaticFont(bytes, {
			sourceFileName: 'mana.woff2',
			declaredMime: 'font/woff2',
		});
		expect(accepted.report.outcome).toBe('accepted');

		const ttf = new Uint8Array(await readFile('public/fonts/mana.ttf'));
		const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
		const tableCount = view.getUint16(4);
		let cmapEntry: number | undefined;
		for (let index = 0; index < tableCount; index++) {
			const entry = 12 + index * 16;
			if (new TextDecoder().decode(ttf.subarray(entry, entry + 4)) === 'cmap')
				cmapEntry = entry;
		}
		if (cmapEntry === undefined)
			throw new Error('Expected a cmap table');
		const cmapOffset = view.getUint32(cmapEntry + 8);
		const cmapLength = view.getUint32(cmapEntry + 12);
		// Every subtable of this face shares one offset, so one write states them all.
		view.setUint16(cmapOffset + view.getUint32(cmapOffset + 8) + 4, 1);
		// Restated so the profile's own table checksum still agrees; otherwise the
		// directory refuses the edit before anything reads the cmap.
		let sum = 0;
		for (let index = 0; index < Math.ceil(cmapLength / 4) * 4; index += 4)
			sum = (sum + view.getUint32(cmapOffset + index)) >>> 0;
		view.setUint32(cmapEntry + 4, sum);

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

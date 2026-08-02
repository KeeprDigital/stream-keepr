/**
 * Restating a font's cmap subtable languages, shared by the two sides that have
 * to agree about it.
 *
 * `static-font-v1` permits a non-zero cmap `language` on the Macintosh platform,
 * where OpenType defines it as the Mac language ID plus one, and refuses one
 * anywhere else. That rule is only worth anything if the bytes the profile
 * accepts server-side are the bytes a browser then loads — so the unit test in
 * `test/unit/server/modules/graphicsFont.test.ts` and the browser acceptance run
 * in `scripts/run-font-browser-acceptance.mjs` build their variants from this one
 * function rather than from two implementations that happen to match today.
 *
 * Two copies would drift silently: nothing compares them, and the pairing would
 * stop meaning anything without a single test failing (#153).
 *
 * Plain ESM with no repository aliases, because one caller is run by `node`
 * directly and the other through Vitest.
 */

/**
 * A copy of `source` with every cmap subtable's language chosen by platform.
 *
 * The table checksum is restated afterwards. It has to be: `static-font-v1`
 * validates the SFNT directory before anything reads a table, so bytes edited
 * without it are refused as `font-checksum-invalid` and prove nothing about the
 * cmap rule they were built to exercise.
 *
 * @param {Uint8Array} source Raw SFNT bytes — a TTF or OTF, not a WOFF wrapper.
 * @param {(platformId: number) => number} languageForPlatform
 * @returns {Uint8Array} A new array; `source` is left untouched.
 */
export function withCmapLanguages(source, languageForPlatform) {
	const bytes = Uint8Array.from(source);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let entry;
	for (let index = 0; index < view.getUint16(4); index++) {
		const candidate = 12 + index * 16;
		if (String.fromCharCode(...bytes.subarray(candidate, candidate + 4)) === 'cmap')
			entry = candidate;
	}
	if (entry === undefined)
		throw new Error('Expected a cmap table');

	const cmap = view.getUint32(entry + 8);
	const length = view.getUint32(entry + 12);
	for (let index = 0; index < view.getUint16(cmap + 2); index++) {
		const record = cmap + 4 + index * 8;
		view.setUint16(cmap + view.getUint32(record + 4) + 4, languageForPlatform(view.getUint16(record)));
	}

	let sum = 0;
	for (let offset = 0; offset < Math.ceil(length / 4) * 4; offset += 4)
		sum = (sum + view.getUint32(cmap + offset)) >>> 0;
	view.setUint32(entry + 4, sum);
	return bytes;
}

/**
 * The one variant both sides name: the bundled MPlantin TTF with its Microsoft
 * subtable's language zeroed and its Macintosh one left at 1.
 *
 * The profile accepts it and a browser loads and renders it, which is the pair of
 * facts the platform exemption rests on — and which the bundled face itself
 * cannot establish, since a rule with or without the exemption rejects that.
 */
export function macintoshCmapLanguage(platformId) {
	return platformId === 1 ? 1 : 0;
}

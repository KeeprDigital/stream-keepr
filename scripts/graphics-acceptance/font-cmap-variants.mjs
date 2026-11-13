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
 * A copy of `source` whose cmap encoding records each own a private subtable.
 *
 * Some fonts (Mana among them) point every record at one shared subtable, so a
 * per-platform language is unrepresentable: `withCmapLanguages` writes once per
 * record and the last platform wins, and a "Macintosh only" variant silently
 * equals the stock font. Splitting first makes each platform's language
 * independent. The rebuilt cmap is appended at the end of the file, 4-byte
 * padded, and its directory entry (offset, length, checksum) is restated so
 * `static-font-v1` still validates the SFNT. A font whose records are already
 * separate keeps the languages it had.
 *
 * @param {Uint8Array} source Raw SFNT bytes — a TTF or OTF, not a WOFF wrapper.
 * @returns {Uint8Array} A new array; `source` is left untouched.
 */
export function withSeparateCmapSubtables(source) {
	const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
	let entry;
	for (let index = 0; index < view.getUint16(4); index++) {
		const candidate = 12 + index * 16;
		if (String.fromCharCode(...source.subarray(candidate, candidate + 4)) === 'cmap')
			entry = candidate;
	}
	if (entry === undefined)
		throw new Error('Expected a cmap table');

	const cmap = view.getUint32(entry + 8);
	const count = view.getUint16(cmap + 2);
	const subtableLength = (offset) => {
		const format = view.getUint16(offset);
		return format >= 8
			? view.getUint32(offset + 4)
			: view.getUint16(offset + 2);
	};

	const records = [];
	let bodyLength = 0;
	for (let index = 0; index < count; index++) {
		const record = cmap + 4 + index * 8;
		const start = cmap + view.getUint32(record + 4);
		const length = subtableLength(start);
		const padded = Math.ceil(length / 4) * 4;
		records.push({ record, start, length, padded });
		bodyLength += padded;
	}

	const headerLength = 4 + count * 8;
	const cmapLength = headerLength + bodyLength;
	const base = Math.ceil(source.byteLength / 4) * 4;
	const bytes = new Uint8Array(base + cmapLength);
	bytes.set(source);
	const out = new DataView(bytes.buffer);
	out.setUint16(base, view.getUint16(cmap));
	out.setUint16(base + 2, count);
	let next = headerLength;
	for (const [index, { record, start, length, padded }] of records.entries()) {
		out.setUint16(base + 4 + index * 8, view.getUint16(record));
		out.setUint16(base + 4 + index * 8 + 2, view.getUint16(record + 2));
		out.setUint32(base + 4 + index * 8 + 4, next);
		bytes.set(source.subarray(start, start + length), base + next);
		next += padded;
	}

	let sum = 0;
	for (let offset = 0; offset < cmapLength; offset += 4)
		sum = (sum + out.getUint32(base + offset)) >>> 0;
	out.setUint32(entry + 4, sum);
	out.setUint32(entry + 8, base);
	out.setUint32(entry + 12, cmapLength);
	return bytes;
}

/**
 * The (platform, encoding, subtable offset, language) of every cmap record, for
 * tests that must see what a variant really carries rather than trust how it
 * was built.
 *
 * @param {Uint8Array} source
 * @returns {{ platformId: number, encodingId: number, offset: number, language: number }[]}
 */
export function cmapRecords(source) {
	const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
	let cmap;
	for (let index = 0; index < view.getUint16(4); index++) {
		const candidate = 12 + index * 16;
		if (String.fromCharCode(...source.subarray(candidate, candidate + 4)) === 'cmap')
			cmap = view.getUint32(candidate + 8);
	}
	if (cmap === undefined)
		throw new Error('Expected a cmap table');
	return Array.from({ length: view.getUint16(cmap + 2) }, (_, index) => {
		const record = cmap + 4 + index * 8;
		const offset = view.getUint32(record + 4);
		return {
			platformId: view.getUint16(record),
			encodingId: view.getUint16(record + 2),
			offset,
			language: view.getUint16(cmap + offset + 4),
		};
	});
}

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
 * The variant both sides name for the Macintosh exemption: the bundled Mana TTF,
 * subtables split per platform, Microsoft's language zeroed and Macintosh's left
 * at 1. Mana's records share one subtable, so it is split first.
 *
 * The profile accepts it and a browser loads and renders it, which is the pair of
 * facts the platform exemption rests on — and which the refused face cannot
 * establish, since a rule with or without the exemption rejects that.
 */
export function macintoshCmapLanguage(platformId) {
	return platformId === 1
		? 1
		: 0;
}

/**
 * Language 1 on every platform but Unicode: the subtables a browser refuses.
 *
 * `public/fonts/mana-cmap-language.ttf` is the split `mana.ttf` run through
 * this, so the committed refused face and the unit test's derivation cannot
 * drift apart.
 */
export function refusedCmapLanguage(platformId) {
	return platformId === 0
		? 0
		: 1;
}

import type {
	GraphicAssetFontFacts,
	GraphicAssetSourceDeclarations,
	GraphicAssetValidationReport,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { create as createFont } from 'fontkitten';
import {
	MAX_STATIC_FONT_EXPANDED_BYTES,
	MAX_STATIC_FONT_INGESTION_BYTES,
	STATIC_FONT_COMPATIBILITY_PROFILE,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { encodeThumbnail, sha256Hex } from './png';
import { validationError } from './validation';

const MIME_BY_FORMAT = {
	woff2: 'font/woff2',
	woff: 'font/woff',
	ttf: 'font/ttf',
	otf: 'font/otf',
} as const;

type StaticFontFormat = keyof typeof MIME_BY_FORMAT;
interface FontPathCommand {
	command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
	args: number[];
}

interface ParsedGlyph {
	id: number;
	advanceWidth: number;
	path: { commands: FontPathCommand[] };
}

type ParsedFont = Exclude<ReturnType<typeof createFont>, { isCollection: true }> & {
	directory?: {
		totalSfntSize?: number;
		tables?: Record<string, {
			offset?: number;
			length?: number;
			compLength?: number;
			checkSum?: number;
			origChecksum?: number;
		}>;
	};
	cmap?: {
		tables?: Array<{
			platformID?: number;
			encodingID?: number;
			table?: { version?: number; language?: number };
		}>;
	};
	glyphForCodePoint: (codePoint: number) => ParsedGlyph;
};

export interface ProcessedStaticFont {
	report: Extract<GraphicAssetValidationReport, { outcome: 'accepted'; facts: GraphicAssetFontFacts }>;
	thumbnail: Uint8Array;
}

function signature(bytes: Uint8Array): StaticFontFormat {
	if (bytes.byteLength >= 4) {
		const tag = String.fromCharCode(...bytes.subarray(0, 4));
		if (tag === 'wOF2')
			return 'woff2';
		if (tag === 'wOFF')
			return 'woff';
		if (tag === 'OTTO')
			return 'otf';
		if (tag === 'ttcf')
			validationError('font-collection-not-supported', 'Font collections are not supported.');
		if (tag === 'true' || (
			bytes[0] === 0
			&& bytes[1] === 1
			&& bytes[2] === 0
			&& bytes[3] === 0
		)) {
			return 'ttf';
		}
	}
	const sourceStart = new TextDecoder().decode(bytes.subarray(0, Math.min(64, bytes.byteLength))).trimStart();
	if (/^<\??(?:xml|svg)|^<svg/i.test(sourceStart))
		validationError('font-svg-not-supported', 'SVG fonts are not supported.');
	if (sourceStart.startsWith('%!PS'))
		validationError('font-type1-not-supported', 'Type 1 fonts are not supported.');
	validationError('unsupported-font-format', 'Font must be WOFF2, WOFF, TTF, or OTF.');
}

function validateDeclarations(
	format: StaticFontFormat,
	declarations: GraphicAssetSourceDeclarations,
) {
	const extension = declarations.sourceFileName?.match(/\.([^.]+)$/)?.[1]?.toLocaleLowerCase();
	if (extension && extension !== format) {
		validationError(
			'conflicting-font-extension',
			`Source extension .${extension} conflicts with inspected ${format.toUpperCase()} bytes.`,
		);
	}
	const declaredMime = declarations.declaredMime?.split(';', 1)[0]?.trim().toLocaleLowerCase();
	const acceptedMimes = format === 'ttf'
		? ['font/ttf', 'application/x-font-ttf']
		: format === 'otf'
			? ['font/otf', 'application/x-font-opentype']
			: [MIME_BY_FORMAT[format], `application/font-${format}`];
	if (declaredMime && !acceptedMimes.includes(declaredMime)) {
		validationError(
			'conflicting-font-mime',
			`Declared MIME ${declaredMime} conflicts with inspected ${format.toUpperCase()} bytes.`,
		);
	}
}

function uint16(bytes: Uint8Array, offset: number) {
	return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function uint32(bytes: Uint8Array, offset: number) {
	return (
		(bytes[offset]! * 0x1000000)
		+ (bytes[offset + 1]! << 16)
		+ (bytes[offset + 2]! << 8)
		+ bytes[offset + 3]!
	) >>> 0;
}

function checksum(bytes: Uint8Array, offset: number, length: number, zeroChecksumAdjustment = false) {
	let sum = 0;
	const paddedLength = Math.ceil(length / 4) * 4;
	for (let index = 0; index < paddedLength; index += 4) {
		let word = 0;
		for (let byte = 0; byte < 4; byte++) {
			const sourceIndex = offset + index + byte;
			const value = sourceIndex < offset + length
				? (zeroChecksumAdjustment && index + byte >= 8 && index + byte < 12
						? 0
						: bytes[sourceIndex]!)
				: 0;
			word = ((word << 8) | value) >>> 0;
		}
		sum = (sum + word) >>> 0;
	}
	return sum;
}

function validateRawSfntDirectory(bytes: Uint8Array) {
	if (bytes.byteLength < 12)
		validationError('font-table-invalid', 'SFNT header is incomplete.');
	const tableCount = uint16(bytes, 4);
	if (tableCount === 0 || tableCount > 256 || 12 + tableCount * 16 > bytes.byteLength)
		validationError('font-table-invalid', 'SFNT table directory is malformed.');
	const occupied: Array<{ start: number; end: number }> = [];
	for (let index = 0; index < tableCount; index++) {
		const entry = 12 + index * 16;
		const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));
		const expectedChecksum = uint32(bytes, entry + 4);
		const offset = uint32(bytes, entry + 8);
		const length = uint32(bytes, entry + 12);
		if (length === 0 || offset > bytes.byteLength || length > bytes.byteLength - offset)
			validationError('font-table-invalid', `Font table ${tag} has invalid offsets or lengths.`);
		const end = offset + Math.ceil(length / 4) * 4;
		if (end > bytes.byteLength)
			validationError('font-table-invalid', `Font table ${tag} padding exceeds the source.`);
		if (occupied.some(range => offset < range.end && end > range.start))
			validationError('font-table-invalid', `Font table ${tag} overlaps another table.`);
		occupied.push({ start: offset, end });
		if (
			checksum(bytes, offset, length) !== expectedChecksum
			&& (tag !== 'head' || checksum(bytes, offset, length, true) !== expectedChecksum)
		) {
			validationError('font-checksum-invalid', `Font table ${tag} checksum is invalid.`);
		}
	}
}

function requireExpandedLimit(byteLength: number) {
	if (!Number.isSafeInteger(byteLength) || byteLength <= 0)
		validationError('font-table-invalid', 'Expanded font length is missing or malformed.');
	if (byteLength > MAX_STATIC_FONT_EXPANDED_BYTES) {
		validationError(
			'font-expanded-size-exceeded',
			`Expanded font data must not exceed ${MAX_STATIC_FONT_EXPANDED_BYTES} bytes.`,
		);
	}
	return byteLength;
}

async function decompressWoffTable(bytes: Uint8Array, expectedLength: number) {
	try {
		const stream = new Blob([Uint8Array.from(bytes)])
			.stream()
			.pipeThrough(new DecompressionStream('deflate'));
		const reader = stream.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		while (true) {
			const result = await reader.read();
			if (result.done)
				break;
			total += result.value.byteLength;
			if (total > expectedLength || total > MAX_STATIC_FONT_EXPANDED_BYTES) {
				await reader.cancel();
				validationError('font-expanded-size-exceeded', 'WOFF table expands beyond its declared bounded length.');
			}
			chunks.push(result.value);
		}
		if (total !== expectedLength)
			validationError('font-table-invalid', 'WOFF table expanded length does not match its directory.');
		const decompressed = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			decompressed.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return decompressed;
	}
	catch (error) {
		if (error instanceof Error && 'issue' in error)
			throw error;
		validationError('font-table-invalid', 'WOFF table compression stream is malformed.');
	}
}

async function validateWoffDirectory(bytes: Uint8Array) {
	if (bytes.byteLength < 44)
		validationError('font-table-invalid', 'WOFF header is incomplete.');
	if (uint32(bytes, 8) !== bytes.byteLength)
		validationError('font-table-invalid', 'WOFF declared source length is inconsistent.');
	const tableCount = uint16(bytes, 12);
	const declaredSfntSize = requireExpandedLimit(uint32(bytes, 16));
	if (tableCount === 0 || tableCount > 256 || 44 + tableCount * 20 > bytes.byteLength)
		validationError('font-table-invalid', 'WOFF table directory is malformed.');
	const occupied: Array<{ start: number; end: number }> = [];
	let calculatedSfntSize = 12 + tableCount * 16;
	for (let index = 0; index < tableCount; index++) {
		const entry = 44 + index * 20;
		const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));
		const offset = uint32(bytes, entry + 4);
		const compressedLength = uint32(bytes, entry + 8);
		const originalLength = uint32(bytes, entry + 12);
		const expectedChecksum = uint32(bytes, entry + 16);
		if (
			offset % 4 !== 0
			|| compressedLength === 0
			|| originalLength === 0
			|| compressedLength > originalLength
			|| offset > bytes.byteLength
			|| compressedLength > bytes.byteLength - offset
		) {
			validationError('font-table-invalid', `WOFF table ${tag} has invalid offsets or lengths.`);
		}
		calculatedSfntSize += Math.ceil(originalLength / 4) * 4;
		requireExpandedLimit(calculatedSfntSize);
		const end = offset + Math.ceil(compressedLength / 4) * 4;
		if (end > bytes.byteLength || occupied.some(range => offset < range.end && end > range.start))
			validationError('font-table-invalid', `WOFF table ${tag} overlaps another table.`);
		occupied.push({ start: offset, end });
		const source = bytes.subarray(offset, offset + compressedLength);
		const expanded = compressedLength === originalLength
			? source
			: await decompressWoffTable(source, originalLength);
		if (
			checksum(expanded, 0, expanded.byteLength) !== expectedChecksum
			&& (tag !== 'head' || checksum(expanded, 0, expanded.byteLength, true) !== expectedChecksum)
		) {
			validationError('font-checksum-invalid', `WOFF table ${tag} checksum is invalid.`);
		}
	}
	if (calculatedSfntSize !== declaredSfntSize)
		validationError('font-table-invalid', 'WOFF expanded SFNT length does not match its checked table lengths.');
	return declaredSfntSize;
}

function readBase128(bytes: Uint8Array, start: number) {
	let value = 0;
	let offset = start;
	for (let index = 0; index < 5; index++) {
		if (offset >= bytes.byteLength || (index === 0 && bytes[offset] === 0x80))
			validationError('font-table-invalid', 'WOFF2 table directory contains a malformed length.');
		const next = bytes[offset++]!;
		if (value > 0x01FFFFFF)
			validationError('font-table-invalid', 'WOFF2 table length overflows its bounded integer.');
		value = value * 128 + (next & 0x7F);
		if ((next & 0x80) === 0)
			return { value, offset };
	}
	validationError('font-table-invalid', 'WOFF2 table directory contains an overlong length.');
}

const WOFF2_KNOWN_TAGS = [
	'cmap',
	'head',
	'hhea',
	'hmtx',
	'maxp',
	'name',
	'OS/2',
	'post',
	'cvt ',
	'fpgm',
	'glyf',
	'loca',
	'prep',
	'CFF ',
	'VORG',
	'EBDT',
	'EBLC',
	'gasp',
	'hdmx',
	'kern',
	'LTSH',
	'PCLT',
	'VDMX',
	'vhea',
	'vmtx',
	'BASE',
	'GDEF',
	'GPOS',
	'GSUB',
	'EBSC',
	'JSTF',
	'MATH',
	'CBDT',
	'CBLC',
	'COLR',
	'CPAL',
	'SVG ',
	'sbix',
	'acnt',
	'avar',
	'bdat',
	'bloc',
	'bsln',
	'cvar',
	'fdsc',
	'feat',
	'fmtx',
	'fvar',
	'gvar',
	'hsty',
	'just',
	'lcar',
	'mort',
	'morx',
	'opbd',
	'prop',
	'trak',
	'Zapf',
	'Silf',
	'Glat',
	'Gloc',
	'Feat',
	'Sill',
] as const;

function validateWoff2Header(bytes: Uint8Array) {
	if (bytes.byteLength < 48)
		validationError('font-table-invalid', 'WOFF2 header is incomplete.');
	if (uint32(bytes, 8) !== bytes.byteLength)
		validationError('font-table-invalid', 'WOFF2 declared source length is inconsistent.');
	const tableCount = uint16(bytes, 12);
	const compressedLength = uint32(bytes, 20);
	const declaredSfntSize = requireExpandedLimit(uint32(bytes, 16));
	if (
		tableCount === 0
		|| tableCount > 256
		|| compressedLength === 0
		|| compressedLength > bytes.byteLength - 48
	) {
		validationError('font-table-invalid', 'WOFF2 table directory or compressed stream length is malformed.');
	}
	let offset = 48;
	let calculatedSfntSize = 12 + tableCount * 16;
	let transformedStreamSize = 0;
	for (let index = 0; index < tableCount; index++) {
		if (offset >= bytes.byteLength)
			validationError('font-table-invalid', 'WOFF2 table directory is truncated.');
		const flags = bytes[offset++]!;
		const tagIndex = flags & 0x3F;
		let tag = WOFF2_KNOWN_TAGS[tagIndex];
		if (tagIndex === 63) {
			if (offset + 4 > bytes.byteLength)
				validationError('font-table-invalid', 'WOFF2 custom table tag is truncated.');
			tag = String.fromCharCode(...bytes.subarray(offset, offset + 4)) as typeof tag;
			offset += 4;
		}
		const original = readBase128(bytes, offset);
		offset = original.offset;
		if (original.value <= 0)
			validationError('font-table-invalid', 'WOFF2 table length must be positive.');
		calculatedSfntSize += Math.ceil(original.value / 4) * 4;
		requireExpandedLimit(calculatedSfntSize);
		const transformVersion = flags >>> 6;
		const transformed = tag === 'glyf' || tag === 'loca'
			? transformVersion === 0
			: transformVersion !== 0;
		let streamLength = original.value;
		if (transformed) {
			const transform = readBase128(bytes, offset);
			offset = transform.offset;
			streamLength = transform.value;
		}
		transformedStreamSize += streamLength;
		requireExpandedLimit(transformedStreamSize);
	}
	if (calculatedSfntSize !== declaredSfntSize)
		validationError('font-table-invalid', 'WOFF2 expanded SFNT length does not match its checked table lengths.');
	if (offset + compressedLength > bytes.byteLength)
		validationError('font-table-invalid', 'WOFF2 compressed stream exceeds the source bounds.');
	return declaredSfntSize;
}

function expandedByteLength(
	format: StaticFontFormat,
	bytes: Uint8Array,
	font: ParsedFont,
	preflightExpandedByteLength?: number,
) {
	const expanded = format === 'ttf' || format === 'otf'
		? bytes.byteLength
		: font.directory?.totalSfntSize;
	requireExpandedLimit(expanded ?? 0);
	if (preflightExpandedByteLength !== undefined && expanded !== preflightExpandedByteLength)
		validationError('font-table-invalid', 'Decoded SFNT length differs from the bounded preflight length.');
	return expanded!;
}

function validateTables(font: ParsedFont) {
	const tags = new Set(Object.keys(font.directory?.tables ?? {}));
	for (const tag of ['head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'cmap']) {
		if (!tags.has(tag))
			validationError('font-required-table-missing', `Font is missing required ${tag} table.`);
	}
	if (!(tags.has('glyf') && tags.has('loca')) && !tags.has('CFF '))
		validationError('font-required-table-missing', 'Font must contain one TrueType or CFF outline face.');
	if ([...tags].some(tag => ['fvar', 'gvar', 'avar', 'HVAR', 'VVAR', 'MVAR', 'STAT', 'CFF2'].includes(tag)))
		validationError('font-variable-not-supported', 'Variable fonts are not supported.');
	if ([...tags].some(tag => ['CBDT', 'CBLC', 'EBDT', 'EBLC', 'EBSC', 'sbix'].includes(tag)))
		validationError('font-bitmap-not-supported', 'Bitmap fonts and bitmap strikes are not supported.');
	if ([...tags].some(tag => ['COLR', 'CPAL'].includes(tag)))
		validationError('font-colour-glyphs-not-supported', 'Colour-glyph fonts are not supported.');
	if (tags.has('SVG '))
		validationError('font-svg-not-supported', 'SVG glyph tables are not supported.');
}

/** Macintosh, the one cmap platform on which a non-zero language is defined. */
const CMAP_MACINTOSH_PLATFORM = 1;

/**
 * A cmap subtable outside the Macintosh platform must declare language zero.
 *
 * A rule this narrow earns its place because a browser's font sanitiser enforces
 * it as a hard failure of the whole table, and the profile had no other way to see
 * it. Chromium refuses `public/fonts/mplantin.ttf` outright — "cmap: Languages
 * should be 0 (1)", then "cmap: Failed to parse table", surfacing to script as
 * `SyntaxError: Invalid font data in ArrayBuffer` — while every check above it
 * passed, because none of them looked inside a subtable and the parser reads the
 * coverage out of one regardless (#153).
 *
 * The platform exemption is the whole of the rule, not a softening of it. On the
 * Macintosh platform OpenType *defines* a format 0/4/6 subtable's `language` as
 * the Mac language ID plus one, so a non-zero value there is correct, and the
 * sanitiser says so in a different voice: "cmap: language id should be zero: 1" is
 * a warning it continues past. Reading both lines as one rule refuses fonts that
 * load and render — proven by restating each subtable of the bundled face
 * independently and driving all four combinations through real Chromium, where a
 * Macintosh-only language loads and renders its glyphs. See the table in
 * `test/unit/server/modules/graphicsFont.test.ts`.
 *
 * The parsed cmap is read rather than the source bytes so the rule holds for all
 * four accepted containers at once: a WOFF2's cmap is inside a compressed stream
 * that nothing here decodes.
 *
 * It closes one defect, not the class. `static-font-v1` states in its own contract
 * that acceptance needs `FontFace.load()` and representative glyph rendering from
 * a real browser, and that requirement is what covers everything a sanitiser
 * rejects that is not written out here; see `reportWithBrowserDecodeEvidence`,
 * which will not publish a font without it. Why the gate sits there rather than in
 * more rules like this one is recorded in
 * `docs/adr/0005-static-font-v1-server-checks-are-a-floor-and-the-browser-is-the-gate.md`.
 */
function validateCmapSubtables(font: ParsedFont) {
	for (const subtable of font.cmap?.tables ?? []) {
		// Formats carrying no language field (14, the variation-sequence subtable)
		// report none, and there is nothing to check.
		if (
			subtable.platformID !== CMAP_MACINTOSH_PLATFORM
			&& typeof subtable.table?.language === 'number'
			&& subtable.table.language !== 0
		) {
			validationError(
				'font-cmap-language-invalid',
				`Font cmap subtable (${subtable.platformID}, ${subtable.encodingID}) declares language ${subtable.table.language} rather than 0.`,
			);
		}
	}
}

interface Point {
	x: number;
	y: number;
}

function representativeCodePoints(font: ParsedFont, coverage: readonly number[], maximum: number) {
	const preferred = coverage.filter(codePoint =>
		(codePoint >= 48 && codePoint <= 57)
		|| (codePoint >= 65 && codePoint <= 90)
		|| (codePoint >= 97 && codePoint <= 122),
	);
	const candidates = [...preferred, ...coverage.filter(codePoint => !preferred.includes(codePoint))];
	const selected: number[] = [];
	for (const codePoint of candidates) {
		const glyph = font.glyphForCodePoint(codePoint);
		if (
			codePoint > 32
			&& glyph.id !== 0
			&& glyph.path.commands.length > 0
			&& !selected.includes(codePoint)
		) {
			selected.push(codePoint);
		}
		if (selected.length === maximum)
			break;
	}
	if (selected.length === 0)
		validationError('font-glyphs-invalid', 'Font has no renderable glyph outlines in its Unicode mapping.');
	return selected;
}

function curvePoint(
	start: Point,
	controls: readonly Point[],
	end: Point,
	t: number,
): Point {
	const inverse = 1 - t;
	if (controls.length === 1) {
		return {
			x: inverse * inverse * start.x + 2 * inverse * t * controls[0]!.x + t * t * end.x,
			y: inverse * inverse * start.y + 2 * inverse * t * controls[0]!.y + t * t * end.y,
		};
	}
	return {
		x: inverse ** 3 * start.x
			+ 3 * inverse * inverse * t * controls[0]!.x
			+ 3 * inverse * t * t * controls[1]!.x
			+ t ** 3 * end.x,
		y: inverse ** 3 * start.y
			+ 3 * inverse * inverse * t * controls[0]!.y
			+ 3 * inverse * t * t * controls[1]!.y
			+ t ** 3 * end.y,
	};
}

function glyphContours(
	glyph: ParsedGlyph,
	offsetX: number,
	baseline: number,
	scale: number,
) {
	const transform = (x: number, y: number): Point => ({
		x: offsetX + x * scale,
		y: baseline - y * scale,
	});
	const contours: Point[][] = [];
	let contour: Point[] | undefined;
	let current = { x: 0, y: 0 };
	for (const command of glyph.path.commands) {
		if (command.command === 'moveTo') {
			if (contour && contour.length > 1)
				contours.push(contour);
			current = { x: command.args[0]!, y: command.args[1]! };
			contour = [transform(current.x, current.y)];
			continue;
		}
		if (!contour)
			continue;
		if (command.command === 'lineTo') {
			current = { x: command.args[0]!, y: command.args[1]! };
			contour.push(transform(current.x, current.y));
		}
		else if (command.command === 'quadraticCurveTo' || command.command === 'bezierCurveTo') {
			const controls = command.command === 'quadraticCurveTo'
				? [{ x: command.args[0]!, y: command.args[1]! }]
				: [
						{ x: command.args[0]!, y: command.args[1]! },
						{ x: command.args[2]!, y: command.args[3]! },
					];
			const endOffset = command.command === 'quadraticCurveTo' ? 2 : 4;
			const end = { x: command.args[endOffset]!, y: command.args[endOffset + 1]! };
			for (let step = 1; step <= 12; step++) {
				const point = curvePoint(current, controls, end, step / 12);
				contour.push(transform(point.x, point.y));
			}
			current = end;
		}
		else if (command.command === 'closePath') {
			if (contour.length > 1)
				contours.push(contour);
			contour = undefined;
		}
	}
	if (contour && contour.length > 1)
		contours.push(contour);
	return contours;
}

function isInsideGlyph(contours: readonly Point[][], x: number, y: number) {
	let winding = 0;
	for (const contour of contours) {
		for (let index = 0; index < contour.length; index++) {
			const start = contour[index]!;
			const end = contour[(index + 1) % contour.length]!;
			const side = (end.x - start.x) * (y - start.y) - (x - start.x) * (end.y - start.y);
			if (start.y <= y && end.y > y && side > 0)
				winding++;
			else if (start.y > y && end.y <= y && side < 0)
				winding--;
		}
	}
	return winding !== 0;
}

function specimenThumbnail(font: ParsedFont, selected: readonly number[]) {
	const width = 640;
	const height = 180;
	const pixels = new Uint8Array(width * height * 4);
	const glyphs = selected.map(codePoint => font.glyphForCodePoint(codePoint));
	const totalAdvance = glyphs.reduce((sum, glyph) => sum + Math.max(1, glyph.advanceWidth), 0);
	const fontSize = Math.min(
		132,
		(width - 32) * font.unitsPerEm / Math.max(1, totalAdvance),
		(height - 24) * font.unitsPerEm / Math.max(1, font.ascent - font.descent),
	);
	const scale = fontSize / font.unitsPerEm;
	const baseline = height / 2 + ((font.ascent + font.descent) * scale) / 2;
	let cursor = 16;
	for (const glyph of glyphs) {
		const contours = glyphContours(glyph, cursor, baseline, scale);
		const points = contours.flat();
		if (points.length > 0) {
			const left = Math.max(0, Math.floor(Math.min(...points.map(point => point.x))));
			const right = Math.min(width - 1, Math.ceil(Math.max(...points.map(point => point.x))));
			const top = Math.max(0, Math.floor(Math.min(...points.map(point => point.y))));
			const bottom = Math.min(height - 1, Math.ceil(Math.max(...points.map(point => point.y))));
			for (let y = top; y <= bottom; y++) {
				for (let x = left; x <= right; x++) {
					if (!isInsideGlyph(contours, x + 0.5, y + 0.5))
						continue;
					const offset = (y * width + x) * 4;
					pixels[offset] = 255;
					pixels[offset + 1] = 255;
					pixels[offset + 2] = 255;
					pixels[offset + 3] = 255;
				}
			}
		}
		cursor += Math.max(1, glyph.advanceWidth) * scale;
	}
	return encodeThumbnail(width, height, pixels);
}

export async function processStaticFont(
	bytes: Uint8Array,
	declarations: GraphicAssetSourceDeclarations,
): Promise<ProcessedStaticFont> {
	if (bytes.byteLength > MAX_STATIC_FONT_INGESTION_BYTES)
		validationError('font-source-size-exceeded', `Font source must not exceed ${MAX_STATIC_FONT_INGESTION_BYTES} bytes.`);
	const format = signature(bytes);
	validateDeclarations(format, declarations);
	let preflightExpandedByteLength: number | undefined;
	if (format === 'ttf' || format === 'otf')
		validateRawSfntDirectory(bytes);
	else if (format === 'woff')
		preflightExpandedByteLength = await validateWoffDirectory(bytes);
	else
		preflightExpandedByteLength = validateWoff2Header(bytes);

	let parsed: ReturnType<typeof createFont>;
	try {
		parsed = createFont(Buffer.from(bytes));
	}
	catch {
		validationError('font-table-invalid', 'Font tables could not be parsed consistently.');
	}
	if (parsed.isCollection)
		validationError('font-collection-not-supported', 'Font collections are not supported.');
	const font = parsed as ParsedFont;
	validateTables(font);
	validateCmapSubtables(font);
	const expanded = expandedByteLength(format, bytes, font, preflightExpandedByteLength);
	let coverage: number[];
	try {
		coverage = [...font.characterSet]
			.filter(codePoint => Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF)
			.sort((left, right) => left - right);
	}
	catch {
		validationError('font-unicode-cmap-required', 'Font Unicode character map could not be inspected.');
	}
	if (coverage.length === 0)
		validationError('font-unicode-cmap-required', 'Font must map at least one Unicode code point.');
	if (!Number.isSafeInteger(font.numGlyphs) || font.numGlyphs <= 0)
		validationError('font-glyphs-invalid', 'Font must contain a non-empty glyph set.');
	const family = String(font.familyName || '').trim();
	const subfamily = String(font.subfamilyName || '').trim();
	const postscriptName = String(font.postscriptName || '').trim();
	if (!family || !subfamily || !postscriptName)
		validationError('font-name-invalid', 'Font family, subfamily, and PostScript name must be inspectable.');
	const weight = Number(font['OS/2']?.usWeightClass);
	const style = font['OS/2']?.fsSelection?.italic || font['OS/2']?.fsSelection?.oblique || font.italicAngle !== 0
		? 'italic'
		: 'normal';
	if (
		!Number.isFinite(weight)
		|| weight < 1
		|| weight > 1000
		|| !Number.isFinite(font.unitsPerEm)
		|| font.unitsPerEm <= 0
		|| !Number.isFinite(font.ascent)
		|| !Number.isFinite(font.descent)
	) {
		validationError('font-metrics-invalid', 'Font weight and layout metrics must be internally consistent.');
	}
	const representativeGlyphs = representativeCodePoints(font, coverage, 8);
	const sourceDigest = await sha256Hex(bytes);
	const challengeDigest = await sha256Hex(
		new TextEncoder().encode(`${sourceDigest}:${representativeGlyphs.join(',')}`),
	);
	const facts: GraphicAssetFontFacts = {
		kind: 'font',
		format,
		canonicalMime: MIME_BY_FORMAT[format],
		byteLength: bytes.byteLength,
		expandedByteLength: expanded,
		sha256: sourceDigest,
		family,
		subfamily,
		postscriptName,
		weight,
		style,
		glyphCount: font.numGlyphs,
		unicodeCodePoints: coverage,
		unitsPerEm: font.unitsPerEm,
		ascent: font.ascent,
		descent: font.descent,
		lineGap: font.lineGap,
		browserChallenge: {
			digest: challengeDigest,
			codePoints: representativeGlyphs,
		},
	};
	return {
		report: {
			outcome: 'accepted',
			compatibilityProfile: STATIC_FONT_COMPATIBILITY_PROFILE,
			issues: [],
			facts,
		},
		thumbnail: specimenThumbnail(font, representativeCodePoints(font, coverage, 14)),
	};
}

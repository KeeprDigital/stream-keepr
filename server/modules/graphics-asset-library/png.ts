import type {
	GraphicAssetImageFacts,
	GraphicAssetValidationIssue,
	GraphicAssetValidationReport,
} from '~~/shared/types/graphicsAsset';

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const MAX_IMAGE_AXIS = 8192;
const MAX_IMAGE_PIXELS = 16_777_216;
const THUMBNAIL_MAX_WIDTH = 640;
const THUMBNAIL_MAX_HEIGHT = 360;
const textDecoder = new TextDecoder('ascii');
const textEncoder = new TextEncoder();

interface ParsedPng {
	width: number;
	height: number;
	colorType: 0 | 2 | 3 | 4 | 6;
	colorModel: GraphicAssetImageFacts['colorModel'];
	hasAlpha: boolean;
	interlaced: boolean;
	compressedImageData: Uint8Array;
	palette?: Uint8Array;
	transparency?: Uint8Array;
}

export interface ProcessedPng {
	report: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>;
	thumbnail: Uint8Array;
}

export interface ValidatedPng {
	report: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>;
	width: number;
	height: number;
	rgba: Uint8Array;
}

export class PngValidationError extends Error {
	constructor(
		readonly issue: GraphicAssetValidationIssue,
	) {
		super(issue.message);
	}
}

function validationError(
	code: GraphicAssetValidationIssue['code'],
	message: string,
): never {
	throw new PngValidationError({ severity: 'error', code, message });
}

function readUint32(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset]! * 0x1000000)
		+ (bytes[offset + 1]! << 16)
		+ (bytes[offset + 2]! << 8)
		+ bytes[offset + 3]!
	) >>> 0;
}

function writeUint32(value: number): Uint8Array {
	return Uint8Array.of(
		(value >>> 24) & 0xFF,
		(value >>> 16) & 0xFF,
		(value >>> 8) & 0xFF,
		value & 0xFF,
	);
}

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++)
			value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xFFFFFFFF;
	for (const byte of bytes)
		crc = crcTable[(crc ^ byte) & 0xFF]! ^ (crc >>> 8);
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
	const byteLength = parts.reduce((total, part) => total + part.byteLength, 0);
	const result = new Uint8Array(byteLength);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength
		&& left.every((value, index) => value === right[index]);
}

function parsePng(bytes: Uint8Array): ParsedPng {
	if (!bytesEqual(bytes.slice(0, PNG_SIGNATURE.byteLength), PNG_SIGNATURE))
		validationError('invalid-png-signature', 'Source bytes do not have the canonical PNG signature.');

	let offset = PNG_SIGNATURE.byteLength;
	let width: number | undefined;
	let height: number | undefined;
	let colorType: ParsedPng['colorType'] | undefined;
	let colorModel: ParsedPng['colorModel'] | undefined;
	let hasAlpha = false;
	let interlaced = false;
	let palette: Uint8Array | undefined;
	let transparency: Uint8Array | undefined;
	let foundTransparency = false;
	let foundSrgb = false;
	let foundGamma = false;
	let foundChromaticities = false;
	let foundImageData = false;
	let endedImageData = false;
	let foundEnd = false;
	const imageData: Uint8Array[] = [];

	while (offset < bytes.byteLength) {
		if (bytes.byteLength - offset < 12)
			validationError('malformed-png', 'PNG ends inside a chunk header.');

		const length = readUint32(bytes, offset);
		const chunkEnd = offset + 12 + length;
		if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength)
			validationError('malformed-png', 'PNG chunk length exceeds the available source bytes.');

		const typeBytes = bytes.slice(offset + 4, offset + 8);
		const type = textDecoder.decode(typeBytes);
		const data = bytes.slice(offset + 8, offset + 8 + length);
		const expectedCrc = readUint32(bytes, offset + 8 + length);
		if (crc32(concatBytes([typeBytes, data])) !== expectedCrc)
			validationError('malformed-png', `PNG ${type} chunk has an invalid checksum.`);

		if (width === undefined && type !== 'IHDR')
			validationError('malformed-png', 'PNG header must be the first chunk.');
		if (foundEnd)
			validationError('malformed-png', 'PNG contains data after its end chunk.');
		if (foundImageData && type !== 'IDAT' && type !== 'IEND')
			endedImageData = true;

		switch (type) {
			case 'IHDR': {
				if (width !== undefined || data.byteLength !== 13)
					validationError('malformed-png', 'PNG must contain one complete 13-byte header.');
				width = readUint32(data, 0);
				height = readUint32(data, 4);
				const bitDepth = data[8];
				const rawColorType = data[9]!;
				if (width === 0 || height === 0)
					validationError('malformed-png', 'PNG dimensions must both be positive.');
				if (width > MAX_IMAGE_AXIS || height > MAX_IMAGE_AXIS)
					validationError('image-dimensions-exceeded', `PNG dimensions must not exceed ${MAX_IMAGE_AXIS} pixels per axis.`);
				if (width * height > MAX_IMAGE_PIXELS)
					validationError('image-pixels-exceeded', `PNG decoded pixels must not exceed ${MAX_IMAGE_PIXELS}.`);
				if (bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(rawColorType))
					validationError('unsupported-png-colour', 'PNG must use supported 8-bit SDR grayscale, indexed, RGB, or RGBA colour.');
				if (data[10] !== 0 || data[11] !== 0 || (data[12] !== 0 && data[12] !== 1))
					validationError('unsupported-png-colour', 'PNG must use standard compression, filtering, and a supported interlace method.');
				interlaced = data[12] === 1;
				colorType = rawColorType as ParsedPng['colorType'];
				colorModel = ({
					0: 'grayscale',
					2: 'rgb',
					3: 'indexed',
					4: 'grayscale-alpha',
					6: 'rgba',
				} as const)[colorType];
				hasAlpha = colorType === 4 || colorType === 6;
				break;
			}
			case 'PLTE':
				if (palette || foundImageData || data.byteLength === 0 || data.byteLength % 3 !== 0 || data.byteLength > 768)
					validationError('malformed-png', 'PNG palette is missing, misplaced, or malformed.');
				palette = data;
				break;
			case 'tRNS':
				if (
					foundTransparency
					|| foundImageData
					|| colorType === 4
					|| colorType === 6
					|| (colorType === 3 && !palette)
				) {
					validationError('malformed-png', 'PNG transparency facts must precede image data.');
				}
				foundTransparency = true;
				transparency = data;
				hasAlpha = true;
				break;
			case 'sRGB':
				if (foundSrgb || palette || foundImageData || data.byteLength !== 1 || data[0]! > 3)
					validationError('unsupported-png-profile', 'PNG sRGB rendering intent is malformed.');
				foundSrgb = true;
				break;
			case 'gAMA':
				if (foundGamma || palette || foundImageData || data.byteLength !== 4 || readUint32(data, 0) !== 45_455)
					validationError('unsupported-png-profile', 'PNG gamma must be compatible with sRGB output.');
				foundGamma = true;
				break;
			case 'cHRM': {
				const srgbChromaticities = [
					31_270,
					32_900,
					64_000,
					33_000,
					30_000,
					60_000,
					15_000,
					6_000,
				];
				if (
					foundChromaticities
					|| palette
					|| foundImageData
					|| data.byteLength !== 32
					|| srgbChromaticities.some((value, index) => readUint32(data, index * 4) !== value)
				) {
					validationError('unsupported-png-profile', 'PNG chromaticities must be compatible with sRGB output.');
				}
				foundChromaticities = true;
				break;
			}
			case 'IDAT':
				if (endedImageData)
					validationError('malformed-png', 'PNG image data chunks must be contiguous.');
				foundImageData = true;
				imageData.push(data);
				break;
			case 'IEND':
				if (data.byteLength !== 0 || !foundImageData)
					validationError('malformed-png', 'PNG end chunk is malformed or precedes image data.');
				foundEnd = true;
				break;
			case 'acTL':
				validationError('unsupported-png-animation', 'Animated PNG is not supported by the png-v1 compatibility profile.');
				break;
			case 'fcTL':
				validationError('unsupported-png-animation', 'Animated PNG is not supported by the png-v1 compatibility profile.');
				break;
			case 'fdAT':
				validationError('unsupported-png-animation', 'Animated PNG is not supported by the png-v1 compatibility profile.');
				break;
			case 'iCCP':
				validationError('unsupported-png-profile', 'Embedded colour profiles or HDR metadata are not supported by the png-v1 compatibility profile.');
				break;
			case 'cICP':
				validationError('unsupported-png-profile', 'Embedded colour profiles or HDR metadata are not supported by the png-v1 compatibility profile.');
				break;
			case 'mDCv':
				validationError('unsupported-png-profile', 'Embedded colour profiles or HDR metadata are not supported by the png-v1 compatibility profile.');
				break;
			case 'cLLi':
				validationError('unsupported-png-profile', 'Embedded colour profiles or HDR metadata are not supported by the png-v1 compatibility profile.');
				break;
			default:
				if ((typeBytes[0]! & 0x20) === 0)
					validationError('malformed-png', `PNG contains unsupported critical chunk ${type}.`);
		}

		offset = chunkEnd;
		if (foundEnd && offset !== bytes.byteLength)
			validationError('malformed-png', 'PNG contains trailing bytes after its end chunk.');
	}

	if (width === undefined || height === undefined || colorType === undefined || !colorModel || !foundEnd)
		validationError('incomplete-png-frame', 'PNG does not contain one complete decodable frame.');
	if (colorType === 3 && !palette)
		validationError('malformed-png', 'Indexed PNG is missing its required palette.');
	if ((colorType === 0 || colorType === 4) && palette)
		validationError('malformed-png', 'Grayscale PNG must not contain a palette.');
	if (colorType === 3 && transparency && transparency.byteLength > palette!.byteLength / 3)
		validationError('malformed-png', 'Indexed PNG transparency exceeds its palette.');
	if (colorType === 0 && transparency && transparency.byteLength !== 2)
		validationError('malformed-png', 'Grayscale PNG transparency is malformed.');
	if (colorType === 2 && transparency && transparency.byteLength !== 6)
		validationError('malformed-png', 'RGB PNG transparency is malformed.');
	if ((colorType === 4 || colorType === 6) && transparency)
		validationError('malformed-png', 'PNG with an alpha channel must not also contain a transparency chunk.');

	return {
		width,
		height,
		colorType,
		colorModel,
		hasAlpha,
		interlaced,
		compressedImageData: concatBytes(imageData),
		palette,
		transparency,
	};
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
	try {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes);
				controller.close();
			},
		}).pipeThrough(
			new DecompressionStream('deflate') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
		);
		return new Uint8Array(await new Response(body).arrayBuffer());
	}
	catch {
		return validationError('incomplete-png-frame', 'PNG image data cannot be completely decoded.');
	}
}

function paeth(left: number, above: number, upperLeft: number): number {
	const estimate = left + above - upperLeft;
	const leftDistance = Math.abs(estimate - left);
	const aboveDistance = Math.abs(estimate - above);
	const upperLeftDistance = Math.abs(estimate - upperLeft);
	if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance)
		return left;
	if (aboveDistance <= upperLeftDistance)
		return above;
	return upperLeft;
}

function unfilterPass(
	inflated: Uint8Array,
	inputStart: number,
	width: number,
	height: number,
	channels: number,
): { decoded: Uint8Array; consumed: number } {
	const rowByteLength = width * channels;
	const decoded = new Uint8Array(height * rowByteLength);
	for (let row = 0; row < height; row++) {
		const inputOffset = inputStart + row * (rowByteLength + 1);
		const filter = inflated[inputOffset];
		if (filter === undefined || filter > 4)
			validationError('malformed-png', 'PNG uses an invalid scanline filter.');

		const outputOffset = row * rowByteLength;
		for (let column = 0; column < rowByteLength; column++) {
			const raw = inflated[inputOffset + 1 + column]!;
			const left = column >= channels ? decoded[outputOffset + column - channels]! : 0;
			const above = row > 0 ? decoded[outputOffset + column - rowByteLength]! : 0;
			const upperLeft = row > 0 && column >= channels
				? decoded[outputOffset + column - rowByteLength - channels]!
				: 0;
			let reconstructed: number;
			switch (filter) {
				case 0:
					reconstructed = raw;
					break;
				case 1:
					reconstructed = raw + left;
					break;
				case 2:
					reconstructed = raw + above;
					break;
				case 3:
					reconstructed = raw + Math.floor((left + above) / 2);
					break;
				case 4:
					reconstructed = raw + paeth(left, above, upperLeft);
					break;
				default:
					reconstructed = raw;
			}
			decoded[outputOffset + column] = reconstructed & 0xFF;
		}
	}
	return { decoded, consumed: height * (rowByteLength + 1) };
}

function passLength(fullLength: number, start: number, step: number): number {
	return fullLength <= start ? 0 : Math.ceil((fullLength - start) / step);
}

function unfilter(parsed: ParsedPng, inflated: Uint8Array): Uint8Array {
	const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const)[parsed.colorType];
	if (!parsed.interlaced) {
		const expectedByteLength = parsed.height * (parsed.width * channels + 1);
		if (inflated.byteLength !== expectedByteLength)
			validationError('incomplete-png-frame', 'PNG decoded frame length does not match its declared dimensions.');
		return unfilterPass(inflated, 0, parsed.width, parsed.height, channels).decoded;
	}

	const decoded = new Uint8Array(parsed.width * parsed.height * channels);
	const passes = [
		{ x: 0, y: 0, dx: 8, dy: 8 },
		{ x: 4, y: 0, dx: 8, dy: 8 },
		{ x: 0, y: 4, dx: 4, dy: 8 },
		{ x: 2, y: 0, dx: 4, dy: 4 },
		{ x: 0, y: 2, dx: 2, dy: 4 },
		{ x: 1, y: 0, dx: 2, dy: 2 },
		{ x: 0, y: 1, dx: 1, dy: 2 },
	] as const;
	let inputOffset = 0;
	for (const pass of passes) {
		const passWidth = passLength(parsed.width, pass.x, pass.dx);
		const passHeight = passLength(parsed.height, pass.y, pass.dy);
		if (passWidth === 0 || passHeight === 0)
			continue;
		const unfiltered = unfilterPass(
			inflated,
			inputOffset,
			passWidth,
			passHeight,
			channels,
		);
		inputOffset += unfiltered.consumed;
		for (let passY = 0; passY < passHeight; passY++) {
			for (let passX = 0; passX < passWidth; passX++) {
				const sourceOffset = (passY * passWidth + passX) * channels;
				const targetOffset = (
					(pass.y + passY * pass.dy) * parsed.width
					+ pass.x
					+ passX * pass.dx
				) * channels;
				decoded.set(
					unfiltered.decoded.slice(sourceOffset, sourceOffset + channels),
					targetOffset,
				);
			}
		}
	}
	if (inputOffset !== inflated.byteLength)
		validationError('incomplete-png-frame', 'PNG decoded interlaced frame length does not match its declared dimensions.');
	return decoded;
}

function toRgba(parsed: ParsedPng, decoded: Uint8Array): Uint8Array {
	const rgba = new Uint8Array(parsed.width * parsed.height * 4);
	let sourceOffset = 0;
	for (let pixel = 0; pixel < parsed.width * parsed.height; pixel++) {
		const targetOffset = pixel * 4;
		switch (parsed.colorType) {
			case 0: {
				const grayscale = decoded[sourceOffset++]!;
				rgba.set([grayscale, grayscale, grayscale], targetOffset);
				rgba[targetOffset + 3] = parsed.transparency
					&& readUint32(Uint8Array.of(0, 0, parsed.transparency[0]!, parsed.transparency[1]!), 0) === grayscale
					? 0
					: 255;
				break;
			}
			case 2: {
				const red = decoded[sourceOffset++]!;
				const green = decoded[sourceOffset++]!;
				const blue = decoded[sourceOffset++]!;
				rgba.set([red, green, blue], targetOffset);
				rgba[targetOffset + 3] = parsed.transparency
					&& parsed.transparency[1] === red
					&& parsed.transparency[3] === green
					&& parsed.transparency[5] === blue
					? 0
					: 255;
				break;
			}
			case 3: {
				const paletteIndex = decoded[sourceOffset++]!;
				const paletteOffset = paletteIndex * 3;
				if (!parsed.palette || paletteOffset + 2 >= parsed.palette.byteLength)
					validationError('malformed-png', 'PNG pixel references a missing palette entry.');
				rgba.set(parsed.palette.slice(paletteOffset, paletteOffset + 3), targetOffset);
				rgba[targetOffset + 3] = parsed.transparency?.[paletteIndex] ?? 255;
				break;
			}
			case 4: {
				const grayscale = decoded[sourceOffset++]!;
				rgba.set([grayscale, grayscale, grayscale, decoded[sourceOffset++]!], targetOffset);
				break;
			}
			case 6:
				rgba.set(decoded.slice(sourceOffset, sourceOffset + 4), targetOffset);
				sourceOffset += 4;
				break;
		}
	}
	return rgba;
}

function fittedThumbnail(source: Uint8Array, width: number, height: number) {
	const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / width, THUMBNAIL_MAX_HEIGHT / height);
	const thumbnailWidth = Math.max(1, Math.floor(width * scale));
	const thumbnailHeight = Math.max(1, Math.floor(height * scale));
	const pixels = new Uint8Array(thumbnailWidth * thumbnailHeight * 4);
	for (let y = 0; y < thumbnailHeight; y++) {
		const sourceY = Math.min(height - 1, Math.floor(y / scale));
		for (let x = 0; x < thumbnailWidth; x++) {
			const sourceX = Math.min(width - 1, Math.floor(x / scale));
			const sourceOffset = (sourceY * width + sourceX) * 4;
			pixels.set(source.slice(sourceOffset, sourceOffset + 4), (y * thumbnailWidth + x) * 4);
		}
	}
	return { width: thumbnailWidth, height: thumbnailHeight, pixels };
}

function adler32(bytes: Uint8Array): number {
	let first = 1;
	let second = 0;
	for (const byte of bytes) {
		first = (first + byte) % 65521;
		second = (second + first) % 65521;
	}
	return ((second << 16) | first) >>> 0;
}

function uncompressedZlib(bytes: Uint8Array): Uint8Array {
	const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
	for (let offset = 0; offset < bytes.byteLength || offset === 0; offset += 65_535) {
		const length = Math.min(65_535, bytes.byteLength - offset);
		const final = offset + length >= bytes.byteLength;
		blocks.push(Uint8Array.of(
			final ? 1 : 0,
			length & 0xFF,
			(length >>> 8) & 0xFF,
			(~length) & 0xFF,
			((~length) >>> 8) & 0xFF,
		));
		blocks.push(bytes.slice(offset, offset + length));
		if (final)
			break;
	}
	blocks.push(writeUint32(adler32(bytes)));
	return concatBytes(blocks);
}

function pngChunk(type: 'IHDR' | 'sRGB' | 'IDAT' | 'IEND', data: Uint8Array): Uint8Array {
	const typeBytes = textEncoder.encode(type);
	return concatBytes([
		writeUint32(data.byteLength),
		typeBytes,
		data,
		writeUint32(crc32(concatBytes([typeBytes, data]))),
	]);
}

function encodeThumbnail(width: number, height: number, rgba: Uint8Array): Uint8Array {
	const scanlines = new Uint8Array(height * (1 + width * 4));
	for (let row = 0; row < height; row++) {
		const scanlineOffset = row * (1 + width * 4);
		scanlines[scanlineOffset] = 0;
		scanlines.set(
			rgba.slice(row * width * 4, (row + 1) * width * 4),
			scanlineOffset + 1,
		);
	}
	const header = concatBytes([
		writeUint32(width),
		writeUint32(height),
		Uint8Array.of(8, 6, 0, 0, 0),
	]);
	return concatBytes([
		PNG_SIGNATURE,
		pngChunk('IHDR', header),
		pngChunk('sRGB', Uint8Array.of(0)),
		pngChunk('IDAT', uncompressedZlib(scanlines)),
		pngChunk('IEND', new Uint8Array()),
	]);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function validatePng(
	bytes: Uint8Array,
	sourceDigest: string,
): Promise<ValidatedPng> {
	const parsed = parsePng(bytes);
	const decoded = unfilter(parsed, await inflate(parsed.compressedImageData));
	const rgba = toRgba(parsed, decoded);
	const facts: GraphicAssetImageFacts = {
		kind: 'image',
		canonicalMime: 'image/png',
		byteLength: bytes.byteLength,
		sha256: sourceDigest,
		width: parsed.width,
		height: parsed.height,
		pixelCount: parsed.width * parsed.height,
		bitDepth: 8,
		colorModel: parsed.colorModel,
		hasAlpha: parsed.hasAlpha,
	};
	return {
		report: {
			outcome: 'accepted',
			compatibilityProfile: 'png-v1',
			issues: [],
			facts,
		},
		width: parsed.width,
		height: parsed.height,
		rgba,
	};
}

export function generatePngThumbnail(validated: ValidatedPng): Uint8Array {
	const thumbnail = fittedThumbnail(validated.rgba, validated.width, validated.height);
	return encodeThumbnail(thumbnail.width, thumbnail.height, thumbnail.pixels);
}

export async function processPng(bytes: Uint8Array): Promise<ProcessedPng> {
	const validated = await validatePng(bytes, await sha256Hex(bytes));
	return {
		report: validated.report,
		thumbnail: generatePngThumbnail(validated),
	};
}

export function rejectedPngReport(error: PngValidationError): GraphicAssetValidationReport {
	return {
		outcome: 'rejected',
		compatibilityProfile: 'png-v1',
		issues: [error.issue],
	};
}

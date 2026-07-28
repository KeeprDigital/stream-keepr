import type {
	GraphicAssetImageFacts,
	GraphicAssetValidationIssue,
	GraphicAssetValidationReport,
} from '~~/shared/types/graphicsAsset';
import type { BoundedByteStream } from './object-store';
import { createHash } from 'node:crypto';
import {
	MAX_STILL_IMAGE_AXIS,
	MAX_STILL_IMAGE_PIXELS,
	STILL_IMAGE_COMPATIBILITY_PROFILE,
	STILL_IMAGE_THUMBNAIL_MAX_HEIGHT,
	STILL_IMAGE_THUMBNAIL_MAX_WIDTH,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { createBoundedByteStream } from './object-store';

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const textDecoder = new TextDecoder('ascii');
const textEncoder = new TextEncoder();
const ADAM7_PASSES = [
	{ x: 0, y: 0, dx: 8, dy: 8 },
	{ x: 4, y: 0, dx: 8, dy: 8 },
	{ x: 0, y: 4, dx: 4, dy: 8 },
	{ x: 2, y: 0, dx: 4, dy: 4 },
	{ x: 0, y: 2, dx: 2, dy: 4 },
	{ x: 1, y: 0, dx: 2, dy: 2 },
	{ x: 0, y: 1, dx: 1, dy: 2 },
] as const;

interface ParsedPng {
	width: number;
	height: number;
	colorType: 0 | 2 | 3 | 4 | 6;
	colorModel: GraphicAssetImageFacts['colorModel'];
	hasAlpha: boolean;
	interlaced: boolean;
	palette?: Uint8Array;
	transparency?: Uint8Array;
}

export interface ProcessedPng {
	report: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>;
	thumbnail: Uint8Array;
}

export class PngValidationError extends Error {
	readonly issue: GraphicAssetValidationIssue;

	constructor(
		readonly issues: readonly GraphicAssetValidationIssue[],
	) {
		if (issues.length === 0)
			throw new Error('PNG validation errors require at least one issue');
		super(issues.map(issue => issue.message).join(' '));
		this.issue = issues[0]!;
	}
}

function validationIssue(
	code: GraphicAssetValidationIssue['code'],
	message: string,
): GraphicAssetValidationIssue {
	return { severity: 'error', code, message };
}

function validationError(
	code: GraphicAssetValidationIssue['code'],
	message: string,
): never {
	throw new PngValidationError([validationIssue(code, message)]);
}

function readUint16(bytes: Uint8Array, offset: number): number {
	return (bytes[offset]! << 8) | bytes[offset + 1]!;
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

function updateCrc32(crc: number, bytes: Uint8Array): number {
	let updated = crc;
	for (const byte of bytes)
		updated = crcTable[(updated ^ byte) & 0xFF]! ^ (updated >>> 8);
	return updated;
}

function crc32(bytes: Uint8Array): number {
	return (updateCrc32(0xFFFFFFFF, bytes) ^ 0xFFFFFFFF) >>> 0;
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

function isAsciiLetter(byte: number) {
	return (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
}

class StreamByteReader {
	private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
	private current?: Uint8Array;
	private offset = 0;
	private ended = false;

	constructor(stream: ReadableStream<Uint8Array>) {
		this.reader = stream.getReader();
	}

	async readAtMost(maximum: number): Promise<Uint8Array | undefined> {
		while (!this.current || this.offset >= this.current.byteLength) {
			if (this.ended)
				return;
			const { done, value } = await this.reader.read();
			if (done) {
				this.ended = true;
				return;
			}
			if (value.byteLength === 0)
				continue;
			this.current = value;
			this.offset = 0;
		}
		const end = Math.min(this.current.byteLength, this.offset + maximum);
		const result = this.current.subarray(this.offset, end);
		this.offset = end;
		return result;
	}

	async readExactly(byteLength: number, message: string): Promise<Uint8Array> {
		const result = new Uint8Array(byteLength);
		let offset = 0;
		while (offset < byteLength) {
			const part = await this.readAtMost(byteLength - offset);
			if (!part)
				validationError('malformed-png', message);
			result.set(part, offset);
			offset += part.byteLength;
		}
		return result;
	}

	async hasRemainingBytes(): Promise<boolean> {
		return (await this.readAtMost(1)) !== undefined;
	}

	async cancel(reason?: unknown): Promise<void> {
		await this.reader.cancel(reason);
	}
}

function channelCount(colorType: ParsedPng['colorType']) {
	return ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const)[colorType];
}

function passLength(fullLength: number, start: number, step: number): number {
	return fullLength <= start ? 0 : Math.ceil((fullLength - start) / step);
}

function unfilterRow(
	filter: number,
	raw: Uint8Array,
	previous: Uint8Array,
	channels: number,
): Uint8Array {
	if (filter > 4)
		validationError('malformed-png', 'PNG uses an invalid scanline filter.');
	const decoded = new Uint8Array(raw.byteLength);
	for (let column = 0; column < raw.byteLength; column++) {
		const left = column >= channels ? decoded[column - channels]! : 0;
		const above = previous[column] ?? 0;
		const upperLeft = column >= channels ? previous[column - channels] ?? 0 : 0;
		let predictor: number;
		switch (filter) {
			case 0:
				predictor = 0;
				break;
			case 1:
				predictor = left;
				break;
			case 2:
				predictor = above;
				break;
			case 3:
				predictor = Math.floor((left + above) / 2);
				break;
			case 4: {
				const estimate = left + above - upperLeft;
				const leftDistance = Math.abs(estimate - left);
				const aboveDistance = Math.abs(estimate - above);
				const upperLeftDistance = Math.abs(estimate - upperLeft);
				predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
					? left
					: aboveDistance <= upperLeftDistance
						? above
						: upperLeft;
				break;
			}
			default:
				predictor = 0;
		}
		decoded[column] = (raw[column]! + predictor) & 0xFF;
	}
	return decoded;
}

function writeRgbaPixel(
	parsed: ParsedPng,
	row: Uint8Array,
	sourceOffset: number,
	target: Uint8Array,
	targetOffset: number,
) {
	switch (parsed.colorType) {
		case 0: {
			const grayscale = row[sourceOffset]!;
			target.set([grayscale, grayscale, grayscale], targetOffset);
			target[targetOffset + 3] = parsed.transparency
				&& readUint16(parsed.transparency, 0) === grayscale
				? 0
				: 255;
			break;
		}
		case 2: {
			const red = row[sourceOffset]!;
			const green = row[sourceOffset + 1]!;
			const blue = row[sourceOffset + 2]!;
			target.set([red, green, blue], targetOffset);
			target[targetOffset + 3] = parsed.transparency
				&& readUint16(parsed.transparency, 0) === red
				&& readUint16(parsed.transparency, 2) === green
				&& readUint16(parsed.transparency, 4) === blue
				? 0
				: 255;
			break;
		}
		case 3: {
			const paletteIndex = row[sourceOffset]!;
			const paletteOffset = paletteIndex * 3;
			if (!parsed.palette || paletteOffset + 2 >= parsed.palette.byteLength)
				validationError('malformed-png', 'PNG pixel references a missing palette entry.');
			target.set(parsed.palette.subarray(paletteOffset, paletteOffset + 3), targetOffset);
			target[targetOffset + 3] = parsed.transparency?.[paletteIndex] ?? 255;
			break;
		}
		case 4: {
			const grayscale = row[sourceOffset]!;
			target.set([grayscale, grayscale, grayscale, row[sourceOffset + 1]!], targetOffset);
			break;
		}
		case 6:
			target.set(row.subarray(sourceOffset, sourceOffset + 4), targetOffset);
			break;
	}
}

async function decodeThumbnail(
	parsed: ParsedPng,
	inflated: ReadableStream<Uint8Array>,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
	const scale = Math.min(
		1,
		STILL_IMAGE_THUMBNAIL_MAX_WIDTH / parsed.width,
		STILL_IMAGE_THUMBNAIL_MAX_HEIGHT / parsed.height,
	);
	const width = Math.max(1, Math.floor(parsed.width * scale));
	const height = Math.max(1, Math.floor(parsed.height * scale));
	const pixels = new Uint8Array(width * height * 4);
	const targetSourceX = Array.from(
		{ length: width },
		(_, targetX) => Math.min(parsed.width - 1, Math.floor(targetX / scale)),
	);
	const targetYBySource = new Map<number, number>();
	for (let targetY = 0; targetY < height; targetY++) {
		targetYBySource.set(
			Math.min(parsed.height - 1, Math.floor(targetY / scale)),
			targetY,
		);
	}

	const reader = new StreamByteReader(inflated);
	const channels = channelCount(parsed.colorType);
	const passes = parsed.interlaced
		? ADAM7_PASSES
		: [{ x: 0, y: 0, dx: 1, dy: 1 }] as const;

	try {
		for (const pass of passes) {
			const passWidth = passLength(parsed.width, pass.x, pass.dx);
			const passHeight = passLength(parsed.height, pass.y, pass.dy);
			if (passWidth === 0 || passHeight === 0)
				continue;
			const rowByteLength = passWidth * channels;
			let previous: Uint8Array<ArrayBufferLike> = new Uint8Array(rowByteLength);
			for (let passY = 0; passY < passHeight; passY++) {
				const encoded = await reader.readExactly(
					rowByteLength + 1,
					'PNG image data ended before its declared frame was decoded.',
				);
				const decoded = unfilterRow(
					encoded[0]!,
					encoded.subarray(1),
					previous,
					channels,
				);
				previous = decoded;
				const sourceY = pass.y + passY * pass.dy;
				const targetY = targetYBySource.get(sourceY);
				if (targetY === undefined)
					continue;
				for (let targetX = 0; targetX < width; targetX++) {
					const sourceX = targetSourceX[targetX]!;
					if (sourceX < pass.x || (sourceX - pass.x) % pass.dx !== 0)
						continue;
					const passX = (sourceX - pass.x) / pass.dx;
					if (passX >= passWidth)
						continue;
					writeRgbaPixel(
						parsed,
						decoded,
						passX * channels,
						pixels,
						(targetY * width + targetX) * 4,
					);
				}
			}
		}
		if (await reader.hasRemainingBytes()) {
			await reader.cancel();
			validationError(
				'incomplete-png-frame',
				'PNG decoded frame exceeds the length allowed by its declared dimensions.',
			);
		}
	}
	catch (error) {
		await reader.cancel(error).catch(() => undefined);
		if (error instanceof PngValidationError)
			throw error;
		validationError('incomplete-png-frame', 'PNG image data cannot be completely decoded.');
	}

	return { width, height, pixels };
}

function captureChunkData(type: string, length: number): boolean {
	return (
		(type === 'IHDR' && length <= 13)
		|| (type === 'PLTE' && length <= 768)
		|| (type === 'tRNS' && length <= 768)
		|| (type === 'sRGB' && length <= 1)
		|| (type === 'gAMA' && length <= 4)
		|| (type === 'cHRM' && length <= 32)
		|| (type === 'IEND' && length === 0)
	);
}

async function inspectAndDecodePng(
	bytes: BoundedByteStream,
): Promise<{
	parsed: ParsedPng;
	thumbnail: { width: number; height: number; pixels: Uint8Array };
}> {
	const reader = new StreamByteReader(bytes.body);
	const signature = await reader.readExactly(
		PNG_SIGNATURE.byteLength,
		'PNG ends before its signature is complete.',
	);
	if (!bytesEqual(signature, PNG_SIGNATURE)) {
		validationError(
			'invalid-png-signature',
			'Source bytes do not have the canonical PNG signature.',
		);
	}

	const issues: GraphicAssetValidationIssue[] = [];
	const profileChunks = new Set<string>();
	let parsed: ParsedPng | undefined;
	let foundPalette = false;
	let foundImageData = false;
	let endedImageData = false;
	let foundEnd = false;
	let foundTransparency = false;
	let compressedWriter: WritableStreamDefaultWriter<BufferSource> | undefined;
	let thumbnailPromise: Promise<{ width: number; height: number; pixels: Uint8Array }> | undefined;
	let thumbnailError: unknown;

	async function closeImageData() {
		if (!compressedWriter)
			return;
		const writer = compressedWriter;
		compressedWriter = undefined;
		await writer.close();
	}

	try {
		while (!foundEnd) {
			const header = await reader.readExactly(8, 'PNG ends inside a chunk header.');
			const length = readUint32(header, 0);
			const typeBytes = header.subarray(4);
			const type = textDecoder.decode(typeBytes);
			if (!typeBytes.every(isAsciiLetter)) {
				issues.push(validationIssue(
					'malformed-png',
					'PNG chunk types must contain exactly four ASCII letters.',
				));
			}
			if ((typeBytes[2]! & 0x20) !== 0) {
				issues.push(validationIssue(
					'malformed-png',
					`PNG ${type} chunk sets the reserved chunk-type bit.`,
				));
			}
			if (!parsed && type !== 'IHDR')
				validationError('malformed-png', 'PNG header must be the first chunk.');
			if (foundImageData && type !== 'IDAT' && type !== 'IEND') {
				endedImageData = true;
				await closeImageData();
			}
			if (type === 'IDAT' && endedImageData)
				validationError('malformed-png', 'PNG image data chunks must be contiguous.');

			const captured = captureChunkData(type, length)
				? new Uint8Array(length)
				: undefined;
			let capturedOffset = 0;
			let remaining = length;
			let crc = updateCrc32(0xFFFFFFFF, typeBytes);

			if (type === 'IDAT') {
				if (!parsed)
					validationError('malformed-png', 'PNG image data precedes its header.');
				if (parsed.colorType === 3 && !parsed.palette)
					validationError('malformed-png', 'Indexed PNG is missing its required palette.');
				if (!foundImageData) {
					const decompressor = new DecompressionStream('deflate');
					compressedWriter = decompressor.writable.getWriter();
					thumbnailPromise = decodeThumbnail(parsed, decompressor.readable)
						.catch((error) => {
							thumbnailError = error;
							throw error;
						});
					void thumbnailPromise.catch(() => undefined);
					foundImageData = true;
				}
			}

			while (remaining > 0) {
				const part = await reader.readAtMost(Math.min(remaining, 64 * 1024));
				if (!part)
					validationError('malformed-png', 'PNG chunk length exceeds the available source bytes.');
				crc = updateCrc32(crc, part);
				captured?.set(part, capturedOffset);
				capturedOffset += part.byteLength;
				remaining -= part.byteLength;
				if (type === 'IDAT')
					await compressedWriter!.write(Uint8Array.from(part));
			}
			const expectedCrc = readUint32(
				await reader.readExactly(4, 'PNG ends before a chunk checksum is complete.'),
				0,
			);
			if (((crc ^ 0xFFFFFFFF) >>> 0) !== expectedCrc) {
				issues.push(validationIssue(
					'malformed-png',
					`PNG ${type} chunk has an invalid checksum.`,
				));
			}

			const data = captured ?? new Uint8Array();
			if (type === 'sRGB' || type === 'gAMA' || type === 'cHRM') {
				const profileInvalid = profileChunks.has(type)
					|| foundPalette
					|| foundImageData
					|| (type === 'sRGB' && (length !== 1 || data[0]! > 3))
					|| (type === 'gAMA' && (length !== 4 || readUint32(data, 0) !== 45_455))
					|| (type === 'cHRM' && (
						length !== 32
						|| [
							31_270,
							32_900,
							64_000,
							33_000,
							30_000,
							60_000,
							15_000,
							6_000,
						].some((value, index) => readUint32(data, index * 4) !== value)
					));
				if (profileInvalid) {
					issues.push(validationIssue(
						'unsupported-png-profile',
						`PNG ${type} chunk is duplicated, misplaced, or incompatible with sRGB output.`,
					));
				}
				profileChunks.add(type);
			}
			if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
				issues.push(validationIssue(
					'unsupported-png-animation',
					'Animated PNG is not supported by the still-image-v1 compatibility profile.',
				));
			}
			if (type === 'iCCP' || type === 'cICP' || type === 'mDCv' || type === 'cLLi') {
				issues.push(validationIssue(
					'unsupported-png-profile',
					'Embedded colour profiles or HDR metadata are not supported by the still-image-v1 compatibility profile.',
				));
			}

			switch (type) {
				case 'IHDR': {
					if (parsed || length !== 13)
						validationError('malformed-png', 'PNG must contain one complete 13-byte header.');
					const width = readUint32(data, 0);
					const height = readUint32(data, 4);
					const bitDepth = data[8];
					const rawColorType = data[9]!;
					if (width === 0 || height === 0)
						validationError('malformed-png', 'PNG dimensions must both be positive.');
					if (width > MAX_STILL_IMAGE_AXIS || height > MAX_STILL_IMAGE_AXIS)
						validationError('image-dimensions-exceeded', `PNG dimensions must not exceed ${MAX_STILL_IMAGE_AXIS} pixels per axis.`);
					if (width * height > MAX_STILL_IMAGE_PIXELS)
						validationError('image-pixels-exceeded', `PNG decoded pixels must not exceed ${MAX_STILL_IMAGE_PIXELS}.`);
					if (bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(rawColorType))
						validationError('unsupported-png-colour', 'PNG must use supported 8-bit SDR grayscale, indexed, RGB, or RGBA colour.');
					if (data[10] !== 0 || data[11] !== 0 || (data[12] !== 0 && data[12] !== 1))
						validationError('unsupported-png-colour', 'PNG must use standard compression, filtering, and a supported interlace method.');
					const colorType = rawColorType as ParsedPng['colorType'];
					parsed = {
						width,
						height,
						colorType,
						colorModel: ({
							0: 'grayscale',
							2: 'rgb',
							3: 'indexed',
							4: 'grayscale-alpha',
							6: 'rgba',
						} as const)[colorType],
						hasAlpha: colorType === 4 || colorType === 6,
						interlaced: data[12] === 1,
					};
					break;
				}
				case 'PLTE':
					if (
						foundPalette
						|| foundImageData
						|| length === 0
						|| length % 3 !== 0
						|| length > 768
					) {
						validationError('malformed-png', 'PNG palette is missing, misplaced, or malformed.');
					}
					foundPalette = true;
					parsed!.palette = data;
					break;
				case 'tRNS':
					if (
						foundTransparency
						|| foundImageData
						|| parsed!.colorType === 4
						|| parsed!.colorType === 6
						|| (parsed!.colorType === 3 && !parsed!.palette)
					) {
						validationError('malformed-png', 'PNG transparency facts must precede image data.');
					}
					if (
						(parsed!.colorType === 3 && (
							length === 0
							|| length > parsed!.palette!.byteLength / 3
						))
						|| (parsed!.colorType === 0 && (
							length !== 2
							|| readUint16(data, 0) > 255
						))
						|| (parsed!.colorType === 2 && (
							length !== 6
							|| readUint16(data, 0) > 255
							|| readUint16(data, 2) > 255
							|| readUint16(data, 4) > 255
						))
					) {
						validationError('malformed-png', 'PNG transparency facts are malformed.');
					}
					foundTransparency = true;
					parsed!.transparency = data;
					parsed!.hasAlpha = true;
					break;
				case 'IEND':
					if (length !== 0 || !foundImageData)
						validationError('malformed-png', 'PNG end chunk is malformed or precedes image data.');
					foundEnd = true;
					await closeImageData();
					break;
				default:
					if (
						!['IDAT', 'sRGB', 'gAMA', 'cHRM', 'acTL', 'fcTL', 'fdAT', 'iCCP', 'cICP', 'mDCv', 'cLLi'].includes(type)
						&& (typeBytes[0]! & 0x20) === 0
					) {
						issues.push(validationIssue(
							'malformed-png',
							`PNG contains unsupported critical chunk ${type}.`,
						));
					}
			}
		}

		if (await reader.hasRemainingBytes())
			validationError('malformed-png', 'PNG contains trailing bytes after its end chunk.');
		if (!parsed || !thumbnailPromise)
			validationError('incomplete-png-frame', 'PNG does not contain one complete decodable frame.');
		const thumbnail = await thumbnailPromise;
		if (issues.length > 0)
			throw new PngValidationError(issues);
		return { parsed, thumbnail };
	}
	catch (error) {
		await compressedWriter?.abort(error).catch(() => undefined);
		await thumbnailPromise?.catch(() => undefined);
		if (thumbnailError instanceof PngValidationError)
			throw thumbnailError;
		throw error;
	}
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
		blocks.push(bytes.subarray(offset, offset + length));
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

export function encodeThumbnail(width: number, height: number, rgba: Uint8Array): Uint8Array {
	const scanlines = new Uint8Array(height * (1 + width * 4));
	for (let row = 0; row < height; row++) {
		const scanlineOffset = row * (1 + width * 4);
		scanlines[scanlineOffset] = 0;
		scanlines.set(
			rgba.subarray(row * width * 4, (row + 1) * width * 4),
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

function digestHex(digest: ArrayBuffer): string {
	return Array.from(
		new Uint8Array(digest),
		byte => byte.toString(16).padStart(2, '0'),
	).join('');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	return digestHex(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
}

interface WorkerDigestStream extends WritableStream<Uint8Array> {
	readonly digest: Promise<ArrayBuffer>;
}

type WorkerDigestStreamConstructor = new (algorithm: string) => WorkerDigestStream;

export async function sha256HexStream(bytes: BoundedByteStream): Promise<string> {
	const workerCrypto = crypto as Crypto & {
		DigestStream?: WorkerDigestStreamConstructor;
	};
	if (workerCrypto.DigestStream) {
		const digestStream = new workerCrypto.DigestStream('SHA-256');
		await bytes.body.pipeTo(digestStream);
		return digestHex(await digestStream.digest);
	}

	const hash = createHash('sha256');
	const reader = bytes.body.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done)
			break;
		hash.update(value);
	}
	return hash.digest('hex');
}

export async function processPngStream(
	bytes: BoundedByteStream,
	sourceDigest: string,
): Promise<ProcessedPng> {
	const { parsed, thumbnail } = await inspectAndDecodePng(bytes);
	return {
		report: {
			outcome: 'accepted',
			compatibilityProfile: STILL_IMAGE_COMPATIBILITY_PROFILE,
			issues: [],
			facts: {
				kind: 'image',
				format: 'png',
				canonicalMime: 'image/png',
				byteLength: bytes.byteLength,
				sha256: sourceDigest,
				width: parsed.width,
				height: parsed.height,
				pixelCount: parsed.width * parsed.height,
				frameCount: 1,
				bitDepth: 8,
				colorSpace: 'srgb',
				colorModel: parsed.colorModel,
				hasAlpha: parsed.hasAlpha,
				orientation: 'normal',
			},
		},
		thumbnail: encodeThumbnail(
			thumbnail.width,
			thumbnail.height,
			thumbnail.pixels,
		),
	};
}

export async function processPng(bytes: Uint8Array): Promise<ProcessedPng> {
	return await processPngStream(
		createBoundedByteStream(bytes, {
			byteLength: bytes.byteLength,
			maximumByteLength: bytes.byteLength,
		}),
		await sha256Hex(bytes),
	);
}

export function rejectedPngReport(error: PngValidationError): GraphicAssetValidationReport {
	return {
		outcome: 'rejected',
		compatibilityProfile: STILL_IMAGE_COMPATIBILITY_PROFILE,
		issues: [...error.issues],
	};
}

import type {
	GraphicAssetImageFacts,
	GraphicAssetValidationIssue,
	GraphicAssetValidationReport,
} from '~~/shared/types/graphicsAsset';
import type { BoundedByteStream } from './object-store';
import { consumeBoundedByteStream } from './object-store';
import {
	encodeThumbnail,
	PngValidationError,
	processPng,
	processPngStream,
	rejectedPngReport,
	sha256Hex,
} from './png';

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const MAX_IMAGE_AXIS = 8192;
const MAX_IMAGE_PIXELS = 16_777_216;
const THUMBNAIL_MAX_WIDTH = 640;
const THUMBNAIL_MAX_HEIGHT = 360;
const JPEG_START_OF_FRAME_MARKERS = new Set([
	0xC0,
	0xC1,
	0xC2,
	0xC3,
	0xC5,
	0xC6,
	0xC7,
	0xC9,
	0xCA,
	0xCB,
	0xCD,
	0xCE,
	0xCF,
]);

export interface StillImageDeclarations {
	sourceFileName?: string;
	declaredMime?: string;
}

export interface ProcessedStillImage {
	report: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>;
	thumbnail: Uint8Array;
}

export class StillImageValidationError extends Error {
	readonly issue: GraphicAssetValidationIssue;

	constructor(readonly issues: readonly GraphicAssetValidationIssue[]) {
		if (issues.length === 0)
			throw new Error('Still-image validation errors require at least one issue');
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
	throw new StillImageValidationError([validationIssue(code, message)]);
}

function bytesStartWith(bytes: Uint8Array, signature: Uint8Array) {
	return bytes.byteLength >= signature.byteLength
		&& signature.every((value, index) => bytes[index] === value);
}

function readUint16BigEndian(bytes: Uint8Array, offset: number) {
	return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number) {
	return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number) {
	return (
		bytes[offset]!
		| (bytes[offset + 1]! << 8)
		| (bytes[offset + 2]! << 16)
		| (bytes[offset + 3]! * 0x1000000)
	) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function jpegExifOrientation(
	bytes: Uint8Array,
	dataOffset: number,
	dataLength: number,
): number | undefined {
	if (dataLength < 14 || ascii(bytes, dataOffset, 6) !== 'Exif\0\0')
		return;
	const tiffOffset = dataOffset + 6;
	const littleEndian = ascii(bytes, tiffOffset, 2) === 'II';
	if (!littleEndian && ascii(bytes, tiffOffset, 2) !== 'MM')
		validationError('malformed-jpeg', 'JPEG EXIF byte order is malformed.');
	const read16 = (offset: number) => littleEndian
		? bytes[offset]! | (bytes[offset + 1]! << 8)
		: readUint16BigEndian(bytes, offset);
	const read32 = (offset: number) => littleEndian
		? (
				bytes[offset]!
				| (bytes[offset + 1]! << 8)
				| (bytes[offset + 2]! << 16)
				| (bytes[offset + 3]! * 0x1000000)
			) >>> 0
		: (
				(bytes[offset]! * 0x1000000)
				+ (bytes[offset + 1]! << 16)
				+ (bytes[offset + 2]! << 8)
				+ bytes[offset + 3]!
			) >>> 0;
	const tiffEnd = dataOffset + dataLength;
	if (read16(tiffOffset + 2) !== 42)
		validationError('malformed-jpeg', 'JPEG EXIF TIFF header is malformed.');
	const directoryOffset = tiffOffset + read32(tiffOffset + 4);
	if (directoryOffset + 2 > tiffEnd)
		validationError('malformed-jpeg', 'JPEG EXIF directory exceeds its segment.');
	const entryCount = read16(directoryOffset);
	if (directoryOffset + 2 + entryCount * 12 + 4 > tiffEnd)
		validationError('malformed-jpeg', 'JPEG EXIF directory is incomplete.');
	for (let index = 0; index < entryCount; index++) {
		const entryOffset = directoryOffset + 2 + index * 12;
		if (read16(entryOffset) !== 0x0112)
			continue;
		if (read16(entryOffset + 2) !== 3 || read32(entryOffset + 4) !== 1)
			validationError('malformed-jpeg', 'JPEG EXIF orientation value is malformed.');
		return read16(entryOffset + 8);
	}
}

function assertDimensions(
	width: number,
	height: number,
	formatLabel: string,
	malformedCode: 'malformed-jpeg' | 'malformed-webp',
) {
	if (width <= 0 || height <= 0)
		validationError(malformedCode, `${formatLabel} dimensions must both be positive.`);
	if (width > MAX_IMAGE_AXIS || height > MAX_IMAGE_AXIS) {
		validationError(
			'image-dimensions-exceeded',
			`${formatLabel} dimensions must not exceed ${MAX_IMAGE_AXIS} pixels per axis.`,
		);
	}
	if (width * height > MAX_IMAGE_PIXELS) {
		validationError(
			'image-pixels-exceeded',
			`${formatLabel} decoded pixels must not exceed ${MAX_IMAGE_PIXELS}.`,
		);
	}
}

function parseJpeg(bytes: Uint8Array) {
	if (!bytesStartWith(bytes, Uint8Array.of(0xFF, 0xD8)))
		validationError('invalid-jpeg-signature', 'Source bytes do not have the canonical JPEG signature.');

	let offset = 2;
	let width: number | undefined;
	let height: number | undefined;
	let colorModel: GraphicAssetImageFacts['colorModel'] | undefined;
	let foundFrame = false;
	let foundEnd = false;

	while (offset < bytes.byteLength) {
		if (bytes[offset] !== 0xFF)
			validationError('malformed-jpeg', 'JPEG marker framing is malformed.');
		while (bytes[offset] === 0xFF)
			offset++;
		const marker = bytes[offset++];
		if (marker === undefined)
			validationError('incomplete-jpeg-frame', 'JPEG ends inside a marker.');
		if (marker === 0xD9) {
			foundEnd = true;
			break;
		}
		if (marker === 0x00 || marker === 0xD8)
			validationError('malformed-jpeg', 'JPEG contains a misplaced marker.');
		if (marker >= 0xD0 && marker <= 0xD7)
			continue;
		if (offset + 2 > bytes.byteLength)
			validationError('incomplete-jpeg-frame', 'JPEG ends before a segment length is complete.');
		const segmentLength = readUint16BigEndian(bytes, offset);
		if (segmentLength < 2 || offset + segmentLength > bytes.byteLength)
			validationError('incomplete-jpeg-frame', 'JPEG segment exceeds the available source bytes.');
		const dataOffset = offset + 2;
		const dataLength = segmentLength - 2;

		if (marker === 0xE2 && ascii(bytes, dataOffset, Math.min(12, dataLength)) === 'ICC_PROFILE\0') {
			validationError(
				'unsupported-jpeg-profile',
				'Embedded JPEG colour profiles are not supported by still-image-v1.',
			);
		}
		if (marker === 0xE1) {
			const orientation = jpegExifOrientation(bytes, dataOffset, dataLength);
			if (orientation !== undefined && orientation !== 1) {
				validationError(
					'unsupported-image-orientation',
					'JPEG orientation must be absent or explicitly normal.',
				);
			}
			if (
				orientation === undefined
				&& ascii(bytes, dataOffset, Math.min(29, dataLength))
					.startsWith('http://ns.adobe.com/xap/1.0/')
			) {
				validationError(
					'unsupported-jpeg-profile',
					'Embedded JPEG XMP metadata is not supported by still-image-v1.',
				);
			}
		}

		if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
			if (foundFrame || dataLength < 6)
				validationError('malformed-jpeg', 'JPEG must contain exactly one complete frame header.');
			foundFrame = true;
			const precision = bytes[dataOffset]!;
			height = readUint16BigEndian(bytes, dataOffset + 1);
			width = readUint16BigEndian(bytes, dataOffset + 3);
			const components = bytes[dataOffset + 5]!;
			if (dataLength !== 6 + components * 3)
				validationError('malformed-jpeg', 'JPEG frame component evidence is malformed.');
			if (precision !== 8 || (components !== 1 && components !== 3)) {
				validationError(
					'unsupported-jpeg-colour',
					'JPEG must use supported 8-bit SDR grayscale or three-channel colour.',
				);
			}
			if (marker !== 0xC0 && marker !== 0xC2) {
				validationError(
					'unsupported-jpeg-colour',
					'JPEG must use sequential or progressive Huffman coding.',
				);
			}
			colorModel = components === 1 ? 'grayscale' : 'rgb';
			assertDimensions(width, height, 'JPEG', 'malformed-jpeg');
		}

		offset += segmentLength;
		if (marker !== 0xDA)
			continue;

		while (offset < bytes.byteLength) {
			if (bytes[offset++] !== 0xFF)
				continue;
			while (bytes[offset] === 0xFF)
				offset++;
			const entropyMarker = bytes[offset];
			if (entropyMarker === undefined)
				validationError('incomplete-jpeg-frame', 'JPEG entropy data is truncated.');
			if (entropyMarker === 0x00 || (entropyMarker >= 0xD0 && entropyMarker <= 0xD7)) {
				offset++;
				continue;
			}
			offset--;
			break;
		}
	}

	if (!foundFrame || width === undefined || height === undefined || !colorModel)
		validationError('incomplete-jpeg-frame', 'JPEG does not contain one complete frame.');
	if (!foundEnd || offset !== bytes.byteLength)
		validationError('incomplete-jpeg-frame', 'JPEG does not end exactly after its complete frame.');
	return { width, height, colorModel, hasAlpha: false as const };
}

function parseWebp(bytes: Uint8Array) {
	if (
		bytes.byteLength < 20
		|| ascii(bytes, 0, 4) !== 'RIFF'
		|| ascii(bytes, 8, 4) !== 'WEBP'
	) {
		validationError('invalid-webp-signature', 'Source bytes do not have the canonical WebP signature.');
	}
	if (readUint32LittleEndian(bytes, 4) !== bytes.byteLength - 8)
		validationError('malformed-webp', 'WebP RIFF length does not match the exact source bytes.');

	let offset = 12;
	let width: number | undefined;
	let height: number | undefined;
	let hasAlpha = false;
	let foundImagePayload = false;
	let extendedAlpha = false;

	while (offset < bytes.byteLength) {
		if (offset + 8 > bytes.byteLength)
			validationError('malformed-webp', 'WebP ends inside a chunk header.');
		const type = ascii(bytes, offset, 4);
		const length = readUint32LittleEndian(bytes, offset + 4);
		const dataOffset = offset + 8;
		const paddedLength = length + (length & 1);
		if (dataOffset + paddedLength > bytes.byteLength)
			validationError('malformed-webp', 'WebP chunk exceeds the available source bytes.');
		if ((length & 1) !== 0 && bytes[dataOffset + length] !== 0)
			validationError('malformed-webp', 'WebP chunk padding must be zero.');

		if (type === 'ANIM' || type === 'ANMF') {
			validationError(
				'unsupported-webp-animation',
				'Animated WebP is not supported by still-image-v1.',
			);
		}
		if (type === 'ICCP' || type === 'EXIF' || type === 'XMP ') {
			validationError(
				type === 'EXIF' ? 'unsupported-image-orientation' : 'unsupported-webp-profile',
				type === 'ICCP'
					? 'Embedded WebP colour profiles are not supported by still-image-v1.'
					: type === 'EXIF'
						? 'WebP orientation metadata is not supported by still-image-v1.'
						: 'Embedded WebP XMP metadata is not supported by still-image-v1.',
			);
		}
		if (type === 'VP8X') {
			if (
				offset !== 12
				|| length !== 10
				|| width !== undefined
				|| height !== undefined
				|| bytes[dataOffset + 1] !== 0
				|| bytes[dataOffset + 2] !== 0
				|| bytes[dataOffset + 3] !== 0
			) {
				validationError('malformed-webp', 'WebP extended header is malformed or duplicated.');
			}
			const flags = bytes[dataOffset]!;
			if ((flags & 0xC1) !== 0)
				validationError('malformed-webp', 'WebP extended header sets reserved feature bits.');
			if ((flags & 0x02) !== 0) {
				validationError(
					'unsupported-webp-animation',
					'Animated WebP is not supported by still-image-v1.',
				);
			}
			if ((flags & 0x20) !== 0) {
				validationError(
					'unsupported-webp-profile',
					'Embedded WebP colour profiles are not supported by still-image-v1.',
				);
			}
			if ((flags & 0x08) !== 0) {
				validationError(
					'unsupported-image-orientation',
					'WebP orientation metadata is not supported by still-image-v1.',
				);
			}
			if ((flags & 0x04) !== 0) {
				validationError(
					'unsupported-webp-profile',
					'Embedded WebP XMP metadata is not supported by still-image-v1.',
				);
			}
			extendedAlpha = (flags & 0x10) !== 0;
			width = readUint24LittleEndian(bytes, dataOffset + 4) + 1;
			height = readUint24LittleEndian(bytes, dataOffset + 7) + 1;
		}
		else if (type === 'VP8L') {
			if (foundImagePayload || length < 5 || bytes[dataOffset] !== 0x2F)
				validationError('malformed-webp', 'WebP lossless frame is malformed or duplicated.');
			foundImagePayload = true;
			const bits = readUint32LittleEndian(bytes, dataOffset + 1);
			if ((bits >>> 29) !== 0) {
				validationError(
					'unsupported-webp-profile',
					'WebP lossless format version must be zero for still-image-v1.',
				);
			}
			const payloadWidth = (bits & 0x3FFF) + 1;
			const payloadHeight = ((bits >>> 14) & 0x3FFF) + 1;
			hasAlpha = ((bits >>> 28) & 1) === 1;
			width ??= payloadWidth;
			height ??= payloadHeight;
			if (width !== payloadWidth || height !== payloadHeight)
				validationError('malformed-webp', 'WebP frame dimensions conflict with its canvas.');
		}
		else if (type === 'VP8 ') {
			if (
				foundImagePayload
				|| length < 10
				|| bytes[dataOffset + 3] !== 0x9D
				|| bytes[dataOffset + 4] !== 0x01
				|| bytes[dataOffset + 5] !== 0x2A
			) {
				validationError('malformed-webp', 'WebP lossy frame is malformed or duplicated.');
			}
			foundImagePayload = true;
			const payloadWidth = readUint16BigEndian(
				Uint8Array.of(bytes[dataOffset + 7]!, bytes[dataOffset + 6]!),
				0,
			) & 0x3FFF;
			const payloadHeight = readUint16BigEndian(
				Uint8Array.of(bytes[dataOffset + 9]!, bytes[dataOffset + 8]!),
				0,
			) & 0x3FFF;
			width ??= payloadWidth;
			height ??= payloadHeight;
			hasAlpha = extendedAlpha;
			if (width !== payloadWidth || height !== payloadHeight)
				validationError('malformed-webp', 'WebP frame dimensions conflict with its canvas.');
		}

		offset = dataOffset + paddedLength;
	}

	if (!foundImagePayload || width === undefined || height === undefined)
		validationError('incomplete-webp-frame', 'WebP does not contain one complete image frame.');
	assertDimensions(width, height, 'WebP', 'malformed-webp');
	return {
		width,
		height,
		colorModel: hasAlpha ? 'rgba' as const : 'rgb' as const,
		hasAlpha,
	};
}

function thumbnailPixels(image: ImageData) {
	const scale = Math.min(
		1,
		THUMBNAIL_MAX_WIDTH / image.width,
		THUMBNAIL_MAX_HEIGHT / image.height,
	);
	const width = Math.max(1, Math.floor(image.width * scale));
	const height = Math.max(1, Math.floor(image.height * scale));
	const pixels = new Uint8Array(width * height * 4);
	for (let targetY = 0; targetY < height; targetY++) {
		const sourceY = Math.min(image.height - 1, Math.floor(targetY / scale));
		for (let targetX = 0; targetX < width; targetX++) {
			const sourceX = Math.min(image.width - 1, Math.floor(targetX / scale));
			const sourceOffset = (sourceY * image.width + sourceX) * 4;
			pixels.set(image.data.subarray(sourceOffset, sourceOffset + 4), (targetY * width + targetX) * 4);
		}
	}
	return { width, height, pixels };
}

function validateDeclarations(
	format: GraphicAssetImageFacts['format'],
	canonicalMime: GraphicAssetImageFacts['canonicalMime'],
	declarations: StillImageDeclarations,
) {
	const extension = declarations.sourceFileName
		?.trim()
		.toLocaleLowerCase()
		.match(/\.([^.]+)$/)?.[1];
	const acceptedExtensions = format === 'jpeg' ? ['jpg', 'jpeg'] : [format];
	if (extension && !acceptedExtensions.includes(extension)) {
		validationError(
			'conflicting-image-extension',
			`Source extension .${extension} conflicts with canonical ${format.toUpperCase()} bytes.`,
		);
	}
	const declaredMime = declarations.declaredMime
		?.split(';', 1)[0]
		?.trim()
		.toLocaleLowerCase();
	if (declaredMime && declaredMime !== canonicalMime) {
		validationError(
			'conflicting-image-mime',
			`Declared MIME ${declaredMime} conflicts with canonical MIME ${canonicalMime}.`,
		);
	}
}

export async function processStillImage(
	bytes: Uint8Array,
	declarations: StillImageDeclarations = {},
): Promise<ProcessedStillImage> {
	if (bytesStartWith(bytes, PNG_SIGNATURE)) {
		validateDeclarations('png', 'image/png', declarations);
		return await processPng(bytes);
	}

	const isJpeg = bytesStartWith(bytes, Uint8Array.of(0xFF, 0xD8));
	const isWebp = bytes.byteLength >= 12
		&& ascii(bytes, 0, 4) === 'RIFF'
		&& ascii(bytes, 8, 4) === 'WEBP';
	if (!isJpeg && !isWebp)
		validationError('unsupported-image-format', 'Source bytes are not a supported PNG, JPEG, or WebP image.');

	const format = isJpeg ? 'jpeg' as const : 'webp' as const;
	const canonicalMime = isJpeg ? 'image/jpeg' as const : 'image/webp' as const;
	validateDeclarations(format, canonicalMime, declarations);
	const parsed = isJpeg ? parseJpeg(bytes) : parseWebp(bytes);
	let decoded: ImageData;
	try {
		const { decodeJpeg, decodeWebp } = await import('../../../runtime/graphics-still-image-codecs');
		const input = Uint8Array.from(bytes).buffer;
		decoded = isJpeg
			? await decodeJpeg(input)
			: await decodeWebp(input);
	}
	catch {
		validationError(
			isJpeg ? 'incomplete-jpeg-frame' : 'incomplete-webp-frame',
			`${isJpeg ? 'JPEG' : 'WebP'} does not contain one complete decodable frame.`,
		);
	}
	if (
		decoded.width !== parsed.width
		|| decoded.height !== parsed.height
		|| decoded.data.byteLength !== parsed.width * parsed.height * 4
	) {
		validationError(
			isJpeg ? 'incomplete-jpeg-frame' : 'incomplete-webp-frame',
			`${isJpeg ? 'JPEG' : 'WebP'} decoded frame conflicts with its bounded parser evidence.`,
		);
	}

	const thumbnail = thumbnailPixels(decoded);
	return {
		report: {
			outcome: 'accepted',
			compatibilityProfile: 'still-image-v1',
			issues: [],
			facts: {
				kind: 'image',
				format,
				canonicalMime,
				byteLength: bytes.byteLength,
				sha256: await sha256Hex(bytes),
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
		thumbnail: encodeThumbnail(thumbnail.width, thumbnail.height, thumbnail.pixels),
	};
}

export async function processStillImageStream(
	bytes: BoundedByteStream,
	sourceDigest: string,
	declarations: StillImageDeclarations = {},
): Promise<ProcessedStillImage> {
	const [sniffingBody, processingBody] = bytes.body.tee();
	const sniffingReader = sniffingBody.getReader();
	const signature = new Uint8Array(Math.min(12, bytes.byteLength));
	let signatureOffset = 0;
	try {
		while (signatureOffset < signature.byteLength) {
			const { done, value } = await sniffingReader.read();
			if (done)
				break;
			const copiedLength = Math.min(value.byteLength, signature.byteLength - signatureOffset);
			signature.set(value.subarray(0, copiedLength), signatureOffset);
			signatureOffset += copiedLength;
		}
	}
	finally {
		void sniffingReader.cancel().catch(() => undefined);
	}

	const processingStream = {
		...bytes,
		body: processingBody,
	};
	if (bytesStartWith(signature, PNG_SIGNATURE)) {
		validateDeclarations('png', 'image/png', declarations);
		return await processPngStream(processingStream, sourceDigest);
	}
	return await processStillImage(
		await consumeBoundedByteStream(processingStream),
		declarations,
	);
}

export function rejectedStillImageReport(
	error: StillImageValidationError | PngValidationError,
): GraphicAssetValidationReport {
	return error instanceof PngValidationError
		? rejectedPngReport(error)
		: {
				outcome: 'rejected',
				compatibilityProfile: 'still-image-v1',
				issues: [...error.issues],
			};
}

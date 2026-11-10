/** Minimal still images in the formats Graphics ingestion accepts beside PNG. */
import { Buffer } from 'node:buffer';
import { crc32, deflateSync } from 'node:zlib';

/** A valid 1×1 baseline JPEG. */
export const jpegPixel = Uint8Array.from(Buffer.from(
	'/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJtAEx7/2Q==',
	'base64',
));

/** A valid 1×1 lossless WebP. */
export const webpPixel = Uint8Array.from(Buffer.from(
	'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAEAdQlFKUp4CBiOh/AAA=',
	'base64',
));

/**
 * `jpegPixel` with a frame header declaring `width` × `height`: enough for the
 * bounded parser, which reads dimensions before anything is decoded.
 */
export function jpegDeclaring(width: number, height: number) {
	const bytes = Uint8Array.from(jpegPixel);
	const frame = bytes.findIndex((byte, index) => byte === 0xFF && bytes[index + 1] === 0xC0);
	if (frame < 0)
		throw new Error('The JPEG fixture has no baseline frame header');
	const view = new DataView(bytes.buffer);
	view.setUint16(frame + 5, height);
	view.setUint16(frame + 7, width);
	return bytes;
}

/** `webpPixel` with a lossless header declaring `width` × `height`, as `jpegDeclaring`. */
export function webpDeclaring(width: number, height: number) {
	const bytes = Uint8Array.from(webpPixel);
	const view = new DataView(bytes.buffer);
	const alphaAndVersion = view.getUint32(21, true) & 0xF0000000;
	view.setUint32(21, (alphaAndVersion | ((height - 1) << 14) | (width - 1)) >>> 0, true);
	return bytes;
}

/** A complete all-black 8-bit grayscale PNG of `width` × `height`. */
export function grayscalePng(width: number, height: number) {
	const chunk = (type: string, data: Uint8Array) => {
		const body = Buffer.concat([
			Buffer.from(type, 'ascii'),
			data,
		]);
		const framed = Buffer.alloc(body.byteLength + 8);
		framed.writeUInt32BE(data.byteLength, 0);
		framed.set(body, 4);
		framed.writeUInt32BE(crc32(body), body.byteLength + 4);
		return framed;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 0, 0, 0, 0], 8);
	return Uint8Array.from(Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(new Uint8Array((width + 1) * height))),
		chunk('IEND', new Uint8Array()),
	]));
}

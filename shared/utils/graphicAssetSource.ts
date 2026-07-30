import type { GraphicAssetSourceDeclarations } from '../types/graphicsAsset';

export type GraphicAssetSourceKind = 'image' | 'silent-video' | 'font';

const FONT_EXTENSION = /\.(?:woff2?|ttf|otf|eot|pfa|pfb|svg)$/i;
const FONT_MIME = /^(?:font\/|application\/(?:font-|x-font-|vnd\.ms-fontobject))/i;
const VIDEO_EXTENSION = /\.(?:mp4|webm|mov|mkv|m4v)$/i;
const VIDEO_MIME = /^video\//i;

function leadingAscii(bytes: Uint8Array) {
	return new TextDecoder().decode(bytes.subarray(0, Math.min(64, bytes.byteLength))).trimStart();
}

export function hasStaticFontSignature(bytes: Uint8Array) {
	if (bytes.byteLength >= 4) {
		const tag = String.fromCharCode(...bytes.subarray(0, 4));
		if (['wOF2', 'wOFF', 'OTTO', 'true', 'ttcf'].includes(tag))
			return true;
		if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
			return true;
	}
	const sourceStart = leadingAscii(bytes);
	return sourceStart.startsWith('%!PS')
		|| /^<\??(?:xml|svg)|^<svg/i.test(sourceStart);
}

export function graphicAssetSourceKind(
	declarations: GraphicAssetSourceDeclarations,
	leadingBytes?: Uint8Array,
): GraphicAssetSourceKind {
	if (
		FONT_MIME.test(declarations.declaredMime ?? '')
		|| FONT_EXTENSION.test(declarations.sourceFileName ?? '')
		|| (leadingBytes && hasStaticFontSignature(leadingBytes))
	) {
		return 'font';
	}
	if (
		VIDEO_MIME.test(declarations.declaredMime ?? '')
		|| VIDEO_EXTENSION.test(declarations.sourceFileName ?? '')
		|| (
			leadingBytes
			&& (
				String.fromCharCode(...leadingBytes.subarray(4, 8)) === 'ftyp'
				|| leadingBytes.subarray(0, 4).every((byte, index) => byte === [0x1A, 0x45, 0xDF, 0xA3][index])
			)
		)
	) {
		return 'silent-video';
	}
	return 'image';
}

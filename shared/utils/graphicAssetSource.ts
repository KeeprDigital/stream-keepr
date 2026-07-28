import type { GraphicAssetSourceDeclarations } from '../types/graphicsAsset';

export type GraphicAssetSourceKind = 'image' | 'font';

const FONT_EXTENSION = /\.(?:woff2?|ttf|otf|eot|pfa|pfb|svg)$/i;
const FONT_MIME = /^(?:font\/|application\/(?:font-|x-font-|vnd\.ms-fontobject))/i;

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
	return 'image';
}

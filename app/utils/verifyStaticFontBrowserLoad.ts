import type {
	GraphicAssetBrowserDecodeEvidence,
	GraphicAssetFontBrowserChallenge,
} from '~~/shared/types/graphicsAsset';
import { sha256Hex } from '~~/shared/utils/sha256';

async function pixelDigest(context: CanvasRenderingContext2D, fontFamily: string, text: string) {
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	context.font = `64px ${fontFamily}`;
	context.textBaseline = 'alphabetic';
	context.fillText(text, 12, 72);
	const pixels = context.getImageData(0, 0, context.canvas.width, context.canvas.height).data;
	return sha256Hex(pixels);
}

export async function verifyStaticFontBrowserLoad(
	source: Blob,
	challenge: GraphicAssetFontBrowserChallenge,
): Promise<GraphicAssetBrowserDecodeEvidence> {
	const bytes = await source.arrayBuffer();
	const sourceDigest = await sha256Hex(bytes);
	const family = `stream-keepr-font-validation-${sourceDigest}`;
	const face = new FontFace(family, bytes);
	try {
		await face.load();
	}
	catch {
		return {
			outcome: 'font-rejected',
			sourceDigest,
			challengeDigest: challenge.digest,
			stage: 'load',
		};
	}

	document.fonts.add(face);
	try {
		const canvas = document.createElement('canvas');
		canvas.width = 128;
		canvas.height = 96;
		const context = canvas.getContext('2d');
		if (!context) {
			return {
				outcome: 'font-rejected',
				sourceDigest,
				challengeDigest: challenge.digest,
				stage: 'render',
			};
		}
		const glyphProofs = [];
		for (const codePoint of challenge.codePoints) {
			const glyph = String.fromCodePoint(codePoint);
			await document.fonts.load(`64px "${family}"`, glyph);
			if (!document.fonts.check(`64px "${family}"`, glyph)) {
				return {
					outcome: 'font-rejected',
					sourceDigest,
					challengeDigest: challenge.digest,
					stage: 'render',
				};
			}
			const [
				exactWithSansDigest,
				exactWithMonoDigest,
				sansFallbackDigest,
				monoFallbackDigest,
			] = await Promise.all([
				pixelDigest(context, `"${family}", sans-serif`, glyph),
				pixelDigest(context, `"${family}", monospace`, glyph),
				pixelDigest(context, 'sans-serif', glyph),
				pixelDigest(context, 'monospace', glyph),
			]);
			if (
				exactWithSansDigest !== exactWithMonoDigest
				|| sansFallbackDigest === monoFallbackDigest
				|| exactWithSansDigest === sansFallbackDigest
				|| exactWithSansDigest === monoFallbackDigest
			) {
				return {
					outcome: 'font-rejected',
					sourceDigest,
					challengeDigest: challenge.digest,
					stage: 'render',
				};
			}
			glyphProofs.push({
				codePoint,
				exactWithSansDigest,
				exactWithMonoDigest,
				sansFallbackDigest,
				monoFallbackDigest,
			});
		}
		return {
			outcome: 'font-loaded',
			sourceDigest,
			challengeDigest: challenge.digest,
			glyphProofs,
		};
	}
	finally {
		document.fonts.delete(face);
	}
}

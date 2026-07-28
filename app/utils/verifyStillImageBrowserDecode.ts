import type { GraphicAssetBrowserDecodeEvidence } from '~~/shared/types/graphicsAsset';

export async function verifyStillImageBrowserDecode(
	source: Blob,
): Promise<GraphicAssetBrowserDecodeEvidence> {
	const sourceDigest = Array.from(
		new Uint8Array(await crypto.subtle.digest(
			'SHA-256',
			await source.arrayBuffer(),
		)),
		byte => byte.toString(16).padStart(2, '0'),
	).join('');
	try {
		if (typeof createImageBitmap === 'function') {
			const bitmap = await createImageBitmap(source);
			try {
				if (bitmap.width < 1 || bitmap.height < 1)
					throw new Error('The browser decoded an empty image.');
				return {
					outcome: 'decoded',
					sourceDigest,
					width: bitmap.width,
					height: bitmap.height,
				};
			}
			finally {
				bitmap.close();
			}
		}

		const objectUrl = URL.createObjectURL(source);
		try {
			const image = new Image();
			image.src = objectUrl;
			await image.decode();
			if (image.naturalWidth < 1 || image.naturalHeight < 1)
				throw new Error('The browser decoded an empty image.');
			return {
				outcome: 'decoded',
				sourceDigest,
				width: image.naturalWidth,
				height: image.naturalHeight,
			};
		}
		finally {
			URL.revokeObjectURL(objectUrl);
		}
	}
	catch {
		return { outcome: 'rejected', sourceDigest };
	}
}

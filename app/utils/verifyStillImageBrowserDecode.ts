export interface BrowserDecodedImageFacts {
	width: number;
	height: number;
}

export async function verifyStillImageBrowserDecode(
	source: Blob,
): Promise<BrowserDecodedImageFacts> {
	if (typeof createImageBitmap === 'function') {
		const bitmap = await createImageBitmap(source);
		try {
			if (bitmap.width < 1 || bitmap.height < 1)
				throw new Error('The browser decoded an empty image.');
			return { width: bitmap.width, height: bitmap.height };
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
		return { width: image.naturalWidth, height: image.naturalHeight };
	}
	finally {
		URL.revokeObjectURL(objectUrl);
	}
}

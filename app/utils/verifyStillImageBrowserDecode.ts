export async function verifyStillImageBrowserDecode(source: Blob): Promise<void> {
	if (typeof createImageBitmap === 'function') {
		const bitmap = await createImageBitmap(source);
		try {
			if (bitmap.width < 1 || bitmap.height < 1)
				throw new Error('The browser decoded an empty image.');
		}
		finally {
			bitmap.close();
		}
		return;
	}

	const objectUrl = URL.createObjectURL(source);
	try {
		const image = new Image();
		image.src = objectUrl;
		await image.decode();
		if (image.naturalWidth < 1 || image.naturalHeight < 1)
			throw new Error('The browser decoded an empty image.');
	}
	finally {
		URL.revokeObjectURL(objectUrl);
	}
}

/**
 * Fetches and decodes one image off-DOM, so a rendering that mounts it next
 * paints it whole on its first frame. Answers whether it loaded; a failed
 * image settles as `false` rather than rejecting.
 */
export function preloadImage(url: string): Promise<boolean> {
	if (!import.meta.client)
		return Promise.resolve(false);

	return new Promise((resolve) => {
		const image = new Image();
		let settled = false;

		const finish = (loaded: boolean) => {
			if (settled)
				return;
			settled = true;
			resolve(loaded);
		};

		const decode = () => {
			if (typeof image.decode === 'function') {
				image.decode().then(() => finish(true), () => finish(false));
				return;
			}
			finish(true);
		};

		image.onload = decode;
		image.onerror = () => finish(false);
		image.src = url;

		if (image.complete) {
			if ('naturalWidth' in image && image.naturalWidth === 0) {
				finish(false);
				return;
			}
			decode();
		}
	});
}

/** Preloads every distinct URL; answers the ones that failed. */
export async function preloadImages(urls: Iterable<string>): Promise<Set<string>> {
	const distinct = [
		...new Set(urls),
	].filter(url => url !== '');
	const results = await Promise.all(distinct.map(async url => [url, await preloadImage(url)] as const));
	return new Set(results.filter(([, loaded]) => !loaded).map(([url]) => url));
}

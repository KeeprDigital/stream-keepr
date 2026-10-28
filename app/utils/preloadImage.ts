/** One off-DOM image and whether it loaded and decoded; a failure settles as `false`. */
function loadImage(url: string): { image: HTMLImageElement; loaded: Promise<boolean> } {
	const image = new Image();
	const loaded = new Promise<boolean>((resolve) => {
		let settled = false;

		const finish = (result: boolean) => {
			if (settled)
				return;
			settled = true;
			resolve(result);
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
	return { image, loaded };
}

/**
 * Fetches and decodes one image off-DOM, so a rendering that mounts it next
 * paints it whole on its first frame. Answers whether it loaded; a failed
 * image settles as `false` rather than rejecting.
 */
export function preloadImage(url: string): Promise<boolean> {
	if (!import.meta.client)
		return Promise.resolve(false);
	return loadImage(url).loaded;
}

/** Preloads every distinct URL; answers the ones that failed. */
export async function preloadImages(urls: Iterable<string>): Promise<Set<string>> {
	const distinct = [
		...new Set(urls),
	].filter(url => url !== '');
	const results = await Promise.all(distinct.map(async url => [url, await preloadImage(url)] as const));
	return new Set(results.filter(([, loaded]) => !loaded).map(([url]) => url));
}

/**
 * Keeps a set of images loaded and decoded for as long as it is named. A
 * preload whose response may not be cached (a Screen Output's library content
 * is `no-store`) helps a later `<img>` only while the loaded image is still
 * held: the browser reuses an image already in the document by URL.
 */
export function createImageRetainer() {
	const held = new Map<string, HTMLImageElement>();

	return {
		/** Holds exactly `urls`, loading the ones not held yet and releasing the rest. */
		retain(urls: Iterable<string>) {
			if (!import.meta.client)
				return;
			const wanted = new Set([...urls].filter(url => url !== ''));
			for (const url of held.keys()) {
				if (!wanted.has(url))
					held.delete(url);
			}
			for (const url of wanted) {
				if (!held.has(url))
					held.set(url, loadImage(url).image);
			}
		},
		release() {
			held.clear();
		},
	};
}

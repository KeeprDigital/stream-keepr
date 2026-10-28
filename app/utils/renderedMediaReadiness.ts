/**
 * A rendered element still loading something no `<img>` or `<video>` shows,
 * such as media whose URL is not resolved yet or an Animation Effect whose
 * module is loading, carries this attribute until it has settled.
 */
export const RENDER_PENDING_ATTRIBUTE = 'data-render-pending';

function waitForNoPendingMarker(element: HTMLElement): Promise<void> {
	const selector = `[${RENDER_PENDING_ATTRIBUTE}]`;
	const settled = () => !element.matches(selector) && element.querySelector(selector) === null;
	if (settled())
		return Promise.resolve();

	return new Promise((resolve) => {
		const observer = new MutationObserver(() => {
			if (settled()) {
				observer.disconnect();
				resolve();
			}
		});
		observer.observe(element, {
			attributes: true,
			childList: true,
			subtree: true,
			attributeFilter: [RENDER_PENDING_ATTRIBUTE],
		});
	});
}

function hasSource(media: HTMLImageElement | HTMLVideoElement) {
	return Boolean(media.currentSrc || media.src || media.getAttribute('src'));
}

/** Settles once the image has loaded and decoded, or failed. */
export async function waitForImage(image: HTMLImageElement) {
	if (!hasSource(image))
		return;
	// `complete` is also true for a broken image, which fires nothing more.
	if (image.complete && image.naturalWidth === 0)
		return;

	if (typeof image.decode === 'function') {
		try {
			await image.decode();
			return;
		}
		catch {
			// Fall back to load/error listeners below; browsers may reject decode for cached cross-origin images.
		}
	}

	if (image.complete)
		return;
	await new Promise<void>((resolve) => {
		image.addEventListener('load', () => resolve(), { once: true });
		image.addEventListener('error', () => resolve(), { once: true });
	});
}

/** Settles once the video has its current frame, or failed. */
export async function waitForVideo(video: HTMLVideoElement) {
	if (!hasSource(video))
		return;
	if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA || video.error)
		return;

	await new Promise<void>((resolve) => {
		video.addEventListener('loadeddata', () => resolve(), { once: true });
		video.addEventListener('error', () => resolve(), { once: true });
	});
}

/**
 * Settles once everything rendered inside `element` has loaded or failed: no
 * pending marker remains, then every `<img>` and `<video>` it holds at that
 * point has settled.
 */
export async function waitForRenderedMedia(element: HTMLElement) {
	await waitForNoPendingMarker(element);
	await Promise.all([
		...Array.from(element.querySelectorAll('img'), waitForImage),
		...Array.from(element.querySelectorAll('video'), waitForVideo),
	]);
}

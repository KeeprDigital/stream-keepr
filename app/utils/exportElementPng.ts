export interface ExportElementPngOptions {
	width: number;
	height: number;
	filename: string;
	backgroundColor?: string;
	readinessTimeoutMs?: number;
}

interface ExportReadinessOptions {
	timeoutMs?: number;
}

const EXPORT_READINESS_SELECTOR = '[data-export-ready]';
const EXPORT_NOT_READY_SELECTOR = '[data-export-ready="false"]';

function nextFrame(): Promise<void> {
	return new Promise(resolve => (typeof requestAnimationFrame === 'function'
		? requestAnimationFrame(() => resolve())
		: setTimeout(resolve, 16)));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<undefined>((resolve) => {
				timeoutId = setTimeout(resolve, timeoutMs, undefined);
			}),
		]);
	}
	finally {
		if (timeoutId)
			clearTimeout(timeoutId);
	}
}

function waitForExportReadyMarkers(element: HTMLElement): Promise<void> {
	const isReady = () =>
		element.querySelector(EXPORT_READINESS_SELECTOR) !== null
		&& element.querySelector(EXPORT_NOT_READY_SELECTOR) === null;

	if (isReady())
		return Promise.resolve();

	return new Promise((resolve) => {
		const observer = new MutationObserver(() => {
			if (isReady()) {
				observer.disconnect();
				resolve();
			}
		});
		observer.observe(element, { attributes: true, childList: true, subtree: true, attributeFilter: ['data-export-ready'] });
	});
}

async function waitForFonts() {
	const fonts = document.fonts;
	if (fonts?.ready)
		await fonts.ready;
}

function imageHasSource(image: HTMLImageElement) {
	return Boolean(image.currentSrc || image.src || image.getAttribute('src'));
}

async function waitForImage(image: HTMLImageElement) {
	if (!imageHasSource(image) || (image.complete && image.naturalWidth > 0))
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

	await new Promise<void>((resolve) => {
		image.addEventListener('load', () => resolve(), { once: true });
		image.addEventListener('error', () => resolve(), { once: true });
	});
}

async function waitForImages(element: HTMLElement) {
	await Promise.all(Array.from(element.querySelectorAll('img')).map(waitForImage));
}

async function waitForVideo(video: HTMLVideoElement) {
	if (!video.currentSrc && !video.src && !video.getAttribute('src'))
		return;
	if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
		return;

	await new Promise<void>((resolve) => {
		video.addEventListener('loadeddata', () => resolve(), { once: true });
		video.addEventListener('error', () => resolve(), { once: true });
	});
}

async function waitForVideos(element: HTMLElement) {
	await Promise.all(Array.from(element.querySelectorAll('video')).map(waitForVideo));
}

export async function waitForElementExportReadiness(element: HTMLElement, options: ExportReadinessOptions = {}) {
	const timeoutMs = options.timeoutMs ?? 5000;
	await withTimeout(waitForExportReadyMarkers(element), timeoutMs);
	await withTimeout(Promise.all([waitForFonts(), waitForImages(element), waitForVideos(element)]).then(() => undefined), timeoutMs);
	await nextFrame();
	await nextFrame();
}

function inlineComputedStyles(source: Element, target: Element) {
	const computed = window.getComputedStyle(source);
	for (const property of computed) {
		target.setAttribute('style', `${target.getAttribute('style') ?? ''}${property}:${computed.getPropertyValue(property)};`);
	}

	const sourceChildren = Array.from(source.children);
	const targetChildren = Array.from(target.children);
	for (let i = 0; i < sourceChildren.length; i++) {
		const sourceChild = sourceChildren[i];
		const targetChild = targetChildren[i];
		if (sourceChild && targetChild) {
			inlineComputedStyles(sourceChild, targetChild);
		}
	}
}

function replaceCanvasSnapshots(source: Element, target: Element) {
	const sourceCanvases = Array.from(source.querySelectorAll('canvas'));
	const targetCanvases = Array.from(target.querySelectorAll('canvas'));

	for (const [index, sourceCanvas] of sourceCanvases.entries()) {
		const targetCanvas = targetCanvases[index];
		if (!targetCanvas)
			continue;

		try {
			const image = document.createElement('img');
			image.src = sourceCanvas.toDataURL('image/png');
			image.width = sourceCanvas.width;
			image.height = sourceCanvas.height;
			image.className = targetCanvas.className;
			image.setAttribute('style', targetCanvas.getAttribute('style') ?? '');
			image.setAttribute('aria-hidden', 'true');
			targetCanvas.replaceWith(image);
		}
		catch {
			// A tainted canvas cannot be serialized. Leave it in place so the rest of the export can continue.
		}
	}
}

function blobDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => typeof reader.result === 'string'
			? resolve(reader.result)
			: reject(new Error('Failed to read export image'));
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read export image'));
		reader.readAsDataURL(blob);
	});
}

function fetchedDataUrl(source: string, cache: Map<string, Promise<string>>, description: string) {
	let dataUrl = cache.get(source);
	if (!dataUrl) {
		dataUrl = fetch(source)
			.then((response) => {
				if (!response.ok)
					throw new Error(`Failed to load export ${description} (status ${response.status})`);
				return response.blob();
			})
			.then(blobDataUrl);
		cache.set(source, dataUrl);
	}
	return dataUrl;
}

function elementImageSource(element: Element): string {
	if (element instanceof HTMLImageElement)
		return element.currentSrc || element.src || element.getAttribute('src') || '';

	return element.getAttribute('href')
		|| element.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
		|| '';
}

/**
 * Replace image URLs in the detached export tree with their bytes.
 *
 * Drawing an SVG foreignObject that still references an ordinary URL taints the
 * destination canvas, including when the browser already displayed that image.
 * Once tainted, `toBlob()` is forbidden. A data URL makes the SVG self-contained
 * and preserves the exact image the output was showing.
 */
export async function inlineExportImageSources(source: Element, target: Element) {
	const sourceImages = Array.from(source.querySelectorAll('img, svg image'));
	const targetImages = Array.from(target.querySelectorAll('img, svg image'));
	const dataUrls = new Map<string, Promise<string>>();

	await Promise.all(sourceImages.map(async (sourceImage, index) => {
		const targetImage = targetImages[index];
		const imageSource = elementImageSource(sourceImage);
		if (!targetImage || !imageSource || imageSource.startsWith('data:'))
			return;

		const embeddedSource = await fetchedDataUrl(imageSource, dataUrls, 'image');
		if (targetImage instanceof HTMLImageElement) {
			targetImage.removeAttribute('srcset');
			targetImage.src = embeddedSource;
		}
		else {
			targetImage.setAttribute('href', embeddedSource);
			targetImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', embeddedSource);
		}
	}));
}

function videoFrameDataUrl(video: HTMLVideoElement) {
	const width = video.videoWidth || video.clientWidth;
	const height = video.videoHeight || video.clientHeight;
	if (width <= 0 || height <= 0)
		throw new Error('Video frame is not ready for export');

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context)
		throw new Error('Canvas is not available');
	context.drawImage(video, 0, 0, width, height);
	return canvas.toDataURL('image/png');
}

async function seekVideo(video: HTMLVideoElement, time: number) {
	if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(video.duration) || video.duration <= 0)
		return;

	const targetTime = Math.min(time, Math.max(0, video.duration - 0.001));
	await new Promise<void>((resolve) => {
		video.addEventListener('seeked', () => resolve(), { once: true });
		video.addEventListener('error', () => resolve(), { once: true });
		video.currentTime = targetTime;
	});
}

async function cleanVideoFrameDataUrl(video: HTMLVideoElement) {
	try {
		return videoFrameDataUrl(video);
	}
	catch (error) {
		if (!(error instanceof DOMException && error.name === 'SecurityError'))
			throw error;
	}

	const source = video.currentSrc || video.src || video.getAttribute('src');
	if (!source)
		throw new Error('Video source is unavailable for export');
	const response = await fetch(source);
	if (!response.ok)
		throw new Error(`Failed to load export video (status ${response.status})`);
	const objectUrl = URL.createObjectURL(await response.blob());
	try {
		const cleanVideo = document.createElement('video');
		cleanVideo.muted = true;
		cleanVideo.preload = 'auto';
		cleanVideo.src = objectUrl;
		await waitForVideo(cleanVideo);
		await seekVideo(cleanVideo, video.currentTime);
		return videoFrameDataUrl(cleanVideo);
	}
	finally {
		URL.revokeObjectURL(objectUrl);
	}
}

async function replaceVideoSnapshots(source: Element, target: Element) {
	const sourceVideos = Array.from(source.querySelectorAll('video'));
	const targetVideos = Array.from(target.querySelectorAll('video'));

	await Promise.all(sourceVideos.map(async (sourceVideo, index) => {
		const targetVideo = targetVideos[index];
		if (!targetVideo)
			return;

		const image = document.createElement('img');
		for (const attribute of Array.from(targetVideo.attributes)) {
			if (attribute.name !== 'src')
				image.setAttribute(attribute.name, attribute.value);
		}
		image.src = await cleanVideoFrameDataUrl(sourceVideo);
		image.alt = '';
		image.setAttribute('aria-hidden', 'true');
		targetVideo.replaceWith(image);
	}));
}

function cssUrls(style: string): string[] {
	return Array.from(style.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g), match => match[2] ?? '')
		.filter(Boolean);
}

function internalFragmentUrl(source: string): string | undefined {
	if (source.startsWith('#'))
		return source;
	try {
		const resolved = new URL(source, document.baseURI);
		const page = new URL(document.URL);
		if (
			resolved.origin === page.origin
			&& resolved.pathname === page.pathname
			&& resolved.search === page.search
			&& resolved.hash
		) {
			return resolved.hash;
		}
	}
	catch {
		// An unreadable URL will fail explicitly when fetched below.
	}
	return undefined;
}

/**
 * Computed styles can carry resources too (most notably icon masks and authored
 * backgrounds). They must obey the same self-contained rule as image elements.
 */
export async function inlineExportStyleUrls(target: Element) {
	const dataUrls = new Map<string, Promise<string>>();
	const elements = [target, ...Array.from(target.querySelectorAll('*'))];

	await Promise.all(elements.map(async (element) => {
		let style = element.getAttribute('style') ?? '';
		for (const source of new Set(cssUrls(style))) {
			if (source.startsWith('data:'))
				continue;
			const fragment = internalFragmentUrl(source);
			if (fragment) {
				style = style.split(source).join(fragment);
				continue;
			}
			const embeddedSource = await fetchedDataUrl(source, dataUrls, 'style resource');
			style = style.split(source).join(embeddedSource);
		}
		element.setAttribute('style', style);
	}));
}

interface ExportFontSource {
	family: string;
	url: string;
}

function exportFontSources(target: Element): ExportFontSource[] {
	const sources = new Map<string, ExportFontSource>();
	for (const marker of target.querySelectorAll('[data-export-font-sources]')) {
		const value = marker.getAttribute('data-export-font-sources');
		if (!value)
			continue;
		try {
			for (const source of JSON.parse(value) as ExportFontSource[]) {
				if (source?.family && source.url)
					sources.set(`${source.family}\0${source.url}`, source);
			}
		}
		catch {
			throw new Error('Export font metadata is invalid');
		}
		marker.removeAttribute('data-export-font-sources');
	}
	return [...sources.values()];
}

/**
 * A FontFace registered on the page still points at its external revision URL.
 * The detached SVG must define that family from embedded bytes of its own or the
 * browser marks the destination canvas as tainted when it paints text.
 */
export async function inlineExportFontSources(target: Element) {
	const sources = exportFontSources(target);
	if (sources.length === 0)
		return;

	const dataUrls = new Map<string, Promise<string>>();
	const declarations = await Promise.all(sources.map(async ({ family, url }) => {
		const dataUrl = await fetchedDataUrl(url, dataUrls, 'font');
		const escapedFamily = family.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
		return `@font-face{font-family:"${escapedFamily}";src:url("${dataUrl}")}`;
	}));
	const style = document.createElement('style');
	style.textContent = declarations.join('\n');
	target.insertBefore(style, target.firstChild);
}

function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

export async function exportElementPng(element: HTMLElement, options: ExportElementPngOptions) {
	await waitForElementExportReadiness(element, { timeoutMs: options.readinessTimeoutMs });

	const clone = element.cloneNode(true) as HTMLElement;
	inlineComputedStyles(element, clone);
	await inlineExportImageSources(element, clone);
	await replaceVideoSnapshots(element, clone);
	replaceCanvasSnapshots(element, clone);
	await inlineExportStyleUrls(clone);
	await inlineExportFontSources(clone);
	clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
	clone.style.width = `${options.width}px`;
	clone.style.height = `${options.height}px`;
	clone.style.margin = '0';
	clone.style.transform = 'none';
	clone.style.position = 'relative';
	if (options.backgroundColor) {
		clone.style.background = options.backgroundColor;
	}

	const serialized = new XMLSerializer().serializeToString(clone);
	const svg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}" viewBox="0 0 ${options.width} ${options.height}">
			<foreignObject width="100%" height="100%">${serialized}</foreignObject>
		</svg>`;

	const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
	// A blob URL containing foreignObject is treated as origin-unclean by Chrome.
	// Drawing it succeeds, but the destination canvas is then permanently tainted
	// and `toBlob()` throws. A data URL keeps the already-inlined SVG self-contained
	// and origin-clean.
	const svgDataUrl = await blobDataUrl(svgBlob);
	const image = new Image();
	await new Promise<void>((resolve, reject) => {
		image.onload = () => resolve();
		image.onerror = () => reject(new Error('Failed to render export image'));
		image.src = svgDataUrl;
	});

	const canvas = document.createElement('canvas');
	canvas.width = options.width;
	canvas.height = options.height;
	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Canvas is not available');
	}
	if (options.backgroundColor) {
		context.fillStyle = options.backgroundColor;
		context.fillRect(0, 0, options.width, options.height);
	}
	context.drawImage(image, 0, 0, options.width, options.height);

	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((result) => {
			if (result)
				resolve(result);
			else
				reject(new Error('Failed to encode PNG'));
		}, 'image/png');
	});
	downloadBlob(blob, options.filename);
}

export function buildFeatureMatchOverlayExportFilename(params: {
	screenSlug: string;
	output: string;
	width: number;
	height: number;
	timestamp?: Date;
}) {
	const timestamp = (params.timestamp ?? new Date()).toISOString().replace(/[:.]/g, '-');
	return `${params.screenSlug}-feature-match-overlay-${params.output}-${params.width}x${params.height}-${timestamp}.png`;
}

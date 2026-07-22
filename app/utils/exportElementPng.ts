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

const EXPORT_READY_SELECTOR = '[data-export-ready="false"]';

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
	if (!element.querySelector(EXPORT_READY_SELECTOR))
		return Promise.resolve();

	return new Promise((resolve) => {
		const observer = new MutationObserver(() => {
			if (!element.querySelector(EXPORT_READY_SELECTOR)) {
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

export async function waitForElementExportReadiness(element: HTMLElement, options: ExportReadinessOptions = {}) {
	const timeoutMs = options.timeoutMs ?? 5000;
	await withTimeout(waitForExportReadyMarkers(element), timeoutMs);
	await withTimeout(Promise.all([waitForFonts(), waitForImages(element)]).then(() => undefined), timeoutMs);
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
	replaceCanvasSnapshots(element, clone);
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
	const url = URL.createObjectURL(svgBlob);
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Failed to render export image'));
			image.src = url;
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
	finally {
		URL.revokeObjectURL(url);
	}
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

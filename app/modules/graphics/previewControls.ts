/**
 * Zooming and panning an editor preview. View state only: nothing here writes,
 * and a preview starts at Fit on every visit.
 */

/** Fit, or a scale where 1 draws one canvas pixel per CSS pixel. */
export type PreviewZoom = 'fit' | number;

export const PREVIEW_ZOOM_OPTIONS = [
	{ label: 'Fit', value: 'fit' },
	{ label: '50%', value: 0.5 },
	{ label: '100%', value: 1 },
] as const satisfies ReadonlyArray<{ label: string; value: PreviewZoom }>;

/** The zoom range, 10–800%. */
export const PREVIEW_ZOOM_MIN = 0.1;
export const PREVIEW_ZOOM_MAX = 8;

export function clampPreviewZoom(scale: number): number {
	return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, scale));
}

/** Pixels a line-mode wheel step stands for. */
const WHEEL_LINE_PIXELS = 16;
/** How far one pixel of wheel travel zooms, as an exponent, so a step in and a step out cancel. */
const WHEEL_ZOOM_RATE = 0.002;

/** The scale a ⌘/Ctrl wheel or trackpad pinch takes the preview to. */
export function wheelPreviewZoom(scale: number, wheel: { deltaY: number; deltaMode: number }): number {
	const pixels = wheel.deltaMode === 1
		? wheel.deltaY * WHEEL_LINE_PIXELS
		: wheel.deltaY;
	return clampPreviewZoom(scale * Math.exp(-pixels * WHEEL_ZOOM_RATE));
}

/** A position in CSS pixels. */
export interface PreviewPoint { x: number; y: number }

const SHORTCUT_ZOOM: Record<string, PreviewZoom> = {
	0: 'fit',
	1: 1,
	Digit0: 'fit',
	Digit1: 1,
};

/**
 * ⌘0 / Ctrl-0 fits, ⌘1 / Ctrl-1 is 100%; nothing else is the preview's. The
 * digit is read from the key or, where a layout needs Shift to type it (AZERTY),
 * from the physical key.
 */
export function previewZoomShortcut(event: {
	key: string;
	code?: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}): PreviewZoom | null {
	if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey)
		return null;
	return SHORTCUT_ZOOM[event.key] ?? SHORTCUT_ZOOM[event.code ?? ''] ?? null;
}

interface Size { width: number; height: number }

/**
 * Where to scroll a preview whose scale changes, so the canvas point under the
 * pointer stays under it. A canvas drawn smaller than the view is centred in it,
 * with nothing to scroll.
 */
export function previewZoomScroll(input: {
	canvas: Size;
	/** The scrolling view's visible size. */
	client: Size;
	scroll: { left: number; top: number };
	/** The pointer, relative to the view's visible top-left. */
	pointer: PreviewPoint;
	from: number;
	to: number;
}): { left: number; top: number } {
	const axis = (size: 'width' | 'height', scroll: number, pointer: number) => {
		const offset = (scale: number) => Math.max(0, (input.client[size] - input.canvas[size] * scale) / 2);
		const point = (scroll + pointer - offset(input.from)) / input.from;
		const next = point * input.to + offset(input.to) - pointer;
		const max = Math.max(0, input.canvas[size] * input.to - input.client[size]);
		return Math.round(Math.min(max, Math.max(0, next)));
	};
	return {
		left: axis('width', input.scroll.left, input.pointer.x),
		top: axis('height', input.scroll.top, input.pointer.y),
	};
}

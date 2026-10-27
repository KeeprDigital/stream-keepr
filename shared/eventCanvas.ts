/**
 * The Event Canvas (ADR-0051): the pixel coordinate space every Screen of an
 * Event is authored and rendered in. Every Screen Output scales it uniformly
 * to fit its window, so output resolution is the browser source's to set.
 */
export interface EventCanvas {
	width: number;
	height: number;
}

export const DEFAULT_EVENT_CANVAS: Readonly<EventCanvas> = { width: 1920, height: 1080 };

/** What each side of an Event Canvas may be, in canvas pixels. */
export const EVENT_CANVAS_SIDE_BOUNDS = { min: 100, max: 7680 } as const;

/** The Event Canvas an Event sets, or the default for one not yet read. */
export function eventCanvasOf(event: { canvasWidth?: number; canvasHeight?: number } | null | undefined): EventCanvas {
	return {
		width: event?.canvasWidth ?? DEFAULT_EVENT_CANVAS.width,
		height: event?.canvasHeight ?? DEFAULT_EVENT_CANVAS.height,
	};
}

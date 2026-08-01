import type { ScreenOutput } from '../types/screenConfig';

export const SCREEN_OUTPUT_VALUES: ScreenOutput[] = ['overlay', 'fill', 'key'];

/**
 * Resolve the Screen Output selection carried on a Screen's one stable URL. An
 * omitted or invalid selection renders the Overlay Output.
 */
export function parseScreenOutput(value: unknown): { output: ScreenOutput; warning: string | null } {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw === undefined || raw === null || raw === '')
		return { output: 'overlay', warning: null };
	if (raw === 'overlay' || raw === 'fill' || raw === 'key')
		return { output: raw, warning: null };

	return { output: 'overlay', warning: `Invalid output mode "${String(raw)}"; rendering overlay.` };
}

/** The one black every Screen Output composes over when it is not transparent. */
export const SCREEN_OUTPUT_BLACK = '#000000';

/**
 * Whether a Screen Output composes over black rather than transparency.
 *
 * The single source of this rule: an empty Screen is transparent in its Overlay
 * Output and black in its Fill Output and Key Output. The live composed canvas
 * and the PNG capture both derive from here so a capture can never diverge from
 * the output it captures.
 */
export function screenOutputCompositesOverBlack(output: ScreenOutput): boolean {
	return output !== 'overlay';
}

/** The CSS background of the composed canvas for a Screen Output. */
export function screenOutputCanvasBackground(output: ScreenOutput): string {
	return screenOutputCompositesOverBlack(output) ? SCREEN_OUTPUT_BLACK : 'transparent';
}

/** The capture background for a Screen Output; omitted for the transparent Overlay Output. */
export function screenOutputBackground(output: ScreenOutput): string | undefined {
	return screenOutputCompositesOverBlack(output) ? SCREEN_OUTPUT_BLACK : undefined;
}

export interface ScreenOutputPathOptions {
	eventId: number;
	screenSlug: string;
	/** Omitted renders the Overlay Output. */
	output?: ScreenOutput;
	/** Scale the canvas to fit the embedding viewport. */
	fitToViewport?: boolean;
	/**
	 * Mark this as an embedded editor preview.
	 *
	 * Editor-only guides and the Feature Match Sample Dataset are available only to a
	 * preview, so a Screen Output URL that omits this can never show either. What
	 * makes that a barrier rather than a convention is that this flag does not
	 * decorate a live output — it selects a rendering that cannot be one: no realtime
	 * session, Graphic Asset content resolved through the author session rather than
	 * the Screen Output Asset Capability, and a checkerboard behind the Overlay
	 * Output. See `displaySession.ts` for the decision and its cost (issue #134).
	 */
	preview?: boolean;
	itemGuides?: boolean;
	safeAreaGuides?: boolean;
	/** Capture the output as a PNG from a temporary tab. */
	download?: boolean;
	/**
	 * The Screen Output Asset Capability this output resolves its Graphic Asset
	 * Revisions with. Without one, an output that is not an editor preview renders
	 * no media at all: it has no other route to the bytes, by design.
	 *
	 * Carried in the URL fragment rather than the query, so it is never sent to the
	 * server as part of the navigation and stays out of request logs.
	 */
	assetCapability?: string | null;
}

/**
 * The one stable Screen URL for a Screen Output, with its output selection, any
 * preview flags, and any asset capability. Built here so every embedder agrees on
 * the query — and so an embedder cannot forget the capability its output needs to
 * show media.
 */
export function screenOutputPath(options: ScreenOutputPathOptions): string {
	const query = new URLSearchParams({ output: options.output ?? 'overlay' });
	if (options.fitToViewport)
		query.set('fit', '1');
	if (options.preview)
		query.set('preview', '1');
	if (options.itemGuides)
		query.set('guides', '1');
	if (options.safeAreaGuides)
		query.set('safe', '1');
	if (options.download)
		query.set('download', '1');

	const fragment = options.assetCapability
		? `#asset-capability=${encodeURIComponent(options.assetCapability)}`
		: '';

	return `/event/${options.eventId}/screen/${options.screenSlug}?${query.toString()}${fragment}`;
}

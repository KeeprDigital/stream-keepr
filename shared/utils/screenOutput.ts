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
	/**
	 * Mark this as an embedded editor preview.
	 *
	 * Editor-only guides and the Feature Match Sample Dataset are available only to a
	 * preview, so a Screen Output URL that omits this can never show either — and the
	 * copyable broadcast URLs and the PNG capture URL never ask for it. What that does
	 * and does not guarantee is worked out over the guide flags in
	 * `app/modules/screen/displaySession.ts`, which is the one place it is written
	 * down (issue #134).
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
 *
 * Deliberately carries no scaling flag. Uniform viewport-fit scaling is registered
 * by the Screen Mode Definition and applies to every output of a mode that
 * registers it; it was a URL option only for as long as it took someone to open an
 * output the editor had not built the URL for (#232).
 */
export function screenOutputPath(options: ScreenOutputPathOptions): string {
	const query = new URLSearchParams({ output: options.output ?? 'overlay' });
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

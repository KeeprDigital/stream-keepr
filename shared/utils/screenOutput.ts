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

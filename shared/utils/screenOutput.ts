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

/** The capture background for a Screen Output: transparency for overlay, black for fill and key. */
export function screenOutputBackground(output: ScreenOutput): string | undefined {
	return output === 'overlay' ? undefined : '#000000';
}

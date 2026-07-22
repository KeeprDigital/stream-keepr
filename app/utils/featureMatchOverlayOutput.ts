import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';

export const FEATURE_MATCH_OVERLAY_OUTPUTS: FeatureMatchOverlayOutput[] = ['overlay', 'fill', 'key'];

export function parseFeatureMatchOverlayOutput(value: unknown): { output: FeatureMatchOverlayOutput; warning: string | null } {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw === undefined || raw === null || raw === '') {
		return { output: 'overlay', warning: null };
	}
	if (raw === 'overlay' || raw === 'fill' || raw === 'key') {
		return { output: raw, warning: null };
	}
	return { output: 'overlay', warning: `Invalid output mode "${String(raw)}"; rendering overlay.` };
}

export function featureMatchOverlayOutputBackground(output: FeatureMatchOverlayOutput): string | undefined {
	return output === 'overlay' ? undefined : '#000000';
}

export const FEATURE_MATCH_OVERLAY_FONT_IDS = [
	'saira-condensed',
	'ibm-plex-sans',
	'inter',
	'inconsolata',
	'mplantin',
	'system-sans',
	'system-serif',
	'system-mono',
] as const;

export type FeatureMatchOverlayFontId = typeof FEATURE_MATCH_OVERLAY_FONT_IDS[number];

export interface FeatureMatchOverlayFontDefinition {
	id: FeatureMatchOverlayFontId;
	label: string;
	cssFamily: string;
	category: 'display' | 'body' | 'mono' | 'serif' | 'system';
}

export const FEATURE_MATCH_OVERLAY_FONTS: readonly FeatureMatchOverlayFontDefinition[] = [
	{
		id: 'saira-condensed',
		label: 'Saira Condensed',
		cssFamily: 'var(--font-saira-condensed)',
		category: 'display',
	},
	{
		id: 'ibm-plex-sans',
		label: 'IBM Plex Sans',
		cssFamily: 'var(--font-ibm-plex-sans)',
		category: 'body',
	},
	{
		id: 'inter',
		label: 'Inter',
		cssFamily: 'var(--font-inter)',
		category: 'body',
	},
	{
		id: 'inconsolata',
		label: 'Inconsolata',
		cssFamily: 'var(--font-inconsolata)',
		category: 'mono',
	},
	{
		id: 'mplantin',
		label: 'MPlantin',
		cssFamily: 'var(--font-mplantin)',
		category: 'serif',
	},
	{
		id: 'system-sans',
		label: 'System Sans',
		cssFamily: 'var(--font-system-sans)',
		category: 'system',
	},
	{
		id: 'system-serif',
		label: 'System Serif',
		cssFamily: 'var(--font-system-serif)',
		category: 'system',
	},
	{
		id: 'system-mono',
		label: 'System Mono',
		cssFamily: 'var(--font-system-mono)',
		category: 'system',
	},
];

const FEATURE_MATCH_OVERLAY_FONT_MAP = new Map<FeatureMatchOverlayFontId, FeatureMatchOverlayFontDefinition>(
	FEATURE_MATCH_OVERLAY_FONTS.map(font => [font.id, font]),
);

export function getFeatureMatchOverlayFontDefinition(value: string | null | undefined) {
	const normalized = value?.trim();
	return normalized ? FEATURE_MATCH_OVERLAY_FONT_MAP.get(normalized as FeatureMatchOverlayFontId) : undefined;
}

export function resolveFeatureMatchOverlayFontFamily(value: string | null | undefined) {
	const normalized = value?.trim();
	if (!normalized)
		return undefined;

	return getFeatureMatchOverlayFontDefinition(normalized)?.cssFamily ?? normalized;
}

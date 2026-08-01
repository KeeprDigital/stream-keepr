import type { GraphicAssetReference } from '../../types/graphicsAsset';
import type { GraphicFontSelection } from '../../types/graphics';

/**
 * The one application font registry every graphics host shares, and how a
 * Graphic Font Selection becomes a CSS `font-family`.
 *
 * The registry is defined here rather than aliased from a host-named module on
 * purpose. There is one registry, both graphics hosts speak it, and a name that
 * belonged to one of them implied a split the value never had — which is the
 * misreading #138 was filed over and #145 closed at the definition site.
 *
 * These are the fonts that ship with Stream Keepr. A font from the Graphics
 * Asset Library is not in here at all: it resolves through its own Graphic Asset
 * Reference, under a family name derived from the exact revision it pins.
 */

export const GRAPHIC_FONT_IDS = [
	'saira-condensed',
	'ibm-plex-sans',
	'inter',
	'inconsolata',
	'mplantin',
	'system-sans',
	'system-serif',
	'system-mono',
] as const;

export type GraphicApplicationFontId = typeof GRAPHIC_FONT_IDS[number];

export interface GraphicFontDefinition {
	id: GraphicApplicationFontId;
	label: string;
	cssFamily: string;
	category: 'display' | 'body' | 'mono' | 'serif' | 'system';
}

export const GRAPHIC_FONTS: readonly GraphicFontDefinition[] = [
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

const GRAPHIC_FONT_MAP = new Map<GraphicApplicationFontId, GraphicFontDefinition>(
	GRAPHIC_FONTS.map(font => [font.id, font]),
);

export function getGraphicFontDefinition(value: string | null | undefined) {
	const normalized = value?.trim();
	return normalized ? GRAPHIC_FONT_MAP.get(normalized as GraphicApplicationFontId) : undefined;
}

export const GRAPHIC_FONT_OPTIONS = GRAPHIC_FONTS.map(font => ({
	label: font.label,
	value: font.id,
}));

/**
 * The CSS family name one exact font Graphic Asset Revision is loaded under.
 *
 * Derived from the revision rather than from the asset, so two revisions of the
 * same font are two `FontFace`s and a pinned reference always paints the bytes it
 * pinned. Sanitised because the family name reaches CSS.
 */
export function graphicAssetFontFaceFamily(reference: GraphicAssetReference) {
	const identity = `${reference.assetId}-${reference.revisionId}`.replace(/[^\w-]/g, '_');
	return `stream-keepr-graphic-asset-${identity}`;
}

/**
 * A Graphic Font Selection as a CSS `font-family`.
 *
 * An application font resolves to the custom property its bundled `@font-face`
 * declares. A library font resolves to the quoted family its `FontFace` is
 * registered under — which is a promise about the family *name*, not about the
 * bytes being loaded yet: whoever renders the selection is the one that loads it.
 *
 * An application id outside the registry resolves to nothing rather than to a raw
 * CSS stack. A font this installation does not have is a font it cannot paint,
 * and saying so is what makes the Template Package's `application-font`
 * capability check meaningful.
 */
export function resolveGraphicFontFamily(font: GraphicFontSelection | undefined): string | undefined {
	if (!font)
		return undefined;
	if (font.kind === 'asset')
		return `"${graphicAssetFontFaceFamily(font.reference)}"`;
	return getGraphicFontDefinition(font.fontId)?.cssFamily;
}

import type { GraphicFontSelection } from '../../types/graphics';
import type { GraphicAssetReference } from '../../types/graphicsAsset';

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
	'inter',
	'ibm-plex-sans',
	'arimo',
	'roboto',
	'poppins',
	'open-sans',
	'montserrat',
	'saira-condensed',
	'roboto-condensed',
	'oswald',
	'barlow-condensed',
	'source-serif-4',
	'jetbrains-mono',
	'system-sans',
	'system-serif',
	'system-mono',
] as const;

export type GraphicApplicationFontId = typeof GRAPHIC_FONT_IDS[number];

/**
 * The application font a newly authored Graphic Item gets, and the one an author
 * returns to when they unpin a library font.
 *
 * Named rather than positional. "First in the registry" is the picker's order,
 * not a statement about what a body of text should default to.
 */
export const DEFAULT_GRAPHIC_FONT_ID: GraphicApplicationFontId = 'inter';

export type GraphicFontCategory = 'sans' | 'condensed' | 'serif' | 'mono' | 'system';

export interface GraphicFontPackage {
	/** npm name, e.g. '@fontsource/inter'. */
	name: string;
	/** The CSS family the package's faces are emitted under, e.g. 'Inter'. */
	family: string;
	weights: readonly number[];
	italic: boolean;
}

export interface GraphicFontDefinition {
	id: GraphicApplicationFontId;
	label: string;
	/** `var(--font-<id>)`. */
	cssFamily: string;
	/** The value of `--font-<id>`, e.g. `'Inter', sans-serif`. */
	stack: string;
	category: GraphicFontCategory;
	/** Absent for a system stack. */
	package?: GraphicFontPackage;
}

/** Every hundred from `from` to `to`, the weights a static Fontsource package ships. */
function weightsFrom(from: number, to: number) {
	return Array.from({ length: (to - from) / 100 + 1 }, (_, step) => from + step * 100);
}

export const GRAPHIC_FONTS: readonly GraphicFontDefinition[] = [
	{
		id: 'inter',
		label: 'Inter',
		cssFamily: 'var(--font-inter)',
		stack: '\'Inter\', sans-serif',
		category: 'sans',
		package: {
			name: '@fontsource/inter',
			family: 'Inter',
			weights: weightsFrom(100, 900),
			italic: true,
		},
	},
	{
		id: 'ibm-plex-sans',
		label: 'IBM Plex Sans',
		cssFamily: 'var(--font-ibm-plex-sans)',
		stack: '\'IBM Plex Sans\', sans-serif',
		category: 'sans',
		package: {
			name: '@fontsource/ibm-plex-sans',
			family: 'IBM Plex Sans',
			weights: weightsFrom(100, 700),
			italic: true,
		},
	},
	{
		id: 'arimo',
		label: 'Arimo',
		cssFamily: 'var(--font-arimo)',
		stack: '\'Arimo\', sans-serif',
		category: 'sans',
		package: {
			name: '@fontsource/arimo',
			family: 'Arimo',
			weights: weightsFrom(400, 700),
			italic: true,
		},
	},
	{
		id: 'roboto',
		label: 'Roboto',
		cssFamily: 'var(--font-roboto)',
		stack: '\'Roboto\', sans-serif',
		category: 'sans',
		package: {
			name: '@fontsource/roboto',
			family: 'Roboto',
			weights: weightsFrom(100, 900),
			italic: true,
		},
	},
	{
		id: 'poppins',
		label: 'Poppins',
		cssFamily: 'var(--font-poppins)',
		stack: '\'Poppins\', sans-serif',
		category: 'sans',
		package: {
			name: '@fontsource/poppins',
			family: 'Poppins',
			weights: weightsFrom(100, 900),
			italic: true,
		},
	},
	{
		id: 'open-sans',
		label: 'Open Sans',
		cssFamily: 'var(--font-open-sans)',
		stack: '\'Open Sans\', sans-serif',
		category: 'sans',
		package: {
			name: '@fontsource/open-sans',
			family: 'Open Sans',
			weights: weightsFrom(300, 800),
			italic: true,
		},
	},
	{
		id: 'montserrat',
		label: 'Montserrat',
		cssFamily: 'var(--font-montserrat)',
		stack: '\'Montserrat\', sans-serif',
		category: 'sans',
		package: {
			name: '@fontsource/montserrat',
			family: 'Montserrat',
			weights: weightsFrom(100, 900),
			italic: true,
		},
	},
	{
		id: 'saira-condensed',
		label: 'Saira Condensed',
		cssFamily: 'var(--font-saira-condensed)',
		stack: '\'Saira Condensed\', \'IBM Plex Sans\', \'Inter\', sans-serif',
		category: 'condensed',
		package: {
			name: '@fontsource/saira-condensed',
			family: 'Saira Condensed',
			weights: weightsFrom(100, 900),
			italic: false,
		},
	},
	{
		id: 'roboto-condensed',
		label: 'Roboto Condensed',
		cssFamily: 'var(--font-roboto-condensed)',
		stack: '\'Roboto Condensed\', sans-serif',
		category: 'condensed',
		package: {
			name: '@fontsource/roboto-condensed',
			family: 'Roboto Condensed',
			weights: weightsFrom(100, 900),
			italic: true,
		},
	},
	{
		id: 'oswald',
		label: 'Oswald',
		cssFamily: 'var(--font-oswald)',
		stack: '\'Oswald\', sans-serif',
		category: 'condensed',
		package: {
			name: '@fontsource/oswald',
			family: 'Oswald',
			weights: weightsFrom(200, 700),
			italic: false,
		},
	},
	{
		id: 'barlow-condensed',
		label: 'Barlow Condensed',
		cssFamily: 'var(--font-barlow-condensed)',
		stack: '\'Barlow Condensed\', sans-serif',
		category: 'condensed',
		package: {
			name: '@fontsource/barlow-condensed',
			family: 'Barlow Condensed',
			weights: weightsFrom(100, 900),
			italic: true,
		},
	},
	{
		id: 'source-serif-4',
		label: 'Source Serif 4',
		cssFamily: 'var(--font-source-serif-4)',
		stack: '\'Source Serif 4\', serif',
		category: 'serif',
		package: {
			name: '@fontsource/source-serif-4',
			family: 'Source Serif 4',
			weights: weightsFrom(200, 900),
			italic: true,
		},
	},
	{
		id: 'jetbrains-mono',
		label: 'JetBrains Mono',
		cssFamily: 'var(--font-jetbrains-mono)',
		stack: '\'JetBrains Mono\', monospace',
		category: 'mono',
		package: {
			name: '@fontsource/jetbrains-mono',
			family: 'JetBrains Mono',
			weights: weightsFrom(100, 800),
			italic: true,
		},
	},
	{
		id: 'system-sans',
		label: 'System Sans',
		cssFamily: 'var(--font-system-sans)',
		stack: 'system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif',
		category: 'system',
	},
	{
		id: 'system-serif',
		label: 'System Serif',
		cssFamily: 'var(--font-system-serif)',
		stack: 'Georgia, \'Times New Roman\', serif',
		category: 'system',
	},
	{
		id: 'system-mono',
		label: 'System Mono',
		cssFamily: 'var(--font-system-mono)',
		stack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \'Liberation Mono\', monospace',
		category: 'system',
	},
];

const GRAPHIC_FONT_MAP = new Map<GraphicApplicationFontId, GraphicFontDefinition>(
	GRAPHIC_FONTS.map(font => [font.id, font]),
);

export function getGraphicFontDefinition(value: string | null | undefined) {
	const normalized = value?.trim();
	return normalized
		? GRAPHIC_FONT_MAP.get(normalized as GraphicApplicationFontId)
		: undefined;
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

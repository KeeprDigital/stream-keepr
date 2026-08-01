import { GRAPHIC_STYLE_SET_PACKAGE_EXTENSION, GRAPHIC_STYLE_SET_PACKAGE_KIND } from '~~/shared/types/graphicStyleSetPackage';
import { TEMPLATE_PACKAGE_ARTIFACTS } from '~~/shared/types/templatePackage';

/**
 * The portable graphics artifacts a library can be handed, as an author reads them.
 *
 * The noun and the accepted file extension are two facts about one artifact kind, so
 * they travel as one. Carried as separate free-text props nothing tied them together,
 * and the types permitted a picker offering to import a "Graphic Style Set Package"
 * from a `.skgraphic` — which is exactly what one component test was mounting.
 *
 * The extensions are not restated here: they come from the envelope vocabulary that
 * already owns them, so a package kind cannot be offered under an extension its own
 * exporter does not emit.
 *
 * Both Template Package kinds share one noun, because a Template Package means the
 * same thing whichever template it carries. That is the reason the pairing needed a
 * table rather than a single derived string.
 */
export const GRAPHICS_PACKAGE_ARTIFACTS = {
	skgraphic: {
		noun: 'Template Package',
		accept: TEMPLATE_PACKAGE_ARTIFACTS.skgraphic.extension,
	},
	sklayout: {
		noun: 'Template Package',
		accept: TEMPLATE_PACKAGE_ARTIFACTS.sklayout.extension,
	},
	[GRAPHIC_STYLE_SET_PACKAGE_KIND]: {
		noun: 'Graphic Style Set Package',
		accept: GRAPHIC_STYLE_SET_PACKAGE_EXTENSION,
	},
} as const satisfies Record<string, { noun: string; accept: string }>;

export type GraphicsPackageArtifactKind = keyof typeof GRAPHICS_PACKAGE_ARTIFACTS;

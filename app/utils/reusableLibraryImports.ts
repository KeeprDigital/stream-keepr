import { GRAPHIC_STYLE_SET_PACKAGE_EXTENSION, GRAPHIC_STYLE_SET_PACKAGE_KIND } from '~~/shared/types/graphicStyleSetPackage';
import { TEMPLATE_PACKAGE_ARTIFACTS } from '~~/shared/types/templatePackage';

/**
 * What a library in the **reusable-library scope** can be handed, as an author reads it.
 *
 * Named for the scope rather than for its contents on purpose. `CONTEXT.md` has no
 * collective term for a Template Package and a Graphic Style Set Package together, and
 * coining one here would be inventing exactly the kind of term `/domain-modeling` exists
 * to settle. Reusable-library scope is already defined, and it is the scope all three of
 * these imports land in — so this names the doorway rather than inventing a category for
 * the things coming through it.
 *
 * The noun and the accepted file extension are two facts about one package kind, so they
 * travel as one. Carried as separate free-text props nothing tied them together, and the
 * types permitted a picker offering to import a "Graphic Style Set Package" from a
 * `.skgraphic` — which is what one component test was mounting.
 *
 * The extensions are not restated here: they come from the envelope vocabulary that
 * already owns them, so a package kind cannot be offered under an extension its own
 * exporter does not emit.
 *
 * Both Template Package kinds share one noun, because a Template Package means the same
 * thing whichever template it carries. That is the reason the pairing needs a table
 * rather than a single derived string.
 */
export const REUSABLE_LIBRARY_IMPORTS = {
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

export type ReusableLibraryImportKind = keyof typeof REUSABLE_LIBRARY_IMPORTS;

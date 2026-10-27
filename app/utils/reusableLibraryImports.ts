import { TEMPLATE_PACKAGE_ARTIFACTS } from '~~/shared/types/templatePackage';

/**
 * What a library in the **reusable-library scope** can be handed, as an author reads it.
 *
 * Named for the scope rather than for its contents: reusable-library scope is already
 * defined, and it is the scope these imports land in.
 *
 * The noun and the accepted file extension are two facts about one package kind, so they
 * travel as one.
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
} as const satisfies Record<string, { noun: string; accept: string }>;

export type ReusableLibraryImportKind = keyof typeof REUSABLE_LIBRARY_IMPORTS;

import type {
	GraphicStyleSetPackagePreflightIssue,
	GraphicStyleSetPackageWarningCode,
} from '~~/shared/types/graphicStyleSetPackage';
import { GRAPHIC_STYLE_SET_PACKAGE_LIMITS } from '~~/shared/types/graphicStyleSetPackage';

/**
 * The envelope codes a `.skstyle` can actually produce, each with the remediation an
 * author acts on.
 *
 * The codes are the Template Package envelope's own — one archive vocabulary, whatever
 * artifact the archive carries — but the guidance is not, because the guidance is
 * about a Graphic Style Set. Telling an author to "reduce the Template's largest
 * assets" when they exported a palette would be worse than saying nothing.
 *
 * The list is closed rather than partial so a code with no Style Set remediation
 * cannot be raised at all: a report that named a condition and left the author to
 * guess what to do about it is the failure this table exists to prevent.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_ENVELOPE_ERROR_CODES = [
	'malformed-package-archive',
	'unsafe-package-entry-path',
	'package-entry-path-traversal',
	'package-entry-link',
	'duplicate-package-entry-path',
	'encrypted-package-entry',
	'compressed-package-entry',
	'nested-package-archive',
	'undeclared-package-entry',
	'missing-package-entry',
	'inconsistent-package-entry-size',
	'package-archive-limit-exceeded',
	'package-expanded-limit-exceeded',
	'package-entry-limit-exceeded',
	'unsupported-package-schema-version',
	'package-migration-unavailable',
	'invalid-package-manifest',
	'unsupported-package-artifact',
	'remote-resource-dependency',
	'executable-template-content',
	'undeclared-graphic-asset-dependency',
	'unsupported-application-capability',
	'package-content-digest-mismatch',
] as const;

export type GraphicStyleSetPackageEnvelopeErrorCode
	= typeof GRAPHIC_STYLE_SET_PACKAGE_ENVELOPE_ERROR_CODES[number];

const REPACKING_ADVICE = 'Export the package again from the sending installation rather than repacking it by hand.';

const ENVELOPE_REMEDIATION = {
	'malformed-package-archive': 'The received file is not a readable Graphic Style Set Package. Export it again from the sending installation and retransfer it.',
	'unsafe-package-entry-path': `A package may only contain safe relative paths. ${REPACKING_ADVICE}`,
	'package-entry-path-traversal': 'This archive tries to write outside itself and cannot be trusted. Obtain the package from its original source.',
	'package-entry-link': `A package carries only regular files. ${REPACKING_ADVICE}`,
	'duplicate-package-entry-path': `Each entry path must appear once, whatever its casing. ${REPACKING_ADVICE}`,
	'encrypted-package-entry': `Packages are never encrypted. ${REPACKING_ADVICE}`,
	'compressed-package-entry': `Package entries are stored uncompressed. ${REPACKING_ADVICE}`,
	'nested-package-archive': 'A package cannot contain another archive. Obtain the package from its original source.',
	'undeclared-package-entry': `A Graphic Style Set Package contains only its manifest and its Style Set document. ${REPACKING_ADVICE}`,
	'missing-package-entry': 'The manifest declares a file this archive does not carry. Export the package again from the sending installation.',
	'inconsistent-package-entry-size': `An entry disagrees with itself about its own size. ${REPACKING_ADVICE}`,
	'package-archive-limit-exceeded': `A Graphic Style Set Package archive may be at most ${GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumArchiveByteLength} bytes. Ask the sender to reduce the number or size of the Style Set's entries.`,
	'package-expanded-limit-exceeded': `A Graphic Style Set Package may expand to at most ${GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumExpandedByteLength} bytes. Ask the sender to reduce the number or size of the Style Set's entries.`,
	'package-entry-limit-exceeded': `A Graphic Style Set Package carries exactly ${GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumEntryCount} files. ${REPACKING_ADVICE}`,
	'unsupported-package-schema-version': 'This installation reads an older Graphic Style Set Package schema. Update this installation, or ask the sender to export from a compatible version.',
	'package-migration-unavailable': 'This installation cannot migrate the package forward from its schema version. Ask the sender to export the Graphic Style Set again from a current installation.',
	'invalid-package-manifest': 'The package manifest is not valid. Export the package again from the sending installation.',
	'unsupported-package-artifact': 'This file is not a Graphic Style Set Package. A `.skgraphic` or `.sklayout` package is imported through the Template Package workflow instead.',
	'remote-resource-dependency': 'A package cannot depend on a remote resource. Ask the sender to correct the Graphic Style Set entry before exporting it.',
	'executable-template-content': 'Packages are data-only. Ask the sender to remove the executable value from the Graphic Style Set before exporting.',
	'undeclared-graphic-asset-dependency': 'This Graphic Style Set needs Graphics Asset Library content a Graphic Style Set Package does not yet carry. Ask the sender to export it from an installation that packages the asset.',
	'unsupported-application-capability': 'This installation does not provide a font the Graphic Style Set requires. Update this installation, or ask the sender for a Style Set that uses supported fonts.',
	'package-content-digest-mismatch': 'The packaged Graphic Style Set does not match the digest its manifest records. Retransfer the package, or obtain it again from its source.',
} as const satisfies Record<GraphicStyleSetPackageEnvelopeErrorCode, string>;

const WARNING_REMEDIATION = {
	'package-schema-migrated': 'The package was migrated to the current schema while it was read. Review the proposed result and confirm to continue.',
	'graphic-style-set-name-differs': 'Confirm to keep the installed name; the packaged name is not applied.',
	'graphic-style-set-revision-updated': 'Every linked template is offered the change as an available style update to review; none of them is rewritten by this install.',
	'graphic-style-set-template-affected': 'Review this template and apply the style update to it, or leave it on the revision it is reconciled to.',
	'graphic-style-set-installed-as-copy': 'Nothing links to the copy until a template selects entries from it.',
} as const satisfies Record<GraphicStyleSetPackageWarningCode, string>;

export function graphicStyleSetPackageEnvelopeIssue(
	code: GraphicStyleSetPackageEnvelopeErrorCode,
	input: { message: string; subject?: string },
): GraphicStyleSetPackagePreflightIssue {
	return {
		code,
		severity: 'error',
		subject: input.subject,
		message: input.message,
		remediation: ENVELOPE_REMEDIATION[code],
	};
}

export function graphicStyleSetPackageWarning(
	code: GraphicStyleSetPackageWarningCode,
	input: { message: string; subject?: string },
): GraphicStyleSetPackagePreflightIssue {
	return {
		code,
		severity: 'warning',
		subject: input.subject,
		message: input.message,
		remediation: WARNING_REMEDIATION[code],
	};
}

const ENVELOPE_CODES = new Set<string>(GRAPHIC_STYLE_SET_PACKAGE_ENVELOPE_ERROR_CODES);

/**
 * Whether an issue the shared archive reader produced is one a Graphic Style Set
 * Package can explain.
 *
 * The reader's vocabulary is wider than what a `.skstyle` can provoke — nothing here
 * packages a Graphic Asset Revision, so its origin, derivative, compatibility, and
 * quota codes are unreachable. A code outside the table would arrive with no
 * remediation, so it is reported as a malformed archive rather than as a condition
 * whose guidance this artifact cannot give.
 */
export function graphicStyleSetPackageEnvelopeCode(
	code: string,
): GraphicStyleSetPackageEnvelopeErrorCode {
	return ENVELOPE_CODES.has(code)
		? code as GraphicStyleSetPackageEnvelopeErrorCode
		: 'malformed-package-archive';
}

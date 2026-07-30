import type {
	TemplatePackagePreflightErrorCode,
	TemplatePackagePreflightIssue,
	TemplatePackagePreflightIssueCode,
	TemplatePackagePreflightWarningCode,
} from '~~/shared/types/templatePackage';
import {
	TEMPLATE_PACKAGE_LIMITS,
	TEMPLATE_PACKAGE_PREFLIGHT_WARNING_CODES,
	TEMPLATE_PACKAGE_SCHEMA_VERSION,
} from '~~/shared/types/templatePackage';

/**
 * Every stable preflight code paired with the remediation an author acts on.
 * Keeping the guidance beside the code is what lets one report explain the
 * complete reason a package cannot install, rather than naming a condition and
 * leaving the author to guess what to do about it.
 */
const ERROR_REMEDIATION = {
	'malformed-package-archive': 'The received file is not a readable Template Package. Export it again from the sending installation and retransfer it.',
	'unsafe-package-entry-path': 'A Template Package may only contain safe relative paths. Export the package again rather than repacking it by hand.',
	'package-entry-path-traversal': 'This archive tries to write outside itself and cannot be trusted. Obtain the package from its original source.',
	'package-entry-link': 'A Template Package carries only regular files. Export the package again rather than repacking it by hand.',
	'duplicate-package-entry-path': 'Each entry path must appear once, whatever its casing. Export the package again from the sending installation.',
	'encrypted-package-entry': 'Template Packages are never encrypted. Export the package again rather than repacking it by hand.',
	'compressed-package-entry': 'Template Package entries are stored uncompressed. Export the package again rather than repacking it by hand.',
	'nested-package-archive': 'A Template Package cannot contain another archive. Remove the nested archive and export the Template again.',
	'undeclared-package-entry': 'A Template Package contains only the files its manifest declares. Export the package again rather than adding files to it.',
	'unused-packaged-graphic-asset': 'A Template Package embeds only the assets its Template requires. Ask the sender to export the Template again rather than adding assets to the package.',
	'missing-package-entry': 'The manifest declares content this archive does not carry. Export the package again from the sending installation.',
	'inconsistent-package-entry-size': 'An entry disagrees with itself about its own size. Export the package again from the sending installation.',
	'package-archive-limit-exceeded': `A Template Package archive may be at most ${TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength} bytes. Ask the sender to reduce or replace the Template's largest assets.`,
	'package-expanded-limit-exceeded': `A Template Package may expand to at most ${TEMPLATE_PACKAGE_LIMITS.maximumExpandedByteLength} bytes. Ask the sender to reduce or replace the Template's largest assets.`,
	'package-entry-limit-exceeded': `A Template Package carries at most ${TEMPLATE_PACKAGE_LIMITS.maximumEntryCount} entries. Ask the sender to reduce the number of distinct assets the Template requires.`,
	'packaged-revision-limit-exceeded': `A Template Package carries at most ${TEMPLATE_PACKAGE_LIMITS.maximumPackagedRevisionCount} packaged Graphic Asset Revisions. Ask the sender to reduce the number of distinct revisions the Template requires.`,
	'unsupported-package-schema-version': `This installation reads Template Package schema version ${TEMPLATE_PACKAGE_SCHEMA_VERSION}. Update this installation, or ask the sender to export from a compatible version.`,
	'package-migration-unavailable': 'This installation cannot migrate the package forward from its schema version. Ask the sender to export the Template again from a current installation.',
	'invalid-package-manifest': 'The package manifest is not valid. Export the package again from the sending installation.',
	'unsupported-package-artifact': 'A Template Package declares exactly one supported artifact type and one Template. Export the package again from the sending installation.',
	'invalid-template-document': 'The Template document must be plain data. Ask the sender to correct the Template before exporting it.',
	'remote-resource-dependency': 'A Template Package cannot depend on a remote resource. Ask the sender to ingest the resource into their library and export the Template again.',
	'executable-template-content': 'Template Packages are data-only. Ask the sender to remove the executable value before exporting.',
	'undeclared-graphic-asset-dependency': 'The Template needs content the package never declared. Ask the sender to export the Template again with every asset it requires.',
	'unsupported-application-capability': 'This installation does not provide an application capability the Template requires. Update this installation, or ask the sender for a Template that uses supported capabilities.',
	'package-content-digest-mismatch': 'Packaged content does not match the digest the manifest records for it. Retransfer the package, or obtain it again from its source.',
	'incompatible-graphic-asset-content': 'Packaged content does not satisfy this installation\'s current Graphic Asset Compatibility Profile. Ask the sender to replace the asset with supported content.',
	'derivative-generation-failed': 'A preview could not be produced for packaged content, so the asset cannot be installed. Ask the sender to replace the asset.',
	'immutable-origin-digest-conflict': 'This package claims an origin that already exists here with different content. Provenance is immutable, so the complete package is rejected. Obtain the package again from its original source.',
	'canonical-capacity-blocked': 'Installing this package would exceed the canonical storage quota. Free canonical storage or raise the quota, then retry.',
} as const satisfies Record<TemplatePackagePreflightErrorCode, string>;

const WARNING_REMEDIATION = {
	'package-schema-migrated': 'The package was migrated to the current schema in staging. Review the proposed result and confirm to continue.',
	'graphic-asset-name-differs': 'The packaged name differs from the name this library already records. Confirming keeps the local name; the packaged name is not applied.',
	'graphic-asset-compatibility-restricted': 'This asset plays only on targets that prove the required capability. Confirm only if its Screens use a supported target.',
	'graphic-asset-created-from-related-origin': 'This package carries a different revision of an asset already imported here. Confirming creates a separate Graphic Asset rather than changing the existing one.',
	'graphic-asset-created-from-shared-content': 'Content identical to this already exists here under different provenance. Confirming creates a separate Graphic Asset that reuses the stored bytes.',
} as const satisfies Record<TemplatePackagePreflightWarningCode, string>;

/**
 * Only a locally exhausted quota can succeed on a later attempt. Everything the
 * package itself got wrong fails the same way however many times it is retried,
 * so it terminates permanently rather than inviting a pointless retry.
 */
const RETRYABLE_ERROR_CODES = new Set<TemplatePackagePreflightIssueCode>([
	'canonical-capacity-blocked',
]);

const WARNING_CODES = new Set<TemplatePackagePreflightIssueCode>(
	TEMPLATE_PACKAGE_PREFLIGHT_WARNING_CODES,
);

export function templatePackagePreflightIssue(
	code: TemplatePackagePreflightIssueCode,
	input: { message: string; subject?: string },
): TemplatePackagePreflightIssue {
	const warning = WARNING_CODES.has(code);
	return {
		code,
		severity: warning ? 'warning' : 'error',
		subject: input.subject,
		message: input.message,
		remediation: warning
			? WARNING_REMEDIATION[code as TemplatePackagePreflightWarningCode]
			: ERROR_REMEDIATION[code as TemplatePackagePreflightErrorCode],
		retryable: RETRYABLE_ERROR_CODES.has(code),
	};
}

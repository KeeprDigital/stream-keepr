import type {
	GraphicAssetCanonicalMime,
	GraphicAssetFontFacts,
	GraphicAssetId,
	GraphicAssetImageFacts,
	GraphicAssetReference,
	GraphicAssetRevisionId,
	GraphicAssetSilentVideoFacts,
} from './graphicsAsset';

/**
 * Template Package envelope vocabulary.
 *
 * A Template Package is a single-template portable artifact carrying either one
 * Broadcast Graphic Template (`.skgraphic`) or one Feature Match Layout Template
 * (`.sklayout`). Both kinds share this envelope, its asset handling, and its
 * integrity facts while keeping their payloads and workflows separate: the
 * package kind selects the artifact descriptor and the template document is the
 * exporting workflow's own data.
 */

export const TEMPLATE_PACKAGE_KINDS = ['skgraphic', 'sklayout'] as const;

export type TemplatePackageKind = typeof TEMPLATE_PACKAGE_KINDS[number];

/** Receivers reject a schema version they do not recognise rather than guessing. */
export const TEMPLATE_PACKAGE_SCHEMA_VERSION = 1;

export const TEMPLATE_PACKAGE_MANIFEST_ENTRY = 'manifest.json';
export const TEMPLATE_PACKAGE_TEMPLATE_ENTRY = 'template.json';
export const TEMPLATE_PACKAGE_CONTENT_ENTRY_PREFIX = 'content/';

export const TEMPLATE_PACKAGE_ARTIFACTS = {
	skgraphic: {
		extension: '.skgraphic',
		templateKind: 'broadcast-graphic-template',
		mediaType: 'application/vnd.streamkeepr.broadcast-graphic-template+zip',
	},
	sklayout: {
		extension: '.sklayout',
		templateKind: 'feature-match-layout-template',
		mediaType: 'application/vnd.streamkeepr.feature-match-layout-template+zip',
	},
} as const satisfies Record<TemplatePackageKind, {
	extension: string;
	templateKind: string;
	mediaType: string;
}>;

export type TemplatePackageTemplateKind
	= typeof TEMPLATE_PACKAGE_ARTIFACTS[TemplatePackageKind]['templateKind'];

/**
 * The settled transfer envelope both package kinds are held to. Export enforces
 * every limit before emitting a byte so a rejected package never produces a
 * partial archive, and preflight enforces the same numbers on receipt.
 */
export const TEMPLATE_PACKAGE_LIMITS = {
	maximumArchiveByteLength: 1024 * 1024 * 1024,
	maximumExpandedByteLength: 1024 * 1024 * 1024,
	maximumEntryCount: 128,
	maximumPackagedRevisionCount: 100,
} as const;

/**
 * Application-owned capabilities a Template requires. They are declared so a
 * receiver can refuse an unsupported one, and never duplicated into the archive:
 * bundled fonts and Graphic Item Definitions ship with Stream Keepr.
 */
export const TEMPLATE_PACKAGE_CAPABILITY_KINDS = [
	'application-font',
	'graphic-item-definition',
	/**
	 * A term from a vocabulary the host owns rather than the Template: a Source
	 * Item's role, a Frame animation effect, a host token a Graphic Text Template
	 * binds. Declared for the same reason a Definition is — the receiving
	 * installation supplies the meaning, so it must be given the chance to say it
	 * has none for this term.
	 */
	'host-vocabulary',
] as const;

export type TemplatePackageCapabilityKind = typeof TEMPLATE_PACKAGE_CAPABILITY_KINDS[number];

/** One Template slot requiring one exact Graphic Asset Revision. */
export interface TemplatePackageAssetRequirement {
	/** The logical path of the requiring field within the Template document. */
	slot: string;
	reference: GraphicAssetReference;
	/** Blocks export when the resolved revision is a different media kind. */
	expectedKind?: 'image' | 'silent-video' | 'font';
}

export interface TemplatePackageCapabilityRequirement {
	slot: string;
	capability: TemplatePackageCapabilityKind;
	identity: string;
	configurationVersion?: number;
}

export interface TemplatePackageCapabilityDeclaration {
	capability: TemplatePackageCapabilityKind;
	identity: string;
	configurationVersion?: number;
	requiredBy: readonly string[];
}

/**
 * The immutable provenance a receiver maps against: source identity, source
 * revision, and content digest. It is provenance for recognising a future
 * import, never a local identity or a live update link.
 */
export interface TemplatePackageAssetOrigin {
	sourceAssetId: GraphicAssetId;
	sourceRevisionId: GraphicAssetRevisionId;
	sourceRevisionNumber: number;
	digest: string;
}

export interface TemplatePackageAssetIntegrity {
	algorithm: 'sha256';
	digest: string;
	byteLength: number;
	canonicalMime: GraphicAssetCanonicalMime;
}

/**
 * One logical packaged identity. Two packaged assets backed by identical bytes
 * share one content entry without merging into one domain resource, so a
 * receiver still installs two distinct Graphic Assets.
 */
export interface TemplatePackageAsset {
	/** Stable within one package; deliberately not a local library identity. */
	packagedId: string;
	name: string;
	kind: 'image' | 'silent-video' | 'font';
	origin: TemplatePackageAssetOrigin;
	integrity: TemplatePackageAssetIntegrity;
	/** The packaged metadata snapshot a receiver revalidates against its own profile. */
	facts: GraphicAssetImageFacts | GraphicAssetSilentVideoFacts | GraphicAssetFontFacts;
	compatibilityProfile: string;
	content: { entry: string };
	requiredBy: readonly string[];
}

export interface TemplatePackageContent {
	digest: string;
	byteLength: number;
	canonicalMime: GraphicAssetCanonicalMime;
	entry: string;
}

export interface TemplatePackageTotals {
	entryCount: number;
	packagedAssetCount: number;
	packagedRevisionCount: number;
	uniqueContentCount: number;
	expandedByteLength: number;
}

export interface TemplatePackageManifest {
	schemaVersion: number;
	packageKind: TemplatePackageKind;
	templateKind: TemplatePackageTemplateKind;
	createdAt: string;
	template: {
		identity: string;
		name: string;
		/**
		 * The Template revision this package was exported at, where the exporting
		 * workflow has one.
		 *
		 * Provenance travelling beside the identity, and only useful together with
		 * it: an installation recognising a source identity it has imported before
		 * needs the revision to tell "the same design again" from "a later revision
		 * of it". Never an update link — nothing follows it back.
		 *
		 * Optional because a package may be exported from something with no managed
		 * revision, and because a schema-1 package written before this field existed
		 * must still read.
		 */
		revision?: number;
		entry: string;
	};
	packagedAssets: readonly TemplatePackageAsset[];
	applicationCapabilities: readonly TemplatePackageCapabilityDeclaration[];
	contents: readonly TemplatePackageContent[];
	totals: TemplatePackageTotals;
}

/**
 * Stable export codes. Every blocking condition is reported together so an
 * author corrects all of them once rather than discovering them one at a time.
 */
export const TEMPLATE_PACKAGE_EXPORT_ISSUE_CODES = [
	'missing-graphic-asset-reference',
	'unavailable-graphic-asset-content',
	'invalid-graphic-asset-content-facts',
	'unsupported-application-capability',
	'unexpected-graphic-asset-kind',
	'undeclared-graphic-asset-dependency',
	'remote-resource-dependency',
	'executable-template-content',
	'invalid-template-document',
	'duplicate-template-slot',
	'package-entry-limit-exceeded',
	'packaged-revision-limit-exceeded',
	'package-expanded-limit-exceeded',
	'package-archive-limit-exceeded',
] as const;

export type TemplatePackageExportIssueCode = typeof TEMPLATE_PACKAGE_EXPORT_ISSUE_CODES[number];

export interface TemplatePackageExportIssue {
	code: TemplatePackageExportIssueCode;
	/** The Template slot or document path responsible, where one exists. */
	slot?: string;
	message: string;
	remediation: string;
	retryable: boolean;
}

export interface TemplatePackageExportReport {
	packageKind: TemplatePackageKind;
	templateIdentity: string;
	checkedAt: string;
	issues: readonly TemplatePackageExportIssue[];
	limits: typeof TEMPLATE_PACKAGE_LIMITS;
	observed: TemplatePackageTotals & { archiveByteLength: number };
}

/**
 * The oldest package schema this installation can migrate forward. A version
 * below it, or above {@link TEMPLATE_PACKAGE_SCHEMA_VERSION}, cannot be read at
 * all: guessing at an unknown envelope is how an unsafe package gets installed.
 */
export const TEMPLATE_PACKAGE_MINIMUM_MIGRATABLE_SCHEMA_VERSION = 1;

/**
 * Stable preflight error codes. Every one found is reported together, so an
 * author sees the complete reason a package cannot be installed rather than the
 * first reason.
 *
 * Anything the package itself got wrong fails the same way however many times it
 * is retried, so those errors terminate the operation permanently. The exception
 * is `canonical-capacity-blocked`: nothing is wrong with the package, only with
 * how much room this installation has, which an administrator can change. It is
 * marked retryable and the operation stays resumable from its staged bytes.
 */
export const TEMPLATE_PACKAGE_PREFLIGHT_ERROR_CODES = [
	'malformed-package-archive',
	'unsafe-package-entry-path',
	'package-entry-path-traversal',
	'package-entry-link',
	'duplicate-package-entry-path',
	'encrypted-package-entry',
	'compressed-package-entry',
	'nested-package-archive',
	'undeclared-package-entry',
	'unused-packaged-graphic-asset',
	'missing-package-entry',
	'inconsistent-package-entry-size',
	'package-archive-limit-exceeded',
	'package-expanded-limit-exceeded',
	'package-entry-limit-exceeded',
	'packaged-revision-limit-exceeded',
	'unsupported-package-schema-version',
	'package-migration-unavailable',
	'invalid-package-manifest',
	'unsupported-package-artifact',
	'invalid-template-document',
	'remote-resource-dependency',
	'executable-template-content',
	'undeclared-graphic-asset-dependency',
	'unsupported-application-capability',
	'package-content-digest-mismatch',
	'incompatible-graphic-asset-content',
	'derivative-generation-failed',
	'immutable-origin-digest-conflict',
	'duplicate-packaged-origin',
	'graphic-asset-origin-not-referenceable',
	'canonical-capacity-blocked',
] as const;

/**
 * Stable preflight warning codes. Warnings never block installation; they pause
 * it exactly once so the author confirms the proposed result they describe.
 */
export const TEMPLATE_PACKAGE_PREFLIGHT_WARNING_CODES = [
	'package-schema-migrated',
	'graphic-asset-name-differs',
	'graphic-asset-compatibility-restricted',
	'graphic-asset-font-attestation-deferred',
	'graphic-asset-created-from-related-origin',
	'graphic-asset-created-from-shared-content',
] as const;

export type TemplatePackagePreflightErrorCode
	= typeof TEMPLATE_PACKAGE_PREFLIGHT_ERROR_CODES[number];

export type TemplatePackagePreflightWarningCode
	= typeof TEMPLATE_PACKAGE_PREFLIGHT_WARNING_CODES[number];

export type TemplatePackagePreflightIssueCode
	= TemplatePackagePreflightErrorCode | TemplatePackagePreflightWarningCode;

export interface TemplatePackagePreflightIssue {
	code: TemplatePackagePreflightIssueCode;
	severity: 'error' | 'warning';
	/** The archive entry, packaged identity, or Template document path responsible. */
	subject?: string;
	message: string;
	remediation: string;
	/**
	 * Whether re-running the operation from its staged bytes could succeed. An
	 * error about the package's own contents never can; a transient local
	 * condition such as exhausted capacity can.
	 */
	retryable: boolean;
}

/**
 * How one packaged identity would become a local Graphic Asset. These are
 * proposals: preflight decides them, records them in an immutable report, and
 * installation applies exactly the set the author confirmed.
 */
export type TemplatePackageMappingBasis
	/** The exact source identity, source revision, and digest already exist locally. */
	= | 'exact-origin'
	/** The same source identity at a different source revision exists locally. */
		| 'related-origin-revision'
	/** Only the content digest matches something local; provenance does not. */
		| 'shared-content-digest'
		| 'new-content';

export interface TemplatePackagePreflightMapping {
	packagedId: string;
	name: string;
	kind: 'image' | 'silent-video' | 'font';
	origin: TemplatePackageAssetOrigin;
	/**
	 * Exact-origin matches reuse the local revision untouched. Everything else
	 * creates a separate local Graphic Asset, sharing canonical bytes when the
	 * digest already exists but never merging identity or provenance.
	 */
	proposal: 'reuse-graphic-asset-revision' | 'create-graphic-asset';
	basis: TemplatePackageMappingBasis;
	/** The exact local revision to reuse, present only for an exact-origin match. */
	reference?: GraphicAssetReference;
	/** Whether the canonical byte store already holds this content. */
	contentAlreadyStored: boolean;
	/** Canonical bytes this mapping would add. Zero when content is shared. */
	canonicalGrowthBytes: number;
	/** The differing local name, when a matched local asset carries its own. */
	localName?: string;
}

export interface TemplatePackagePreflightQuota {
	canonicalGrowthBytes: number;
	canonicalAvailableBytes: number;
	canonicalLimitBytes: number;
	pressure: 'normal' | 'warning' | 'critical' | 'full';
}

/**
 * The one complete Template Package preflight result. It is immutable once
 * recorded: its {@link TemplatePackagePreflightReport.fingerprint} covers the
 * received bytes, the proposed mappings, and the compatibility profiles they
 * were judged under, so any change to the package, the library, or the proposal
 * invalidates a confirmation rather than silently installing something else.
 */
export interface TemplatePackagePreflightReport {
	packageKind: TemplatePackageKind;
	templateIdentity: string;
	templateName: string;
	/** The source Template revision the package declared, where it declared one. */
	templateRevision?: number;
	checkedAt: string;
	fingerprint: string;
	schema: {
		received: number;
		supported: number;
		migrated: boolean;
	};
	/** Every compatibility profile the embedded sources were revalidated under. */
	compatibilityProfiles: readonly string[];
	issues: readonly TemplatePackagePreflightIssue[];
	mappings: readonly TemplatePackagePreflightMapping[];
	quota: TemplatePackagePreflightQuota;
	limits: typeof TEMPLATE_PACKAGE_LIMITS;
	observed: TemplatePackageTotals & { archiveByteLength: number };
	/**
	 * `rejected` is terminal. `requires-confirmation` pauses for exactly one
	 * confirmation bound to the fingerprint. `ready` needs no confirmation.
	 */
	outcome: 'ready' | 'requires-confirmation' | 'rejected';
}

/**
 * The receiving half of one Template Package kind's payload.
 *
 * A Template Package is one envelope carrying one of several artifacts: both
 * template kinds "share the package envelope, asset handling, validation,
 * migration, conflict, and atomic installation contract while retaining separate
 * payloads, libraries, and import/export workflows". This contract is where that
 * separation lives. The Graphics Asset Library owns everything the sentence says is
 * shared and treats the Template document as opaque data; a payload owns the one
 * thing it cannot — reading the document as the artifact it claims to be. Placing
 * the installed result in the library that artifact belongs to is the other half of
 * the separation, and it is not on this contract: the Graphics Asset Library records
 * an Installed Graphics Template and each artifact's own write path picks it up.
 *
 * ## Why the document is read at all, when the envelope already validates
 *
 * The envelope proves a Template document is *data*: plain JSON, no executable
 * value, no remote dependency, no undeclared asset. It cannot prove the document is
 * a *Broadcast Graphic*, because it does not know what one is. Without this seam a
 * package could carry any well-formed JSON object and install it as a Template
 * nothing can place, render, or repair — discovered by an author days later, on a
 * design they can no longer re-import correctly because the bytes that travelled
 * were always wrong.
 *
 * The check runs at Template Package Preflight, where a failure is a terminal error
 * with a stable code and nothing has been written. That is what makes an unsupported
 * Graphic Item Definition or configuration version fail *atomically*: it is refused
 * before an asset, an origin, a reference, or a Template exists.
 *
 * ## The export-side counterpart
 *
 * Discovery of what a Template requires — its exact Graphic Asset Revisions and the
 * application capabilities it declares — is the sending half, in
 * `shared/utils/templatePackageRequirements.ts`, where both editors reach it while
 * authoring. The two halves are deliberately symmetric per kind: whatever a kind
 * declares on the way out is what a receiver holds it to on the way in.
 *
 * The types live here rather than beside the implementations so the Graphics Asset
 * Library can be handed a payload without importing one. It stays a library that
 * knows nothing about Broadcast Graphics.
 */

/**
 * A reason a received document cannot be installed, in the preflight vocabulary.
 *
 * Both codes are existing {@link TemplatePackagePreflightErrorCode}s: a payload
 * explains itself in terms a report already presents, rather than inventing a second
 * issue vocabulary a caller would have to translate.
 */
export interface TemplatePackagePayloadIssue {
	code: 'invalid-template-document' | 'unsupported-application-capability';
	/** The document path responsible, where one exists. */
	subject?: string;
	message: string;
}

export type ReadInstallableTemplateDocumentOutcome
	= | {
		outcome: 'read';
		/**
		 * The application-owned capabilities this document actually requires,
		 * derived by the same walk the exporting workflow declares them with.
		 *
		 * Preflight holds the manifest to them. A package requiring a Graphic Item
		 * Definition it never declares is one no exporter here could have produced,
		 * and accepting it would install a Graphic Item whose configuration version
		 * was never checked against anything.
		 */
		capabilities: readonly TemplatePackageCapabilityRequirement[];
	}
	| { outcome: 'rejected'; issues: readonly TemplatePackagePayloadIssue[] };

export interface TemplatePackagePayload {
	packageKind: TemplatePackageKind;
	/**
	 * Proves a received Template document is the artifact its package claims, under
	 * the vocabulary and configuration versions *this* installation implements.
	 *
	 * Called during Template Package Preflight over the document exactly as it
	 * travelled — before its Graphic Asset References are rewritten, so every
	 * identity in it is still the sender's.
	 */
	readInstallableDocument: (document: unknown) => ReadInstallableTemplateDocumentOutcome;
}

export type TemplatePackagePayloads = (kind: TemplatePackageKind) => TemplatePackagePayload;

export function templatePackageContentEntry(digest: string): string {
	return `${TEMPLATE_PACKAGE_CONTENT_ENTRY_PREFIX}sha256-${digest}.bin`;
}

export function templatePackageFileName(
	packageKind: TemplatePackageKind,
	templateName: string,
): string {
	const slug = templateName
		.normalize('NFKD')
		.replace(/[^\w.-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.toLowerCase()
		.slice(0, 64);
	return `${slug || 'template'}${TEMPLATE_PACKAGE_ARTIFACTS[packageKind].extension}`;
}

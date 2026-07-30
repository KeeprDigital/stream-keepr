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

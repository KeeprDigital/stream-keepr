import type {
	AffectedGraphicsTemplate,
	GraphicStyleSetEntry,
	GraphicStyleSetPublishIssue,
	GraphicStyleSetResponse,
} from './graphicStyleSet';
import type {
	TemplatePackageCapabilityDeclaration,
	TemplatePackagePreflightErrorCode,
} from './templatePackage';

/**
 * Graphic Style Set Package vocabulary.
 *
 * A `.skstyle` archive is "a single-Style-Set portable artifact … that transfers one
 * Graphic Style Set and its required font assets without containing a Broadcast
 * Graphic Template or Feature Match Layout Template". It is a sibling of the Template
 * Package rather than a third kind of one, and the difference is not packaging — it is
 * what an import *means*.
 *
 * ## Why this is not a third Template Package kind
 *
 * A Template Package always installs an independent unlinked copy, because nothing
 * refers to a template by identity: two installations holding the same design under
 * two identities is not a problem anybody can observe.
 *
 * A Graphic Style Set is the opposite. It is the artifact templates *link to*, by
 * identity and published revision. So the glossary requires the mirror-image rule:
 * "the first import preserves the packaged Style Set identity and revision", and "a
 * newer related revision may explicitly update the installed Style Set through its
 * ordinary publish and affected-template review flow". An import that minted a new
 * identity every time could never deliver either — there would be nothing for a second
 * package to update, and a show's style could not actually travel.
 *
 * Two further consequences follow from the same place, and both are why the Template
 * Package pipeline is not reused wholesale:
 *
 * - The installed result is a first-class Graphic Style Set that an author publishes,
 *   links, and edits — not an Installed Graphics Template the Graphics Asset Library
 *   owns and no author may change.
 * - A Style Set contains no Graphic Item trees, no layout, and no media selections, so
 *   it transitively requires no Graphic Asset at all. Every part of the Template
 *   Package envelope that exists for *bytes* — durable staging, canonical growth
 *   quota, derivative regeneration, compatibility revalidation, Graphic Asset Origin
 *   mapping — has nothing to do here.
 *
 * What is shared is shared for real: the archive reader and its issue vocabulary, the
 * data-only document inspection, the application-capability declaration, and the
 * fingerprint-bound confirmation contract. Those are the "Template Package principles"
 * the glossary names, and none of them is restated here.
 *
 * ## Fonts
 *
 * A Style Set's typography presets name application fonts, which ship with Stream
 * Keepr and are declared rather than duplicated — exactly as the Template Package
 * envelope declares them. A receiver that does not have a named font refuses the
 * package instead of installing a Style Set it could never publish. Should a Style
 * Set one day reference a Graphics Asset Library font, the entry would carry an
 * ordinary Graphic Asset Reference and the packaged-asset half of this envelope is
 * where it would travel; today that half is empty because nothing puts anything in it.
 */

export const GRAPHIC_STYLE_SET_PACKAGE_KIND = 'skstyle';
export const GRAPHIC_STYLE_SET_PACKAGE_ARTIFACT_KIND = 'graphic-style-set';
export const GRAPHIC_STYLE_SET_PACKAGE_EXTENSION = '.skstyle';
export const GRAPHIC_STYLE_SET_PACKAGE_MEDIA_TYPE
	= 'application/vnd.streamkeepr.graphic-style-set+zip';

/** Receivers reject a schema version they do not recognise rather than guessing. */
export const GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION = 1;

/**
 * The oldest package schema this installation can migrate forward. A version below
 * it, or above {@link GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION}, cannot be read at
 * all.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_MINIMUM_MIGRATABLE_SCHEMA_VERSION = 1;

export const GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY = 'manifest.json';
export const GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY = 'style-set.json';

/**
 * The settled transfer envelope a `.skstyle` is held to.
 *
 * Far smaller than a Template Package's, because the contents are bounded by the
 * artifact rather than by media: a Style Set holds at most
 * `MAX_GRAPHIC_STYLE_SET_ENTRIES` entries of bounded presets and nothing else. Export
 * enforces every limit before emitting a byte, and preflight enforces the same numbers
 * on receipt.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_LIMITS = {
	maximumArchiveByteLength: 4 * 1024 * 1024,
	maximumExpandedByteLength: 4 * 1024 * 1024,
	/** The manifest and the Style Set document, and nothing else. */
	maximumEntryCount: 2,
	maximumDocumentByteLength: 2 * 1024 * 1024,
} as const;

/**
 * The frozen, self-contained snapshot one `.skstyle` carries.
 *
 * It is the *published* entries and never the working draft: a draft is referentially
 * broken for most of its life, and a package that carried one would transfer something
 * the sending installation itself could not publish.
 *
 * Every entry states its own `kind` and `schemaVersion`, so a receiver refuses an
 * entry shape it does not read rather than misinterpreting it — which is why the
 * schema version is per entry rather than per package.
 */
export interface GraphicStyleSetSnapshot {
	id: string;
	name: string;
	description: string | null;
	/** The published revision this snapshot was frozen at. Always at least one. */
	revision: number;
	entries: GraphicStyleSetEntry[];
}

/**
 * The immutable provenance a receiver maps against.
 *
 * Three facts, and a reader may rely on exactly these:
 *
 * - `sourceStyleSetId` is the identity the exporting installation knows this Style Set
 *   by. On a preserved-identity import it becomes the local identity too, which is the
 *   whole mechanism by which a second package can update the first one's result.
 * - `sourceRevision` is the published revision the snapshot was frozen at. It is what
 *   distinguishes "the same style again" from "a later revision of it", and it is why
 *   an older revision can be recognised and refused rather than silently applied.
 * - `contentDigest` is a SHA-256 over the snapshot's entries alone, in a canonical
 *   form that is independent of key order and of how any installation happens to
 *   serialise JSON. It is what makes "the same identity and revision with different
 *   content" a detectable conflict rather than a silent divergence.
 *
 * What a reader may *not* rely on: any of this being a link. Nothing follows a
 * provenance record back to the installation that exported it, no update is fetched
 * through it, and the exporting installation learns nothing about the import. The name
 * is deliberately outside the digest — a rename creates no Style Set revision, so two
 * installations at the same revision with different names hold the same content and
 * are told so as a difference rather than a conflict.
 */
export interface GraphicStyleSetPackageProvenance {
	sourceStyleSetId: string;
	sourceRevision: number;
	contentDigest: string;
}

export interface GraphicStyleSetPackageManifest {
	schemaVersion: number;
	packageKind: typeof GRAPHIC_STYLE_SET_PACKAGE_KIND;
	artifactKind: typeof GRAPHIC_STYLE_SET_PACKAGE_ARTIFACT_KIND;
	createdAt: string;
	styleSet: {
		identity: string;
		name: string;
		revision: number;
		/** SHA-256 over the canonical form of the snapshot's entries. */
		contentDigest: string;
		/** How many entries the Style Set holds — never an archive file count. */
		entryCount: number;
		entry: string;
	};
	/**
	 * Application-owned capabilities the snapshot requires, declared rather than
	 * duplicated. Today that is one `application-font` declaration per distinct font a
	 * typography preset names.
	 */
	applicationCapabilities: readonly TemplatePackageCapabilityDeclaration[];
	totals: {
		/** How many files the archive carries — never a Style Set entry count. */
		archiveEntryCount: number;
		expandedByteLength: number;
	};
}

/**
 * Why a Graphic Style Set could not be packaged.
 *
 * Every code is stable and names one condition an author can act on, and they are all
 * reported together for the same reason a publish refusal is: a Style Set is up to two
 * hundred entries and an author fixes them in one sitting.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_EXPORT_ISSUE_CODES = [
	/** The Style Set has never been published, so there is no snapshot to freeze. */
	'graphic-style-set-never-published',
	/** The published entries do not resolve, so the package would not install anywhere. */
	'graphic-style-set-unresolvable',
	/**
	 * An entry names Graphics Asset Library content. A Graphic Style Set Package does
	 * not yet carry packaged assets, so exporting one would produce a package whose
	 * Style Set could not be published where it landed.
	 */
	'undeclared-graphic-asset-dependency',
	'executable-graphic-style-set-content',
	'remote-resource-dependency',
	'invalid-graphic-style-set-document',
	'package-expanded-limit-exceeded',
	'package-archive-limit-exceeded',
] as const;

/**
 * The remediation each export refusal carries.
 *
 * Beside the codes rather than beside the exporter, for the same reason the receiving
 * side's tables are beside theirs: a code with no guidance is a report that names a
 * condition and leaves the author to guess what to do about it, and `satisfies` is what
 * makes adding a code without guidance impossible.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_EXPORT_REMEDIATION = {
	'graphic-style-set-never-published': 'A package carries what a Graphic Style Set publishes, not what it is being edited into. Publish this Graphic Style Set, then export it.',
	'graphic-style-set-unresolvable': 'The published entries do not resolve here, so no installation could publish them either. Correct the entries and publish again before exporting.',
	'undeclared-graphic-asset-dependency': 'A Graphic Style Set Package does not yet carry Graphics Asset Library content. Replace the entry\'s library selection with an application font before exporting.',
	'executable-graphic-style-set-content': 'Packages are data-only. Remove the executable value from the entry before exporting.',
	'remote-resource-dependency': 'A package cannot depend on a remote resource. Remove the remote reference from the entry before exporting.',
	'invalid-graphic-style-set-document': 'The Graphic Style Set must be plain data. Remove the unsupported value before exporting.',
	'package-expanded-limit-exceeded': `A Graphic Style Set Package may expand to at most ${GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumExpandedByteLength} bytes. Reduce the number or size of the Style Set's entries.`,
	'package-archive-limit-exceeded': `A Graphic Style Set Package archive may be at most ${GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumArchiveByteLength} bytes. Reduce the number or size of the Style Set's entries.`,
} as const satisfies Record<GraphicStyleSetPackageExportIssueCode, string>;

export type GraphicStyleSetPackageExportIssueCode
	= typeof GRAPHIC_STYLE_SET_PACKAGE_EXPORT_ISSUE_CODES[number];

export interface GraphicStyleSetPackageExportIssue {
	code: GraphicStyleSetPackageExportIssueCode;
	/** The entry responsible, where one is. */
	entryId?: string;
	message: string;
	remediation: string;
}

export interface GraphicStyleSetPackageExportReport {
	styleSetId: string;
	checkedAt: string;
	issues: readonly GraphicStyleSetPackageExportIssue[];
	limits: typeof GRAPHIC_STYLE_SET_PACKAGE_LIMITS;
}

/**
 * Preflight error codes a `.skstyle` adds to the shared archive vocabulary.
 *
 * The envelope-level codes are deliberately *not* restated: an unsafe entry path, a
 * traversing path, a link entry, a compressed or encrypted entry, a nested archive, an
 * undeclared or missing entry, an inconsistent size, and every limit violation are
 * proved by the same reader a Template Package goes through and reported under the
 * same {@link TemplatePackagePreflightErrorCode}s. One archive vocabulary, one set of
 * remediations, whatever the archive carries.
 *
 * What is added here is everything the shared reader cannot know: whether the document
 * is a Graphic Style Set, and how the packaged identity and revision relate to what
 * this installation already holds.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_ERROR_CODES = [
	'invalid-graphic-style-set-document',
	/** A value a renderer would execute rather than draw. Packages are data-only. */
	'executable-graphic-style-set-content',
	/**
	 * The packaged entries do not resolve under this installation's vocabulary — a
	 * dangling reference, a kind mismatch, a cycle, an entry schema this build does not
	 * read, or a font this installation does not have. Installing them published would
	 * put every linked template on entries that resolve to nothing.
	 */
	'graphic-style-set-unpublishable',
	/**
	 * The packaged identity and revision are already installed with different content.
	 * Two installations have published different entries as the same revision of the
	 * same Style Set, and no import may decide which one is right — so the package is
	 * refused unless its author chooses to install it as an independent copy.
	 */
	'graphic-style-set-revision-conflict',
	/**
	 * The packaged revision is older than the installed one. An import never silently
	 * downgrades a Style Set every linked template resolves against.
	 */
	'graphic-style-set-revision-superseded',
	/**
	 * A Style Set with the packaged identity exists here and has never been published.
	 *
	 * There is no installed revision for the package to relate to, so nothing decides
	 * whether it is newer, older, or the same — and the row is somebody's working draft.
	 * Distinct from a diverged draft, which *does* have an installed revision and so can
	 * be offered as an update the author confirms.
	 */
	'graphic-style-set-identity-unpublished',
] as const;

/**
 * Preflight warning codes. Warnings never block installation; they pause it exactly
 * once so the author confirms the proposed result they describe.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_WARNING_CODES = [
	'package-schema-migrated',
	/** The package and this library record the same Style Set under different names. */
	'graphic-style-set-name-differs',
	/** A newer revision of an installed Style Set; confirming publishes it here. */
	'graphic-style-set-revision-updated',
	/** A linked template would be offered an available style update by this install. */
	'graphic-style-set-template-affected',
	/** The author chose a new identity, so nothing here links to the result yet. */
	'graphic-style-set-installed-as-copy',
	/**
	 * The installed Style Set has unpublished draft changes this update would discard.
	 *
	 * A warning rather than a refusal, because the glossary says a newer revision "may
	 * explicitly update the installed Style Set" and discarding a draft is not a merge —
	 * it is one whole thing replacing another, which is exactly what every disposition
	 * here does. What it is not is something an import may do *quietly*, so the author
	 * is told what they would lose and confirms it against that exact draft.
	 */
	'graphic-style-set-draft-discarded',
] as const;

export type GraphicStyleSetPackageErrorCode
	= typeof GRAPHIC_STYLE_SET_PACKAGE_ERROR_CODES[number];

export type GraphicStyleSetPackageWarningCode
	= typeof GRAPHIC_STYLE_SET_PACKAGE_WARNING_CODES[number];

/**
 * The remediation each Style-Set-specific preflight issue carries.
 *
 * Beside the codes, so the envelope's table (which lives with the archive reader) and
 * this one together cover every code a report can carry, each total over its own half.
 * Splitting them that way is what keeps the archive vocabulary shared with the Template
 * Package while the guidance stays about a Graphic Style Set.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_REMEDIATION = {
	'invalid-graphic-style-set-document': 'The document is not a Graphic Style Set this installation reads. Ask the sender to export it from a compatible version.',
	'executable-graphic-style-set-content': 'Packages are data-only. Ask the sender to remove the executable value from the Graphic Style Set before exporting.',
	'graphic-style-set-unpublishable': 'Ask the sender to correct the reported entries and publish the Graphic Style Set again before exporting it.',
	'graphic-style-set-revision-conflict': 'Two installations published different entries as the same revision of this Graphic Style Set. Install it as an independent copy, or reconcile the two by hand and publish a newer revision on one of them.',
	'graphic-style-set-revision-superseded': 'This installation already holds a newer revision of this Graphic Style Set. Export the newer one instead, or install this package as an independent copy.',
	'graphic-style-set-identity-unpublished': 'A Graphic Style Set with this identity exists here and has never been published, so there is no revision for this package to relate to. Publish or delete it first, or install this package as an independent copy.',
	'package-schema-migrated': 'The package was migrated to the current schema while it was read. Review the proposed result and confirm to continue.',
	'graphic-style-set-name-differs': 'Confirm to keep the installed name; the packaged name is not applied.',
	'graphic-style-set-revision-updated': 'Every linked template is offered the change as an available style update to review; none of them is rewritten by this install.',
	'graphic-style-set-template-affected': 'Review this template and apply the style update to it, or leave it on the revision it is reconciled to.',
	'graphic-style-set-installed-as-copy': 'Nothing links to the copy until a template selects entries from it.',
	'graphic-style-set-draft-discarded': 'Publish or revert the draft first if you want to keep it, or install this package as an independent copy. Confirming replaces the draft with the packaged entries.',
} as const satisfies Record<
	GraphicStyleSetPackageErrorCode | GraphicStyleSetPackageWarningCode,
	string
>;

/**
 * Every code a `.skstyle` preflight issue may carry: the shared archive and envelope
 * errors, plus this artifact's own.
 */
export type GraphicStyleSetPackagePreflightIssueCode
	= | TemplatePackagePreflightErrorCode
		| GraphicStyleSetPackageErrorCode
		| GraphicStyleSetPackageWarningCode;

export interface GraphicStyleSetPackagePreflightIssue {
	code: GraphicStyleSetPackagePreflightIssueCode;
	severity: 'error' | 'warning';
	/** The archive entry, Style Set entry, or template responsible, where one is. */
	subject?: string;
	message: string;
	remediation: string;
}

/**
 * How the author asked a related or conflicting package to be resolved.
 *
 * Declared with the package rather than chosen after the fact, because the two produce
 * genuinely different proposals — one updates a Style Set every linked template
 * resolves against, the other creates something nothing links to — and a report is
 * only meaningful about one of them. Changing the resolution changes the issues, so it
 * changes the fingerprint, so it needs a fresh confirmation.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_RESOLUTIONS = [
	'preserve-identity',
	'independent-copy',
] as const;

export type GraphicStyleSetPackageResolution
	= typeof GRAPHIC_STYLE_SET_PACKAGE_RESOLUTIONS[number];

/**
 * What installing this package would do.
 *
 * These are proposals: preflight decides one, records it in an immutable report, and
 * installation applies exactly the one the author confirmed. There is deliberately no
 * merge disposition — "imports never field-merge Style Sets" — so every outcome either
 * takes the packaged entries whole or does nothing at all.
 */
export const GRAPHIC_STYLE_SET_PACKAGE_DISPOSITIONS = [
	/** No Style Set with the packaged identity exists here; it is created as packaged. */
	'install-new',
	/** The exact identity, revision, and content are already installed: a no-op. */
	'already-installed',
	/** A newer revision of an installed Style Set, published here on confirmation. */
	'update-installed',
	/** A new local identity carrying the packaged entries, linked to by nothing. */
	'install-independent-copy',
	/** Nothing would be installed. */
	'rejected',
] as const;

export type GraphicStyleSetPackageDisposition
	= typeof GRAPHIC_STYLE_SET_PACKAGE_DISPOSITIONS[number];

/**
 * The one complete Graphic Style Set Package preflight result.
 *
 * Immutable once produced: its {@link GraphicStyleSetPackagePreflightReport.fingerprint}
 * covers the received bytes, the resolution the author asked for, the disposition it
 * produced, and every issue that disposition carries. Any change to the package, to
 * the installed library, or to the proposal invalidates a confirmation rather than
 * silently installing something else.
 */
export interface GraphicStyleSetPackagePreflightReport {
	packageKind: typeof GRAPHIC_STYLE_SET_PACKAGE_KIND;
	checkedAt: string;
	fingerprint: string;
	schema: {
		received: number;
		supported: number;
		migrated: boolean;
	};
	/** Absent when the archive or manifest could not be read at all. */
	provenance?: GraphicStyleSetPackageProvenance;
	styleSetName?: string;
	/** How many entries the packaged Style Set holds — never an archive file count. */
	styleSetEntryCount?: number;
	resolution: GraphicStyleSetPackageResolution;
	disposition: GraphicStyleSetPackageDisposition;
	/** The local identity the install would write, once one is decided. */
	targetStyleSetId?: string;
	/** The revision installed here for this identity, where one is installed. */
	installedRevision?: number;
	/**
	 * The draft revision the installed Style Set was at when this proposal was decided.
	 *
	 * Carried on the report rather than re-read at installation, and that is the whole
	 * point: it is the compare-and-swap token the write is conditional on, so a draft
	 * edit landing at any moment after the author saw this report refuses the write
	 * instead of being silently replaced by the packaged entries.
	 */
	installedDraftRevision?: number;
	/**
	 * Templates that would be offered an available style update. Named rather than
	 * counted, for the same reason a publish names them: an author who is about to
	 * revise four designs under their colleagues needs to know which four.
	 */
	affectedTemplates: readonly { id: string; name: string; revision: number; styleChanged: boolean }[];
	/** Why the packaged entries cannot be published here, when that is the fault. */
	publishIssues: readonly GraphicStyleSetPublishIssue[];
	issues: readonly GraphicStyleSetPackagePreflightIssue[];
	limits: typeof GRAPHIC_STYLE_SET_PACKAGE_LIMITS;
	observed: {
		archiveByteLength: number;
		/** How many files the archive carries — never a Style Set entry count. */
		archiveEntryCount: number;
		expandedByteLength: number;
	};
	/**
	 * `rejected` is terminal. `requires-confirmation` pauses for exactly one
	 * confirmation bound to the fingerprint. `ready` needs no confirmation.
	 */
	outcome: 'ready' | 'requires-confirmation' | 'rejected';
}

/**
 * What one completed installation answers with.
 *
 * The report is part of the answer rather than a separate lookup, because what an
 * install *did* is only meaningful beside what it proposed — "nothing was written"
 * and "revision four was published here" are the same HTTP success otherwise. The
 * affected templates are named for the same reason a publish names them: an author who
 * has just made an update available on four designs needs to know which four.
 */
export interface GraphicStyleSetPackageInstallation {
	report: GraphicStyleSetPackagePreflightReport;
	styleSet: GraphicStyleSetResponse;
	affectedTemplates: AffectedGraphicsTemplate[];
}

export function graphicStyleSetPackageFileName(styleSetName: string): string {
	const slug = styleSetName
		.normalize('NFKD')
		.replace(/[^\w.-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.toLowerCase()
		.slice(0, 64);
	return `${slug || 'graphic-style-set'}${GRAPHIC_STYLE_SET_PACKAGE_EXTENSION}`;
}

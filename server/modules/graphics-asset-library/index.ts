import type {
	GraphicAsset,
	GraphicAssetCanonicalMime,
	GraphicAssetId,
	GraphicAssetLifecycleActionOutcome,
	GraphicAssetLifecycleState,
	GraphicAssetPurgeOutcome,
	GraphicAssetReference,
	GraphicAssetReferenceStatus,
	GraphicAssetRetentionView,
	GraphicAssetRevisionId,
	GraphicAssetSilentVideoFacts,
	GraphicAssetSourceDeclarations,
	GraphicAssetUsage,
	GraphicAssetValidationReport,
	GraphicsAssetCapacityLimits,
	GraphicsAssetEvidenceCategory,
	GraphicsAssetEvidenceEntry,
	GraphicsAssetLibraryCapacity,
	GraphicsAssetLibraryComponentHealth,
	GraphicsAssetLibraryHealth,
	GraphicsDerivativeId,
	GraphicsDiscrepancy,
	GraphicsDiscrepancyActionOutcome,
	GraphicsDuplicateContentPolicy,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
	GraphicsIngestionSource,
	GraphicsOperationalQueuesOverview,
	GraphicsOperationsCockpit,
	GraphicsQueueInspection,
	GraphicsReconciliationOverview,
	GraphicsReconciliationSweepResult,
	GraphicsRetentionOverview,
	GraphicsRetentionSweepResult,
	InstalledGraphicsTemplate,
	InstalledGraphicsTemplateId,
	InstalledGraphicsTemplateKind,
} from '~~/shared/types/graphicsAsset';
import type {
	TemplatePackageAssetOrigin,
	TemplatePackageAssetRequirement,
	TemplatePackageCapabilityRequirement,
	TemplatePackageExportIssue,
	TemplatePackageExportReport,
	TemplatePackageKind,
	TemplatePackageManifest,
	TemplatePackageMappingBasis,
	TemplatePackagePreflightIssue,
	TemplatePackagePreflightMapping,
	TemplatePackagePreflightQuota,
	TemplatePackagePreflightReport,
	TemplatePackageTotals,
} from '~~/shared/types/templatePackage';
import type { GraphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import type { GraphicsOperationalQueueId } from '~~/shared/utils/graphicsOperationalQueues';
import type { GraphicsCapacityExhaustedDetails } from './errors';
import type { GraphicsAssetMultipartState } from './multipart';
import type {
	BoundedByteStream,
	GraphicsCanonicalObjectStore,
	GraphicsMultipartPart,
	GraphicsMultipartPartIdentity,
	GraphicsMultipartUploadIdentity,
	GraphicsObjectStoreHealth,
	GraphicsStagingObjectStore,
	ReadGraphicsObjectOutcome,
} from './object-store';
import type { GraphicsOperationalQueuesCatalogue } from './operational-queues';
import type { GraphicsOperationsCockpitCatalogue } from './operations-cockpit';
import type {
	GraphicsAssetReconciliationCatalogue,
	GraphicsReconciliationMedia,
	RegenerateGraphicsDerivativeOutcome,
	VerifyGraphicsContentBytesOutcome,
} from './reconciliation';
import type { GraphicsRemoteSourceFetcher } from './remote-source';
import type { GraphicsAssetRetentionCatalogue } from './retention';
import type { SilentVideoPlaybackValidator } from './silent-video-playback-validator';
import type { ResolvedPackagedRevision } from './template-package';
import type { TemplatePackageArchiveEntry } from './template-package-archive';
import type { TemplatePackagePreflightState } from './template-package-preflight';
import {
	TEMPLATE_PACKAGE_ARTIFACTS,
	TEMPLATE_PACKAGE_LIMITS,
	TEMPLATE_PACKAGE_MANIFEST_ENTRY,
	TEMPLATE_PACKAGE_SCHEMA_VERSION,
	TEMPLATE_PACKAGE_TEMPLATE_ENTRY,
	templatePackageFileName,
} from '~~/shared/types/templatePackage';
import { graphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import {
	GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
	GRAPHICS_MULTIPART_MAXIMUM_PART_ATTEMPTS,
	GRAPHICS_MULTIPART_PART_BYTES,
	GRAPHICS_MULTIPART_PART_TRANSFER_TIMEOUT_MILLISECONDS,
	MAX_SILENT_VIDEO_INGESTION_BYTES,
	MAX_SILENT_VIDEO_POSTER_BYTES,
	MAX_STATIC_FONT_INGESTION_BYTES,
	MAX_STILL_IMAGE_INGESTION_BYTES,
	SILENT_VIDEO_COMPATIBILITY_PROFILE,
	STATIC_FONT_COMPATIBILITY_PROFILE,
	STATIC_FONT_UNATTESTED_COMPATIBILITY_PROFILE,
	STILL_IMAGE_COMPATIBILITY_PROFILE,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { GRAPHICS_RETENTION_ACTOR } from '~~/shared/utils/graphicsAssetRetention';
import { canonicalContentIdentity, canonicalObjectAgreement } from './canonical-integrity';
import { GraphicsAssetLibraryError } from './errors';
import { processStaticFont } from './font';
import { graphicsIngestionPartIdentity } from './multipart';
import {
	boundedByteStreamWithDeadline,
	consumeBoundedByteStream,
	createBoundedByteStream,
	graphicsObjectIdentity,
	GraphicsObjectInputError,
	readableBytes,
} from './object-store';
import { createGraphicsOperationalQueues } from './operational-queues';
import { readGraphicsOperationsCockpit } from './operations-cockpit';
import {
	sha256Hex,
	sha256HexStream,
} from './png';
import {
	createGraphicsReconciliation,
	reconciliationWorkingCopyIdentity,
	reconciliationWorkingCopyOperationId,
} from './reconciliation';
import { createGraphicsRetention } from './retention';
import {
	processSilentVideo,
	processSilentVideoFromRandomAccess,
	SilentVideoInspectionSourceError,
} from './silent-video';
import {
	createUnavailableSilentVideoPlaybackValidator,
	silentVideoPlaybackValidationIssue,
} from './silent-video-playback-validator';
import { processStillImage } from './still-image';
import {
	groupTemplatePackageRequirements,
	inspectTemplateDocument,
	inspectTemplatePackageCapabilities,
	planTemplatePackage,
	templatePackageExportIssue,
	undeclaredReferenceIssues,
} from './template-package';
import {
	readTemplatePackageArchive,
	TemplatePackageArchiveSourceError,
} from './template-package-archive';
import {
	installedGraphicsTemplateKind,
	packagedOriginKey,
	rewriteTemplateDocumentReferences,
	templatePackageLocalReferences,
} from './template-package-installation';
import {
	assembleTemplatePackagePreflightReport,
	hasNestedArchiveSignature,
	inspectReceivedApplicationCapabilities,
	inspectTemplatePackageEntries,
	NESTED_ARCHIVE_PROBE_BYTES,
	readTemplatePackageManifest,
	templatePackageMappingProposal,
	templatePackagePreflightConfirmed,
	templatePackagePreflightFingerprintMaterial,
} from './template-package-preflight';
import { templatePackagePreflightIssue } from './template-package-preflight-issues';
import {
	GraphicAssetValidationError,
	rejectedValidationReport,
	validationError,
} from './validation';
import { createStoredZipArchive, storedZipArchiveByteLength } from './zip-archive';

export { GraphicsAssetLibraryError } from './errors';
export { createInMemoryGraphicsAssetCatalogue } from './in-memory-catalogue';

/**
 * A manifest or Template document is parsed in full, so both are bounded well
 * below the envelope's own limits. Neither has any legitimate reason to be
 * larger, and a package cannot be allowed to make a receiver hold one that is.
 */
const MAXIMUM_PACKAGE_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** How much of an archive entry is resident while its digest is recomputed. */
const PACKAGE_ENTRY_READ_CHUNK_BYTES = 1024 * 1024;

const GRAPHIC_ASSET_SOURCE_POLICIES = {
	'image': {
		label: 'Still image',
		maximumByteLength: MAX_STILL_IMAGE_INGESTION_BYTES,
		compatibilityProfile: STILL_IMAGE_COMPATIBILITY_PROFILE,
		conflictingMimeCode: 'conflicting-image-mime',
	},
	'silent-video': {
		label: 'Silent video',
		maximumByteLength: MAX_SILENT_VIDEO_INGESTION_BYTES,
		compatibilityProfile: SILENT_VIDEO_COMPATIBILITY_PROFILE,
		conflictingMimeCode: 'conflicting-video-mime',
	},
	'font': {
		label: 'Static font',
		maximumByteLength: MAX_STATIC_FONT_INGESTION_BYTES,
		compatibilityProfile: STATIC_FONT_COMPATIBILITY_PROFILE,
		conflictingMimeCode: 'conflicting-font-mime',
	},
} as const satisfies Record<GraphicAssetSourceKind, {
	label: string;
	maximumByteLength: number;
	compatibilityProfile: GraphicAssetValidationReport['compatibilityProfile'];
	conflictingMimeCode: Extract<GraphicAssetValidationReport, { outcome: 'rejected' }>['issues'][number]['code'];
}>;

async function processGraphicAssetSource(
	kind: GraphicAssetSourceKind,
	bytes: Uint8Array,
	declarations: Pick<GraphicAssetSourceDeclarations, 'sourceFileName' | 'declaredMime'>,
) {
	switch (kind) {
		case 'font':
			return await processStaticFont(bytes, declarations);
		case 'silent-video':
			return await processSilentVideo(bytes, declarations);
		case 'image':
			return await processStillImage(bytes, declarations);
	}
}

export interface GraphicsAssetCatalogueHealth {
	checkHealth: () => Promise<{ outcome: 'healthy' }>;
}

export interface PublishGraphicAssetCatalogueInput {
	operation: GraphicsIngestionOperation;
	report: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>;
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	derivativeId: GraphicsDerivativeId;
	sourceDigest: string;
	thumbnailDigest: string;
	thumbnailByteLength: number;
	publishedAt: string;
}

export interface ReusableGraphicAsset {
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
}

/**
 * One packaged identity this installation is creating a local Graphic Asset for.
 *
 * It carries the packaged metadata snapshot — the name and kind the sender
 * recorded — together with the facts and compatibility profile *this*
 * installation proved for the same bytes, because a receiver never adopts
 * another installation's judgement of what its content is.
 */
export interface CreatedTemplatePackageGraphicAsset {
	packagedId: string;
	basis: TemplatePackageMappingBasis;
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	derivativeId: GraphicsDerivativeId;
	name: string;
	kind: 'image' | 'silent-video' | 'font';
	sourceDigest: string;
	sourceByteLength: number;
	canonicalMime: GraphicAssetCanonicalMime;
	compatibilityProfile: string;
	facts: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>['facts'];
	derivativeKind: 'thumbnail' | 'video-poster' | 'font-specimen';
	thumbnailDigest: string;
	thumbnailByteLength: number;
	origin: TemplatePackageAssetOrigin;
}

/**
 * One packaged identity that matched an exact Graphic Asset Origin and so reuses
 * the local revision untouched. Its name and compatibility profile are the
 * library's own current record, never the package's: reuse preserves locally
 * curated metadata, and the differences were already reported at preflight.
 */
export interface ReusedTemplatePackageGraphicAsset {
	packagedId: string;
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	name: string;
	kind: 'image' | 'silent-video' | 'font';
	compatibilityProfile: string;
}

export interface InstallTemplatePackageCatalogueInput {
	/** Claimed at `publishing`; every statement commits only against this claim. */
	operation: GraphicsIngestionOperation;
	template: {
		id: InstalledGraphicsTemplateId;
		kind: InstalledGraphicsTemplateKind;
		name: string;
		/** Already rewritten to exact local identities and revisions. */
		document: unknown;
		sourceTemplateIdentity: string;
	};
	created: readonly CreatedTemplatePackageGraphicAsset[];
	reused: readonly ReusedTemplatePackageGraphicAsset[];
	references: readonly {
		id: string;
		ownerSlot: string;
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}[];
	publishedAt: string;
}

/**
 * One packaged content entry as this installation read and judged it: where its
 * bytes are in the staged archive, the facts a local revalidation proved, and
 * the preview regenerated from them.
 */
interface ValidatedPackagedContent {
	entry: TemplatePackageArchiveEntry;
	facts: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>['facts'];
	compatibilityProfile: string;
	thumbnail: Uint8Array;
	thumbnailDigest: string;
}

interface StagedTemplatePackageMaterial {
	manifest?: TemplatePackageManifest;
	/** The received document, exactly as packaged and before any rewrite. */
	templateDocument?: unknown;
	contents: Map<string, ValidatedPackagedContent>;
}

export type GraphicAssetLifecycleTransition
	= | {
		outcome: 'updated';
		asset: GraphicAsset;
	}
	| {
		outcome: 'in-use';
		usage: GraphicAssetUsage[];
	}
	| { outcome: 'not-found' | 'not-allowed' };

export interface GraphicsAssetCatalogue extends GraphicsAssetCatalogueHealth {
	getCapacity: () => Promise<GraphicsAssetLibraryCapacity>;
	initiateGraphicsIngestion: (operation: GraphicsIngestionOperation) => Promise<GraphicsIngestionOperation>;
	recordStagedBytes: (input: {
		operation: GraphicsIngestionOperation;
		usedBytes: number;
		recordedAt: string;
	}) => Promise<void>;
	/**
	 * An approved remote copy reserves the worst-case staging envelope before
	 * any byte moves, because the exact length is only knowable from the remote
	 * response. This records the observed length as the operation's declared
	 * length and releases the unused part of that reservation.
	 */
	recordRemoteCopyStagedSource: (input: {
		operation: GraphicsIngestionOperation;
		observedByteLength: number;
		recordedAt: string;
	}) => Promise<void>;
	recordCanonicalWrites: (input: {
		operation: GraphicsIngestionOperation;
		contents: readonly { digest: string; byteLength: number }[];
		recordedAt: string;
	}) => Promise<void>;
	reserveGraphicAssetPublication: (input: {
		operation: GraphicsIngestionOperation;
		sourceDigest: string;
		sourceByteLength: number;
		thumbnailDigest: string;
		thumbnailByteLength: number;
		reservedAt: string;
	}) => Promise<
		| { outcome: 'reserved'; operation: GraphicsIngestionOperation }
		| { outcome: 'blocked'; capacity: GraphicsCapacityExhaustedDetails }
	>;
	updateCapacityLimits: (
		input: GraphicsAssetCapacityLimits & { updatedAt: string },
	) => Promise<GraphicsAssetLibraryCapacity>;
	getIngestionOperation: (
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	) => Promise<GraphicsIngestionOperation | undefined>;
	getGraphicAssetMultipartState: (
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	) => Promise<GraphicsAssetMultipartState | undefined>;
	updateGraphicAssetMultipartState: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		expectedVersion: number;
		state: GraphicsAssetMultipartState;
		updatedAt: string;
	}) => Promise<boolean>;
	recordGraphicAssetMultipartCleanupComplete: (
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	) => Promise<void>;
	getTemplatePackagePreflight: (
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	) => Promise<TemplatePackagePreflightState | undefined>;
	/** Returns false when the operation reached a terminal or confirmed stage first. */
	updateTemplatePackagePreflight: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		state: TemplatePackagePreflightState;
	}) => Promise<boolean>;
	/**
	 * Accepts one exact proposal and readies it for installation in a single
	 * conditional transition.
	 *
	 * Recording the confirmation and advancing the stage must not be two steps: a
	 * retry can durably record a newer report between them, and a confirmation
	 * written back over it would install a proposal nobody agreed to. So this
	 * compares and sets — it commits only while the operation is still paused on
	 * the exact report the author saw, and writes only the confirmation.
	 */
	confirmTemplatePackagePreflight: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		fingerprint: string;
		confirmedAt: string;
		updatedAt: string;
	}) => Promise<boolean>;
	/**
	 * Reserves the canonical growth one confirmed Template Package proposal
	 * costs, as one number rather than per digest: the report already counted
	 * every shared byte once, so re-deriving it here could only disagree with
	 * what the author confirmed.
	 */
	reserveTemplatePackagePublication: (input: {
		operation: GraphicsIngestionOperation;
		growthBytes: number;
		reservedAt: string;
	}) => Promise<
		| { outcome: 'reserved'; operation: GraphicsIngestionOperation }
		| { outcome: 'blocked'; capacity: GraphicsCapacityExhaustedDetails }
		/** Another attempt took the operation; this one has nothing left to reserve for. */
		| { outcome: 'lost-claim' }
	>;
	/**
	 * Publishes one complete Template Package installation.
	 *
	 * Every new Graphic Asset, revision, Graphic Asset Origin, derivative, Event
	 * association, rewritten Graphic Asset Reference, the Installed Graphics
	 * Template, and the terminal operation result commit together or not at all.
	 * Reusing an exact origin writes nothing to the local asset it reuses beyond
	 * the Event association an Event-scoped installation adds.
	 */
	installTemplatePackage: (
		input: InstallTemplatePackageCatalogueInput,
	) => Promise<GraphicsIngestionOperation>;
	/**
	 * One Installed Graphics Template and the exact revisions its references pin.
	 */
	findInstalledGraphicsTemplate: (
		templateId: InstalledGraphicsTemplateId,
	) => Promise<InstalledGraphicsTemplate | undefined>;
	/**
	 * What this installation already holds for one packaged Graphic Asset Origin:
	 * the exact local revision carrying that source identity and revision, and
	 * whether any other revision of the same source is present.
	 */
	findTemplatePackageOriginCandidates: (input: {
		sourceAssetId: string;
		sourceRevisionId: string;
	}) => Promise<{
		exact?: {
			reference: GraphicAssetReference;
			digest: string;
			name: string;
			lifecycleState: GraphicAssetLifecycleState;
		};
		relatedRevisionExists: boolean;
	}>;
	findGraphicAssetByContentDigest: (digest: string) => Promise<
		| (ReusableGraphicAsset & { name: string })
		| undefined
	>;
	updateIngestionOperation: (
		operation: GraphicsIngestionOperation,
		expectedUpdatedAt: string,
	) => Promise<GraphicsIngestionOperation>;
	claimGraphicsIngestion: (input: {
		operation: GraphicsIngestionOperation;
		claimedAt: string;
		staleBefore: string;
	}) => Promise<GraphicsIngestionOperation | undefined>;
	findReusableGraphicAsset: (sourceDigest: string) => Promise<ReusableGraphicAsset | undefined>;
	findCurrentGraphicAsset: (assetId: GraphicAssetId) => Promise<
		| (ReusableGraphicAsset & { sourceDigest: string })
		| undefined
	>;
	reuseGraphicAsset: (input: {
		operation: GraphicsIngestionOperation;
		reusable: ReusableGraphicAsset;
		publishedAt: string;
	}) => Promise<GraphicsIngestionOperation>;
	completeGraphicAssetReplacementNoop: (input: {
		operation: GraphicsIngestionOperation;
		current: ReusableGraphicAsset & { sourceDigest: string };
		completedAt: string;
	}) => Promise<GraphicsIngestionOperation>;
	publishGraphicAssetReplacement: (input: PublishGraphicAssetCatalogueInput & {
		targetAssetId: GraphicAssetId;
	}) => Promise<GraphicsIngestionOperation>;
	publishGraphicAsset: (input: PublishGraphicAssetCatalogueInput) => Promise<GraphicsIngestionOperation>;
	updateGraphicAsset: (input: {
		assetId: GraphicAssetId;
		name: string;
		eventIds: number[];
		updatedAt: string;
	}) => Promise<GraphicAsset | undefined>;
	listGraphicAssets: (
		search: string,
		lifecycleStates: readonly GraphicAssetLifecycleState[],
	) => Promise<GraphicAsset[]>;
	retireGraphicAsset: (input: {
		assetId: GraphicAssetId;
		updatedAt: string;
	}) => Promise<GraphicAssetLifecycleTransition>;
	trashGraphicAsset: (input: {
		assetId: GraphicAssetId;
		trashedAt: string;
		recoverableUntil: string;
	}) => Promise<GraphicAssetLifecycleTransition>;
	restoreGraphicAsset: (input: {
		assetId: GraphicAssetId;
		restoredAt: string;
	}) => Promise<GraphicAssetLifecycleTransition>;
	findRevisionContent: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) => Promise<{
		digest: string;
		byteLength: number;
		canonicalMime: GraphicAssetCanonicalMime;
		kind: 'image' | 'silent-video' | 'font';
		lifecycleState: 'active' | 'retired' | 'trashed';
		/** The catalogue metadata snapshot a Template Package carries as provenance. */
		name: string;
		revisionNumber: number;
		compatibilityProfile: string;
		facts: GraphicAsset['facts'];
	} | undefined>;
	listGraphicAssetUsage: (assetId: GraphicAssetId) => Promise<GraphicAssetUsage[]>;
	/**
	 * The preview content for one Graphic Asset, with the facts a reader needs to
	 * prove the stored object is the one the catalogue recorded.
	 */
	findThumbnailContent: (assetId: GraphicAssetId) => Promise<{
		digest: string;
		byteLength: number;
		canonicalMime: GraphicAssetCanonicalMime;
	} | undefined>;
}

export interface GraphicsAssetLibrary {
	getHealth: () => Promise<GraphicsAssetLibraryHealth>;
	/**
	 * The administrator-only Operations Cockpit reading: whether the library is
	 * safe, and what needs attention.
	 *
	 * It composes catalogue and byte-store condition, capacity against its exact
	 * boundaries, unfinished ingestion, the reconciliation backlog, lifecycle
	 * deadlines, and recent outcomes into one domain-shaped answer. A catalogue
	 * that cannot answer still produces a reading, because the question the
	 * cockpit exists to settle is exactly the one that matters most then.
	 */
	getOperationsCockpit: () => Promise<GraphicsOperationsCockpit>;
	getCapacity: () => Promise<GraphicsAssetLibraryCapacity>;
	updateCapacityLimits: (
		input: GraphicsAssetCapacityLimits,
	) => Promise<GraphicsAssetLibraryCapacity>;
	initiateGraphicsIngestion: (input: GraphicAssetSourceDeclarations & {
		idempotencyKey: string;
		initiatedBy: string;
		name: string;
		defaultEventId?: number;
		duplicateContentPolicy?: GraphicsDuplicateContentPolicy;
		declaredByteLength: number;
	}) => Promise<GraphicsIngestionOperation>;
	initiateGraphicAssetReplacement: (input: GraphicAssetSourceDeclarations & {
		assetId: GraphicAssetId;
		idempotencyKey: string;
		initiatedBy: string;
		declaredByteLength: number;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * Initiates a one-time copy of an approved public HTTPS resource. The remote
	 * length is unknown until the copy runs, so the operation starts with the
	 * worst-case bound for the Graphic Asset kind implied by its declarations.
	 */
	initiateRemoteGraphicAssetCopy: (input: GraphicAssetSourceDeclarations & {
		idempotencyKey: string;
		initiatedBy: string;
		name: string;
		defaultEventId?: number;
		duplicateContentPolicy?: GraphicsDuplicateContentPolicy;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * Runs the bounded remote copy. The URL is never persisted, logged, or
	 * reported: it is supplied per attempt and its query parameters and fragment
	 * are treated as secrets.
	 */
	copyRemoteGraphicAssetSource: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		sourceUrl: string;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * Provisional staged bytes for an operation paused for browser confirmation.
	 * Only the initiating author may read them, and they remain undiscoverable
	 * and non-addressable outside this operation.
	 */
	resolveStagedGraphicAssetSource: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<
		| {
			outcome: 'available';
			body: ReadableStream<Uint8Array>;
			byteLength: number;
		}
		| { outcome: 'missing' }
		| { outcome: 'unavailable'; retryable: true }
	>;
	confirmGraphicAssetBrowserEvidence: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		evidence: NonNullable<GraphicAssetSourceDeclarations['browserDecodeEvidence']>;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * Initiates preflight of one received Template Package. The package is
	 * transferred and staged through the same durable path every other ingestion
	 * source uses, so it resumes, cancels, and expires identically.
	 */
	initiateTemplatePackagePreflight: (input: {
		idempotencyKey: string;
		initiatedBy: string;
		sourceFileName?: string;
		declaredByteLength: number;
		defaultEventId?: number;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * Accepts the exact proposal a report describes. The fingerprint must match
	 * the current report, so a confirmation can never be applied to a package,
	 * mapping, or compatibility profile the author never saw.
	 */
	confirmTemplatePackagePreflight: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		fingerprint: string;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * Installs one confirmed Template Package.
	 *
	 * The staged package is inspected again from its exact received bytes, and
	 * the proposal that produces must still be the one the author accepted: a
	 * library, compatibility profile, or capacity that moved underneath a resting
	 * confirmation returns the operation to `awaiting-confirmation` with the new
	 * report rather than installing something nobody agreed to.
	 *
	 * Everything the package publishes becomes discoverable in one transaction,
	 * so calling this twice, retrying it after an ambiguous failure, or racing it
	 * against a cancellation can never produce a partial or duplicated
	 * installation.
	 */
	installTemplatePackage: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * One Installed Graphics Template: its independent local document, and the
	 * exact local revisions its rewritten references pin.
	 */
	inspectInstalledGraphicsTemplate: (input: {
		templateId: InstalledGraphicsTemplateId;
	}) => Promise<InstalledGraphicsTemplate>;
	cancelGraphicsIngestion: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	getIngestionOperation: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	uploadGraphicAsset: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		declaredMime?: string;
		bytes: BoundedByteStream;
	}) => Promise<GraphicsIngestionOperation>;
	startGraphicAssetMultipartUpload: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	uploadGraphicAssetMultipartPart: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		partNumber: number;
		bytes: BoundedByteStream;
	}) => Promise<GraphicsIngestionOperation>;
	completeGraphicAssetMultipartUpload: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	retryGraphicsIngestion: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * The font-specific entry point into {@link confirmGraphicAssetBrowserEvidence}.
	 * It rejects non-font evidence before the shared kind check so a font client
	 * receives a font-shaped error.
	 */
	confirmFontBrowserEvidence: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		evidence: NonNullable<GraphicAssetSourceDeclarations['browserDecodeEvidence']>;
	}) => Promise<GraphicsIngestionOperation>;
	listGraphicAssets: (input: {
		search?: string;
		lifecycleStates?: readonly GraphicAssetLifecycleState[];
	}) => Promise<GraphicAsset[]>;
	retireGraphicAsset: (input: {
		assetId: GraphicAssetId;
	}) => Promise<GraphicAssetLifecycleActionOutcome>;
	trashGraphicAsset: (input: {
		assetId: GraphicAssetId;
	}) => Promise<GraphicAssetLifecycleActionOutcome>;
	restoreGraphicAsset: (input: {
		assetId: GraphicAssetId;
	}) => Promise<GraphicAssetLifecycleActionOutcome>;
	updateGraphicAsset: (input: {
		assetId: GraphicAssetId;
		name: string;
		eventIds: number[];
	}) => Promise<GraphicAsset>;
	listGraphicAssetUsage: (input: { assetId: GraphicAssetId }) => Promise<GraphicAssetUsage[]>;
	inspectGraphicAssetRevision: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) => Promise<GraphicAssetReferenceStatus>;
	inspectGraphicAssetRevisionContent: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) => Promise<
		| {
			outcome: 'available';
			byteLength: number;
			contentType: GraphicAssetCanonicalMime;
		}
		| { outcome: 'missing' }
		| { outcome: 'unavailable'; retryable: true }
	>;
	resolveGraphicAssetRevision: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
		range?: { offset: number; length: number };
	}) => Promise<
		| {
			outcome: 'available';
			body: ReadableStream<Uint8Array>;
			byteLength: number;
			contentType: GraphicAssetCanonicalMime;
		}
		| { outcome: 'missing' }
		| { outcome: 'unavailable'; retryable: true }
	>;
	resolveGraphicAssetThumbnail: (input: {
		assetId: GraphicAssetId;
	}) => Promise<
		| {
			outcome: 'available';
			body: ReadableStream<Uint8Array>;
			byteLength: number;
			contentType: 'image/png';
		}
		| { outcome: 'missing' }
		| { outcome: 'unavailable'; retryable: true }
	>;
	/**
	 * The single contract both Template Package exporters use. Each workflow
	 * supplies its own Template payload and the requirements its own vocabulary
	 * discovered; the library decides what a package may contain, resolves every
	 * exact revision, and streams the envelope. Callers learn nothing about
	 * digests-as-keys, buckets, or any storage provider.
	 */
	exportTemplatePackage: (input: TemplatePackageExportRequest) => Promise<TemplatePackageExportOutcome>;
	/**
	 * Runs one scheduled retention pass. Every stage reclaims only state it has
	 * just proven unreachable past its complete recovery guarantee, and records
	 * durable Evidence for what it did.
	 */
	runGraphicsRetention: () => Promise<GraphicsRetentionSweepResult>;
	/**
	 * The administrator's explicitly confirmed early purge of unreferenced
	 * Trash. It proves usage afresh and never shortens any other guarantee.
	 */
	purgeTrashedGraphicAsset: (input: {
		assetId: GraphicAssetId;
		actor: string;
		confirmation: 'purge-now';
	}) => Promise<GraphicAssetPurgeOutcome>;
	listGraphicsAssetEvidence: (input?: {
		limit?: number;
		categories?: readonly GraphicsAssetEvidenceCategory[];
		/**
		 * Narrows the ledger to one opaque domain subject. Without it the ledger
		 * answers with the newest entries the installation holds, which is a
		 * different question from what happened to this asset.
		 */
		subject?: { kind: GraphicsAssetEvidenceEntry['subject']['kind']; id: string };
	}) => Promise<GraphicsAssetEvidenceEntry[]>;
	/**
	 * Every operational queue in one risk-ordered reading: what needs doing,
	 * how much of it there is, and the soonest deadline each queue is holding.
	 */
	getOperationalQueues: () => Promise<GraphicsOperationalQueuesOverview>;
	/**
	 * Everything the persistent inspector shows for one selected queue item:
	 * its domain identity, current state, exact deadline, affected pinned usage,
	 * the catalogue's expectations beside the byte evidence, the Evidence ledger
	 * filtered to that subject, and only the actions valid in that state.
	 */
	inspectOperationalQueueItem: (input: {
		queue: GraphicsOperationalQueueId;
		subjectId: string;
	}) => Promise<GraphicsQueueInspection>;
	/** Every exact recovery and cleanup deadline the installation is holding. */
	getRetentionOverview: () => Promise<GraphicsRetentionOverview>;
	/** One Graphic Asset's recovery window and per-revision retention. */
	inspectGraphicAssetRetention: (input: {
		assetId: GraphicAssetId;
	}) => Promise<GraphicAssetRetentionView>;
	/**
	 * Runs one reconciliation pass. The catalogue decides what should be
	 * reachable and the byte store reports only what it holds; nothing here
	 * creates, redirects, or removes an identity or a reference.
	 */
	runGraphicsReconciliation: () => Promise<GraphicsReconciliationSweepResult>;
	/** Catalogue-versus-byte-store health and every open discrepancy. */
	getReconciliationOverview: () => Promise<GraphicsReconciliationOverview>;
	/**
	 * One discrepancy's structured evidence, the pinned usage it affects, and
	 * exactly the actions valid in its current state.
	 */
	inspectGraphicsDiscrepancy: (input: {
		discrepancyId: string;
	}) => Promise<GraphicsDiscrepancy>;
	/** Re-observes one discrepancy against the byte store right now. */
	recheckGraphicsDiscrepancy: (input: {
		discrepancyId: string;
		actor: string;
	}) => Promise<GraphicsDiscrepancyActionOutcome>;
	/**
	 * Repairs Unavailable Graphic Asset Content from exact supplied bytes. The
	 * bytes must prove the same application SHA-256, byte size, canonical media
	 * type, and validation facts; a successful repair creates no Graphic Asset
	 * Revision and changes no Graphic Asset Reference.
	 */
	repairUnavailableGraphicAssetContent: (input: {
		discrepancyId: string;
		actor: string;
		bytes: BoundedByteStream;
	}) => Promise<GraphicsDiscrepancyActionOutcome>;
	/**
	 * Re-reads and re-hashes the stored bytes in full against the complete
	 * expectation. It is the only action valid on an isolated critical integrity
	 * incident, because it settles one without writing anything; verified bytes
	 * a Content Quarantine record was holding are restored by releasing it.
	 */
	verifyStoredGraphicAssetContent: (input: {
		discrepancyId: string;
		actor: string;
	}) => Promise<GraphicsDiscrepancyActionOutcome>;
	/**
	 * Regenerates one missing deterministic Graphics Derivative from available
	 * canonical source content, without mutating its source revision.
	 */
	regenerateGraphicsDerivative: (input: {
		discrepancyId: string;
		actor: string;
	}) => Promise<GraphicsDiscrepancyActionOutcome>;
}

export interface TemplatePackageExportRequest {
	packageKind: TemplatePackageKind;
	/** Exactly one Template. Its document is opaque data the library validates but never interprets. */
	template: {
		identity: string;
		name: string;
		document: unknown;
	};
	/** Every exact revision the Template transitively requires, by Template slot. */
	assets: readonly TemplatePackageAssetRequirement[];
	/** Application-owned capabilities to declare rather than duplicate. */
	capabilities?: readonly TemplatePackageCapabilityRequirement[];
}

export interface TemplatePackageEnvelope {
	packageKind: TemplatePackageKind;
	fileName: string;
	mediaType: string;
	manifest: TemplatePackageManifest;
	/** Exact, known before the first byte streams, so a route may publish it. */
	archiveByteLength: number;
	open: () => ReadableStream<Uint8Array>;
}

export type TemplatePackageExportOutcome
	= | { outcome: 'exported'; package: TemplatePackageEnvelope }
		| { outcome: 'rejected'; report: TemplatePackageExportReport };

interface GraphicsAssetLibraryDependencies {
	catalogue: GraphicsAssetCatalogueHealth | GraphicsAssetCatalogue;
	staging: GraphicsObjectStoreHealth | GraphicsStagingObjectStore;
	canonical: GraphicsObjectStoreHealth | GraphicsCanonicalObjectStore;
	silentVideoPlaybackValidator?: SilentVideoPlaybackValidator;
	remoteSource?: GraphicsRemoteSourceFetcher;
	now?: () => Date;
	generateIdentity?: () => string;
}

function requiredIdentity<T extends string>(value: string, label: string): T {
	if (value.length === 0)
		throw new Error(`${label} cannot be empty`);
	return value as T;
}

export function graphicAssetId(value: string): GraphicAssetId {
	return requiredIdentity<GraphicAssetId>(value, 'Graphic Asset identity');
}

export function graphicAssetRevisionId(value: string): GraphicAssetRevisionId {
	return requiredIdentity<GraphicAssetRevisionId>(value, 'Graphic Asset Revision identity');
}

function requiredActor(actor: string): string {
	const identity = actor.trim();
	if (!identity) {
		throw new GraphicsAssetLibraryError(
			'A reconciliation action requires an administrator identity',
			'invalid-ingestion-input',
		);
	}
	return identity;
}

/**
 * A reconciliation action addresses one discrepancy by identity, so an unknown
 * identity is a not-found result rather than a silently ignored request.
 */
function requireDiscrepancyOutcome(
	outcome: GraphicsDiscrepancyActionOutcome | undefined,
): GraphicsDiscrepancyActionOutcome {
	if (!outcome)
		throw new GraphicsAssetLibraryError('Graphics discrepancy not found', 'ingestion-operation-not-found');
	return outcome;
}

/**
 * A discrepancy identity from an untrusted edge. It is an opaque domain
 * identity rather than a brand, but it is still validated at the boundary so a
 * blank path segment becomes a clear input error rather than a lookup miss.
 */
export function graphicsDiscrepancyId(value: string): string {
	const identity = value.trim();
	if (!identity) {
		throw new GraphicsAssetLibraryError(
			'A Graphics discrepancy identity is required',
			'invalid-ingestion-input',
		);
	}
	return identity;
}

export function graphicsDerivativeId(value: string): GraphicsDerivativeId {
	return requiredIdentity<GraphicsDerivativeId>(value, 'Graphics Derivative identity');
}

export function graphicsIngestionOperationId(value: string): GraphicsIngestionOperationId {
	return requiredIdentity<GraphicsIngestionOperationId>(value, 'Graphics Ingestion Operation identity');
}

export function installedGraphicsTemplateId(value: string): InstalledGraphicsTemplateId {
	return requiredIdentity<InstalledGraphicsTemplateId>(value, 'Installed Graphics Template identity');
}

export function graphicsMultipartPartByteLength(
	declaredByteLength: number,
	partNumber: number,
): number {
	const partCount = Math.ceil(declaredByteLength / GRAPHICS_MULTIPART_PART_BYTES);
	if (!Number.isSafeInteger(partNumber) || partNumber <= 0 || partNumber > partCount)
		throw new GraphicsAssetLibraryError('Multipart part number is outside this operation', 'invalid-ingestion-input');
	return partNumber === partCount
		? declaredByteLength - GRAPHICS_MULTIPART_PART_BYTES * (partCount - 1)
		: GRAPHICS_MULTIPART_PART_BYTES;
}

async function catalogueHealth(catalogue: GraphicsAssetCatalogueHealth): Promise<GraphicsAssetLibraryComponentHealth> {
	try {
		await catalogue.checkHealth();
		return { status: 'healthy' };
	}
	catch {
		return {
			status: 'unavailable',
			reason: { code: 'catalogue-unavailable', retryable: true },
		};
	}
}

async function byteStoreHealth(
	store: GraphicsObjectStoreHealth,
): Promise<GraphicsAssetLibraryComponentHealth> {
	try {
		const outcome = await store.checkHealth();
		return outcome.outcome === 'healthy'
			? { status: 'healthy' }
			: {
					status: 'unavailable',
					reason: { code: 'byte-store-unavailable', retryable: true },
				};
	}
	catch {
		return {
			status: 'unavailable',
			reason: { code: 'byte-store-unavailable', retryable: true },
		};
	}
}

export function createGraphicsAssetLibrary(
	dependencies: GraphicsAssetLibraryDependencies,
): GraphicsAssetLibrary {
	const now = dependencies.now ?? (() => new Date());
	const generateIdentity = dependencies.generateIdentity ?? (() => crypto.randomUUID());
	const silentVideoPlaybackValidator = dependencies.silentVideoPlaybackValidator
		?? createUnavailableSilentVideoPlaybackValidator();
	const activeIngestionLeaseMilliseconds
		= GRAPHICS_MULTIPART_PART_TRANSFER_TIMEOUT_MILLISECONDS + 30_000;
	const trashRecoveryMilliseconds = 30 * 24 * 60 * 60 * 1000;

	function requireCatalogue(): GraphicsAssetCatalogue {
		if (!('initiateGraphicsIngestion' in dependencies.catalogue))
			throw new GraphicsAssetLibraryError('Graphics Asset catalogue is unavailable', 'graphics-asset-library-unavailable');
		return dependencies.catalogue;
	}

	function requireStaging(): GraphicsStagingObjectStore {
		if (!('createImmutable' in dependencies.staging))
			throw new GraphicsAssetLibraryError('Graphics Asset staging byte store is unavailable', 'graphics-asset-library-unavailable');
		return dependencies.staging;
	}

	function requireCanonical(): GraphicsCanonicalObjectStore {
		if (!('createImmutable' in dependencies.canonical))
			throw new GraphicsAssetLibraryError('Graphics Asset canonical byte store is unavailable', 'graphics-asset-library-unavailable');
		return dependencies.canonical;
	}

	/**
	 * Attestations a browser or the pinned validation runtime made about these
	 * exact bytes at ingestion. Re-inspection cannot reproduce them and does not
	 * need to: an exact SHA-256 match already proves the bytes are the same ones
	 * those attestations were made about.
	 */
	const RUNTIME_ATTESTATION_FACTS = [
		'browserDecodable',
		'browserPlayable',
		'browserLoadable',
		'chromiumTransparencyPlayback',
		'representativeGlyphsRendered',
	] as const;

	function comparableFacts(facts: Record<string, unknown>): string {
		const attested = new Set<string>(RUNTIME_ATTESTATION_FACTS);
		return JSON.stringify(
			Object.fromEntries(
				Object.entries(facts)
					.filter(([key]) => !attested.has(key))
					.toSorted(([left], [right]) => left.localeCompare(right)),
			),
		);
	}

	/**
	 * Re-derives a source's validation facts from bytes already staged or stored.
	 * Video is inspected through random access so a repair candidate is never
	 * held complete in memory.
	 */
	async function inspectContentBytes(
		read: (range?: { offset: number; length: number }) => Promise<ReadGraphicsObjectOutcome>,
		byteLength: number,
		sourceKind: GraphicAssetSourceKind,
		digest: string,
	) {
		if (sourceKind === 'silent-video') {
			return await processSilentVideoFromRandomAccess({
				byteLength,
				sha256: digest,
				read: async (offset, length) => {
					const range = await read({ offset, length });
					if (range.outcome !== 'available') {
						return range.outcome === 'missing'
							? { outcome: 'missing' as const }
							: { outcome: 'unavailable' as const, retryable: true as const };
					}
					const bytes = await consumeBoundedByteStream({
						body: range.body,
						byteLength: length,
						maximumByteLength: length,
					});
					return {
						outcome: 'available' as const,
						bytes,
						completeLength: range.range.completeLength,
					};
				},
			}, {});
		}
		const complete = await read();
		if (complete.outcome !== 'available')
			throw new GraphicsObjectInputError('The content bytes could not be read for inspection');
		const bytes = await consumeBoundedByteStream({
			body: complete.body,
			byteLength: complete.object.byteLength,
			maximumByteLength: GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind].maximumByteLength,
		});
		return await processGraphicAssetSource(sourceKind, bytes, {});
	}

	/**
	 * Regenerates a silent-video poster.
	 *
	 * The pinned validation runtime reads staged sources, so the canonical bytes
	 * are streamed into the working copy this regeneration already owns. The
	 * copy is the same identity reconciliation claimed and cleans up, so a
	 * crashed regeneration can never leave staged bytes with no catalogue trace.
	 */
	async function regenerateSilentVideoPoster(input: {
		discrepancyId: string;
		sourceDigest: string;
		sourceByteLength: number;
		sourceCanonicalMime: string;
		sourceFacts: Record<string, unknown>;
	}): Promise<RegenerateGraphicsDerivativeOutcome> {
		const unavailable = {
			outcome: 'unavailable' as const,
			code: 'derivative-regeneration-unavailable' as const,
			message: 'The pinned silent-video validation runtime could not reproduce this poster.',
		};
		const source = await requireCanonical().read(canonicalContentIdentity(input.sourceDigest));
		if (source.outcome !== 'available')
			return { ...unavailable, code: 'source-content-unavailable', message: 'The canonical source content is not currently available.' };
		// Staged objects are create-if-absent, so an abandoned copy from a
		// previous attempt would otherwise be validated instead of this one.
		// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
		await requireStaging().delete(reconciliationWorkingCopyIdentity(input.discrepancyId));
		const staged = await requireStaging().createImmutable({
			identity: reconciliationWorkingCopyIdentity(input.discrepancyId),
			bytes: {
				body: source.body,
				byteLength: input.sourceByteLength,
				maximumByteLength: input.sourceByteLength,
			},
			metadata: { contentType: input.sourceCanonicalMime },
		});
		if (staged.outcome === 'unavailable')
			return { ...unavailable, code: 'byte-store-unavailable', message: 'The staging byte store is temporarily unavailable.' };
		try {
			const trusted = await reportWithTrustedSilentVideoValidation(
				{
					outcome: 'accepted',
					compatibilityProfile: SILENT_VIDEO_COMPATIBILITY_PROFILE,
					issues: [],
					facts: JSON.parse(
						comparableFacts(input.sourceFacts),
					) as GraphicAssetSilentVideoFacts,
				},
				{ id: reconciliationWorkingCopyOperationId(input.discrepancyId) } as GraphicsIngestionOperation,
			);
			return { outcome: 'generated', bytes: trusted.derivative };
		}
		catch {
			return unavailable;
		}
	}

	/**
	 * The media-aware half of reconciliation. Compatibility profiles, parsers,
	 * and the pinned validation runtime stay here; reconciliation only decides
	 * what must be proven and what happens to catalogue state once it is.
	 */
	const reconciliationMedia: GraphicsReconciliationMedia = {
		async verifyContentBytes(input): Promise<VerifyGraphicsContentBytesOutcome> {
			const metadata = await input.read({ offset: 0, length: 1 });
			if (metadata.outcome !== 'available') {
				return {
					outcome: 'rejected',
					code: 'byte-store-unavailable',
					message: 'The bytes to verify could not be read.',
				};
			}
			if (metadata.range.completeLength !== input.expectedByteLength) {
				return {
					outcome: 'rejected',
					code: 'byte-length-mismatch',
					message: `Verification requires exactly ${input.expectedByteLength} bytes; these are ${metadata.range.completeLength}.`,
				};
			}

			// The digest is computed over the exact stored bytes by streaming, so
			// nothing here depends on holding a complete asset in memory.
			const complete = await input.read();
			if (complete.outcome !== 'available') {
				return {
					outcome: 'rejected',
					code: 'byte-store-unavailable',
					message: 'The bytes to verify could not be read.',
				};
			}
			const digest = await sha256HexStream({
				body: complete.body,
				byteLength: input.expectedByteLength,
				maximumByteLength: input.expectedByteLength,
			});
			if (digest !== input.expectedDigest) {
				return {
					outcome: 'rejected',
					code: 'digest-mismatch',
					message: 'These bytes do not hash to the exact expected content digest.',
				};
			}
			if (input.expectation.kind === 'derivative')
				return { outcome: 'verified' };

			let inspected;
			try {
				inspected = await inspectContentBytes(
					input.read,
					input.expectedByteLength,
					input.expectation.sourceKind,
					digest,
				);
			}
			catch {
				return {
					outcome: 'rejected',
					code: 'validation-facts-mismatch',
					message: 'These bytes could not be revalidated under the recorded compatibility profile.',
				};
			}
			if (inspected.report.outcome !== 'accepted') {
				return {
					outcome: 'rejected',
					code: 'validation-facts-mismatch',
					message: 'These bytes no longer pass Graphic Asset Validation.',
				};
			}
			if (inspected.report.facts.canonicalMime !== input.expectation.canonicalMime) {
				return {
					outcome: 'rejected',
					code: 'canonical-mime-mismatch',
					message: `Repair requires ${input.expectation.canonicalMime}; these bytes are ${inspected.report.facts.canonicalMime}.`,
				};
			}
			if (
				comparableFacts(inspected.report.facts as unknown as Record<string, unknown>)
				!== comparableFacts(input.expectation.facts)
			) {
				return {
					outcome: 'rejected',
					code: 'validation-facts-mismatch',
					message: 'These bytes do not reproduce the validation facts the revision recorded.',
				};
			}
			return { outcome: 'verified' };
		},
		async regenerateDerivative(input): Promise<RegenerateGraphicsDerivativeOutcome> {
			if (input.sourceKind === 'silent-video')
				return await regenerateSilentVideoPoster(input);
			const source = await requireCanonical().read(canonicalContentIdentity(input.sourceDigest));
			if (source.outcome !== 'available') {
				return {
					outcome: 'unavailable',
					code: 'source-content-unavailable',
					message: 'The canonical source content is not currently available.',
				};
			}
			try {
				const bytes = await consumeBoundedByteStream({
					body: source.body,
					byteLength: input.sourceByteLength,
					maximumByteLength: GRAPHIC_ASSET_SOURCE_POLICIES[input.sourceKind].maximumByteLength,
				});
				const processed = await processGraphicAssetSource(input.sourceKind, bytes, {});
				if (!('thumbnail' in processed))
					throw new Error('The validated source did not produce its deterministic derivative');
				return { outcome: 'generated', bytes: processed.thumbnail };
			}
			catch {
				return {
					outcome: 'unavailable',
					code: 'derivative-regeneration-unavailable',
					message: 'The deterministic derivative could not be reproduced from the canonical source.',
				};
			}
		},
		sha256Hex,
	};

	/**
	 * The scheduled retention path needs transactional catalogue proofs that an
	 * ordinary in-memory catalogue double cannot provide.
	 */
	function findRetention() {
		const catalogue = requireCatalogue();
		if (!('listStagedInputExpiryCandidates' in catalogue))
			return undefined;
		return createGraphicsRetention({
			catalogue: catalogue as GraphicsAssetCatalogue & GraphicsAssetRetentionCatalogue,
			staging: requireStaging(),
			canonical: requireCanonical(),
			now,
			generateIdentity,
		});
	}

	function requireRetention() {
		const retention = findRetention();
		if (!retention) {
			throw new GraphicsAssetLibraryError(
				'Graphics Asset retention is unavailable for this catalogue',
				'graphics-asset-library-unavailable',
			);
		}
		return retention;
	}

	/**
	 * Reconciliation needs the same transactional catalogue proofs the retention
	 * path does, so it is likewise unavailable against an ordinary in-memory
	 * catalogue double.
	 */
	function findReconciliation() {
		const catalogue = requireCatalogue();
		if (!('listExpectedContent' in catalogue))
			return undefined;
		return createGraphicsReconciliation({
			catalogue: catalogue as GraphicsAssetCatalogue & GraphicsAssetReconciliationCatalogue,
			canonical: requireCanonical(),
			staging: requireStaging(),
			media: reconciliationMedia,
			now,
			generateIdentity,
		});
	}

	/**
	 * The Operations Cockpit reads aggregates the ordinary in-memory catalogue
	 * double does not implement, so it is available only against a catalogue that
	 * can answer them.
	 *
	 * Every cockpit-specific method is checked rather than one standing in for
	 * the rest, because a partially implemented double would otherwise fail
	 * mid-reading with a `TypeError` instead of the domain error that says the
	 * cockpit is unavailable for this catalogue.
	 */
	const COCKPIT_CATALOGUE_METHODS = [
		'getCapacity',
		'countUnavailableContent',
		'countOpenDiscrepancies',
		'countIsolatedDiscrepancies',
		'getReconciliationState',
		'summariseIngestionAttention',
		'summariseRetentionDeadlines',
		'listGraphicsAssetEvidence',
	] as const satisfies readonly (keyof GraphicsOperationsCockpitCatalogue)[];

	function requireCockpitCatalogue(): GraphicsOperationsCockpitCatalogue {
		const catalogue = requireCatalogue();
		if (!COCKPIT_CATALOGUE_METHODS.every(method => method in catalogue)) {
			throw new GraphicsAssetLibraryError(
				'The Graphics Asset Operations Cockpit is unavailable for this catalogue',
				'graphics-asset-library-unavailable',
			);
		}
		return catalogue as GraphicsAssetCatalogue & GraphicsOperationsCockpitCatalogue;
	}

	/**
	 * The queues read the same aggregates the cockpit does plus the bounded
	 * deadline samples retention owns, so like both they are available only
	 * against a catalogue that can answer them. Every method is checked rather
	 * than one standing in for the rest, so a partially implemented double fails
	 * with the domain error instead of a `TypeError` mid-reading.
	 */
	const QUEUE_CATALOGUE_METHODS = [
		'countOpenDiscrepancies',
		'summariseIngestionAttention',
		'summariseRetentionDeadlines',
		'listTrashDeadlines',
		'listRevisionRetention',
		'listRetiredGraphicAssets',
		'listGraphicsAssetEvidence',
		'listGraphicAssetUsage',
	] as const satisfies readonly (keyof GraphicsOperationalQueuesCatalogue)[];

	function requireOperationalQueues() {
		const catalogue = requireCatalogue();
		if (!QUEUE_CATALOGUE_METHODS.every(method => method in catalogue)) {
			throw new GraphicsAssetLibraryError(
				'Graphics Asset Library operational queues are unavailable for this catalogue',
				'graphics-asset-library-unavailable',
			);
		}
		return createGraphicsOperationalQueues({
			catalogue: () => catalogue as GraphicsAssetCatalogue & GraphicsOperationalQueuesCatalogue,
			reconciliation: () => requireReconciliation(),
			inspectRetention: async assetId => await requireRetention().inspect(assetId),
			now,
		});
	}

	function requireReconciliation() {
		const reconciliation = findReconciliation();
		if (!reconciliation) {
			throw new GraphicsAssetLibraryError(
				'Graphics Asset reconciliation is unavailable for this catalogue',
				'graphics-asset-library-unavailable',
			);
		}
		return reconciliation;
	}

	/**
	 * Records that a reader just observed the byte store contradicting the
	 * catalogue. Delivery has already decided its own outcome by this point, so
	 * this only turns the observation into durable operational state and must
	 * never change or fail the caller's result.
	 */
	async function observeCanonicalDisagreement(
		input:
			| { assetId: GraphicAssetId; revisionId: GraphicAssetRevisionId }
			| { digest: string },
	) {
		try {
			const reconciliation = findReconciliation();
			if (!reconciliation)
				return;
			await ('digest' in input
				? reconciliation.reconcileObservedDigest(input)
				: reconciliation.reconcileObservedContent(input));
		}
		catch {
			// The scheduled pass re-observes the same disagreement, so a failure to
			// record it immediately only delays the alert.
		}
	}

	/**
	 * Trash and restore change revision pruning deadlines inside their own
	 * transaction; this records the resulting Evidence. It never fails the
	 * lifecycle transition that already committed.
	 */
	async function recordPruningTransition(
		assetId: GraphicAssetId,
		transition: 'frozen' | 'resumed',
	) {
		try {
			await findRetention()?.recordPruningTransition({
				assetId,
				transition,
				actor: GRAPHICS_RETENTION_ACTOR,
				recordedAt: timestamp(),
			});
		}
		catch {
			// The transition is already durable; Evidence for it is best-effort and
			// the next sweep re-observes the deadline either way.
		}
	}

	async function catalogueRequest<T>(
		request: () => Promise<T>,
		message: string,
	): Promise<T> {
		try {
			return await request();
		}
		catch (error) {
			if (error instanceof GraphicsAssetLibraryError)
				throw error;
			throw new GraphicsAssetLibraryError(
				message,
				'graphics-asset-library-unavailable',
				{ cause: error },
			);
		}
	}

	function timestamp() {
		return now().toISOString();
	}

	type CanonicalContentFacts = Pick<
		NonNullable<Awaited<ReturnType<GraphicsAssetCatalogue['findRevisionContent']>>>,
		'digest' | 'byteLength' | 'canonicalMime'
	>;

	/**
	 * Canonical bytes are only usable when the store agrees with the catalogue in
	 * every respect `canonicalObjectAgreement` checks — the same rule
	 * reconciliation applies. Delivery and reconciliation deliberately share one
	 * definition of agreement, so content reconciliation has isolated as a
	 * critical integrity incident can never still be served on air.
	 *
	 * Any disagreement reads as unavailable rather than being served, so no
	 * caller ever receives content that does not match its recorded facts.
	 */
	async function readCanonicalContent(
		content: CanonicalContentFacts,
		range?: { offset: number; length: number },
	): Promise<
		| { outcome: 'available'; body: ReadableStream<Uint8Array>; byteLength: number }
		| { outcome: 'unavailable'; retryable: true; disagreement: boolean }
	> {
		const result = await requireCanonical().read(
			canonicalContentIdentity(content.digest),
			range,
		);
		if (
			result.outcome !== 'available'
			|| canonicalObjectAgreement(content, result.object).outcome !== 'agrees'
			|| result.range.completeLength !== content.byteLength
			|| (
				range !== undefined
				&& (result.range.offset !== range.offset || result.range.length !== range.length)
			)
		) {
			return {
				outcome: 'unavailable',
				retryable: true,
				// A store that could not answer proves nothing about this object; a
				// store that answered and disagreed is a real integrity observation
				// worth reconciling.
				disagreement: result.outcome !== 'unavailable',
			};
		}
		return {
			outcome: 'available',
			body: result.body,
			byteLength: result.object.byteLength,
		};
	}

	async function observeCanonicalContent(content: CanonicalContentFacts): Promise<
		{ outcome: 'available' } | { outcome: 'unavailable'; disagreement: boolean }
	> {
		const result = await requireCanonical().readMetadata(
			canonicalContentIdentity(content.digest),
		);
		if (
			result.outcome === 'available'
			&& canonicalObjectAgreement(content, result.object).outcome === 'agrees'
		) {
			return { outcome: 'available' };
		}
		return { outcome: 'unavailable', disagreement: result.outcome !== 'unavailable' };
	}

	function timestampAfter(updatedAt: string) {
		return new Date(Math.max(
			now().getTime(),
			new Date(updatedAt).getTime() + 1,
		)).toISOString();
	}

	function validateGraphicsIngestionInput(input: GraphicAssetSourceDeclarations & {
		idempotencyKey: string;
		initiatedBy: string;
		source: GraphicsIngestionSource;
		declaredByteLength: number;
		defaultEventId?: number;
	}) {
		if (!input.idempotencyKey.trim() || !input.initiatedBy.trim())
			throw new GraphicsAssetLibraryError('Ingestion identity and author are required', 'invalid-ingestion-input');
		// A Template Package is an envelope rather than one Graphic Asset, so it is
		// held to the archive limit instead of any single asset kind's limit.
		const { label, maximumByteLength } = input.source === 'template-package'
			? {
					label: 'Template Package',
					maximumByteLength: TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength,
				}
			: GRAPHIC_ASSET_SOURCE_POLICIES[graphicAssetSourceKind(input)];
		if (
			!Number.isSafeInteger(input.declaredByteLength)
			|| input.declaredByteLength <= 0
			|| input.declaredByteLength > maximumByteLength
		) {
			throw new GraphicsAssetLibraryError(
				`${label} must be between 1 and ${maximumByteLength} bytes`,
				'invalid-ingestion-input',
			);
		}
		if (
			input.defaultEventId !== undefined
			&& (!Number.isSafeInteger(input.defaultEventId) || input.defaultEventId <= 0)
		) {
			throw new GraphicsAssetLibraryError('Default Event identity must be a positive integer', 'invalid-ingestion-input');
		}
		if (input.browserDecodeEvidence?.outcome === 'font-loaded' || input.browserDecodeEvidence?.outcome === 'font-rejected') {
			throw new GraphicsAssetLibraryError(
				'Font browser evidence can only answer the server-selected post-validation challenge',
				'invalid-ingestion-input',
			);
		}
		if (
			input.browserDecodeEvidence
			&& (
				!/^[a-f0-9]{64}$/.test(input.browserDecodeEvidence.sourceDigest)
				|| (
					input.browserDecodeEvidence.outcome === 'decoded'
					&& (
						!Number.isSafeInteger(input.browserDecodeEvidence.width)
						|| input.browserDecodeEvidence.width <= 0
						|| !Number.isSafeInteger(input.browserDecodeEvidence.height)
						|| input.browserDecodeEvidence.height <= 0
					)
				)
			)
		) {
			throw new GraphicsAssetLibraryError('Browser decode evidence is malformed', 'invalid-ingestion-input');
		}
	}

	async function initiateGraphicsOperation(input: GraphicAssetSourceDeclarations & {
		idempotencyKey: string;
		initiatedBy: string;
		name: string;
		source: GraphicsIngestionSource;
		targetAssetId?: GraphicAssetId;
		defaultEventId?: number;
		duplicateContentPolicy: GraphicsDuplicateContentPolicy;
		declaredByteLength: number;
	}) {
		validateGraphicsIngestionInput(input);
		const createdAt = timestamp();
		return await catalogueRequest(() => requireCatalogue().initiateGraphicsIngestion({
			id: graphicsIngestionOperationId(generateIdentity()),
			idempotencyKey: input.idempotencyKey,
			source: input.source,
			initiatedBy: input.initiatedBy,
			name: input.name.trim(),
			targetAssetId: input.targetAssetId,
			sourceFileName: input.sourceFileName?.trim(),
			declaredMime: input.declaredMime?.trim().toLocaleLowerCase(),
			browserDecodeEvidence: input.browserDecodeEvidence,
			defaultEventId: input.defaultEventId,
			duplicateContentPolicy: input.duplicateContentPolicy,
			declaredByteLength: input.declaredByteLength,
			transferredByteLength: 0,
			stage: 'created',
			createdAt,
			updatedAt: createdAt,
		}), 'Graphics ingestion could not be initiated because the catalogue is unavailable');
	}

	function changedOperation(
		operation: GraphicsIngestionOperation,
		changes: Partial<GraphicsIngestionOperation>,
	): GraphicsIngestionOperation {
		const updatedAt = new Date(Math.max(
			now().getTime(),
			new Date(operation.updatedAt).getTime() + 1,
		)).toISOString();
		return {
			...operation,
			...changes,
			updatedAt,
		};
	}

	class SilentVideoValidationRuntimeError extends Error {}

	async function reportWithTrustedSilentVideoValidation(
		report: Extract<GraphicAssetValidationReport, {
			outcome: 'accepted';
			compatibilityProfile: 'silent-video-v1';
		}>,
		operation: GraphicsIngestionOperation,
	) {
		const factsDigest = await sha256Hex(
			new TextEncoder().encode(JSON.stringify(report.facts)),
		);
		const idempotencyKey = [
			'silent-video-playback-v1',
			operation.id,
			report.facts.sha256,
			factsDigest,
		].join(':');
		const validationInput = {
			operationId: operation.id,
			idempotencyKey,
			sourceDigest: report.facts.sha256,
			sourceByteLength: report.facts.byteLength,
			sourceContentType: report.facts.canonicalMime,
			factsDigest,
			inspectedFacts: report.facts,
		} as const;
		let validation;
		try {
			validation = await silentVideoPlaybackValidator.validate(validationInput);
		}
		catch {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation runtime failed while executing the bound operation',
			);
		}
		if (validation.outcome === 'unavailable')
			throw new SilentVideoValidationRuntimeError('Silent-video validation runtime is unavailable');
		if (
			validation.operationId !== operation.id
			|| validation.idempotencyKey !== idempotencyKey
			|| validation.sourceDigest !== report.facts.sha256
			|| validation.factsDigest !== factsDigest
		) {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation result was not bound to the exact operation, source, and inspected facts',
			);
		}
		const validationIssue = silentVideoPlaybackValidationIssue(validationInput, validation);
		if (validationIssue) {
			validationError(
				validationIssue,
				'Pinned native validation could not decode, play, and seek the exact silent video.',
			);
		}
		if (validation.outcome === 'rejected')
			throw new SilentVideoValidationRuntimeError('Rejected validation did not produce an issue');
		if (
			validation.mutedInlinePlayback !== true
			|| validation.seeked !== true
			|| validation.width !== report.facts.width
			|| validation.height !== report.facts.height
			|| Math.abs(validation.durationSeconds - report.facts.durationSeconds) > 0.05
			|| Math.abs(validation.posterTimeSeconds - report.facts.posterTimeSeconds) > 0.001
		) {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation facts conflict with bounded inspection',
			);
		}
		if (
			validation.poster.byteLength <= 0
			|| validation.poster.byteLength > MAX_SILENT_VIDEO_POSTER_BYTES
			|| !/^[a-f0-9]{64}$/.test(validation.posterDigest)
		) {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation returned an invalid deterministic poster envelope',
			);
		}
		let poster;
		try {
			const posterBytes = await consumeBoundedByteStream(validation.poster);
			if (await sha256Hex(posterBytes) !== validation.posterDigest) {
				throw new SilentVideoValidationRuntimeError(
					'Silent-video validation poster digest does not match its exact bytes',
				);
			}
			poster = await processStillImage(posterBytes, {
				sourceFileName: 'poster.png',
				declaredMime: 'image/png',
			});
		}
		catch (error) {
			if (error instanceof SilentVideoValidationRuntimeError)
				throw error;
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation returned a poster that could not be verified',
			);
		}
		const scale = Math.min(1, 640 / report.facts.width, 360 / report.facts.height);
		const expectedWidth = Math.max(1, Math.round(report.facts.width * scale));
		const expectedHeight = Math.max(1, Math.round(report.facts.height * scale));
		if (
			poster.report.facts.kind !== 'image'
			|| poster.report.facts.width !== expectedWidth
			|| poster.report.facts.height !== expectedHeight
		) {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation poster violates the deterministic fit rule',
			);
		}
		return {
			report: {
				...report,
				facts: {
					...report.facts,
					browserPlayable: true as const,
					...(report.facts.hasAlpha
						? { chromiumTransparencyPlayback: true as const }
						: {}),
				},
			},
			derivative: poster.thumbnail,
		};
	}

	function reportWithBrowserDecodeEvidence(
		report: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>,
		operation: GraphicsIngestionOperation,
	): Extract<GraphicAssetValidationReport, { outcome: 'accepted' }> {
		const evidence = operation.browserDecodeEvidence;
		if (report.facts.kind === 'font') {
			if (
				!evidence
				|| evidence.outcome === 'decoded'
				|| evidence.outcome === 'rejected'
			) {
				validationError(
					'browser-font-load-failed',
					'FontFace challenge evidence is required before publication.',
				);
			}
			if (evidence.sourceDigest !== report.facts.sha256) {
				validationError(
					'browser-font-evidence-mismatch',
					'Browser font evidence does not match the staged source bytes.',
				);
			}
			if (evidence.outcome === 'font-rejected') {
				validationError(
					evidence.stage === 'load' ? 'browser-font-load-failed' : 'browser-font-render-failed',
					evidence.stage === 'load'
						? 'The representative browser could not load the exact font bytes.'
						: 'The representative browser could not render covered glyphs without fallback.',
				);
			}
			if (evidence.challengeDigest !== report.facts.browserChallenge.digest) {
				validationError(
					'browser-font-evidence-mismatch',
					'Browser font evidence does not match the server-selected glyph challenge.',
				);
			}
			const challenge = report.facts.browserChallenge;
			// This is a same-origin browser attestation, not cryptographic remote
			// attestation. Binding every proof to server-inspected coverage and two
			// distinct fallback rasters prevents accidental fallback in the authoring
			// client; deployed browser acceptance remains the trusted runtime proof.
			if (
				evidence.glyphProofs.length !== challenge.codePoints.length
				|| evidence.glyphProofs.some((proof, index) => {
					const digest = /^[a-f0-9]{64}$/;
					return proof.codePoint !== challenge.codePoints[index]
						|| !digest.test(proof.exactWithSansDigest)
						|| !digest.test(proof.exactWithMonoDigest)
						|| !digest.test(proof.sansFallbackDigest)
						|| !digest.test(proof.monoFallbackDigest)
						|| proof.exactWithSansDigest !== proof.exactWithMonoDigest
						|| proof.sansFallbackDigest === proof.monoFallbackDigest
						|| proof.exactWithSansDigest === proof.sansFallbackDigest
						|| proof.exactWithSansDigest === proof.monoFallbackDigest;
				})
			) {
				validationError(
					'browser-font-render-failed',
					'Each challenged glyph must render identically through the exact face and differently through independent fallbacks.',
				);
			}
			return {
				...report,
				facts: {
					...report.facts,
					browserLoadable: true,
					representativeGlyphsRendered: true,
				},
			} as Extract<GraphicAssetValidationReport, { compatibilityProfile: 'static-font-v1' }>;
		}
		if (!evidence) {
			validationError(
				'browser-image-decode-failed',
				'Representative browser decode evidence is required before publication.',
			);
		}
		if (evidence.sourceDigest !== report.facts.sha256) {
			validationError(
				'browser-image-decode-mismatch',
				'Browser-decoded source digest does not match the staged source bytes.',
			);
		}
		if (
			evidence.outcome === 'font-loaded'
			|| evidence.outcome === 'font-rejected'
		) {
			validationError(
				'browser-image-decode-failed',
				'Image browser decode evidence is required before publication.',
			);
		}
		if (evidence.outcome === 'rejected') {
			validationError(
				'browser-image-decode-failed',
				'The representative browser could not decode the exact source bytes.',
			);
		}
		if (
			evidence.width !== report.facts.width
			|| evidence.height !== report.facts.height
		) {
			validationError(
				'browser-image-decode-mismatch',
				'Browser-decoded dimensions do not match bounded parser and server decoder evidence.',
			);
		}
		return {
			...report,
			facts: {
				...report.facts,
				browserDecodable: true,
			},
		} as Extract<GraphicAssetValidationReport, { compatibilityProfile: 'still-image-v1' }>;
	}

	async function failOperation(
		catalogue: GraphicsAssetCatalogue,
		operation: GraphicsIngestionOperation,
		failure: NonNullable<GraphicsIngestionOperation['failure']>,
		report?: GraphicAssetValidationReport,
	) {
		try {
			return await catalogue.updateIngestionOperation(
				changedOperation(operation, {
					stage: 'failed',
					report,
					failure,
				}),
				operation.updatedAt,
			);
		}
		catch (error) {
			throw new GraphicsAssetLibraryError(
				'Graphics ingestion state could not be updated because the catalogue is unavailable',
				'graphics-asset-library-unavailable',
				{ cause: error },
			);
		}
	}

	async function cleanupCancelledMultipart(
		catalogue: GraphicsAssetCatalogue,
		operation: GraphicsIngestionOperation,
	): Promise<GraphicsIngestionOperation> {
		const multipart = await catalogueRequest(
			() => catalogue.getGraphicAssetMultipartState(operation.id, operation.initiatedBy),
			'Graphics multipart cancellation checkpoint is temporarily unavailable',
		);
		if (!multipart?.uploadId || !multipart.cleanupPending)
			return operation;
		const staging = requireStaging();
		const identity = graphicsObjectIdentity(`ingestion/${operation.id}/source`);
		const aborted = await staging.abortMultipart({
			identity,
			uploadId: multipart.uploadId,
		});
		// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by operation identity.
		const deleted = await staging.delete(identity);
		if (aborted.outcome === 'unavailable' || deleted.outcome === 'unavailable')
			return operation;
		await catalogueRequest(
			() => catalogue.recordGraphicAssetMultipartCleanupComplete(operation.id, operation.initiatedBy),
			'Graphics multipart cleanup completion could not be recorded',
		);
		return await catalogueRequest(
			() => catalogue.getIngestionOperation(operation.id, operation.initiatedBy),
			'Graphics ingestion state is temporarily unavailable',
		) ?? operation;
	}

	async function storeCanonicalStream(
		store: GraphicsCanonicalObjectStore,
		digest: string,
		bytes: BoundedByteStream,
		contentType: GraphicAssetCanonicalMime,
	) {
		const identity = canonicalContentIdentity(digest);
		const result = await store.createImmutable({
			identity,
			bytes,
			metadata: {
				contentType,
				custom: { sha256: digest },
			},
		});
		if (result.outcome === 'unavailable')
			return result;
		if (
			result.object.byteLength !== bytes.byteLength
			|| result.object.contentType !== contentType
			|| result.object.customMetadata.sha256 !== digest
		) {
			return {
				outcome: 'unavailable' as const,
				reason: {
					code: 'object-unavailable' as const,
					retryable: true as const,
				},
			};
		}
		const stored = await store.read(identity);
		if (
			stored.outcome !== 'available'
			|| stored.object.byteLength !== bytes.byteLength
			|| stored.object.contentType !== contentType
		) {
			return {
				outcome: 'unavailable' as const,
				reason: {
					code: 'object-unavailable' as const,
					retryable: true as const,
				},
			};
		}
		const storedDigest = await sha256HexStream({
			body: stored.body,
			byteLength: stored.object.byteLength,
			maximumByteLength: bytes.byteLength,
		});
		if (storedDigest !== digest) {
			return {
				outcome: 'unavailable' as const,
				reason: {
					code: 'object-unavailable' as const,
					retryable: true as const,
				},
			};
		}
		return result;
	}

	async function storeCanonicalBytes(
		store: GraphicsCanonicalObjectStore,
		digest: string,
		bytes: Uint8Array,
	) {
		return await storeCanonicalStream(
			store,
			digest,
			createBoundedByteStream(bytes, {
				byteLength: bytes.byteLength,
				maximumByteLength: bytes.byteLength,
			}),
			'image/png',
		);
	}

	type StageRemoteSourceOutcome
		= | { outcome: 'staged'; byteLength: number }
			/** Only a source that declared a length can contradict it. */
			| { outcome: 'length-mismatch'; declaredByteLength: number }
			| { outcome: 'length-exceeded' }
			| { outcome: 'empty' }
			| { outcome: 'unavailable' };

	/**
	 * Copies a remote body into staging without ever holding a complete Graphic
	 * Asset in Worker memory.
	 *
	 * A declared length lets the object store write one fixed-length object. When
	 * the origin declared none, the length is discovered while reading: bytes
	 * accumulate up to one multipart part, and only if the source outgrows that
	 * part does a resumable multipart transfer start. So at most one part is ever
	 * resident, which is the same bound the single-shot upload route enforces.
	 */
	async function stageRemoteSource(input: {
		staging: GraphicsStagingObjectStore;
		identity: ReturnType<typeof graphicsObjectIdentity>;
		operationId: GraphicsIngestionOperationId;
		body: ReadableStream<Uint8Array>;
		maximumByteLength: number;
		declaredByteLength?: number;
	}): Promise<StageRemoteSourceOutcome> {
		const metadata = {
			contentType: 'application/octet-stream',
			custom: { operationId: input.operationId },
		} as const;

		if (input.declaredByteLength !== undefined) {
			let staged: Awaited<ReturnType<typeof input.staging.createImmutable>>;
			try {
				staged = await input.staging.createImmutable({
					identity: input.identity,
					bytes: createBoundedByteStream(input.body, {
						byteLength: input.declaredByteLength,
						maximumByteLength: input.maximumByteLength,
					}),
					metadata,
				});
			}
			catch (error) {
				return error instanceof GraphicsObjectInputError
					? { outcome: 'length-mismatch', declaredByteLength: input.declaredByteLength }
					: { outcome: 'unavailable' };
			}
			if (staged.outcome === 'unavailable')
				return { outcome: 'unavailable' };
			return staged.object.byteLength === input.declaredByteLength
				? { outcome: 'staged', byteLength: staged.object.byteLength }
				: { outcome: 'length-mismatch', declaredByteLength: input.declaredByteLength };
		}

		const reader = input.body.getReader();
		const pending: Uint8Array[] = [];
		let pendingByteLength = 0;
		let totalByteLength = 0;
		let upload: { identity: typeof input.identity; uploadId: GraphicsMultipartUploadIdentity } | undefined;
		const parts: GraphicsMultipartPart[] = [];

		function takePendingPart(byteCount: number) {
			const part = new Uint8Array(byteCount);
			let offset = 0;
			while (offset < byteCount) {
				const chunk = pending[0]!;
				const take = Math.min(chunk.byteLength, byteCount - offset);
				part.set(chunk.subarray(0, take), offset);
				offset += take;
				if (take === chunk.byteLength)
					pending.shift();
				else
					pending[0] = chunk.subarray(take);
			}
			pendingByteLength -= byteCount;
			return part;
		}

		async function abort() {
			await reader.cancel().catch(() => undefined);
			if (upload)
				await input.staging.abortMultipart(upload);
		}

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done)
					break;
				totalByteLength += value.byteLength;
				if (totalByteLength > input.maximumByteLength) {
					await abort();
					return { outcome: 'length-exceeded' };
				}
				pending.push(value);
				pendingByteLength += value.byteLength;
				// Keep one whole part in hand so the last part can be the short one.
				while (pendingByteLength > GRAPHICS_MULTIPART_PART_BYTES) {
					if (!upload) {
						const started = await input.staging.beginMultipart({
							identity: input.identity,
							metadata,
						});
						if (started.outcome === 'unavailable') {
							await abort();
							return { outcome: 'unavailable' };
						}
						upload = started.upload;
					}
					const uploaded = await input.staging.uploadPart({
						upload,
						partNumber: parts.length + 1,
						bytes: createBoundedByteStream(takePendingPart(GRAPHICS_MULTIPART_PART_BYTES), {
							byteLength: GRAPHICS_MULTIPART_PART_BYTES,
							maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
						}),
					});
					if (uploaded.outcome === 'unavailable') {
						await abort();
						return { outcome: 'unavailable' };
					}
					parts.push(uploaded.part);
				}
			}
		}
		catch {
			await abort();
			return { outcome: 'unavailable' };
		}

		if (totalByteLength === 0) {
			await abort();
			return { outcome: 'empty' };
		}

		const tail = takePendingPart(pendingByteLength);
		if (!upload) {
			const staged = await input.staging.createImmutable({
				identity: input.identity,
				bytes: createBoundedByteStream(tail, {
					byteLength: tail.byteLength,
					maximumByteLength: input.maximumByteLength,
				}),
				metadata,
			});
			if (staged.outcome === 'unavailable')
				return { outcome: 'unavailable' };
			return { outcome: 'staged', byteLength: staged.object.byteLength };
		}
		const uploadedTail = await input.staging.uploadPart({
			upload,
			partNumber: parts.length + 1,
			bytes: createBoundedByteStream(tail, {
				byteLength: tail.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		});
		if (uploadedTail.outcome === 'unavailable') {
			await abort();
			return { outcome: 'unavailable' };
		}
		parts.push(uploadedTail.part);
		const completed = await input.staging.completeMultipart({ upload, parts });
		if (completed.outcome === 'unavailable')
			return { outcome: 'unavailable' };
		// The source declared no length to contradict, so a store that assembles a
		// different total is a staging integrity failure, not a remote rejection.
		return completed.object.byteLength === totalByteLength
			? { outcome: 'staged', byteLength: completed.object.byteLength }
			: { outcome: 'unavailable' };
	}

	/**
	 * The export-side document rules a received Template must satisfy too. Both
	 * sides ask the same question — is this document plain, self-contained data? —
	 * so preflight reuses the exporter's inspection and reports its answers in
	 * preflight's own vocabulary rather than restating the rules.
	 */
	const RECEIVED_DOCUMENT_ISSUE_CODES = {
		'invalid-template-document': 'invalid-template-document',
		'remote-resource-dependency': 'remote-resource-dependency',
		'executable-template-content': 'executable-template-content',
		'undeclared-graphic-asset-dependency': 'undeclared-graphic-asset-dependency',
	} as const;

	/**
	 * Streams one archive entry in bounded chunks so its digest can be recomputed
	 * without the entry ever being resident in full.
	 */
	function archiveEntryStream(
		entry: TemplatePackageArchiveEntry,
		readRange: (offset: number, length: number) => Promise<Uint8Array>,
	): ReadableStream<Uint8Array> {
		let delivered = 0;
		return new ReadableStream<Uint8Array>({
			async pull(controller) {
				if (delivered >= entry.byteLength) {
					controller.close();
					return;
				}
				const length = Math.min(PACKAGE_ENTRY_READ_CHUNK_BYTES, entry.byteLength - delivered);
				const bytes = await readRange(entry.dataOffset + delivered, length);
				delivered += bytes.byteLength;
				controller.enqueue(bytes);
			},
		});
	}

	/**
	 * Inspects one staged Template Package completely and returns the immutable
	 * report it produced. Every check runs even after an earlier one failed, so an
	 * author sees the complete reason a package cannot install rather than
	 * correcting one problem at a time.
	 */
	async function inspectStagedTemplatePackage(input: {
		operation: GraphicsIngestionOperation;
		sourceDigest: string;
		readRange: (offset: number, length: number) => Promise<Uint8Array>;
		catalogue: GraphicsAssetCatalogue;
		canonical: GraphicsCanonicalObjectStore;
	}): Promise<{
		report: TemplatePackagePreflightReport;
		derivatives: TemplatePackagePreflightState['derivatives'];
		/**
		 * What installation would need to publish the proposal this report
		 * describes: the received Template document, and — per packaged content
		 * digest — this installation's own validated facts, the archive entry its
		 * bytes live in, and the preview it regenerated locally.
		 *
		 * It is deliberately the same pass. A report and the material published
		 * under it must describe one reading of one archive, or an installation
		 * could publish bytes no report was ever computed over.
		 */
		material: StagedTemplatePackageMaterial;
	}> {
		const { operation, readRange, catalogue, canonical } = input;
		const checkedAt = timestamp();
		const archiveByteLength = operation.declaredByteLength;
		const issues: TemplatePackagePreflightIssue[] = [];
		const decoder = new TextDecoder('utf-8', { fatal: true });
		const material: StagedTemplatePackageMaterial = { contents: new Map() };

		function finish(
			reportIssues: readonly TemplatePackagePreflightIssue[],
			options: {
				packageKind?: TemplatePackageKind;
				templateIdentity?: string;
				templateName?: string;
				schema?: TemplatePackagePreflightReport['schema'];
				compatibilityProfiles?: readonly string[];
				mappings?: readonly TemplatePackagePreflightMapping[];
				quota?: TemplatePackagePreflightQuota;
				observed?: TemplatePackageTotals & { archiveByteLength: number };
			} = {},
		) {
			const material = {
				packageKind: options.packageKind ?? 'skgraphic',
				templateIdentity: options.templateIdentity ?? '',
				templateName: options.templateName ?? '',
				sourceDigest: input.sourceDigest,
				schema: options.schema ?? {
					received: 0,
					supported: TEMPLATE_PACKAGE_SCHEMA_VERSION,
					migrated: false,
				},
				compatibilityProfiles: options.compatibilityProfiles ?? [],
				issues: reportIssues,
				mappings: options.mappings ?? [],
				quota: options.quota ?? {
					canonicalGrowthBytes: 0,
					canonicalAvailableBytes: 0,
					canonicalLimitBytes: 0,
					pressure: 'normal' as const,
				},
				observed: options.observed ?? {
					entryCount: 0,
					packagedAssetCount: 0,
					packagedRevisionCount: 0,
					uniqueContentCount: 0,
					expandedByteLength: 0,
					archiveByteLength,
				},
			};
			return sha256Hex(new TextEncoder().encode(
				templatePackagePreflightFingerprintMaterial(material),
			)).then(fingerprint => assembleTemplatePackagePreflightReport({
				...material,
				checkedAt,
				fingerprint,
			}));
		}

		const archive = await readTemplatePackageArchive({
			byteLength: archiveByteLength,
			read: readRange,
		});
		if (archive.outcome === 'rejected')
			return { report: await finish(archive.issues), derivatives: [], material };

		const entries = archive.entries;
		const entryByName = new Map(entries.map(entry => [entry.name, entry]));
		const observedExpandedByteLength = entries
			.reduce((total, entry) => total + entry.byteLength, 0);

		async function readEntryDocument(
			entry: TemplatePackageArchiveEntry,
		): Promise<unknown | undefined> {
			if (entry.byteLength > MAXIMUM_PACKAGE_DOCUMENT_BYTES)
				return undefined;
			try {
				return JSON.parse(decoder.decode(await readRange(entry.dataOffset, entry.byteLength)));
			}
			catch (error) {
				if (error instanceof TemplatePackageArchiveSourceError)
					throw error;
				return undefined;
			}
		}

		const manifestEntry = entryByName.get(TEMPLATE_PACKAGE_MANIFEST_ENTRY);
		if (!manifestEntry) {
			return {
				report: await finish([templatePackagePreflightIssue('missing-package-entry', {
					subject: TEMPLATE_PACKAGE_MANIFEST_ENTRY,
					message: 'The archive carries no package manifest',
				})]),
				derivatives: [],
				material,
			};
		}
		const manifestValue = await readEntryDocument(manifestEntry);
		if (manifestValue === undefined) {
			return {
				report: await finish([templatePackagePreflightIssue('invalid-package-manifest', {
					subject: TEMPLATE_PACKAGE_MANIFEST_ENTRY,
					message: 'The package manifest is not readable JSON within the size a manifest may occupy',
				})]),
				derivatives: [],
				material,
			};
		}
		const manifestRead = readTemplatePackageManifest(manifestValue);
		if (manifestRead.outcome === 'rejected')
			return { report: await finish(manifestRead.issues), derivatives: [], material };
		const { manifest, receivedSchemaVersion, migrated } = manifestRead.result;
		material.manifest = manifest;
		const schema = {
			received: receivedSchemaVersion,
			supported: TEMPLATE_PACKAGE_SCHEMA_VERSION,
			migrated,
		};
		const observed = {
			entryCount: entries.length,
			packagedAssetCount: manifest.packagedAssets.length,
			packagedRevisionCount: manifest.packagedAssets.length,
			uniqueContentCount: manifest.contents.length,
			expandedByteLength: observedExpandedByteLength,
			archiveByteLength,
		};
		const reportOptions = {
			packageKind: manifest.packageKind,
			templateIdentity: manifest.template.identity,
			templateName: manifest.template.name,
			schema,
			observed,
		};

		// A migration happened in staging and changed nothing the sender chose, but
		// the author still confirms the result they are about to install.
		if (migrated) {
			issues.push(templatePackagePreflightIssue('package-schema-migrated', {
				message: `The package was migrated from schema version ${receivedSchemaVersion} to ${TEMPLATE_PACKAGE_SCHEMA_VERSION} in staging`,
			}));
		}
		issues.push(...inspectTemplatePackageEntries(entries, manifest));
		issues.push(...inspectReceivedApplicationCapabilities(manifest));
		// The received file name is a hint, and the manifest alone determines the
		// artifact type — so a package transferred without a name (an API client
		// streaming bytes it never had a file for) is not penalised for it. When a
		// name is supplied it must not contradict the manifest, because one of the
		// two is then describing a different artifact.
		const extension = TEMPLATE_PACKAGE_ARTIFACTS[manifest.packageKind].extension;
		const receivedName = operation.sourceFileName?.toLowerCase();
		if (receivedName !== undefined && !receivedName.endsWith(extension)) {
			const receivedExtension = receivedName.slice(receivedName.lastIndexOf('.'));
			issues.push(templatePackagePreflightIssue('unsupported-package-artifact', {
				subject: operation.sourceFileName,
				message: `A ${manifest.packageKind} package must be received as a "${extension}" file, but this one arrived as "${
					receivedExtension.startsWith('.') ? receivedExtension : 'a file with no extension'
				}"`,
			}));
		}

		// Keyed the same way installation resolves a rewritten reference, so the
		// asset a Template's field is matched to here is the asset it is mapped to
		// there.
		const declaredOrigins = new Map(manifest.packagedAssets.map(asset => [
			packagedOriginKey(asset.origin),
			asset,
		]));
		const templateEntry = entryByName.get(TEMPLATE_PACKAGE_TEMPLATE_ENTRY);
		if (!templateEntry) {
			issues.push(templatePackagePreflightIssue('missing-package-entry', {
				subject: TEMPLATE_PACKAGE_TEMPLATE_ENTRY,
				message: 'The archive carries no Template document',
			}));
		}
		else {
			const document = await readEntryDocument(templateEntry);
			if (document === undefined) {
				issues.push(templatePackagePreflightIssue('invalid-template-document', {
					subject: TEMPLATE_PACKAGE_TEMPLATE_ENTRY,
					message: 'The Template document is not readable JSON within the size a Template may occupy',
				}));
			}
			else {
				material.templateDocument = document;
				const inspected = inspectTemplateDocument(document);
				for (const issue of inspected.issues) {
					const code = RECEIVED_DOCUMENT_ISSUE_CODES[
						issue.code as keyof typeof RECEIVED_DOCUMENT_ISSUE_CODES
					];
					issues.push(templatePackagePreflightIssue(code ?? 'invalid-template-document', {
						subject: issue.slot,
						message: issue.message,
					}));
				}
				// A package embeds every asset its Template needs and no others.
				// The document names the sender's identities, which are exactly the
				// provenance each packaged asset declares.
				const required = new Set<string>();
				for (const discovered of inspected.references) {
					const key = packagedOriginKey({
						sourceAssetId: discovered.reference.assetId,
						sourceRevisionId: discovered.reference.revisionId,
					});
					if (declaredOrigins.has(key)) {
						required.add(key);
						continue;
					}
					issues.push(templatePackagePreflightIssue('undeclared-graphic-asset-dependency', {
						subject: discovered.path,
						message: 'The Template requires a Graphic Asset Revision the package never embedded',
					}));
				}
				for (const [key, asset] of declaredOrigins) {
					if (required.has(key))
						continue;
					issues.push(templatePackagePreflightIssue('unused-packaged-graphic-asset', {
						subject: asset.packagedId,
						message: `The package embeds "${asset.name}", which its Template never requires`,
					}));
				}
			}
		}

		// Every embedded source is revalidated here under this installation's
		// current profiles. The sender's recorded facts are never trusted: they are
		// a snapshot of another installation's rules, which may be older, newer, or
		// simply different from the ones this receiver must enforce.
		const validated = material.contents;
		for (const content of manifest.contents) {
			const entry = entryByName.get(content.entry);
			if (!entry)
				continue;
			// Enough to cover a complete tar header block, whose magic is not at the
			// start of the file. Media sniffing still only looks at the first 64.
			const leadingLength = Math.min(NESTED_ARCHIVE_PROBE_BYTES, entry.byteLength);
			const leadingBytes = leadingLength > 0
				? await readRange(entry.dataOffset, leadingLength)
				: new Uint8Array();
			if (hasNestedArchiveSignature(leadingBytes)) {
				issues.push(templatePackagePreflightIssue('nested-package-archive', {
					subject: entry.name,
					message: 'Packaged content is itself an archive',
				}));
				continue;
			}
			// The digest is recomputed from the exact archived bytes. A package that
			// disagrees with itself about its own content cannot be installed.
			const observedDigest = await sha256HexStream({
				body: archiveEntryStream(entry, readRange),
				byteLength: entry.byteLength,
				maximumByteLength: entry.byteLength,
			});
			if (observedDigest !== content.digest) {
				issues.push(templatePackagePreflightIssue('package-content-digest-mismatch', {
					subject: entry.name,
					message: 'Packaged content does not match the digest the manifest records for it',
				}));
				continue;
			}
			const sourceKind = graphicAssetSourceKind(
				{ declaredMime: content.canonicalMime },
				leadingBytes.subarray(0, 64),
			);
			const policy = GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind];
			if (entry.byteLength > policy.maximumByteLength) {
				issues.push(templatePackagePreflightIssue('incompatible-graphic-asset-content', {
					subject: entry.name,
					message: `${policy.label} content of ${entry.byteLength} bytes exceeds this installation's ${policy.maximumByteLength}-byte limit`,
				}));
				continue;
			}
			try {
				let accepted: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>;
				let thumbnail: Uint8Array;
				if (sourceKind === 'silent-video') {
					const processed = await processSilentVideoFromRandomAccess({
						byteLength: entry.byteLength,
						sha256: observedDigest,
						read: async (offset, length) => {
							try {
								return {
									outcome: 'available' as const,
									bytes: await readRange(entry.dataOffset + offset, length),
									completeLength: entry.byteLength,
								};
							}
							catch {
								return { outcome: 'unavailable' as const, retryable: true as const };
							}
						},
					}, { declaredMime: content.canonicalMime });
					// A packaged video is proven by the same pinned native validation an
					// uploaded one is; there is no interactive client here to attest for it.
					const trusted = await reportWithTrustedSilentVideoValidation(
						processed.report as Extract<GraphicAssetValidationReport, {
							outcome: 'accepted';
							compatibilityProfile: 'silent-video-v1';
						}>,
						operation,
					);
					accepted = trusted.report;
					thumbnail = trusted.derivative;
				}
				else {
					const bytes = await consumeBoundedByteStream({
						body: archiveEntryStream(entry, readRange),
						byteLength: entry.byteLength,
						maximumByteLength: policy.maximumByteLength,
					});
					const processed = await processGraphicAssetSource(sourceKind, bytes, {
						declaredMime: content.canonicalMime,
					});
					if (!('thumbnail' in processed)) {
						issues.push(templatePackagePreflightIssue('derivative-generation-failed', {
							subject: entry.name,
							message: 'Validated packaged content produced no deterministic preview',
						}));
						continue;
					}
					accepted = processed.report;
					thumbnail = processed.thumbnail;
				}
				// `static-font-v1` includes `FontFace.load()` and representative glyph
				// rendering, which an interactive upload collects from the author's own
				// browser. A package has no such client, and unlike silent video there
				// is no server-side substitute for actually loading a face. So a
				// packaged font records what it genuinely satisfied rather than
				// claiming a profile it did not: its facts already carry neither
				// `browserLoadable` nor `representativeGlyphsRendered`, and a warning
				// makes the gap something the author confirms knowingly.
				validated.set(content.digest, {
					entry,
					facts: accepted.facts,
					compatibilityProfile: accepted.facts.kind === 'font'
						? STATIC_FONT_UNATTESTED_COMPATIBILITY_PROFILE
						: accepted.compatibilityProfile,
					thumbnail,
					thumbnailDigest: await sha256Hex(thumbnail),
				});
			}
			catch (error) {
				if (error instanceof SilentVideoInspectionSourceError)
					throw new TemplatePackageArchiveSourceError('Staged Template Package bytes are temporarily unavailable');
				if (error instanceof SilentVideoValidationRuntimeError)
					throw error;
				if (!(error instanceof GraphicAssetValidationError))
					throw error;
				const rejection = rejectedValidationReport(error, policy.compatibilityProfile);
				for (const rejected of rejection.issues) {
					issues.push(templatePackagePreflightIssue('incompatible-graphic-asset-content', {
						subject: entry.name,
						message: `${rejected.code}: ${rejected.message}`,
					}));
				}
			}
		}

		// Mappings are proposed only from content this installation has actually
		// validated, so a proposal never describes bytes it could not accept.
		const mappings: TemplatePackagePreflightMapping[] = [];
		const countedContentDigests = new Set<string>();
		const derivatives: TemplatePackagePreflightState['derivatives'] = [];
		const countedDerivativeDigests = new Set<string>();
		let derivativeGrowthBytes = 0;
		for (const asset of manifest.packagedAssets) {
			const content = validated.get(asset.integrity.digest);
			if (!content)
				continue;
			const [originCandidates, contentStored, sharedContent] = await Promise.all([
				catalogue.findTemplatePackageOriginCandidates({
					sourceAssetId: asset.origin.sourceAssetId,
					sourceRevisionId: asset.origin.sourceRevisionId,
				}),
				canonical.readMetadata(graphicsObjectIdentity(`sha256/${asset.integrity.digest}`)),
				catalogue.findGraphicAssetByContentDigest(asset.integrity.digest),
			]);
			const contentAlreadyStored = contentStored.outcome === 'available'
				&& contentStored.object.byteLength === content.facts.byteLength;
			const proposal = templatePackageMappingProposal({
				asset,
				originMatch: originCandidates.exact,
				relatedOriginExists: originCandidates.relatedRevisionExists,
				contentAlreadyStored,
				contentCountedByAnotherMapping: countedContentDigests.has(asset.integrity.digest),
				sharedContentName: originCandidates.exact ? undefined : sharedContent?.name,
				compatibilityRestricted: content.facts.kind === 'silent-video'
					&& content.facts.targetCompatibility !== 'all-supported',
			});
			if (proposal.mapping.canonicalGrowthBytes > 0)
				countedContentDigests.add(asset.integrity.digest);
			mappings.push(proposal.mapping);
			issues.push(...proposal.issues);
			// Only a font this package would actually install carries the gap.
			// Reusing an exact origin keeps the local revision and whatever
			// attestation it already earned, so there is nothing new to accept.
			if (
				content.facts.kind === 'font'
				&& proposal.mapping.proposal === 'create-graphic-asset'
			) {
				issues.push(templatePackagePreflightIssue('graphic-asset-font-attestation-deferred', {
					subject: asset.packagedId,
					message: `"${asset.name}" would be installed under ${STATIC_FONT_UNATTESTED_COMPATIBILITY_PROFILE}: no browser has loaded and rendered it here`,
				}));
			}

			// A reused revision already has its preview; only a new Graphic Asset
			// brings a derivative this installation would have to store.
			const derivativeDigest = content.thumbnailDigest;
			derivatives.push({
				packagedId: asset.packagedId,
				digest: derivativeDigest,
				byteLength: content.thumbnail.byteLength,
			});
			if (
				proposal.mapping.proposal === 'create-graphic-asset'
				&& !countedDerivativeDigests.has(derivativeDigest)
			) {
				countedDerivativeDigests.add(derivativeDigest);
				const stored = await canonical.readMetadata(
					graphicsObjectIdentity(`sha256/${derivativeDigest}`),
				);
				if (stored.outcome !== 'available')
					derivativeGrowthBytes += content.thumbnail.byteLength;
			}
		}

		const canonicalGrowthBytes = mappings
			.reduce((total, mapping) => total + mapping.canonicalGrowthBytes, 0)
			+ derivativeGrowthBytes;
		const capacity = await catalogue.getCapacity();
		const quota: TemplatePackagePreflightQuota = {
			canonicalGrowthBytes,
			canonicalAvailableBytes: capacity.canonical.availableBytes,
			canonicalLimitBytes: capacity.canonical.limitBytes,
			pressure: capacity.canonical.pressure,
		};
		// A package that adds nothing to canonical storage stays possible at a full
		// quota; only real growth the installation cannot absorb is blocked.
		if (canonicalGrowthBytes > capacity.canonical.availableBytes) {
			issues.push(templatePackagePreflightIssue('canonical-capacity-blocked', {
				message: `Installing this package would add ${canonicalGrowthBytes} canonical bytes with ${capacity.canonical.availableBytes} available`,
			}));
		}

		const compatibilityProfiles = [
			...new Set([...validated.values()].map(content => content.compatibilityProfile)),
		];
		return {
			report: await finish(issues, {
				...reportOptions,
				compatibilityProfiles,
				mappings,
				quota,
			}),
			derivatives,
			material,
		};
	}

	/**
	 * Runs one complete Template Package preflight over durably staged bytes, and
	 * — when installing — publishes the proposal it produces.
	 *
	 * The archive is never expanded. Its entries are located through ranged reads
	 * of the staged object and each one is inspected in place, so a package at the
	 * 1 GiB limit costs the same bounded Worker memory as a small one. Nothing the
	 * package asserts is believed: the container is re-derived, every content
	 * digest is recomputed, and every embedded source is revalidated under this
	 * installation's current compatibility profiles rather than the sender's.
	 *
	 * The result is one immutable report. It is written durably before the stage
	 * changes, so a reconnecting author, a retry, and a cancellation all read the
	 * same proposal, and nothing it proposes exists outside this operation.
	 *
	 * Installation deliberately runs the identical inspection rather than trusting
	 * the resting report. A confirmation names one exact proposal, and the library
	 * it was made against can move while the operation rests: re-deriving the
	 * report is the only way to know the author still agrees with what would now
	 * be installed. A run that reaches the same conclusion keeps the confirmation
	 * and publishes; one that does not returns the operation to the author with
	 * the new report instead.
	 */
	async function continueTemplatePackagePreflight(
		initialOperation: GraphicsIngestionOperation,
		options: { install: boolean } = { install: false },
	): Promise<GraphicsIngestionOperation> {
		const catalogue = requireCatalogue();
		const staging = requireStaging();
		const canonical = requireCanonical();
		let operation = initialOperation;
		const stagingIdentity = graphicsObjectIdentity(`ingestion/${operation.id}/source`);

		async function terminalOperationAtCheckpoint() {
			const authoritative = await catalogue.getIngestionOperation(
				operation.id,
				operation.initiatedBy,
			);
			if (authoritative?.stage !== 'cancelled' && authoritative?.stage !== 'completed')
				return undefined;
			if (authoritative.stage === 'cancelled') {
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
			}
			return authoritative;
		}

		async function stagingUnavailable(message: string) {
			return await failOperation(catalogue, operation, {
				code: 'staging-unavailable',
				retryable: true,
				message,
			});
		}

		/** Reads an exact window of the staged archive, or reports it unreadable. */
		async function readStagedRange(offset: number, length: number): Promise<Uint8Array> {
			const range = await staging.read(stagingIdentity, { offset, length });
			if (
				range.outcome !== 'available'
				|| range.range.offset !== offset
				|| range.range.length !== length
				|| range.range.completeLength !== operation.declaredByteLength
			) {
				throw new TemplatePackageArchiveSourceError('Staged Template Package bytes are temporarily unavailable');
			}
			try {
				return await consumeBoundedByteStream({
					body: range.body,
					byteLength: length,
					maximumByteLength: length,
				});
			}
			catch (error) {
				throw new TemplatePackageArchiveSourceError(
					'Staged Template Package bytes could not be read',
					{ cause: error },
				);
			}
		}

		/**
		 * Publishes one confirmed proposal.
		 *
		 * Everything before the final catalogue call is preparation this operation
		 * can still lose without consequence: bytes written into the canonical store
		 * are claimed as its candidates first, stay unreachable until a revision
		 * points at them, and are collected if it never finishes. Only the one
		 * transaction at the end makes any of it exist.
		 */
		async function publishConfirmedTemplatePackage(input: {
			report: TemplatePackagePreflightReport;
			material: StagedTemplatePackageMaterial;
		}): Promise<GraphicsIngestionOperation> {
			const { report, material } = input;
			const manifest = material.manifest;
			if (!manifest || material.templateDocument === undefined) {
				// A report is installable only once its manifest and Template document
				// have both read, so this is a broken invariant rather than anything
				// the package got wrong.
				throw new Error('A confirmed Template Package has no manifest or Template document');
			}

			// Every exact-origin reuse is proven to still resolve, and to still be an
			// asset that may take a new reference, before a byte moves. The name and
			// profile recorded here are the library's own: reuse never adopts the
			// packaged snapshot over locally curated metadata, and the differences
			// were already reported at preflight.
			const reused: ReusedTemplatePackageGraphicAsset[] = [];
			for (const mapping of report.mappings) {
				if (mapping.proposal !== 'reuse-graphic-asset-revision' || !mapping.reference)
					continue;
				const local = await catalogue.findRevisionContent(mapping.reference);
				if (!local || local.lifecycleState !== 'active') {
					return await failOperation(catalogue, operation, {
						code: 'template-package-mapping-unavailable',
						retryable: true,
						message: 'A Graphic Asset this Template Package reuses can no longer receive references.',
					});
				}
				reused.push({
					packagedId: mapping.packagedId,
					assetId: mapping.reference.assetId,
					revisionId: mapping.reference.revisionId,
					name: local.name,
					kind: local.kind,
					compatibilityProfile: local.compatibilityProfile,
				});
			}

			// The confirmed report already counted every shared byte once, so its
			// growth is exactly what this reservation holds.
			const reservation = await catalogue.reserveTemplatePackagePublication({
				operation,
				growthBytes: report.quota.canonicalGrowthBytes,
				reservedAt: changedOperation(operation, {}).updatedAt,
			});
			if (reservation.outcome === 'lost-claim') {
				// Another attempt owns this operation now, and whatever it decided is
				// the authoritative answer — so it is read rather than guessed at, and
				// never reported as a capacity problem the author would go off and try
				// to solve.
				return await catalogueRequest(
					() => catalogue.getIngestionOperation(operation.id, operation.initiatedBy),
					'Graphics ingestion state is temporarily unavailable',
				) ?? operation;
			}
			if (reservation.outcome === 'blocked') {
				operation = {
					...operation,
					canonicalCapacityOutcome: {
						outcome: 'canonical-capacity-blocked',
						growthBytes: reservation.capacity.requestedBytes,
						availableBytes: reservation.capacity.availableBytes,
					},
				};
				return await failOperation(catalogue, operation, {
					code: 'canonical-capacity-exhausted',
					retryable: true,
					message: 'Canonical capacity is exhausted; installing this Template Package would add new bytes.',
				});
			}
			operation = reservation.operation;

			const created: CreatedTemplatePackageGraphicAsset[] = [];
			for (const mapping of report.mappings) {
				if (mapping.proposal !== 'create-graphic-asset')
					continue;
				const content = material.contents.get(mapping.origin.digest);
				if (!content)
					throw new Error('A confirmed Template Package mapping names content this run never validated');
				created.push({
					packagedId: mapping.packagedId,
					basis: mapping.basis,
					assetId: graphicAssetId(generateIdentity()),
					revisionId: graphicAssetRevisionId(generateIdentity()),
					derivativeId: graphicsDerivativeId(generateIdentity()),
					// An asset this installation creates takes the packaged metadata
					// snapshot. Only its technical facts and compatibility profile are
					// this installation's own, because those are what it proved.
					name: mapping.name,
					kind: content.facts.kind,
					sourceDigest: mapping.origin.digest,
					sourceByteLength: content.facts.byteLength,
					canonicalMime: content.facts.canonicalMime,
					compatibilityProfile: content.compatibilityProfile,
					facts: content.facts,
					derivativeKind: content.facts.kind === 'font'
						? 'font-specimen'
						: content.facts.kind === 'silent-video'
							? 'video-poster'
							: 'thumbnail',
					thumbnailDigest: content.thumbnailDigest,
					thumbnailByteLength: content.thumbnail.byteLength,
					origin: mapping.origin,
				});
			}

			// Claimed before a byte moves, for the reason ordinary ingestion claims
			// its own: an object the canonical store holds that the catalogue cannot
			// account for is what the reconciliation scan quarantines, so writing
			// first would let a publication in flight have its bytes taken out from
			// under it.
			const claimed = new Map<string, number>();
			for (const asset of created) {
				claimed.set(asset.sourceDigest, asset.sourceByteLength);
				claimed.set(asset.thumbnailDigest, asset.thumbnailByteLength);
			}
			await catalogue.recordCanonicalWrites({
				operation,
				contents: [...claimed].map(([digest, byteLength]) => ({ digest, byteLength })),
				recordedAt: timestamp(),
			});

			// Identical bytes behind distinct packaged identities are written once,
			// which is exactly what the quota was charged for.
			const written = new Set<string>();
			for (const asset of created) {
				const content = material.contents.get(asset.sourceDigest)!;
				const writes = [];
				if (!written.has(asset.sourceDigest)) {
					written.add(asset.sourceDigest);
					writes.push(storeCanonicalStream(canonical, asset.sourceDigest, {
						body: archiveEntryStream(content.entry, readStagedRange),
						byteLength: content.entry.byteLength,
						maximumByteLength: content.entry.byteLength,
					}, asset.canonicalMime));
				}
				if (!written.has(asset.thumbnailDigest)) {
					written.add(asset.thumbnailDigest);
					writes.push(storeCanonicalBytes(canonical, asset.thumbnailDigest, content.thumbnail));
				}
				const results = await Promise.all(writes);
				if (results.some(result => result.outcome === 'unavailable')) {
					return await failOperation(catalogue, operation, {
						code: 'canonical-store-unavailable',
						retryable: true,
						message: 'Canonical storage for this Template Package is temporarily unavailable.',
					});
				}
			}

			const bytesTerminal = await terminalOperationAtCheckpoint();
			if (bytesTerminal)
				return bytesTerminal;

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, { stage: 'publishing' }),
				operation.updatedAt,
			);
			const publicationTerminal = await terminalOperationAtCheckpoint();
			if (publicationTerminal)
				return publicationTerminal;

			// Every reference the Template carries becomes an exact local identity and
			// revision pair, whether its mapping reused a revision or created one. A
			// reference the confirmed proposal does not account for would install a
			// Template with a dangling field, so it is refused instead.
			const rewrite = rewriteTemplateDocumentReferences(
				material.templateDocument,
				templatePackageLocalReferences(
					report.mappings,
					new Map(created.map(asset => [asset.packagedId, {
						assetId: asset.assetId,
						revisionId: asset.revisionId,
					}])),
				),
			);
			if (rewrite.unmapped.length > 0) {
				return await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'The Template requires a Graphic Asset Revision this proposal never mapped.',
				});
			}

			const installed = await catalogue.installTemplatePackage({
				operation,
				template: {
					id: installedGraphicsTemplateId(generateIdentity()),
					kind: installedGraphicsTemplateKind(report.packageKind),
					name: manifest.template.name,
					document: rewrite.document,
					sourceTemplateIdentity: manifest.template.identity,
				},
				created,
				reused,
				references: rewrite.references.map(reference => ({
					id: generateIdentity(),
					ownerSlot: reference.ownerSlot,
					assetId: reference.reference.assetId,
					revisionId: reference.reference.revisionId,
				})),
				publishedAt: timestamp(),
			});
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
			await staging.delete(stagingIdentity);
			return installed;
		}

		try {
			const stagedMetadata = await staging.readMetadata(stagingIdentity);
			if (
				stagedMetadata.outcome !== 'available'
				|| stagedMetadata.object.byteLength !== operation.declaredByteLength
				|| stagedMetadata.object.customMetadata.operationId !== operation.id
			) {
				return await stagingUnavailable('Staged Template Package bytes could not be verified.');
			}

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, {
					stage: 'hashing',
					transferredByteLength: operation.declaredByteLength,
					failure: undefined,
				}),
				operation.updatedAt,
			);
			const archiveRead = await staging.read(stagingIdentity);
			if (archiveRead.outcome !== 'available')
				return await stagingUnavailable('Staged Template Package bytes are temporarily unavailable.');
			// The digest of the exact received bytes anchors the report fingerprint,
			// so a different package can never inherit an author's confirmation.
			const sourceDigest = await sha256HexStream({
				body: archiveRead.body,
				byteLength: archiveRead.object.byteLength,
				maximumByteLength: TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength,
			});
			const hashingTerminal = await terminalOperationAtCheckpoint();
			if (hashingTerminal)
				return hashingTerminal;

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, { stage: 'validating' }),
				operation.updatedAt,
			);

			const inspection = await inspectStagedTemplatePackage({
				operation,
				sourceDigest,
				readRange: readStagedRange,
				catalogue,
				canonical: requireCanonical(),
			});
			const derivativeTerminal = await terminalOperationAtCheckpoint();
			if (derivativeTerminal)
				return derivativeTerminal;

			// The proposal is durable before the stage that exposes it changes, so a
			// paused operation can never be observed without the report it paused on.
			const existing = await catalogue.getTemplatePackagePreflight(
				operation.id,
				operation.initiatedBy,
			);
			const state: TemplatePackagePreflightState = {
				report: inspection.report,
				// A confirmation survives only a proposal that reached the identical
				// conclusion. Any other outcome discards it and asks again.
				confirmedFingerprint: existing?.confirmedFingerprint === inspection.report.fingerprint
					? existing.confirmedFingerprint
					: undefined,
				confirmedAt: existing?.confirmedFingerprint === inspection.report.fingerprint
					? existing.confirmedAt
					: undefined,
				derivatives: inspection.derivatives,
			};
			const recorded = await catalogueRequest(
				() => catalogue.updateTemplatePackagePreflight({
					operationId: operation.id,
					initiatedBy: operation.initiatedBy,
					state,
				}),
				'Template Package preflight could not be recorded',
			);
			if (!recorded) {
				return await catalogueRequest(
					() => catalogue.getIngestionOperation(operation.id, operation.initiatedBy),
					'Graphics ingestion state is temporarily unavailable',
				) ?? operation;
			}

			if (state.report.outcome === 'rejected') {
				// A package this installation cannot accept fails permanently unless
				// the only thing standing in its way is something this installation
				// can change. The failure names which one, because "free some space
				// and retry" and "restore that asset first" are different
				// instructions and an author can only act on the right one.
				const retryable = state.report.issues.find(
					issue => issue.severity === 'error' && issue.retryable,
				);
				return await failOperation(catalogue, operation, retryable
					? retryable.code === 'graphic-asset-origin-not-referenceable'
						? {
								code: 'template-package-mapping-unavailable',
								retryable: true,
								message: 'A Graphic Asset this Template Package reuses can no longer receive references.',
							}
						: {
								code: 'canonical-capacity-exhausted',
								retryable: true,
								message: 'Installing this Template Package would exceed canonical capacity.',
							}
					: {
							code: 'validation-failed',
							retryable: false,
							message: 'The Template Package did not satisfy this installation\'s requirements.',
						});
			}

			const confirmed = templatePackagePreflightConfirmed(state);
			if (!options.install || !confirmed) {
				// A clean or already-confirmed proposal rests until installation claims
				// it; anything else pauses for exactly one confirmation. An installation
				// that lands here reached a conclusion its confirmation no longer covers,
				// so the author is asked about the new proposal rather than having the
				// old confirmation applied to it.
				return await catalogue.updateIngestionOperation(
					changedOperation(operation, {
						stage: confirmed ? 'awaiting-installation' : 'awaiting-confirmation',
						failure: undefined,
					}),
					operation.updatedAt,
				);
			}

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, {
					stage: 'generating-derivatives',
					failure: undefined,
				}),
				operation.updatedAt,
			);
			const installationTerminal = await terminalOperationAtCheckpoint();
			if (installationTerminal)
				return installationTerminal;
			return await publishConfirmedTemplatePackage({
				report: state.report,
				material: inspection.material,
			});
		}
		catch (error) {
			if (error instanceof TemplatePackageArchiveSourceError)
				return await stagingUnavailable('Staged Template Package bytes are temporarily unavailable.');
			if (error instanceof SilentVideoValidationRuntimeError) {
				return await failOperation(catalogue, operation, {
					code: 'validation-runtime-unavailable',
					retryable: true,
					message: 'Trusted silent-video playback validation is temporarily unavailable.',
				});
			}
			let authoritative: GraphicsIngestionOperation | undefined;
			try {
				authoritative = await catalogue.getIngestionOperation(operation.id, operation.initiatedBy);
			}
			catch (catalogueError) {
				throw new GraphicsAssetLibraryError(
					'Template Package preflight was interrupted while the catalogue was unavailable',
					'graphics-asset-library-unavailable',
					{ cause: catalogueError },
				);
			}
			if (authoritative?.stage === 'completed' || authoritative?.stage === 'cancelled')
				return authoritative;
			if (authoritative && authoritative.updatedAt !== operation.updatedAt)
				return authoritative;
			return await failOperation(catalogue, authoritative ?? operation, {
				code: 'ingestion-processing-failed',
				retryable: true,
				message: 'Template Package preflight was interrupted and can be retried from staged bytes.',
			});
		}
	}

	async function continueGraphicsIngestion(
		initialOperation: GraphicsIngestionOperation,
	): Promise<GraphicsIngestionOperation> {
		if (initialOperation.source === 'template-package')
			return await continueTemplatePackagePreflight(initialOperation);
		const catalogue = requireCatalogue();
		const staging = requireStaging();
		const canonical = requireCanonical();
		let operation = initialOperation;
		const stagingIdentity = graphicsObjectIdentity(`ingestion/${operation.id}/source`);
		const posterIdentity = graphicsObjectIdentity(`ingestion/${operation.id}/video-poster`);

		async function terminalOperationAtCheckpoint() {
			const authoritative = await catalogue.getIngestionOperation(
				operation.id,
				operation.initiatedBy,
			);
			if (authoritative?.stage !== 'cancelled' && authoritative?.stage !== 'completed')
				return;
			if (authoritative.stage === 'cancelled') {
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(posterIdentity);
			}
			return authoritative;
		}

		try {
			const stagedMetadata = await staging.readMetadata(stagingIdentity);
			if (
				stagedMetadata.outcome !== 'available'
				|| stagedMetadata.object.byteLength !== operation.declaredByteLength
				|| stagedMetadata.object.customMetadata.operationId !== operation.id
			) {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staged source bytes could not be verified.',
				}, operation.report);
			}

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, {
					stage: 'hashing',
					transferredByteLength: operation.declaredByteLength,
					failure: undefined,
				}),
				operation.updatedAt,
			);
			const stagedRead = await staging.read(stagingIdentity);
			if (stagedRead.outcome !== 'available') {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staged source bytes are temporarily unavailable.',
				}, operation.report);
			}
			const sourceDigest = await sha256HexStream({
				body: stagedRead.body,
				byteLength: stagedRead.object.byteLength,
				maximumByteLength: GRAPHIC_ASSET_SOURCE_POLICIES[
					graphicAssetSourceKind(operation)
				].maximumByteLength,
			});
			const hashingTerminal = await terminalOperationAtCheckpoint();
			if (hashingTerminal)
				return hashingTerminal;

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, { stage: 'validating' }),
				operation.updatedAt,
			);
			const leadingLength = Math.min(64, operation.declaredByteLength);
			const leadingRead = await staging.read(stagingIdentity, {
				offset: 0,
				length: leadingLength,
			});
			if (leadingRead.outcome !== 'available') {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staged source bytes are temporarily unavailable.',
				}, operation.report);
			}
			let processed:
				| Awaited<ReturnType<typeof processStillImage>>
				| Awaited<ReturnType<typeof processSilentVideo>>
				| Awaited<ReturnType<typeof processStaticFont>>;
			let sourceKind: GraphicAssetSourceKind = graphicAssetSourceKind(operation);
			let derivative: Uint8Array | undefined;
			let report: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>;
			try {
				const leadingBytes = await consumeBoundedByteStream({
					body: leadingRead.body,
					byteLength: leadingLength,
					maximumByteLength: leadingLength,
				});
				sourceKind = graphicAssetSourceKind(operation, leadingBytes);
				if (sourceKind === 'silent-video') {
					processed = await processSilentVideoFromRandomAccess({
						byteLength: stagedMetadata.object.byteLength,
						sha256: sourceDigest,
						read: async (offset, length) => {
							const range = await staging.read(stagingIdentity, { offset, length });
							if (range.outcome !== 'available') {
								return range.outcome === 'missing'
									? { outcome: 'missing' as const }
									: { outcome: 'unavailable' as const, retryable: true as const };
							}
							try {
								const bytes = await consumeBoundedByteStream({
									body: range.body,
									byteLength: length,
									maximumByteLength: length,
								});
								if (
									range.range.offset !== offset
									|| range.range.length !== length
									|| range.range.completeLength !== stagedMetadata.object.byteLength
								) {
									return { outcome: 'unavailable' as const, retryable: true as const };
								}
								return {
									outcome: 'available' as const,
									bytes,
									completeLength: range.range.completeLength,
								};
							}
							catch {
								return { outcome: 'unavailable' as const, retryable: true as const };
							}
						},
					}, {
						sourceFileName: operation.sourceFileName,
						declaredMime: operation.declaredMime,
					});
				}
				else {
					const validationRead = await staging.read(stagingIdentity);
					if (validationRead.outcome !== 'available')
						throw new Error('Staged source bytes are temporarily unavailable.');
					const validationBytes = await consumeBoundedByteStream({
						body: validationRead.body,
						byteLength: validationRead.object.byteLength,
						maximumByteLength: GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind].maximumByteLength,
					});
					processed = await processGraphicAssetSource(sourceKind, validationBytes, {
						sourceFileName: operation.sourceFileName,
						declaredMime: operation.declaredMime,
					});
				}
				// A local upload arrives with browser evidence for its own file. An
				// approved remote copy has no client-side bytes, so the operation
				// pauses here until the author confirms the staged source instead.
				if (
					!operation.browserDecodeEvidence
					&& (
						processed.report.facts.kind === 'font'
						|| (operation.source === 'remote-copy' && processed.report.facts.kind === 'image')
					)
				) {
					return await catalogue.updateIngestionOperation(
						changedOperation(operation, {
							stage: 'awaiting-confirmation',
							report: processed.report,
						}),
						operation.updatedAt,
					);
				}
				if (processed.report.facts.kind === 'silent-video') {
					const trusted = await reportWithTrustedSilentVideoValidation(
						processed.report as Extract<GraphicAssetValidationReport, {
							outcome: 'accepted';
							compatibilityProfile: 'silent-video-v1';
						}>,
						operation,
					);
					report = trusted.report;
					derivative = trusted.derivative;
				}
				else {
					report = reportWithBrowserDecodeEvidence(processed.report, operation);
					if (!('thumbnail' in processed))
						throw new Error('Validated still image or font is missing its deterministic derivative');
					derivative = processed.thumbnail;
				}
			}
			catch (error) {
				if (error instanceof SilentVideoInspectionSourceError) {
					return await failOperation(catalogue, operation, {
						code: 'staging-unavailable',
						retryable: true,
						message: error.outcome === 'missing'
							? 'Staged source bytes are missing.'
							: 'Staged source bytes are temporarily unavailable.',
					}, operation.report);
				}
				if (error instanceof SilentVideoValidationRuntimeError) {
					return await failOperation(catalogue, operation, {
						code: 'validation-runtime-unavailable',
						retryable: true,
						message: 'Trusted silent-video playback validation is temporarily unavailable.',
					}, operation.report);
				}
				if (!(error instanceof GraphicAssetValidationError))
					throw error;
				const report = rejectedValidationReport(
					error,
					GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind].compatibilityProfile,
				);
				const failed = await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'Graphic Asset did not satisfy its compatibility profile.',
				}, report);
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(posterIdentity);
				return failed;
			}
			const validationTerminal = await terminalOperationAtCheckpoint();
			if (validationTerminal)
				return validationTerminal;

			if (operation.targetAssetId) {
				const current = await catalogue.findCurrentGraphicAsset(operation.targetAssetId);
				if (!current)
					throw new Error('Replacement target Graphic Asset was not found');
				if (current.sourceDigest === report.facts.sha256) {
					operation = await catalogue.updateIngestionOperation(
						changedOperation(operation, {
							stage: 'publishing',
							report,
						}),
						operation.updatedAt,
					);
					const completed = await catalogue.completeGraphicAssetReplacementNoop({
						operation,
						current,
						completedAt: timestamp(),
					});
					// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
					await staging.delete(stagingIdentity);
					return completed;
				}
			}

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, {
					stage: 'generating-derivatives',
					report,
				}),
				operation.updatedAt,
			);
			const derivativeStartTerminal = await terminalOperationAtCheckpoint();
			if (derivativeStartTerminal)
				return derivativeStartTerminal;

			const thumbnail = derivative!;
			const thumbnailDigest = await sha256Hex(thumbnail);
			const reservation = await catalogue.reserveGraphicAssetPublication({
				operation,
				sourceDigest: report.facts.sha256,
				sourceByteLength: report.facts.byteLength,
				thumbnailDigest,
				thumbnailByteLength: thumbnail.byteLength,
				reservedAt: changedOperation(operation, {}).updatedAt,
			});
			if (reservation.outcome === 'blocked') {
				operation = {
					...operation,
					canonicalCapacityOutcome: {
						outcome: 'canonical-capacity-blocked',
						growthBytes: reservation.capacity.requestedBytes,
						availableBytes: reservation.capacity.availableBytes,
					},
				};
				return await failOperation(catalogue, operation, {
					code: 'canonical-capacity-exhausted',
					retryable: true,
					message: 'Canonical capacity is exhausted; this operation would add new bytes.',
				}, report);
			}
			operation = reservation.operation;
			const canonicalSourceRead = await staging.read(stagingIdentity);
			if (canonicalSourceRead.outcome !== 'available') {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staged source bytes are temporarily unavailable.',
				}, report);
			}
			// The claim is recorded before a byte moves. An object present in the
			// canonical store that nothing in the catalogue accounts for is exactly
			// what the reconciliation scan quarantines as unexpected, so writing
			// first would leave a window in which a publication in flight could have
			// its own bytes quarantined out from under it.
			//
			// Claiming a digest whose write then never happens is harmless: the
			// candidate is removed by publication, and an abandoned operation's
			// candidates are collected by the retention path, whose byte deletion
			// treats an already-absent object as deleted rather than as a failure.
			await catalogue.recordCanonicalWrites({
				operation,
				contents: [
					{ digest: report.facts.sha256, byteLength: report.facts.byteLength },
					{ digest: thumbnailDigest, byteLength: thumbnail.byteLength },
				],
				recordedAt: timestamp(),
			});
			const [sourceWrite, thumbnailWrite] = await Promise.all([
				storeCanonicalStream(canonical, report.facts.sha256, {
					body: canonicalSourceRead.body,
					byteLength: canonicalSourceRead.object.byteLength,
					maximumByteLength: GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind].maximumByteLength,
				}, report.facts.canonicalMime),
				storeCanonicalBytes(canonical, thumbnailDigest, thumbnail),
			]);
			if (sourceWrite.outcome === 'unavailable' || thumbnailWrite.outcome === 'unavailable') {
				return await failOperation(catalogue, operation, {
					code: 'canonical-store-unavailable',
					retryable: true,
					message: 'Canonical source or thumbnail storage is temporarily unavailable.',
				}, report);
			}
			const derivativeTerminal = await terminalOperationAtCheckpoint();
			if (derivativeTerminal)
				return derivativeTerminal;

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, { stage: 'publishing' }),
				operation.updatedAt,
			);
			const publicationTerminal = await terminalOperationAtCheckpoint();
			if (publicationTerminal)
				return publicationTerminal;

			const reusable = !operation.targetAssetId && operation.duplicateContentPolicy === 'reuse'
				? await catalogue.findReusableGraphicAsset(report.facts.sha256)
				: undefined;
			let completed: GraphicsIngestionOperation;
			if (reusable) {
				completed = await catalogue.reuseGraphicAsset({
					operation,
					reusable,
					publishedAt: timestamp(),
				});
			}
			else if (operation.targetAssetId) {
				completed = await catalogue.publishGraphicAssetReplacement({
					operation,
					targetAssetId: operation.targetAssetId,
					report,
					assetId: operation.targetAssetId,
					revisionId: graphicAssetRevisionId(generateIdentity()),
					derivativeId: graphicsDerivativeId(generateIdentity()),
					sourceDigest: report.facts.sha256,
					thumbnailDigest,
					thumbnailByteLength: thumbnail.byteLength,
					publishedAt: timestamp(),
				});
			}
			else {
				try {
					completed = await catalogue.publishGraphicAsset({
						operation,
						report,
						assetId: graphicAssetId(generateIdentity()),
						revisionId: graphicAssetRevisionId(generateIdentity()),
						derivativeId: graphicsDerivativeId(generateIdentity()),
						sourceDigest: report.facts.sha256,
						thumbnailDigest,
						thumbnailByteLength: thumbnail.byteLength,
						publishedAt: timestamp(),
					});
				}
				catch (publicationError) {
					if (operation.duplicateContentPolicy === 'create-separate')
						throw publicationError;
					const concurrentlyPublished = await catalogue.findReusableGraphicAsset(
						report.facts.sha256,
					);
					if (!concurrentlyPublished)
						throw publicationError;
					completed = await catalogue.reuseGraphicAsset({
						operation,
						reusable: concurrentlyPublished,
						publishedAt: timestamp(),
					});
				}
			}
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
			await staging.delete(stagingIdentity);
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
			await staging.delete(posterIdentity);
			return completed;
		}
		catch {
			let authoritative: GraphicsIngestionOperation | undefined;
			try {
				authoritative = await catalogue.getIngestionOperation(operation.id, operation.initiatedBy);
			}
			catch (error) {
				throw new GraphicsAssetLibraryError(
					'Graphics ingestion was interrupted while the catalogue was unavailable',
					'graphics-asset-library-unavailable',
					{ cause: error },
				);
			}
			if (authoritative?.stage === 'completed' || authoritative?.stage === 'cancelled')
				return authoritative;
			if (authoritative && authoritative.updatedAt !== operation.updatedAt)
				return authoritative;
			return await failOperation(catalogue, authoritative ?? operation, {
				code: operation.stage === 'publishing'
					? 'catalogue-publication-failed'
					: 'ingestion-processing-failed',
				retryable: true,
				message: operation.stage === 'publishing'
					? 'The Graphic Asset catalogue could not publish atomically.'
					: 'Graphics ingestion processing was interrupted and can be retried from staged bytes.',
			}, operation.report);
		}
	}

	/**
	 * Whether each component can answer at all. Every component is probed even
	 * when an earlier one has already failed, so one reading always reports the
	 * complete picture rather than stopping at the first problem.
	 */
	async function probeLibraryHealth(): Promise<GraphicsAssetLibraryHealth> {
		const checkedAt = now().toISOString();
		const [catalogue, staging, canonical] = await Promise.all([
			catalogueHealth(dependencies.catalogue),
			byteStoreHealth(dependencies.staging),
			byteStoreHealth(dependencies.canonical),
		]);
		return {
			status: catalogue.status === 'healthy'
				&& staging.status === 'healthy'
				&& canonical.status === 'healthy'
				? 'healthy'
				: 'degraded',
			checkedAt,
			catalogue,
			byteStores: { staging, canonical },
		};
	}

	return {
		getHealth: probeLibraryHealth,
		async getOperationsCockpit() {
			return await catalogueRequest(
				async () => await readGraphicsOperationsCockpit({
					probeHealth: probeLibraryHealth,
					catalogue: requireCockpitCatalogue,
					now,
				}),
				'The Graphics Asset Operations Cockpit is temporarily unavailable',
			);
		},
		async getCapacity() {
			return await catalogueRequest(
				() => requireCatalogue().getCapacity(),
				'Graphics Asset Library Capacity is temporarily unavailable',
			);
		},
		async updateCapacityLimits(input) {
			if (
				!Number.isSafeInteger(input.canonicalLimitBytes)
				|| input.canonicalLimitBytes <= 0
				|| !Number.isSafeInteger(input.stagingLimitBytes)
				|| input.stagingLimitBytes <= 0
			) {
				throw new GraphicsAssetLibraryError(
					'Graphics capacity limits must be positive whole byte counts',
					'invalid-ingestion-input',
				);
			}
			return await catalogueRequest(
				() => requireCatalogue().updateCapacityLimits({
					...input,
					updatedAt: timestamp(),
				}),
				'Graphics capacity limits could not be updated',
			);
		},
		async initiateGraphicsIngestion(input) {
			if (!input.name.trim())
				throw new GraphicsAssetLibraryError('Graphic Asset name is required', 'invalid-ingestion-input');
			return await initiateGraphicsOperation({
				...input,
				name: input.name,
				source: 'local-upload',
				duplicateContentPolicy: input.duplicateContentPolicy ?? 'reuse',
			});
		},
		async initiateGraphicAssetReplacement(input) {
			return await initiateGraphicsOperation({
				...input,
				name: 'Graphic Asset replacement',
				source: 'replacement',
				targetAssetId: input.assetId,
				duplicateContentPolicy: 'create-separate',
			});
		},
		async initiateRemoteGraphicAssetCopy(input) {
			if (!input.name.trim())
				throw new GraphicsAssetLibraryError('Graphic Asset name is required', 'invalid-ingestion-input');
			return await initiateGraphicsOperation({
				...input,
				name: input.name,
				source: 'remote-copy',
				duplicateContentPolicy: input.duplicateContentPolicy ?? 'reuse',
				declaredByteLength:
					GRAPHIC_ASSET_SOURCE_POLICIES[graphicAssetSourceKind(input)].maximumByteLength,
			});
		},
		async getIngestionOperation(input) {
			const operation = await catalogueRequest(
				() => requireCatalogue().getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			return operation;
		},
		async initiateTemplatePackagePreflight(input) {
			return await initiateGraphicsOperation({
				...input,
				// A package names no asset, so the operation is labelled by what the
				// author actually handed over. The Template's own name is not known
				// until the manifest is read, and the label must exist before that.
				name: input.sourceFileName?.trim() || 'Received Template Package',
				source: 'template-package',
				// A package never merges a packaged identity into a local one. Shared
				// bytes are reused, but each mapping decides its own identity.
				duplicateContentPolicy: 'create-separate',
			});
		},
		async confirmTemplatePackagePreflight(input) {
			const catalogue = requireCatalogue();
			const operation = await this.getIngestionOperation(input);
			if (operation.source !== 'template-package') {
				throw new GraphicsAssetLibraryError(
					'This Graphics Ingestion Operation does not receive a Template Package',
					'invalid-ingestion-input',
				);
			}
			const state = await catalogueRequest(
				() => catalogue.getTemplatePackagePreflight(operation.id, operation.initiatedBy),
				'Template Package preflight is temporarily unavailable',
			);
			// Confirming twice is the same act twice, not a conflict, so a repeat of
			// the confirmation that already succeeded is answered rather than
			// refused for having left `awaiting-confirmation` behind.
			if (
				state?.confirmedFingerprint === input.fingerprint
				&& operation.stage === 'awaiting-installation'
			) {
				return operation;
			}
			if (!state || operation.stage !== 'awaiting-confirmation') {
				throw new GraphicsAssetLibraryError(
					`Template Package preflight cannot be confirmed from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}
			// The fingerprint is the whole point of the pause: it proves the author
			// accepted this exact package, proposal, and set of warnings, so a report
			// that has since been superseded cannot be confirmed by an earlier one.
			if (input.fingerprint !== state.report.fingerprint) {
				throw new GraphicsAssetLibraryError(
					'Template Package confirmation does not match the current preflight report',
					'invalid-ingestion-input',
				);
			}
			// Everything above is a courtesy check against a stale read. The decision
			// is made by the conditional transition below, which is the only thing
			// standing between a concurrent retry and an installed proposal nobody
			// agreed to.
			const confirmed = await catalogueRequest(
				() => catalogue.confirmTemplatePackagePreflight({
					operationId: operation.id,
					initiatedBy: operation.initiatedBy,
					fingerprint: input.fingerprint,
					confirmedAt: timestamp(),
					updatedAt: timestampAfter(operation.updatedAt),
				}),
				'Template Package confirmation could not be recorded',
			);
			if (confirmed)
				return await this.getIngestionOperation(input);

			// The compare-and-set lost. What replaced it decides what the author is
			// told, so the authoritative state is re-read rather than guessed at.
			const latest = await this.getIngestionOperation(input);
			const latestState = await catalogueRequest(
				() => catalogue.getTemplatePackagePreflight(latest.id, latest.initiatedBy),
				'Template Package preflight is temporarily unavailable',
			);
			// Confirming twice is the same act twice, not a conflict.
			if (
				latestState?.confirmedFingerprint === input.fingerprint
				&& latest.stage === 'awaiting-installation'
			) {
				return latest;
			}
			if (latestState && latestState.report.fingerprint !== input.fingerprint) {
				throw new GraphicsAssetLibraryError(
					'Template Package confirmation does not match the current preflight report',
					'invalid-ingestion-input',
				);
			}
			throw new GraphicsAssetLibraryError(
				`Template Package preflight cannot be confirmed from stage ${latest.stage}`,
				'ingestion-operation-not-uploadable',
			);
		},
		async installTemplatePackage(input) {
			const catalogue = requireCatalogue();
			const operation = await this.getIngestionOperation(input);
			if (operation.source !== 'template-package') {
				throw new GraphicsAssetLibraryError(
					'This Graphics Ingestion Operation does not receive a Template Package',
					'invalid-ingestion-input',
				);
			}
			// Installing what is already installed is the same act twice, not a
			// conflict. This is also the answer to an installation that committed and
			// then lost its reply: the terminal result is durable, so a retry reads it
			// rather than publishing a second copy of the same package.
			if (operation.stage === 'completed')
				return operation;
			// A cancellation that reached the operation before publication started
			// wins, and stays won.
			if (operation.stage === 'cancelled')
				return operation;
			const state = await catalogueRequest(
				() => catalogue.getTemplatePackagePreflight(operation.id, operation.initiatedBy),
				'Template Package preflight is temporarily unavailable',
			);
			if (operation.stage === 'failed' && !operation.failure?.retryable) {
				throw new GraphicsAssetLibraryError(
					'This Template Package failed permanently and cannot be installed',
					'ingestion-operation-not-uploadable',
				);
			}
			// An operation resting on a proposal is judged by that proposal: nothing
			// installs from a pause the author never answered.
			//
			// A retryable failure has no resting proposal. The run that failed will
			// have recorded the report explaining why — an exhausted quota, an asset
			// that had gone into Trash — so judging the retry by that report would
			// refuse exactly the attempt the author was told to make after fixing it.
			// The re-derived report decides instead, and it either matches the
			// confirmation the author already gave or returns the operation to them.
			if (
				operation.stage !== 'failed'
				&& (!state || !templatePackagePreflightConfirmed(state))
			) {
				throw new GraphicsAssetLibraryError(
					'This Template Package has no confirmed preflight proposal to install',
					'ingestion-operation-not-uploadable',
				);
			}
			const claimedAt = new Date(Math.max(
				now().getTime(),
				new Date(operation.updatedAt).getTime() + 1,
			)).toISOString();
			// The claim is what makes two concurrent installations of one operation
			// impossible: whichever compare-and-set commits owns the publication, and
			// the other is told the operation is already busy rather than starting a
			// second run over the same staged bytes.
			const claimed = await catalogueRequest(
				() => catalogue.claimGraphicsIngestion({
					operation,
					claimedAt,
					staleBefore: new Date(
						new Date(claimedAt).getTime() - activeIngestionLeaseMilliseconds,
					).toISOString(),
				}),
				'Template Package installation could not claim the durable operation',
			);
			if (!claimed) {
				const latest = await this.getIngestionOperation(input);
				if (latest.stage === 'completed' || latest.stage === 'cancelled')
					return latest;
				throw new GraphicsAssetLibraryError(
					`Template Package installation cannot start from stage ${latest.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}
			return await continueTemplatePackagePreflight(claimed, { install: true });
		},
		async inspectInstalledGraphicsTemplate(input) {
			const template = await catalogueRequest(
				() => requireCatalogue().findInstalledGraphicsTemplate(input.templateId),
				'Installed graphics Template state is temporarily unavailable',
			);
			if (!template) {
				throw new GraphicsAssetLibraryError(
					'Installed Graphics Template not found',
					'ingestion-operation-not-found',
				);
			}
			return template;
		},
		async cancelGraphicsIngestion(input) {
			const catalogue = requireCatalogue();
			const operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'completed')
				return operation;
			if (operation.stage === 'cancelled')
				return await cleanupCancelledMultipart(catalogue, operation);
			const cancelled = await catalogueRequest(
				() => catalogue.updateIngestionOperation(
					changedOperation(operation, {
						stage: 'cancelled',
						failure: {
							code: 'ingestion-cancelled',
							retryable: false,
							message: 'Graphics ingestion was cancelled before publication.',
						},
					}),
					operation.updatedAt,
				),
				'Graphics ingestion cancellation could not be recorded',
			);
			const cleaned = await cleanupCancelledMultipart(catalogue, cancelled);
			const staging = requireStaging();
			// Source and poster are one operation's provisional staging set.
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
			await staging.delete(graphicsObjectIdentity(`ingestion/${operation.id}/source`));
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
			await staging.delete(graphicsObjectIdentity(`ingestion/${operation.id}/video-poster`));
			return cleaned;
		},
		async startGraphicAssetMultipartUpload(input) {
			const catalogue = requireCatalogue();
			const staging = requireStaging();
			const operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'completed' || operation.stage === 'cancelled')
				return operation;
			if (operation.declaredByteLength <= GRAPHICS_MULTIPART_PART_BYTES) {
				throw new GraphicsAssetLibraryError(
					'Multipart transfer is reserved for inputs larger than 16 MiB',
					'invalid-ingestion-input',
				);
			}
			// An approved remote copy owns the same staging identity for the whole
			// of its own transfer, so a client-driven multipart must not race it.
			if (operation.source === 'remote-copy') {
				throw new GraphicsAssetLibraryError(
					'An approved remote copy transfers its own source and cannot accept a client multipart upload',
					'ingestion-operation-not-uploadable',
				);
			}
			if (operation.stage !== 'created' && operation.stage !== 'transferring') {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot start multipart transfer from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}

			const existing = await catalogueRequest(
				() => catalogue.getGraphicAssetMultipartState(operation.id, operation.initiatedBy),
				'Graphics multipart checkpoint is temporarily unavailable',
			);
			const stagingIdentity = graphicsObjectIdentity(`ingestion/${operation.id}/source`);
			if (existing?.uploadId) {
				const resumed = await staging.resumeMultipart(stagingIdentity, existing.uploadId);
				if (resumed.outcome === 'unavailable') {
					throw new GraphicsAssetLibraryError(
						'Graphics multipart upload is temporarily unavailable',
						'graphics-asset-library-unavailable',
					);
				}
				return await this.getIngestionOperation(input);
			}

			const started = await staging.beginMultipart({
				identity: stagingIdentity,
				metadata: {
					contentType: 'application/octet-stream',
					custom: { operationId: operation.id },
				},
			});
			if (started.outcome === 'unavailable') {
				throw new GraphicsAssetLibraryError(
					'Graphics multipart upload could not be started',
					'graphics-asset-library-unavailable',
				);
			}
			const initialVersion = existing?.version ?? 0;
			const state: GraphicsAssetMultipartState = {
				version: initialVersion + 1,
				uploadId: started.upload.uploadId,
				cleanupPending: false,
				parts: existing?.parts ?? [],
			};
			const recorded = await catalogueRequest(
				() => catalogue.updateGraphicAssetMultipartState({
					operationId: operation.id,
					initiatedBy: operation.initiatedBy,
					expectedVersion: initialVersion,
					state,
					updatedAt: timestampAfter(operation.updatedAt),
				}),
				'Graphics multipart start checkpoint could not be recorded',
			);
			if (!recorded) {
				await staging.abortMultipart(started.upload);
				return await this.startGraphicAssetMultipartUpload(input);
			}
			return await this.getIngestionOperation(input);
		},
		async uploadGraphicAssetMultipartPart(input) {
			const catalogue = requireCatalogue();
			const staging = requireStaging();
			let operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'completed' || operation.stage === 'cancelled')
				return operation;
			if (operation.stage !== 'transferring' || !operation.transfer) {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot accept a multipart part from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}
			const expectedByteLength = graphicsMultipartPartByteLength(
				operation.declaredByteLength,
				input.partNumber,
			);
			if (input.bytes.byteLength !== expectedByteLength) {
				throw new GraphicsAssetLibraryError(
					`Multipart part ${input.partNumber} must contain exactly ${expectedByteLength} bytes`,
					'invalid-ingestion-input',
				);
			}

			let claimedState: GraphicsAssetMultipartState | undefined;
			for (let claimAttempt = 0; claimAttempt < 8; claimAttempt++) {
				const state = await catalogueRequest(
					() => catalogue.getGraphicAssetMultipartState(operation!.id, operation!.initiatedBy),
					'Graphics multipart checkpoint is temporarily unavailable',
				);
				if (!state?.uploadId)
					throw new GraphicsAssetLibraryError('Graphics multipart upload has not been started', 'ingestion-operation-not-uploadable');
				const staleBefore = new Date(
					now().getTime() - activeIngestionLeaseMilliseconds,
				).toISOString();
				const availableParts = state.parts.map(part =>
					part.status === 'uploading' && part.claimedAt <= staleBefore
						? { ...part, status: 'failed' as const }
						: part);
				const existing = availableParts.find(part => part.partNumber === input.partNumber);
				if (existing?.status === 'completed')
					return await this.getIngestionOperation(input);
				if (existing?.status === 'uploading') {
					throw new GraphicsAssetLibraryError(
						`Multipart part ${input.partNumber} is already in flight`,
						'ingestion-operation-not-uploadable',
					);
				}
				const attempts = (existing?.attempts ?? 0) + 1;
				if (attempts > GRAPHICS_MULTIPART_MAXIMUM_PART_ATTEMPTS) {
					throw new GraphicsAssetLibraryError(
						`Multipart part ${input.partNumber} exhausted its retry allowance`,
						'ingestion-operation-not-uploadable',
					);
				}
				const inFlight = availableParts.filter(part => part.status === 'uploading').length;
				if (inFlight >= GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS) {
					throw new GraphicsAssetLibraryError(
						'No more than three multipart parts may be in flight',
						'ingestion-operation-not-uploadable',
					);
				}
				const claimedPart: GraphicsAssetMultipartState['parts'][number] = {
					partNumber: input.partNumber,
					partIdentity: graphicsIngestionPartIdentity(operation.id, input.partNumber),
					byteLength: expectedByteLength,
					status: 'uploading',
					claimedAt: timestamp(),
					attempts,
				};
				const claimed: GraphicsAssetMultipartState = {
					...state,
					version: state.version + 1,
					parts: [
						...availableParts.filter(part => part.partNumber !== input.partNumber),
						claimedPart,
					],
				};
				const recorded = await catalogueRequest(
					() => catalogue.updateGraphicAssetMultipartState({
						operationId: operation!.id,
						initiatedBy: operation!.initiatedBy,
						expectedVersion: state.version,
						state: claimed,
						updatedAt: timestampAfter(operation!.updatedAt),
					}),
					'Graphics multipart part claim could not be recorded',
				);
				if (recorded) {
					claimedState = claimed;
					break;
				}
				operation = await this.getIngestionOperation(input);
				if (operation.stage === 'completed' || operation.stage === 'cancelled')
					return operation;
			}
			if (!claimedState?.uploadId) {
				throw new GraphicsAssetLibraryError(
					'Graphics multipart part could not claim a durable transfer slot',
					'graphics-asset-library-unavailable',
				);
			}

			const upload = {
				identity: graphicsObjectIdentity(`ingestion/${operation.id}/source`),
				uploadId: claimedState.uploadId,
			};
			const uploaded = await staging.uploadPart({
				upload,
				partNumber: input.partNumber,
				bytes: boundedByteStreamWithDeadline(
					input.bytes,
					GRAPHICS_MULTIPART_PART_TRANSFER_TIMEOUT_MILLISECONDS,
				),
			});
			if (uploaded.outcome === 'unavailable') {
				const failedState: GraphicsAssetMultipartState = {
					...claimedState,
					version: claimedState.version + 1,
					parts: claimedState.parts.map(part =>
						part.partNumber === input.partNumber
							? { ...part, status: 'failed' as const }
							: part),
				};
				await catalogueRequest(
					() => catalogue.updateGraphicAssetMultipartState({
						operationId: operation!.id,
						initiatedBy: operation!.initiatedBy,
						expectedVersion: claimedState!.version,
						state: failedState,
						updatedAt: timestampAfter(operation!.updatedAt),
					}),
					'Graphics multipart retry checkpoint could not be recorded',
				);
				throw new GraphicsAssetLibraryError(
					`Multipart part ${input.partNumber} is temporarily unavailable`,
					'graphics-asset-library-unavailable',
				);
			}

			for (let recordAttempt = 0; recordAttempt < 8; recordAttempt++) {
				const latest = await catalogueRequest(
					() => catalogue.getGraphicAssetMultipartState(operation!.id, operation!.initiatedBy),
					'Graphics multipart checkpoint is temporarily unavailable',
				);
				if (!latest)
					break;
				const existing = latest.parts.find(part => part.partNumber === input.partNumber);
				if (existing?.status === 'completed')
					return await this.getIngestionOperation(input);
				const completed: GraphicsAssetMultipartState = {
					...latest,
					version: latest.version + 1,
					parts: [
						...latest.parts.filter(part => part.partNumber !== input.partNumber),
						{
							partNumber: input.partNumber,
							partIdentity: graphicsIngestionPartIdentity(operation.id, input.partNumber),
							objectStorePartIdentity: uploaded.part.partIdentity,
							byteLength: uploaded.part.byteLength,
							status: 'completed',
							claimedAt: existing?.claimedAt ?? timestamp(),
							attempts: existing?.attempts ?? 1,
						},
					],
				};
				const recorded = await catalogueRequest(
					() => catalogue.updateGraphicAssetMultipartState({
						operationId: operation!.id,
						initiatedBy: operation!.initiatedBy,
						expectedVersion: latest.version,
						state: completed,
						updatedAt: timestampAfter(operation!.updatedAt),
					}),
					'Graphics multipart completed part could not be recorded',
				);
				if (recorded)
					return await this.getIngestionOperation(input);
				operation = await this.getIngestionOperation(input);
				if (operation.stage === 'completed' || operation.stage === 'cancelled')
					return operation;
			}
			throw new GraphicsAssetLibraryError(
				'Graphics multipart completed part could not be checkpointed',
				'graphics-asset-library-unavailable',
			);
		},
		async completeGraphicAssetMultipartUpload(input) {
			const catalogue = requireCatalogue();
			const staging = requireStaging();
			const operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'completed' || operation.stage === 'cancelled')
				return operation;
			if (operation.stage !== 'transferring' || !operation.transfer) {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot complete multipart transfer from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}
			const state = await catalogueRequest(
				() => catalogue.getGraphicAssetMultipartState(operation.id, operation.initiatedBy),
				'Graphics multipart checkpoint is temporarily unavailable',
			);
			if (!state?.uploadId)
				throw new GraphicsAssetLibraryError('Graphics multipart upload has not been started', 'ingestion-operation-not-uploadable');
			const expectedPartCount = Math.ceil(operation.declaredByteLength / GRAPHICS_MULTIPART_PART_BYTES);
			const completedParts = state.parts
				.filter((part): part is typeof part & { objectStorePartIdentity: GraphicsMultipartPartIdentity } =>
					part.status === 'completed' && part.objectStorePartIdentity !== undefined)
				.toSorted((left, right) => left.partNumber - right.partNumber);
			if (
				completedParts.length !== expectedPartCount
				|| completedParts.some((part, index) => part.partNumber !== index + 1)
			) {
				throw new GraphicsAssetLibraryError(
					'Graphics multipart upload is missing verified parts',
					'ingestion-operation-not-uploadable',
				);
			}
			const upload = {
				identity: graphicsObjectIdentity(`ingestion/${operation.id}/source`),
				uploadId: state.uploadId,
			};
			const completed = await staging.completeMultipart({
				upload,
				parts: completedParts.map(part => ({
					partNumber: part.partNumber,
					partIdentity: part.objectStorePartIdentity,
					byteLength: part.byteLength,
				})),
			});
			let stagedByteLength = completed.outcome === 'created'
				? completed.object.byteLength
				: undefined;
			if (stagedByteLength === undefined) {
				const metadata = await staging.readMetadata(upload.identity);
				if (metadata.outcome === 'available')
					stagedByteLength = metadata.object.byteLength;
			}
			if (stagedByteLength !== operation.declaredByteLength) {
				throw new GraphicsAssetLibraryError(
					'Graphics multipart completion could not be verified',
					'graphics-asset-library-unavailable',
				);
			}
			await catalogueRequest(
				() => catalogue.recordStagedBytes({
					operation,
					usedBytes: stagedByteLength!,
					recordedAt: timestamp(),
				}),
				'Graphics staging progress could not be recorded',
			);
			const authoritative = await this.getIngestionOperation(input);
			return await continueGraphicsIngestion(authoritative);
		},
		async uploadGraphicAsset(input) {
			const catalogue = requireCatalogue();
			const staging = requireStaging();
			let operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'completed' || operation.stage === 'cancelled')
				return operation;
			if (operation.stage !== 'created') {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot upload from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}
			if (operation.declaredByteLength > GRAPHICS_MULTIPART_PART_BYTES) {
				throw new GraphicsAssetLibraryError(
					'Inputs larger than 16 MiB must use resumable multipart transfer',
					'ingestion-operation-not-uploadable',
				);
			}
			if (input.bytes.byteLength !== operation.declaredByteLength) {
				throw new GraphicsAssetLibraryError(
					'Transferred Graphic Asset length must match the initiated operation',
					'invalid-ingestion-input',
				);
			}
			const initiatedMime = operation.declaredMime?.trim().toLocaleLowerCase();
			const transferMime = input.declaredMime?.trim().toLocaleLowerCase();
			// A Template Package declares its artifact type in its own manifest, and
			// preflight holds that declaration to the archive it actually received.
			// A transfer header disagreeing with it is not a validation report about
			// one Graphic Asset, so it is left for preflight to judge.
			if (
				operation.source !== 'template-package'
				&& initiatedMime
				&& transferMime
				&& initiatedMime !== transferMime
			) {
				const sourceKind = graphicAssetSourceKind(operation);
				const sourcePolicy = GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind];
				return await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'Graphic Asset declarations conflict before validation.',
				}, {
					outcome: 'rejected',
					compatibilityProfile: sourcePolicy.compatibilityProfile,
					issues: [{
						severity: 'error',
						code: sourcePolicy.conflictingMimeCode,
						message: `Initiated MIME ${initiatedMime} conflicts with transfer MIME ${transferMime}.`,
					}],
				});
			}

			operation = await catalogueRequest(
				() => catalogue.updateIngestionOperation(
					changedOperation(operation!, {
						stage: 'transferring',
						declaredMime: initiatedMime ?? transferMime,
						failure: undefined,
					}),
					operation!.updatedAt,
				),
				'Graphics ingestion transfer could not be started',
			);
			const stagingIdentity = graphicsObjectIdentity(`ingestion/${operation.id}/source`);
			let staged: Awaited<ReturnType<typeof staging.createImmutable>>;
			try {
				staged = await staging.createImmutable({
					identity: stagingIdentity,
					bytes: input.bytes,
					metadata: {
						contentType: 'application/octet-stream',
						custom: { operationId: operation.id },
					},
				});
			}
			catch {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staging byte storage was interrupted.',
				});
			}
			if (staged.outcome === 'unavailable') {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staging byte storage is temporarily unavailable.',
				});
			}
			if (staged.object.byteLength !== operation.declaredByteLength) {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staged source bytes could not be verified.',
				});
			}
			const authoritative = await catalogueRequest(
				() => catalogue.getIngestionOperation(operation!.id, operation!.initiatedBy),
				'Graphics ingestion transfer checkpoint is temporarily unavailable',
			);
			if (authoritative?.stage === 'cancelled' || authoritative?.stage === 'completed') {
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
				return authoritative;
			}
			await catalogueRequest(
				() => catalogue.recordStagedBytes({
					operation,
					usedBytes: staged.object.byteLength,
					recordedAt: timestamp(),
				}),
				'Graphics staging progress could not be recorded',
			);
			return await continueGraphicsIngestion(operation);
		},
		async copyRemoteGraphicAssetSource(input) {
			const catalogue = requireCatalogue();
			const staging = requireStaging();
			const remoteSource = dependencies.remoteSource;
			if (!remoteSource) {
				throw new GraphicsAssetLibraryError(
					'Approved remote Graphic Asset copying is unavailable',
					'graphics-asset-library-unavailable',
				);
			}
			let operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'completed' || operation.stage === 'cancelled')
				return operation;
			if (operation.source !== 'remote-copy') {
				throw new GraphicsAssetLibraryError(
					'This Graphics Ingestion Operation does not copy an approved remote source',
					'ingestion-operation-not-uploadable',
				);
			}
			// The remote URL is supplied per attempt rather than persisted, so the
			// byte-source phase may be re-run while no staged bytes exist.
			const resumable = operation.transferredByteLength === 0
				&& (
					operation.stage === 'created'
					|| operation.stage === 'transferring'
					|| (operation.stage === 'failed' && operation.failure?.retryable !== false)
				);
			if (!resumable) {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot copy an approved remote source from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}

			const sourceKind = graphicAssetSourceKind(operation);
			const policy = GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind];
			const opened = await remoteSource.open({
				sourceUrl: input.sourceUrl,
				maximumByteLength: policy.maximumByteLength,
			});
			if (opened.outcome === 'unavailable') {
				throw new GraphicsAssetLibraryError(
					opened.message,
					'graphics-asset-library-unavailable',
				);
			}
			if (opened.outcome === 'rejected') {
				return await failOperation(catalogue, operation, {
					code: 'remote-source-rejected',
					retryable: false,
					message: 'The approved remote Graphic Asset source was rejected before any byte was copied.',
				}, {
					outcome: 'rejected',
					compatibilityProfile: policy.compatibilityProfile,
					issues: [{
						severity: 'error',
						code: opened.rejection.code,
						message: opened.rejection.message,
					}],
				});
			}

			operation = await catalogueRequest(
				() => catalogue.updateIngestionOperation(
					changedOperation(operation!, {
						stage: 'transferring',
						failure: undefined,
						report: undefined,
					}),
					operation!.updatedAt,
				),
				'Approved remote Graphic Asset copy could not be started',
			);
			const stagingIdentity = graphicsObjectIdentity(`ingestion/${operation.id}/source`);
			const staged = await stageRemoteSource({
				staging,
				identity: stagingIdentity,
				operationId: operation.id,
				body: opened.body,
				maximumByteLength: policy.maximumByteLength,
				declaredByteLength: opened.byteLength,
			});
			if (staged.outcome !== 'staged') {
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
				if (staged.outcome === 'unavailable') {
					return await failOperation(catalogue, operation, {
						code: 'staging-unavailable',
						retryable: true,
						message: 'Copied remote source bytes could not be staged and verified.',
					});
				}
				const rejection = staged.outcome === 'length-exceeded'
					? {
							code: 'remote-source-length-exceeded' as const,
							message: `The remote source delivered more than the ${policy.maximumByteLength}-byte limit for this Graphic Asset kind.`,
						}
					: staged.outcome === 'empty'
						? {
								code: 'remote-source-not-retrievable' as const,
								message: 'The remote source returned no content.',
							}
						: {
								code: 'remote-source-length-mismatch' as const,
								message: `The remote source declared ${staged.declaredByteLength} bytes but delivered a different length.`,
							};
				return await failOperation(catalogue, operation, {
					code: 'remote-source-rejected',
					retryable: false,
					message: 'The approved remote Graphic Asset source did not deliver a usable bounded copy.',
				}, {
					outcome: 'rejected',
					compatibilityProfile: policy.compatibilityProfile,
					issues: [{ severity: 'error', ...rejection }],
				});
			}
			const authoritative = await catalogueRequest(
				() => catalogue.getIngestionOperation(operation!.id, operation!.initiatedBy),
				'Approved remote Graphic Asset copy checkpoint is temporarily unavailable',
			);
			if (authoritative?.stage === 'cancelled' || authoritative?.stage === 'completed') {
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
				return authoritative;
			}
			await catalogueRequest(
				() => catalogue.recordRemoteCopyStagedSource({
					operation: operation!,
					observedByteLength: staged.byteLength,
					recordedAt: timestamp(),
				}),
				'Approved remote Graphic Asset copy progress could not be recorded',
			);
			return await continueGraphicsIngestion(await catalogueRequest(
				() => catalogue.getIngestionOperation(operation!.id, operation!.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			) ?? operation);
		},
		async resolveStagedGraphicAssetSource(input) {
			const operation = await catalogueRequest(
				() => requireCatalogue().getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage !== 'awaiting-confirmation')
				return { outcome: 'missing' };
			const result = await requireStaging().read(
				graphicsObjectIdentity(`ingestion/${operation.id}/source`),
			);
			if (result.outcome === 'missing')
				return { outcome: 'missing' };
			if (
				result.outcome === 'unavailable'
				|| result.object.byteLength !== operation.declaredByteLength
			) {
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				body: result.body,
				byteLength: result.object.byteLength,
			};
		},
		async confirmGraphicAssetBrowserEvidence(input) {
			const catalogue = requireCatalogue();
			const operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (
				operation.stage !== 'awaiting-confirmation'
				|| operation.report?.outcome !== 'accepted'
			) {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot confirm browser evidence from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}
			const fontEvidence = input.evidence.outcome === 'font-loaded'
				|| input.evidence.outcome === 'font-rejected';
			if ((operation.report.facts.kind === 'font') !== fontEvidence) {
				throw new GraphicsAssetLibraryError(
					'Browser evidence must answer the challenge for this Graphic Asset kind',
					'invalid-ingestion-input',
				);
			}
			const confirmed = await catalogueRequest(
				() => catalogue.updateIngestionOperation(
					changedOperation(operation, {
						stage: 'validating',
						browserDecodeEvidence: input.evidence,
						failure: undefined,
					}),
					operation.updatedAt,
				),
				'Browser validation evidence could not be recorded',
			);
			return await continueGraphicsIngestion(confirmed);
		},
		async confirmFontBrowserEvidence(input) {
			if (input.evidence.outcome !== 'font-loaded' && input.evidence.outcome !== 'font-rejected') {
				throw new GraphicsAssetLibraryError(
					'Font browser challenge evidence is required',
					'invalid-ingestion-input',
				);
			}
			return await this.confirmGraphicAssetBrowserEvidence(input);
		},
		async retryGraphicsIngestion(input) {
			const catalogue = requireCatalogue();
			const operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'completed' || operation.stage === 'cancelled')
				return operation;
			if (operation.stage === 'created' || (operation.stage === 'failed' && !operation.failure?.retryable)) {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot retry from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}
			const claimedAt = new Date(Math.max(
				now().getTime(),
				new Date(operation.updatedAt).getTime() + 1,
			)).toISOString();
			const claimed = await catalogueRequest(
				() => catalogue.claimGraphicsIngestion({
					operation,
					claimedAt,
					staleBefore: new Date(
						new Date(claimedAt).getTime() - activeIngestionLeaseMilliseconds,
					).toISOString(),
				}),
				'Graphics ingestion retry could not claim the durable operation',
			);
			if (!claimed) {
				throw new GraphicsAssetLibraryError(
					'Graphics Ingestion Operation is still active and cannot be claimed for retry',
					'ingestion-operation-not-uploadable',
				);
			}
			return await continueGraphicsIngestion(claimed);
		},
		async listGraphicAssets(input) {
			const lifecycleStates = input.lifecycleStates ?? ['active'];
			if (
				lifecycleStates.length === 0
				|| lifecycleStates.some(state => !['active', 'retired', 'trashed'].includes(state))
			) {
				throw new GraphicsAssetLibraryError(
					'At least one valid Graphic Asset lifecycle state is required',
					'invalid-ingestion-input',
				);
			}
			return await catalogueRequest(
				() => requireCatalogue().listGraphicAssets(
					input.search ?? '',
					[...new Set(lifecycleStates)],
				),
				'Graphic Asset discovery is temporarily unavailable',
			);
		},
		async retireGraphicAsset(input) {
			const transition = await catalogueRequest(
				() => requireCatalogue().retireGraphicAsset({
					assetId: input.assetId,
					updatedAt: timestamp(),
				}),
				'Graphic Asset retirement could not be completed',
			);
			if (transition.outcome === 'not-found') {
				throw new GraphicsAssetLibraryError(
					'Graphic Asset not found',
					'ingestion-operation-not-found',
				);
			}
			if (transition.outcome !== 'updated') {
				throw new GraphicsAssetLibraryError(
					'Only an active Graphic Asset can be retired',
					'graphic-asset-lifecycle-action-not-allowed',
				);
			}
			return { outcome: 'retired', asset: transition.asset };
		},
		async trashGraphicAsset(input) {
			const trashedAt = now();
			const transition = await catalogueRequest(
				() => requireCatalogue().trashGraphicAsset({
					assetId: input.assetId,
					trashedAt: trashedAt.toISOString(),
					recoverableUntil: new Date(
						trashedAt.getTime() + trashRecoveryMilliseconds,
					).toISOString(),
				}),
				'Graphic Asset Trash transition could not be completed',
			);
			if (transition.outcome === 'not-found') {
				throw new GraphicsAssetLibraryError(
					'Graphic Asset not found',
					'ingestion-operation-not-found',
				);
			}
			if (transition.outcome === 'in-use')
				return transition;
			if (transition.outcome !== 'updated') {
				throw new GraphicsAssetLibraryError(
					'Only an active or Retired Graphic Asset can enter Trash',
					'graphic-asset-lifecycle-action-not-allowed',
				);
			}
			await recordPruningTransition(input.assetId, 'frozen');
			return { outcome: 'trashed', asset: transition.asset };
		},
		async restoreGraphicAsset(input) {
			const transition = await catalogueRequest(
				() => requireCatalogue().restoreGraphicAsset({
					assetId: input.assetId,
					restoredAt: timestamp(),
				}),
				'Graphic Asset restoration could not be completed',
			);
			if (transition.outcome === 'not-found') {
				throw new GraphicsAssetLibraryError(
					'Graphic Asset not found',
					'ingestion-operation-not-found',
				);
			}
			if (transition.outcome !== 'updated') {
				throw new GraphicsAssetLibraryError(
					'Graphic Asset cannot be restored from its current lifecycle state or its recovery window has ended',
					'graphic-asset-lifecycle-action-not-allowed',
				);
			}
			await recordPruningTransition(input.assetId, 'resumed');
			return { outcome: 'restored', asset: transition.asset };
		},
		async updateGraphicAsset(input) {
			const name = input.name.trim();
			if (!name || name.length > 200) {
				throw new GraphicsAssetLibraryError(
					'Graphic Asset name must be between 1 and 200 characters',
					'invalid-ingestion-input',
				);
			}
			if (
				input.eventIds.some(eventId => !Number.isSafeInteger(eventId) || eventId <= 0)
			) {
				throw new GraphicsAssetLibraryError(
					'Event identities must be positive integers',
					'invalid-ingestion-input',
				);
			}
			const updated = await catalogueRequest(
				() => requireCatalogue().updateGraphicAsset({
					assetId: input.assetId,
					name,
					eventIds: [...new Set(input.eventIds)].sort((left, right) => left - right),
					updatedAt: timestamp(),
				}),
				'Graphic Asset metadata could not be updated',
			);
			if (!updated)
				throw new GraphicsAssetLibraryError('Graphic Asset not found', 'ingestion-operation-not-found');
			return updated;
		},
		async listGraphicAssetUsage(input) {
			return await catalogueRequest(
				() => requireCatalogue().listGraphicAssetUsage(input.assetId),
				'Graphic Asset usage is temporarily unavailable',
			);
		},
		async inspectGraphicAssetRevision(input) {
			const content = await catalogueRequest(
				() => requireCatalogue().findRevisionContent(input),
				'Graphic Asset Revision lookup is temporarily unavailable',
			);
			if (!content)
				return { outcome: 'missing' };
			const observation = await observeCanonicalContent(content);
			if (observation.outcome !== 'available') {
				if (observation.disagreement)
					await observeCanonicalDisagreement(input);
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				lifecycleState: content.lifecycleState,
				kind: content.kind,
			};
		},
		async inspectGraphicAssetRevisionContent(input) {
			const content = await catalogueRequest(
				() => requireCatalogue().findRevisionContent(input),
				'Graphic Asset Revision lookup is temporarily unavailable',
			);
			if (!content)
				return { outcome: 'missing' };
			const observation = await observeCanonicalContent(content);
			if (observation.outcome !== 'available') {
				if (observation.disagreement)
					await observeCanonicalDisagreement(input);
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				byteLength: content.byteLength,
				contentType: content.canonicalMime,
			};
		},
		async resolveGraphicAssetRevision(input) {
			const content = await catalogueRequest(
				() => requireCatalogue().findRevisionContent(input),
				'Graphic Asset Revision lookup is temporarily unavailable',
			);
			if (!content)
				return { outcome: 'missing' };
			const result = await readCanonicalContent(content, input.range);
			if (result.outcome !== 'available') {
				if (result.disagreement)
					await observeCanonicalDisagreement(input);
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				body: result.body,
				byteLength: result.byteLength,
				contentType: content.canonicalMime,
			};
		},
		async resolveGraphicAssetThumbnail(input) {
			const content = await catalogueRequest(
				() => requireCatalogue().findThumbnailContent(input.assetId),
				'Graphic Asset preview lookup is temporarily unavailable',
			);
			// No Graphics Derivative recorded at all is genuinely missing. Bytes the
			// catalogue does expect but the store cannot produce are a retryable
			// operational failure, not an absent preview: reporting those as missing
			// would tell a caller there is nothing to show when there is.
			if (!content)
				return { outcome: 'missing' };
			const result = await readCanonicalContent(content);
			if (result.outcome !== 'available') {
				if (result.disagreement)
					await observeCanonicalDisagreement({ digest: content.digest });
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				body: result.body,
				byteLength: result.byteLength,
				contentType: 'image/png',
			};
		},
		async exportTemplatePackage(input) {
			const checkedAt = timestamp();
			const identity = input.template.identity.trim();
			const name = input.template.name.trim();
			if (!identity || !name || name.length > 200) {
				throw new GraphicsAssetLibraryError(
					'A Template Package requires one Template identity and a name of 1 to 200 characters',
					'invalid-ingestion-input',
				);
			}

			const document = inspectTemplateDocument(input.template.document);
			const requirements = groupTemplatePackageRequirements(input.assets);
			const capabilities = inspectTemplatePackageCapabilities(input.capabilities ?? []);
			const issues: TemplatePackageExportIssue[] = [
				...document.issues,
				...undeclaredReferenceIssues(document.references, input.assets),
				...requirements.issues,
				...capabilities.issues,
			];

			// Every requirement resolves before anything is packaged, so one report
			// carries all blocking problems together rather than the first one found.
			const revisions: ResolvedPackagedRevision[] = [];
			for (const requirement of requirements.grouped) {
				const content = await catalogueRequest(
					() => requireCatalogue().findRevisionContent(requirement.reference),
					'Graphic Asset Revision lookup is temporarily unavailable',
				);
				if (!content) {
					issues.push(templatePackageExportIssue('missing-graphic-asset-reference', {
						slot: requirement.slots[0],
						message: 'The Template requires a Graphic Asset Revision that does not exist',
					}));
					continue;
				}
				if (requirement.expectedKind && requirement.expectedKind !== content.kind) {
					issues.push(templatePackageExportIssue('unexpected-graphic-asset-kind', {
						slot: requirement.slots[0],
						message: `The Template slot requires a ${requirement.expectedKind} but its revision is a ${content.kind}`,
					}));
					continue;
				}
				// Export asks the byte store rather than trusting the catalogue's
				// advisory availability flag, because a package must contain the
				// bytes that exist now. A disagreement it finds is fed straight back
				// into reconciliation so the incident is not lost with the report.
				const observation = await observeCanonicalContent(content);
				if (observation.outcome !== 'available') {
					if (observation.disagreement)
						await observeCanonicalDisagreement(requirement.reference);
					issues.push(templatePackageExportIssue('unavailable-graphic-asset-content', {
						slot: requirement.slots[0],
						message: 'The exact Graphic Asset Revision exists but its content is unavailable',
					}));
					continue;
				}
				revisions.push({
					reference: requirement.reference,
					name: content.name,
					kind: content.kind,
					revisionNumber: content.revisionNumber,
					digest: content.digest,
					byteLength: content.byteLength,
					canonicalMime: content.canonicalMime,
					facts: content.facts,
					compatibilityProfile: content.compatibilityProfile,
					requiredBy: requirement.slots,
				});
			}

			function rejected(
				reportIssues: readonly TemplatePackageExportIssue[],
				observed: TemplatePackageExportReport['observed'],
			): TemplatePackageExportOutcome {
				return {
					outcome: 'rejected',
					report: {
						packageKind: input.packageKind,
						templateIdentity: identity,
						checkedAt,
						issues: [...reportIssues].sort((left, right) =>
							(left.slot ?? '').localeCompare(right.slot ?? '')
							|| left.code.localeCompare(right.code),
						),
						limits: TEMPLATE_PACKAGE_LIMITS,
						observed,
					},
				};
			}

			// The envelope is measured even when a requirement already failed, so one
			// report carries resolution and limit problems together rather than
			// making an author fix a reference only to discover the package was
			// always too large. Totals cover the revisions that did resolve, so a
			// limit reported here is always real; an unresolvable revision's bytes
			// simply cannot be counted, which can only understate a violation.
			const plan = planTemplatePackage({
				packageKind: input.packageKind,
				template: { identity, name, document: input.template.document },
				revisions,
				capabilities: capabilities.declarations,
				createdAt: checkedAt,
				archiveByteLength: storedZipArchiveByteLength,
			});
			// Limits are measured before a byte is written, so a package that would
			// exceed the envelope never produces a partial archive.
			if (issues.length > 0 || plan.issues.length > 0)
				return rejected([...issues, ...plan.issues], plan.totals);

			return {
				outcome: 'exported',
				package: {
					packageKind: input.packageKind,
					fileName: templatePackageFileName(input.packageKind, name),
					mediaType: TEMPLATE_PACKAGE_ARTIFACTS[input.packageKind].mediaType,
					manifest: plan.manifest,
					archiveByteLength: plan.totals.archiveByteLength,
					open: () => createStoredZipArchive([
						{
							name: TEMPLATE_PACKAGE_MANIFEST_ENTRY,
							byteLength: plan.manifestBytes.byteLength,
							open: async () => readableBytes(plan.manifestBytes),
						},
						{
							name: TEMPLATE_PACKAGE_TEMPLATE_ENTRY,
							byteLength: plan.templateBytes.byteLength,
							open: async () => readableBytes(plan.templateBytes),
						},
						...plan.contents.map(content => ({
							name: content.entry,
							byteLength: content.byteLength,
							// Bytes are fetched only when the archive reaches this entry, so
							// no complete asset is ever held in Worker memory.
							open: async () => {
								const result = await readCanonicalContent(content);
								if (result.outcome !== 'available') {
									// Content that resolved during the report and then failed
									// mid-stream is the sharpest integrity observation the
									// library gets; it must not vanish with the aborted
									// download.
									if (result.disagreement)
										await observeCanonicalDisagreement({ digest: content.digest });
									throw new GraphicsAssetLibraryError(
										'Graphic Asset content became unavailable while the Template Package was streaming',
										'graphics-asset-library-unavailable',
									);
								}
								return result.body;
							},
						})),
					]),
				},
			};
		},
		async runGraphicsRetention() {
			return await catalogueRequest(
				() => requireRetention().run(),
				'Graphics Asset retention could not complete because the catalogue is unavailable',
			);
		},
		async purgeTrashedGraphicAsset(input) {
			if (input.confirmation !== 'purge-now' || !input.actor.trim()) {
				throw new GraphicsAssetLibraryError(
					'Early purge requires an explicit confirmation and an administrator identity',
					'invalid-ingestion-input',
				);
			}
			const outcome = await catalogueRequest(
				() => requireRetention().purge({
					assetId: input.assetId,
					actor: input.actor.trim(),
				}),
				'Graphic Asset purge could not be completed',
			);
			if (outcome.outcome === 'not-found') {
				throw new GraphicsAssetLibraryError(
					'Graphic Asset not found',
					'ingestion-operation-not-found',
				);
			}
			if (outcome.outcome === 'not-trashed') {
				throw new GraphicsAssetLibraryError(
					'Only a Trashed Graphic Asset can be purged',
					'graphic-asset-lifecycle-action-not-allowed',
				);
			}
			if (outcome.outcome === 'blocked') {
				return {
					outcome: 'in-use',
					usage: await catalogueRequest(
						() => requireCatalogue().listGraphicAssetUsage(input.assetId),
						'Graphic Asset usage is temporarily unavailable',
					),
				};
			}
			return {
				outcome: 'purged',
				assetId: input.assetId,
				purgedAt: outcome.purgedAt,
				revisionCount: outcome.revisionCount,
				referenceCount: outcome.referenceCount,
				reason: 'early-purge',
			};
		},
		async listGraphicsAssetEvidence(input = {}) {
			return await catalogueRequest(
				() => requireRetention().listEvidence(input),
				'Graphics Asset Evidence is temporarily unavailable',
			);
		},
		async getOperationalQueues() {
			return await catalogueRequest(
				() => requireOperationalQueues().overview(),
				'Graphics Asset Library operational queues are temporarily unavailable',
			);
		},
		async inspectOperationalQueueItem(input) {
			return await catalogueRequest(
				() => requireOperationalQueues().inspect(input),
				'The operational queue item is temporarily unavailable',
			);
		},
		async getRetentionOverview() {
			return await catalogueRequest(
				async () => {
					const retention = requireRetention();
					return await retention.overview(await requireCatalogue().getCapacity());
				},
				'Graphics Asset retention deadlines are temporarily unavailable',
			);
		},
		async inspectGraphicAssetRetention(input) {
			const view = await catalogueRequest(
				() => requireRetention().inspect(input.assetId),
				'Graphic Asset retention deadlines are temporarily unavailable',
			);
			if (!view)
				throw new GraphicsAssetLibraryError('Graphic Asset not found', 'ingestion-operation-not-found');
			return view;
		},
		async runGraphicsReconciliation() {
			return await catalogueRequest(
				() => requireReconciliation().run(),
				'Graphics Asset reconciliation could not complete because the catalogue is unavailable',
			);
		},
		async getReconciliationOverview() {
			return await catalogueRequest(
				() => requireReconciliation().overview(),
				'Graphics Asset reconciliation state is temporarily unavailable',
			);
		},
		async inspectGraphicsDiscrepancy(input) {
			const discrepancy = await catalogueRequest(
				() => requireReconciliation().inspect({ discrepancyId: input.discrepancyId }),
				'Graphics discrepancy evidence is temporarily unavailable',
			);
			if (!discrepancy)
				throw new GraphicsAssetLibraryError('Graphics discrepancy not found', 'ingestion-operation-not-found');
			return discrepancy;
		},
		async recheckGraphicsDiscrepancy(input) {
			return requireDiscrepancyOutcome(await catalogueRequest(
				() => requireReconciliation().recheck({
					discrepancyId: input.discrepancyId,
					actor: requiredActor(input.actor),
				}),
				'Graphics discrepancy could not be rechecked',
			));
		},
		async repairUnavailableGraphicAssetContent(input) {
			return requireDiscrepancyOutcome(await catalogueRequest(
				() => requireReconciliation().repair({
					discrepancyId: input.discrepancyId,
					actor: requiredActor(input.actor),
					bytes: input.bytes,
				}),
				'Graphic Asset Content repair could not be completed',
			));
		},
		async verifyStoredGraphicAssetContent(input) {
			return requireDiscrepancyOutcome(await catalogueRequest(
				() => requireReconciliation().verifyStoredBytes({
					discrepancyId: input.discrepancyId,
					actor: requiredActor(input.actor),
				}),
				'Stored Graphic Asset Content could not be verified',
			));
		},
		async regenerateGraphicsDerivative(input) {
			return requireDiscrepancyOutcome(await catalogueRequest(
				() => requireReconciliation().regenerateDerivative({
					discrepancyId: input.discrepancyId,
					actor: requiredActor(input.actor),
				}),
				'Graphics Derivative could not be regenerated',
			));
		},
	};
}

export type {
	GraphicAsset,
	GraphicAssetId,
	GraphicAssetReferenceStatus,
	GraphicAssetRevisionId,
	GraphicAssetUsage,
	GraphicAssetValidationReport,
	GraphicsAssetLibraryComponentHealth,
	GraphicsAssetLibraryHealth,
	GraphicsDerivativeId,
	GraphicsDuplicateContentPolicy,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';

import type {
	SILENT_VIDEO_COMPATIBILITY_PROFILE,
	STATIC_FONT_COMPATIBILITY_PROFILE,
	STILL_IMAGE_COMPATIBILITY_PROFILE,
} from '../utils/graphicsAssetCompatibility';
import type {
	GRAPHICS_DISCREPANCY_ACTIONS,
	GRAPHICS_DISCREPANCY_KINDS,
	GRAPHICS_DISCREPANCY_REASON_CODES,
	GRAPHICS_DISCREPANCY_RESOLUTIONS,
	GRAPHICS_DISCREPANCY_STATES,
	GRAPHICS_RECONCILIATION_EVIDENCE_CATEGORIES,
	GRAPHICS_REPAIR_REJECTION_CODES,
} from '../utils/graphicsAssetReconciliation';
import type {
	GRAPHIC_ASSET_PURGE_REASONS,
	GRAPHICS_RETENTION_EVIDENCE_CATEGORIES,
} from '../utils/graphicsAssetRetention';
import type {
	GraphicsOperationalQueueId,
	GraphicsQueueAction,
} from '../utils/graphicsOperationalQueues';
import type {
	GraphicsIngestionAttentionState,
	GraphicsRecentOutcomeGroup,
	GraphicsStorageHealthAlertCode,
	GraphicsStorageHealthAlertSeverity,
} from '../utils/graphicsOperationsCockpit';
import type { TemplatePackagePreflightReport } from './templatePackage';

declare const graphicAssetIdBrand: unique symbol;
declare const graphicAssetRevisionIdBrand: unique symbol;
declare const graphicsDerivativeIdBrand: unique symbol;
declare const graphicsIngestionOperationIdBrand: unique symbol;
declare const graphicsIngestionPartIdentityBrand: unique symbol;
declare const installedGraphicsTemplateIdBrand: unique symbol;

export const DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES = 100 * 1024 * 1024 * 1024;
export const DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES = 10 * 1024 * 1024 * 1024;
export const GRAPHIC_ASSET_LIFECYCLE_ACTIONS = ['retire', 'trash', 'restore'] as const;
/**
 * The shelves a Graphic Asset can sit on, as a value rather than only a type.
 * The API's lifecycle filter is a caller-supplied string that has to be checked
 * against them at runtime, and until #309 every place that checked wrote the
 * three names out again.
 */
export const GRAPHIC_ASSET_LIFECYCLE_STATES = ['active', 'retired', 'trashed'] as const;

export type GraphicAssetId = string & {
	readonly [graphicAssetIdBrand]: 'GraphicAssetId';
};

export type GraphicAssetRevisionId = string & {
	readonly [graphicAssetRevisionIdBrand]: 'GraphicAssetRevisionId';
};

export type GraphicsDerivativeId = string & {
	readonly [graphicsDerivativeIdBrand]: 'GraphicsDerivativeId';
};

export type GraphicsIngestionOperationId = string & {
	readonly [graphicsIngestionOperationIdBrand]: 'GraphicsIngestionOperationId';
};

export type GraphicsIngestionPartIdentity = string & {
	readonly [graphicsIngestionPartIdentityBrand]: 'GraphicsIngestionPartIdentity';
};

export type InstalledGraphicsTemplateId = string & {
	readonly [installedGraphicsTemplateIdBrand]: 'InstalledGraphicsTemplateId';
};

export interface GraphicAssetReference {
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
}

export interface GraphicAssetUsage {
	id: string;
	reference: GraphicAssetReference;
	owner: {
		kind: string;
		id: string;
		name?: string;
		slot: string;
		eventId?: number;
	};
}

export type GraphicAssetLifecycleState = typeof GRAPHIC_ASSET_LIFECYCLE_STATES[number];
export type GraphicAssetLifecycleAction = typeof GRAPHIC_ASSET_LIFECYCLE_ACTIONS[number];

export type GraphicAssetLifecycle
	= | {
		state: 'active' | 'retired';
	}
	| {
		state: 'trashed';
		priorState: 'active' | 'retired';
		trashedAt: string;
		recoverableUntil: string;
	};

export type GraphicAssetLifecycleActionOutcome
	= | {
		outcome: 'retired' | 'restored' | 'trashed';
		asset: GraphicAsset;
	}
	| {
		outcome: 'in-use';
		usage: GraphicAssetUsage[];
	};

export type GraphicAssetReferenceStatus
	= | {
		outcome: 'available';
		lifecycleState: 'active' | 'retired' | 'trashed';
		kind: 'image' | 'silent-video' | 'font';
		/**
		 * The pinned revision's own target compatibility, for a silent video.
		 *
		 * Reported here because whatever records a Graphic Asset Reference has to
		 * record this fact alongside it: the reference index checks a silent-video
		 * reference against the revision's own, and nothing downstream of the
		 * reference — no render model, no Live Session — can go and ask the library
		 * for it. Absent for an image or a font, which have none.
		 */
		targetCompatibility?: 'all-supported' | 'chromium-transparency';
	}
	| { outcome: 'missing' }
	| { outcome: 'unavailable'; retryable: true };

export type GraphicsDuplicateContentPolicy = 'reuse' | 'create-separate';

/**
 * Where a Graphics Ingestion Operation's bytes come from. An approved remote
 * copy is a one-time transfer: the published Graphic Asset keeps no hotlink,
 * refresh schedule, or dependency on the remote host.
 */
export type GraphicsIngestionSource
	= | 'local-upload'
		| 'remote-copy'
		| 'replacement'
		| 'template-package';

export interface GraphicAssetFontBrowserChallenge {
	digest: string;
	codePoints: number[];
}

export interface GraphicAssetFontGlyphProof {
	codePoint: number;
	exactWithSansDigest: string;
	exactWithMonoDigest: string;
	sansFallbackDigest: string;
	monoFallbackDigest: string;
}

export type GraphicAssetBrowserDecodeEvidence
	= | {
		outcome: 'decoded';
		sourceDigest: string;
		width: number;
		height: number;
	}
	| {
		outcome: 'rejected';
		sourceDigest: string;
	}
	| {
		outcome: 'font-loaded';
		sourceDigest: string;
		challengeDigest: string;
		glyphProofs: GraphicAssetFontGlyphProof[];
	}
	| {
		outcome: 'font-rejected';
		sourceDigest: string;
		challengeDigest: string;
		stage: 'load' | 'render';
	};

export type GraphicAssetBrowserValidationEvidence
	= GraphicAssetBrowserDecodeEvidence;

export interface GraphicAssetSourceDeclarations {
	sourceFileName?: string;
	declaredMime?: string;
	browserDecodeEvidence?: GraphicAssetBrowserValidationEvidence;
}

export type GraphicsIngestionStage
	= | 'created'
		| 'transferring'
		| 'hashing'
		| 'validating'
		| 'generating-derivatives'
		| 'awaiting-confirmation'
		/**
		 * A Template Package whose preflight succeeded and whose proposal the
		 * author accepted, holding its verified staged result until installation
		 * publishes it. Nothing it proposes is discoverable or addressable here.
		 */
		| 'awaiting-installation'
		| 'publishing'
		| 'completed'
		| 'failed'
		| 'cancelled';

export interface GraphicAssetImageFacts {
	kind: 'image';
	format: 'png' | 'jpeg' | 'webp';
	canonicalMime: 'image/png' | 'image/jpeg' | 'image/webp';
	byteLength: number;
	sha256: string;
	width: number;
	height: number;
	pixelCount: number;
	frameCount: 1;
	bitDepth: 8;
	colorSpace: 'srgb';
	colorModel: 'grayscale' | 'grayscale-alpha' | 'indexed' | 'rgb' | 'rgba';
	hasAlpha: boolean;
	orientation: 'normal';
	browserDecodable?: true;
}

export interface GraphicAssetFontFacts {
	kind: 'font';
	format: 'woff2' | 'woff' | 'ttf' | 'otf';
	canonicalMime: 'font/woff2' | 'font/woff' | 'font/ttf' | 'font/otf';
	byteLength: number;
	expandedByteLength: number;
	sha256: string;
	family: string;
	subfamily: string;
	postscriptName: string;
	weight: number;
	style: 'normal' | 'italic';
	glyphCount: number;
	unicodeCodePoints: number[];
	unitsPerEm: number;
	ascent: number;
	descent: number;
	lineGap: number;
	browserChallenge: GraphicAssetFontBrowserChallenge;
	browserLoadable?: true;
	representativeGlyphsRendered?: true;
}

export interface GraphicAssetSilentVideoFacts {
	kind: 'silent-video';
	format: 'mp4' | 'webm';
	codec: 'h264' | 'vp9';
	canonicalMime: 'video/mp4' | 'video/webm';
	byteLength: number;
	sha256: string;
	width: number;
	height: number;
	durationSeconds: number;
	frameRate: number;
	frameCount: number;
	bitDepth: 8;
	colorSpace: 'sdr';
	chromaSubsampling: '4:2:0';
	hasAlpha: boolean;
	fastStart: boolean | null;
	seekable: true;
	posterTimeSeconds: number;
	targetCompatibility: 'all-supported' | 'chromium-transparency';
	browserPlayable?: true;
	chromiumTransparencyPlayback?: true;
}

export type GraphicAssetCanonicalMime
	= GraphicAssetImageFacts['canonicalMime']
		| GraphicAssetSilentVideoFacts['canonicalMime']
		| GraphicAssetFontFacts['canonicalMime'];

export interface GraphicAssetValidationIssue {
	severity: 'error';
	code:
		| 'invalid-png-signature'
		| 'malformed-png'
		| 'unsupported-png-animation'
		| 'unsupported-png-colour'
		| 'unsupported-png-profile'
		| 'image-dimensions-exceeded'
		| 'image-pixels-exceeded'
		| 'incomplete-png-frame'
		| 'unsupported-image-format'
		| 'invalid-jpeg-signature'
		| 'malformed-jpeg'
		| 'unsupported-jpeg-colour'
		| 'unsupported-jpeg-profile'
		| 'unsupported-image-orientation'
		| 'incomplete-jpeg-frame'
		| 'invalid-webp-signature'
		| 'malformed-webp'
		| 'unsupported-webp-animation'
		| 'unsupported-webp-profile'
		| 'incomplete-webp-frame'
		| 'conflicting-image-extension'
		| 'conflicting-image-mime'
		| 'browser-image-decode-failed'
		| 'browser-image-decode-mismatch'
		| 'unsupported-video-format'
		| 'conflicting-video-extension'
		| 'conflicting-video-mime'
		| 'video-source-size-exceeded'
		| 'malformed-video'
		| 'unsupported-video-codec'
		| 'unsupported-video-tracks'
		| 'unsupported-video-encryption'
		| 'unsupported-video-transform'
		| 'unsupported-video-profile'
		| 'video-dimensions-exceeded'
		| 'video-duration-exceeded'
		| 'video-frame-rate-exceeded'
		| 'malformed-video-timeline'
		| 'video-index-incomplete'
		| 'mp4-fast-start-required'
		| 'browser-video-playback-failed'
		| 'browser-video-evidence-mismatch'
		| 'vp9-alpha-chromium-required'
		| 'unsupported-font-format'
		| 'conflicting-font-extension'
		| 'conflicting-font-mime'
		| 'font-source-size-exceeded'
		| 'font-expanded-size-exceeded'
		| 'font-collection-not-supported'
		| 'font-variable-not-supported'
		| 'font-bitmap-not-supported'
		| 'font-colour-glyphs-not-supported'
		| 'font-type1-not-supported'
		| 'font-svg-not-supported'
		| 'font-required-table-missing'
		| 'font-table-invalid'
		| 'font-checksum-invalid'
		| 'font-metrics-invalid'
		| 'font-glyphs-invalid'
		| 'font-unicode-cmap-required'
		| 'font-cmap-language-invalid'
		| 'font-name-invalid'
		| 'browser-font-load-failed'
		| 'browser-font-render-failed'
		| 'browser-font-evidence-mismatch'
		| 'remote-source-not-https'
		| 'remote-source-credentials-present'
		| 'remote-source-destination-not-public'
		| 'remote-source-redirect-limit-exceeded'
		| 'remote-source-not-retrievable'
		| 'remote-source-length-exceeded'
		| 'remote-source-length-mismatch';
	message: string;
}

export type GraphicAssetValidationReport
	= {
		outcome: 'accepted';
		compatibilityProfile: typeof STILL_IMAGE_COMPATIBILITY_PROFILE;
		issues: [];
		facts: GraphicAssetImageFacts;
	}
	| {
		outcome: 'rejected';
		compatibilityProfile:
			| typeof STILL_IMAGE_COMPATIBILITY_PROFILE
			| typeof SILENT_VIDEO_COMPATIBILITY_PROFILE
			| typeof STATIC_FONT_COMPATIBILITY_PROFILE;
		issues: GraphicAssetValidationIssue[];
	}
	| {
		outcome: 'accepted';
		compatibilityProfile: typeof STATIC_FONT_COMPATIBILITY_PROFILE;
		issues: [];
		facts: GraphicAssetFontFacts;
	}
	| {
		outcome: 'accepted';
		compatibilityProfile: typeof SILENT_VIDEO_COMPATIBILITY_PROFILE;
		issues: [];
		facts: GraphicAssetSilentVideoFacts;
	};

export interface GraphicsIngestionFailure {
	code:
		| 'ingestion-cancelled'
		| 'staged-input-expired'
		| 'staging-unavailable'
		| 'staging-capacity-exhausted'
		| 'canonical-capacity-exhausted'
		| 'canonical-store-unavailable'
		| 'validation-runtime-unavailable'
		| 'catalogue-publication-failed'
		| 'ingestion-processing-failed'
		| 'validation-failed'
		| 'template-package-mapping-unavailable'
		| 'remote-source-rejected';
	retryable: boolean;
	message: string;
}

/**
 * What one packaged identity actually became locally.
 *
 * The compatibility profile is the installed revision's own, not the packaged
 * bytes': an exact-origin reuse keeps whatever the local revision already
 * earned, so a caller reading this learns the truth about the revision its
 * Template now pins rather than what the sender happened to ship.
 */
export interface InstalledTemplatePackageAsset {
	packagedId: string;
	/** Whether this identity created a local Graphic Asset or reused one. */
	outcome: 'created' | 'reused';
	basis: 'exact-origin' | 'related-origin-revision' | 'shared-content-digest' | 'new-content';
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	name: string;
	kind: 'image' | 'silent-video' | 'font';
	compatibilityProfile: string;
}

/** What one complete Template Package installation published. */
export interface TemplatePackageInstallationResult {
	templateId: InstalledGraphicsTemplateId;
	templateKind: InstalledGraphicsTemplateKind;
	templateName: string;
	/** Every packaged identity, whichever way it resolved locally. */
	assets: InstalledTemplatePackageAsset[];
}

export const INSTALLED_GRAPHICS_TEMPLATE_KINDS = [
	'broadcast-graphic',
	'feature-match-layout',
] as const;

export type InstalledGraphicsTemplateKind = typeof INSTALLED_GRAPHICS_TEMPLATE_KINDS[number];

/**
 * One graphics Template a Template Package installed into this installation.
 *
 * Its document is an independent local copy whose Graphic Asset References are
 * already rewritten to exact local identities and revisions, so it is valid the
 * instant it becomes visible. It records the source Template identity as
 * provenance only: there is no link back to the installation that exported it.
 */
export interface InstalledGraphicsTemplate {
	id: InstalledGraphicsTemplateId;
	kind: InstalledGraphicsTemplateKind;
	name: string;
	revisionNumber: number;
	document: unknown;
	sourceTemplateIdentity: string;
	/**
	 * The revision the source Template was exported at, where the package declared
	 * one. Provenance completing the identity, never an update link.
	 */
	sourceTemplateRevision?: number;
	installedByOperationId: GraphicsIngestionOperationId;
	eventId?: number;
	references: {
		ownerSlot: string;
		reference: GraphicAssetReference;
	}[];
	installedAt: string;
}

/**
 * One Installed Graphics Template as a library listing reads it.
 *
 * Its Graphic Asset References are deliberately absent: browsing a library of
 * designs is choosing between them, and which exact revisions each one pins is a
 * question about one design rather than about the list. The document stays, because
 * what an author chooses between — how many Graphic Items, how many Graphic Inputs —
 * is derived from it.
 */
export type InstalledGraphicsTemplateSummary = Omit<InstalledGraphicsTemplate, 'references'>;

export type GraphicsIngestionCapacityOutcome
	= | {
		outcome: 'canonical-growth-reserved';
		growthBytes: number;
		availableBytes: number;
	}
	| {
		outcome: 'no-canonical-growth';
		growthBytes: 0;
		availableBytes: number;
	}
	| {
		outcome: 'canonical-capacity-blocked';
		growthBytes: number;
		availableBytes: number;
	};

export interface GraphicsIngestionOperation extends GraphicAssetSourceDeclarations {
	id: GraphicsIngestionOperationId;
	idempotencyKey: string;
	source: GraphicsIngestionSource;
	initiatedBy: string;
	name: string;
	targetAssetId?: GraphicAssetId;
	defaultEventId?: number;
	duplicateContentPolicy: GraphicsDuplicateContentPolicy;
	declaredByteLength: number;
	transferredByteLength: number;
	transfer?: {
		method: 'multipart';
		partByteLength: number;
		maximumConcurrentParts: number;
		maximumPartAttempts: number;
		partCount: number;
		cleanupPending: boolean;
		completedParts: {
			partNumber: number;
			partIdentity: GraphicsIngestionPartIdentity;
			byteLength: number;
		}[];
	};
	stage: GraphicsIngestionStage;
	canonicalCapacityOutcome?: GraphicsIngestionCapacityOutcome;
	report?: GraphicAssetValidationReport;
	/**
	 * The immutable Template Package preflight result, present only on a
	 * `template-package` operation that has produced one. It travels with the
	 * operation so one read answers what was proposed, what it would cost, and
	 * whether the author still has something to confirm.
	 */
	templatePackagePreflight?: TemplatePackagePreflightReport;
	result?: {
		outcome: 'published' | 'reused' | 'revision-created' | 'replacement-noop';
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	};
	/**
	 * The terminal result of one Template Package installation, present only on a
	 * `template-package` operation that published one.
	 *
	 * A package's result is meaningful only as the complete set it published
	 * together — one Template and every local revision its rewritten references
	 * pin — so it is recorded beside the single-revision result the other
	 * ingestion paths produce rather than pretending to be one.
	 */
	templatePackageInstallation?: TemplatePackageInstallationResult;
	failure?: GraphicsIngestionFailure;
	createdAt: string;
	updatedAt: string;
}

export interface GraphicAsset {
	id: GraphicAssetId;
	name: string;
	kind: 'image' | 'silent-video' | 'font';
	revisionId: GraphicAssetRevisionId;
	revisionNumber: number;
	revisions: {
		id: GraphicAssetRevisionId;
		revisionNumber: number;
		facts: GraphicAssetImageFacts | GraphicAssetSilentVideoFacts | GraphicAssetFontFacts;
	}[];
	facts: GraphicAssetImageFacts | GraphicAssetSilentVideoFacts | GraphicAssetFontFacts;
	eventIds: number[];
	lifecycle: GraphicAssetLifecycle;
	operation: GraphicsIngestionOperation;
}

export type GraphicsAssetLibraryComponentHealth
	= | { status: 'healthy' }
		| {
			status: 'unavailable';
			reason: {
				code: 'catalogue-unavailable' | 'byte-store-unavailable';
				retryable: true;
			};
		};

export interface GraphicsAssetLibraryHealth {
	status: 'healthy' | 'degraded';
	checkedAt: string;
	catalogue: GraphicsAssetLibraryComponentHealth;
	byteStores: {
		staging: GraphicsAssetLibraryComponentHealth;
		canonical: GraphicsAssetLibraryComponentHealth;
	};
}

/**
 * Why a Graphic Asset Revision is retained, and when that retention ends.
 * Referenced and latest revisions have no deadline at all.
 */
export type GraphicAssetRevisionRetention
	= | { policy: 'latest-revision' }
		| { policy: 'referenced'; referenceCount: number }
		| {
			policy: 'unreferenced-superseded';
			unreferencedSince: string;
			pruneAfter: string;
		}
		| {
			policy: 'pruning-frozen';
			unreferencedSince: string;
			frozenAt: string;
			remainingMilliseconds: number;
		};

export type GraphicAssetPurgeReason = typeof GRAPHIC_ASSET_PURGE_REASONS[number];

export type GraphicsRetentionEvidenceCategory
	= typeof GRAPHICS_RETENTION_EVIDENCE_CATEGORIES[number];

export type GraphicsReconciliationEvidenceCategory
	= typeof GRAPHICS_RECONCILIATION_EVIDENCE_CATEGORIES[number];

/** Every category the one shared Evidence ledger accepts. */
export type GraphicsAssetEvidenceCategory
	= | GraphicsRetentionEvidenceCategory
		| GraphicsReconciliationEvidenceCategory;

export type GraphicsAssetEvidenceSubjectKind
	= | 'graphics-ingestion-operation'
		| 'graphic-asset'
		| 'graphic-asset-revision'
		| 'graphic-asset-content'
		| 'graphics-derivative'
		| 'graphics-discrepancy';

/**
 * One durable administrator-facing record of an automated lifecycle decision.
 * Subjects are opaque domain identities: evidence never carries object keys,
 * digests, filenames, capability secrets, or deleted bytes.
 */
export interface GraphicsAssetEvidenceEntry {
	id: string;
	recordedAt: string;
	category: GraphicsAssetEvidenceCategory;
	actor: string;
	subject: {
		kind: GraphicsAssetEvidenceSubjectKind;
		id: string;
	};
	outcome: string;
	reason: string;
	correlationId: string;
	detail: {
		/** References the proof found. Zero is the proof that reclamation was safe. */
		referenceCount?: number;
		revisionCount?: number;
		bytesFreed?: number;
		bytesReserved?: number;
		deadline?: string;
		remainingMilliseconds?: number;
		/**
		 * The named states either side of the change, where the subject has them.
		 * The category says what happened; this says what it happened to, so a
		 * reader does not have to know which category implies which prior state.
		 */
		transition?: { from: string; to: string };
		/** The ingestion operation an entry belongs to, when it is not the subject. */
		operationId?: string;
		canonicalUsedBytes?: number;
		canonicalLimitBytes?: number;
		canonicalPressure?: GraphicsCanonicalCapacityPressure;
		/** Which disagreement an entry explains, for reconciliation categories. */
		discrepancyKind?: GraphicsDiscrepancyKind;
		discrepancyId?: string;
		reasonCode?: GraphicsDiscrepancyReasonCode;
		rejectionCode?: GraphicsRepairRejectionCode;
		/** How many pinned revisions the discrepancy affected; all stay intact. */
		affectedRevisionCount?: number;
		/** Whether the incident fails closed and is excluded from automatic action. */
		isolated?: boolean;
	};
	/**
	 * When this entry may be removed, or null while its subject is still live.
	 *
	 * The one-year window runs from the subject's terminal cleanup, so an entry
	 * has no expiry until something records that cleanup. Null therefore means
	 * "retained", not "retained forever": every subject reaches a terminal
	 * outcome eventually, and the sweep stamps the whole subject's entries when
	 * it does.
	 */
	expiresAt: string | null;
}

/**
 * One position in the chronological ledger. Paging by offset would re-read
 * everything already skipped and would silently shift under a sweep writing new
 * entries mid-read, so a page is addressed by the last entry it contained.
 */
export interface GraphicsAssetEvidencePosition {
	recordedAt: string;
	id: string;
}

/**
 * What an administrator is asking the Evidence ledger. Every filter narrows;
 * none of them widen, so an unfiltered query is the whole ledger newest first.
 */
export interface GraphicsAssetEvidenceQuery {
	categories?: readonly GraphicsAssetEvidenceCategory[];
	/** Narrows the ledger to one opaque domain subject. */
	subject?: { kind: GraphicsAssetEvidenceSubjectKind; id: string };
	/** The administrator or automated policy that decided. */
	actor?: string;
	/** Everything one sweep or one request decided, however far apart. */
	correlationId?: string;
	recordedFrom?: string;
	recordedUntil?: string;
	cursor?: GraphicsAssetEvidencePosition;
	/** Which side of the cursor to read. Reading starts at the newest end. */
	direction?: 'older' | 'newer';
}

/**
 * Proof that a Graphic Asset identity was purged.
 *
 * A tombstone outlives both the asset and the Evidence explaining its purge, so
 * it is what still answers a provenance question about the identity a year
 * later. It is a record of an absence and never resolves to content: nothing
 * reaches it from a Graphic Asset Reference.
 */
export interface GraphicAssetTombstone {
	assetId: GraphicAssetId;
	purgedAt: string;
	reason: GraphicAssetPurgeReason;
	revisionCount: number;
	/** How many references the purge proof found. A purge only commits at zero. */
	referenceCount: number;
}

/**
 * One page of the ledger, always in newest-first order whichever direction it
 * was read in. A null cursor is the end of the ledger in that direction rather
 * than an empty page, so navigation can stop without a further read.
 */
export interface GraphicsAssetEvidencePage {
	entries: GraphicsAssetEvidenceEntry[];
	older: GraphicsAssetEvidencePosition | null;
	newer: GraphicsAssetEvidencePosition | null;
	/**
	 * The tombstone for the subject asked about, when the question was about one
	 * Graphic Asset and that asset has been purged. It is reported beside the
	 * Evidence because an empty ledger for a purged identity means something
	 * quite different from an empty ledger for one that never existed.
	 */
	tombstone?: GraphicAssetTombstone;
}

export interface GraphicsRetentionSweepResult {
	correlationId: string;
	startedAt: string;
	completedAt: string;
	stagedInput: {
		expiredIncompleteTransfers: number;
		expiredCompletedInput: number;
	};
	/** Stranded releases from earlier sweeps this one finally proved gone (#358). */
	strandedStagedInput: {
		released: number;
	};
	revisions: {
		pruningScheduled: number;
		pruningCancelled: number;
		pruned: number;
	};
	trash: {
		purged: number;
		blockedByReferences: number;
	};
	content: {
		quarantined: number;
		quarantineReleased: number;
		deleted: number;
		bytesReclaimed: number;
	};
	evidence: {
		recorded: number;
		expired: number;
	};
}

export interface GraphicsStagedInputDeadline {
	operationId: GraphicsIngestionOperationId;
	initiatedBy: string;
	stage: GraphicsIngestionStage;
	transferComplete: boolean;
	stagingBytes: number;
	expiresAt: string;
}

export interface GraphicsTrashDeadline {
	assetId: GraphicAssetId;
	name: string;
	trashedAt: string;
	/** Restoration is possible until this instant; final purge happens at it. */
	recoverableUntil: string;
	referenceCount: number;
	revisionCount: number;
}

export interface GraphicsRevisionPruningDeadline {
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	revisionNumber: number;
	retention: GraphicAssetRevisionRetention;
}

/**
 * The Library Workspace view of one Graphic Asset's recovery and cleanup
 * deadlines: its Trash recovery window and every revision's retention policy.
 */
export interface GraphicAssetRetentionView {
	assetId: GraphicAssetId;
	lifecycle: GraphicAssetLifecycle;
	revisions: GraphicsRevisionPruningDeadline[];
}

export interface GraphicsContentQuarantineDeadline {
	id: string;
	byteLength: number;
	origin: 'orphaned-content' | 'abandoned-canonical-write' | 'unexpected-object';
	quarantinedAt: string;
	deleteAfter: string;
}

/**
 * The operational retention view. It states every exact deadline and asserts
 * that storage pressure never shortens a guarantee.
 */
export interface GraphicsRetentionOverview {
	checkedAt: string;
	guarantees: {
		incompleteTransferMilliseconds: number;
		completedInputMilliseconds: number;
		trashRecoveryMilliseconds: number;
		supersededRevisionMilliseconds: number;
		orphanContentQuarantineMilliseconds: number;
		evidenceMilliseconds: number;
	};
	storagePressure: GraphicsCanonicalCapacityPressure;
	guaranteesShortenedUnderPressure: false;
	stagedInput: GraphicsStagedInputDeadline[];
	trashedAssets: GraphicsTrashDeadline[];
	prunableRevisions: GraphicsRevisionPruningDeadline[];
	quarantinedContent: GraphicsContentQuarantineDeadline[];
}

export type GraphicAssetPurgeOutcome
	= | {
		outcome: 'purged';
		assetId: GraphicAssetId;
		purgedAt: string;
		revisionCount: number;
		/** References the fresh proof found across every revision; always 0 when purged. */
		referenceCount: number;
		reason: GraphicAssetPurgeReason;
	}
	| {
		outcome: 'in-use';
		usage: GraphicAssetUsage[];
	};

export type GraphicsDiscrepancyKind = typeof GRAPHICS_DISCREPANCY_KINDS[number];
export type GraphicsDiscrepancyState = typeof GRAPHICS_DISCREPANCY_STATES[number];
export type GraphicsDiscrepancyReasonCode = typeof GRAPHICS_DISCREPANCY_REASON_CODES[number];
export type GraphicsDiscrepancyResolution = typeof GRAPHICS_DISCREPANCY_RESOLUTIONS[number];
export type GraphicsDiscrepancyAction = typeof GRAPHICS_DISCREPANCY_ACTIONS[number];
export type GraphicsRepairRejectionCode = typeof GRAPHICS_REPAIR_REJECTION_CODES[number];

/**
 * One pinned use a discrepancy currently affects. Reconciliation never
 * redirects, rewrites, or clears any of them: they are reported so an
 * administrator can see the blast radius before acting.
 */
export interface GraphicsDiscrepancyUsage {
	assetId: GraphicAssetId;
	assetName: string;
	revisionId: GraphicAssetRevisionId;
	revisionNumber: number;
	kind: 'image' | 'silent-video' | 'font';
	lifecycleState: GraphicAssetLifecycleState;
	referenceCount: number;
}

/**
 * One durable disagreement between the catalogue and the canonical byte store,
 * with the structured evidence behind it and exactly the actions valid in its
 * current state.
 *
 * Identities here are opaque domain identities. A discrepancy never exposes an
 * object key, a content digest, a bucket, or a provider URL.
 */
export interface GraphicsDiscrepancy {
	id: string;
	kind: GraphicsDiscrepancyKind;
	state: GraphicsDiscrepancyState;
	reasonCode: GraphicsDiscrepancyReasonCode;
	/** A critical integrity incident fails closed and is never repaired in place. */
	isolated: boolean;
	detectedAt: string;
	lastCheckedAt: string;
	resolvedAt?: string;
	resolution?: GraphicsDiscrepancyResolution;
	/** What D1 says the library should be able to reach. */
	expected: {
		byteLength: number;
		canonicalMime?: string;
	};
	/** What the canonical byte store actually reported at `lastCheckedAt`. */
	observed: {
		present: boolean;
		byteLength?: number;
		canonicalMime?: string;
		/** Set when the byte store itself could not answer, rather than disagreeing. */
		byteStoreUnavailable?: boolean;
	};
	affectedUsage: GraphicsDiscrepancyUsage[];
	derivative?: {
		id: GraphicsDerivativeId;
		kind: 'thumbnail' | 'video-poster' | 'font-specimen';
		sourceAssetId: GraphicAssetId;
		sourceRevisionId: GraphicAssetRevisionId;
		/** Regeneration is possible only while the canonical source content resolves. */
		sourceAvailable: boolean;
	};
	/** Present when quarantined bytes are still holding an exact copy. */
	quarantine?: {
		quarantinedAt: string;
		deleteAfter: string;
	};
	actions: GraphicsDiscrepancyAction[];
}

export interface GraphicsReconciliationSweepResult {
	correlationId: string;
	startedAt: string;
	completedAt: string;
	content: {
		checked: number;
		unavailableDetected: number;
		availabilityRestored: number;
	};
	derivatives: {
		missingDetected: number;
	};
	unexpectedObjects: {
		scanned: number;
		quarantined: number;
	};
	criticalIntegrityIncidents: number;
	workingCopies: {
		reclaimed: number;
	};
	evidence: {
		recorded: number;
	};
}

/**
 * The Operations cockpit view of catalogue-versus-byte-store health. It states
 * the authority contract explicitly so a reader never has to infer whether the
 * catalogue's availability flag or the byte store wins.
 */
export interface GraphicsReconciliationOverview {
	checkedAt: string;
	authority: {
		/** D1 decides what the library expects to reach. */
		expectedReachability: 'catalogue';
		/** R2 decides which bytes exist right now. */
		presentBytes: 'byte-store';
		/** The catalogue availability flag is maintained state, never a read authority. */
		contentAvailabilityFlag: 'advisory-reconciliation-state';
	};
	lastSweep?: {
		correlationId: string;
		startedAt: string;
		completedAt: string;
	};
	openCounts: Record<GraphicsDiscrepancyKind, number>;
	discrepancies: GraphicsDiscrepancy[];
}

export type GraphicsDiscrepancyActionOutcome
	= | {
		outcome: 'resolved';
		resolution: GraphicsDiscrepancyResolution;
		discrepancy: GraphicsDiscrepancy;
	}
	| {
		outcome: 'unchanged';
		discrepancy: GraphicsDiscrepancy;
	}
	| {
		outcome: 'rejected';
		code: GraphicsRepairRejectionCode;
		message: string;
		discrepancy: GraphicsDiscrepancy;
	};

export type GraphicsCanonicalCapacityPressure = 'normal' | 'warning' | 'critical' | 'full';

export interface GraphicsAssetCapacityLimits {
	canonicalLimitBytes: number;
	stagingLimitBytes: number;
}

export interface GraphicsAssetLibraryCapacity {
	canonical: {
		limitBytes: number;
		usedBytes: number;
		reservedBytes: number;
		availableBytes: number;
		pressure: GraphicsCanonicalCapacityPressure;
		breakdown: {
			retainedSourceBytes: number;
			retainedDerivativeBytes: number;
			metadataBytes: number;
			providerCacheBytes: number;
			unreachableQuarantineBytes: number;
		};
	};
	staging: {
		limitBytes: number;
		usedBytes: number;
		reservedBytes: number;
		availableBytes: number;
	};
}

/**
 * Why a component that is answering is nonetheless not fully healthy.
 *
 * Each side is judged against its own durable evidence: the catalogue against
 * the content it has recorded as unresolvable, and the canonical byte store
 * against the disagreements reconciliation has observed in it.
 */
export type GraphicsLibraryDegradedReasonCode
	/** The catalogue answers and records content it cannot currently serve. */
	= | 'catalogue-records-unavailable-content'
	/** The byte store answers and its bytes disagree with what the catalogue expects. */
		| 'canonical-bytes-disagree-with-catalogue';

/**
 * One library component's condition: whether it can answer at all, and whether
 * what it holds currently agrees with the other side.
 *
 * This is strictly more than {@link GraphicsAssetLibraryComponentHealth}, which
 * is only a liveness probe. A component that cannot answer is `unavailable` and
 * cannot be judged for agreement at all; one that answers while carrying known
 * disagreement is `degraded`; one that answers with nothing outstanding is
 * `healthy`.
 */
export type GraphicsLibraryComponentCondition
	= | { status: 'healthy' }
		| {
			status: 'degraded';
			reason: {
				code: GraphicsLibraryDegradedReasonCode;
				retryable: true;
				/** How many durable subjects currently hold it in this state. */
				openCount: number;
			};
		}
		| {
			status: 'unavailable';
			reason: {
				code: 'catalogue-unavailable' | 'byte-store-unavailable';
				retryable: true;
			};
		};

export type GraphicsLibraryConditionStatus = 'healthy' | 'degraded' | 'unavailable';

/**
 * D1 catalogue condition and R2 byte-store condition, stated separately.
 *
 * They are never merged into one number: the catalogue deciding what the
 * library expects and the byte store holding what exists are different
 * authorities, and an administrator has to see which one is in trouble.
 */
export interface GraphicsLibraryConditionSummary {
	/** The worst condition any component is in. */
	status: GraphicsLibraryConditionStatus;
	/** D1 is authoritative for what the library expects to reach. */
	catalogue: GraphicsLibraryComponentCondition;
	/** R2 canonical is authoritative for which validated bytes exist right now. */
	canonicalByteStore: GraphicsLibraryComponentCondition;
	/** R2 staging holds only provisional transfers, so its condition is liveness. */
	stagingByteStore: GraphicsLibraryComponentCondition;
}

/**
 * One open storage-health alert, derived from durable state rather than raised
 * and remembered. Resolving its subject is the only thing that clears it.
 */
export interface GraphicsStorageHealthAlert {
	code: GraphicsStorageHealthAlertCode;
	severity: GraphicsStorageHealthAlertSeverity;
	/** How many durable subjects hold this alert open; at least one. */
	openCount: number;
	/**
	 * Whether the alert outlives this reading. A persistent alert reappears on
	 * reload and after navigation until an administrator resolves its subject.
	 */
	persistent: boolean;
}

export interface GraphicsStorageHealthAlertSummary {
	/**
	 * How many open *subjects* sit at each severity — not how many alert codes.
	 * This is the same unit {@link GraphicsReconciliationBacklog} counts in, so
	 * the two summaries can be read side by side without converting between them.
	 */
	countsBySeverity: Record<GraphicsStorageHealthAlertSeverity, number>;
	/** Ordered most severe first. */
	open: GraphicsStorageHealthAlert[];
}

/** The exact boundaries of the Canonical Graphics Quota, in bytes and fractions. */
export interface GraphicsCanonicalQuotaBoundaries {
	warningFraction: number;
	criticalFraction: number;
	fullFraction: number;
	warningBytes: number;
	criticalBytes: number;
	fullBytes: number;
}

/**
 * Canonical and staging capacity as two independent budgets. Staging is never
 * borrowed from or lent to the Canonical Graphics Quota, so it carries no
 * canonical boundary and no canonical pressure.
 */
export interface GraphicsCockpitCapacity {
	canonical: GraphicsAssetLibraryCapacity['canonical'] & {
		usedFraction: number;
		boundaries: GraphicsCanonicalQuotaBoundaries;
	};
	staging: GraphicsAssetLibraryCapacity['staging'] & { usedFraction: number };
}

/**
 * One Graphics Ingestion Operation that is not finished, with the exact facts of
 * the stage it is actually in.
 *
 * A failure is reported by its stable code alone. The free-text message a
 * failure also carries is for the author who caused it, not for an
 * installation-wide surface.
 */
export interface GraphicsIngestionAttentionItem {
	operationId: GraphicsIngestionOperationId;
	attention: GraphicsIngestionAttentionState;
	stage: GraphicsIngestionStage;
	source: GraphicsIngestionSource;
	initiatedBy: string;
	name: string;
	/** Exactly what has transferred, never a guessed overall percentage. */
	transferredByteLength: number;
	declaredByteLength: number;
	transferComplete: boolean;
	stagingBytes: number;
	/** When this operation's staged input reaches its retention guarantee. */
	inputExpiresAt: string;
	failureCode?: GraphicsIngestionFailure['code'];
	updatedAt: string;
}

export interface GraphicsIngestionAttentionSummary {
	/** Complete counts, taken across every operation rather than the list below. */
	counts: Record<GraphicsIngestionAttentionState, number>;
	/** A bounded, risk-ordered sample: expired first, then retryable, then waiting. */
	operations: GraphicsIngestionAttentionItem[];
}

/**
 * The reconciliation backlog as counts. The cockpit summarises; the
 * reconciliation surface remains the place to inspect and act on one
 * discrepancy.
 */
export interface GraphicsReconciliationBacklog {
	/** Restated here so a cockpit reader never has to infer which side wins. */
	authority: GraphicsReconciliationOverview['authority'];
	lastSweep?: {
		correlationId: string;
		startedAt: string;
		completedAt: string;
	};
	openCounts: Record<GraphicsDiscrepancyKind, number>;
	/** How many open discrepancy subjects sit at each severity. */
	countsBySeverity: Record<GraphicsStorageHealthAlertSeverity, number>;
	/** Incidents that fail closed and are never repaired in place. */
	isolatedIncidentCount: number;
}

/** One lifecycle group's size and the soonest deadline it is holding. */
export interface GraphicsLifecycleDeadlineGroup {
	count: number;
	/** The soonest deadline in the group; absent when the group is empty. */
	nextDeadline?: string;
	/** The complete guarantee every member of the group is held to. */
	guaranteeMilliseconds: number;
}

/**
 * Lifecycle counts with the distinct recovery or cleanup deadline each one
 * carries. Retirement is the only reversible state with no deadline at all.
 */
export interface GraphicsLifecycleSummary {
	retired: {
		count: number;
		/** Retirement is reversible and never expires, so it has no deadline. */
		reversibleWithoutDeadline: true;
	};
	trashed: GraphicsLifecycleDeadlineGroup;
	supersededRevisions: GraphicsLifecycleDeadlineGroup;
	/** Superseded revisions whose pruning is frozen by their asset's Trash window. */
	frozenRevisions: { count: number };
	quarantinedContent: GraphicsLifecycleDeadlineGroup;
	stagedInput: GraphicsLifecycleDeadlineGroup;
	/** Storage pressure never shortens any deadline above. */
	guaranteesShortenedUnderPressure: false;
}

/** One recent automated outcome, read from the Evidence ledger. */
export interface GraphicsRecentOutcome {
	id: string;
	recordedAt: string;
	group: GraphicsRecentOutcomeGroup;
	category: GraphicsAssetEvidenceCategory;
	subject: GraphicsAssetEvidenceEntry['subject'];
	outcome: string;
	reason: string;
}

export interface GraphicsRecentOutcomeSummary {
	/** How many recent Evidence entries the counts below were taken over. */
	consideredEntryCount: number;
	countsByGroup: Record<GraphicsRecentOutcomeGroup, number>;
	/** The most recent entries, newest first. */
	entries: GraphicsRecentOutcome[];
}

/**
 * The administrator-only Operations Cockpit reading.
 *
 * Its first answer is always whether the library is safe, which is why a
 * catalogue that cannot answer still produces a reading: the condition and the
 * alerts explaining it are present, and only the sections that genuinely
 * require the catalogue are absent.
 */
export type GraphicsOperationsCockpit
	= | {
		outcome: 'complete';
		checkedAt: string;
		condition: GraphicsLibraryConditionSummary;
		alerts: GraphicsStorageHealthAlertSummary;
		capacity: GraphicsCockpitCapacity;
		ingestion: GraphicsIngestionAttentionSummary;
		reconciliation: GraphicsReconciliationBacklog;
		lifecycle: GraphicsLifecycleSummary;
		recentOutcomes: GraphicsRecentOutcomeSummary;
	}
	| {
		/** The catalogue could not answer, so nothing it owns can be reported. */
		outcome: 'catalogue-unavailable';
		checkedAt: string;
		condition: GraphicsLibraryConditionSummary;
		alerts: GraphicsStorageHealthAlertSummary;
	};

/**
 * What one queue item or inspection is about: an opaque domain identity and the
 * kind of thing it identifies. Never a bucket, object key, digest, or filename.
 */
export interface GraphicsQueueSubject {
	kind: GraphicsAssetEvidenceSubjectKind;
	id: string;
}

/**
 * One piece of work in an operational queue.
 *
 * An item names the domain identity it is about and the exact instant its state
 * changes if nobody acts. It carries only what triage needs; the inspector is
 * where the complete evidence for one item is read.
 */
export interface GraphicsOperationalQueueItem {
	/**
	 * Stable across readings, so a selected item survives navigation, reload,
	 * and the next poll rather than being identified by its position in a list.
	 */
	key: string;
	queue: GraphicsOperationalQueueId;
	subject: GraphicsQueueSubject;
	/** What an administrator recognises this item by. */
	title: string;
	/** The exact instant this item's state changes if nobody acts. */
	deadline?: string;
	/** Pinned usage across every revision, where the subject can carry any. */
	referenceCount?: number;
	/** Only the actions valid in this item's current state. */
	actions: GraphicsQueueAction[];
}

/** One operational queue: what is wrong, how much of it, and the nearest deadline. */
export interface GraphicsOperationalQueue {
	id: GraphicsOperationalQueueId;
	severity: GraphicsStorageHealthAlertSeverity;
	/** The complete count, taken as an aggregate rather than by expanding rows. */
	totalCount: number;
	/** The soonest deadline anything in this queue is holding. */
	nextDeadline?: string;
	/** A bounded sample of the queue, nearest deadline first. */
	items: GraphicsOperationalQueueItem[];
}

/**
 * Every operational queue in one risk-ordered reading.
 *
 * Every queue is always present, so an empty one reads as empty rather than as
 * missing, and the queues arrive in the order an administrator should work
 * them: most severe first, then by deadline proximity.
 */
export interface GraphicsOperationalQueuesOverview {
	checkedAt: string;
	/** Restated here so a queue reader never has to infer which side decides what. */
	authority: GraphicsReconciliationOverview['authority'];
	queues: GraphicsOperationalQueue[];
}

/**
 * The subject-specific evidence behind one queue item.
 *
 * Each variant carries what its own kind of subject can actually prove. A
 * discrepancy distinguishes what the catalogue expects from what the byte store
 * reported; a Graphic Asset carries its lifecycle, its per-revision retention,
 * and its pinned usage; an operation carries its exact stage facts.
 */
export type GraphicsQueueInspectionDetail
	= | {
		kind: 'graphics-discrepancy';
		discrepancy: GraphicsDiscrepancy;
	}
	| {
		kind: 'graphic-asset';
		lifecycle: GraphicAssetLifecycle;
		revisions: GraphicsRevisionPruningDeadline[];
		usage: GraphicAssetUsage[];
	}
	| {
		kind: 'graphic-asset-revision';
		assetId: GraphicAssetId;
		revisionNumber: number;
		retention: GraphicAssetRevisionRetention;
		usage: GraphicAssetUsage[];
	}
	| {
		kind: 'graphics-ingestion-operation';
		operation: GraphicsIngestionAttentionItem;
	}
	| {
		kind: 'unreleased-staged-input';
		strand: GraphicsUnreleasedStagedInput;
	};

/**
 * A terminal Graphics Ingestion Operation whose staged objects a failed release
 * stranded (#358). The staging bytes still on its books are the marker: every
 * ordinary terminal transition zeroes them in the transition itself, so
 * terminal-with-bytes means exactly a release the library still owes.
 */
export interface GraphicsUnreleasedStagedInput {
	operationId: GraphicsIngestionOperationId;
	stage: GraphicsIngestionStage;
	name: string;
	stagingBytes: number;
	updatedAt: string;
}

/**
 * Everything the persistent inspector shows for one selected queue item.
 *
 * It is composed on every read from durable state, so an inspection survives
 * navigation and reload and can never show a subject a stale list still
 * believes in.
 */
export interface GraphicsQueueInspection {
	key: string;
	queue: GraphicsOperationalQueueId;
	severity: GraphicsStorageHealthAlertSeverity;
	subject: GraphicsQueueSubject;
	title: string;
	/** Restated per inspection, so the evidence below is never read as one voice. */
	authority: GraphicsReconciliationOverview['authority'];
	deadline?: string;
	referenceCount: number;
	/** Only the actions valid in this subject's current state. */
	actions: GraphicsQueueAction[];
	detail: GraphicsQueueInspectionDetail;
	/** The Evidence ledger filtered to exactly this subject, newest first. */
	evidence: GraphicsAssetEvidenceEntry[];
}

/**
 * What to call each actor named anywhere in one administrator reading (#398,
 * ADR-0010).
 *
 * Every actor and initiator the library records is an opaque identity — a
 * userId since the cutover, a Graphics Author Session before it, a machine
 * actor for a sweep — and none of the three is a name. The reading carries the
 * names beside the identities rather than in place of them, because both are
 * used: the identity is what an inspector filters the ledger by, and the name is
 * what a person reads.
 *
 * A dictionary rather than a field on each entry, because the identities are
 * scattered through nested structures that the Graphics Asset Library builds
 * and which know nothing about accounts. This way the naming is resolved once,
 * where the reading is served, and the module's own shapes stay as they are.
 *
 * Complete for the reading it belongs to: every identity in the payload has an
 * entry, so `graphicsActorName` is a lookup rather than a fallback chain.
 */
export type GraphicsActorNames = Record<string, string>;

export interface GraphicsActorNaming {
	actorNames: GraphicsActorNames;
}

/** The Operations Cockpit as its route serves it: the reading, plus its names. */
export type GraphicsOperationsCockpitReading = GraphicsOperationsCockpit & GraphicsActorNaming;

/** One queue inspection as its route serves it. */
export interface GraphicsQueueInspectionReading extends GraphicsQueueInspection, GraphicsActorNaming {}

/** One page of the Evidence ledger as its route serves it. */
export interface GraphicsAssetEvidenceReading extends GraphicsAssetEvidencePage, GraphicsActorNaming {}

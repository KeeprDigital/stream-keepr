import type {
	SILENT_VIDEO_COMPATIBILITY_PROFILE,
	STATIC_FONT_COMPATIBILITY_PROFILE,
	STILL_IMAGE_COMPATIBILITY_PROFILE,
} from '../utils/graphicsAssetCompatibility';
import type { GRAPHICS_RETENTION_EVIDENCE_CATEGORIES } from '../utils/graphicsAssetRetention';

declare const graphicAssetIdBrand: unique symbol;
declare const graphicAssetRevisionIdBrand: unique symbol;
declare const graphicsDerivativeIdBrand: unique symbol;
declare const graphicsIngestionOperationIdBrand: unique symbol;
declare const graphicsIngestionPartIdentityBrand: unique symbol;

export const DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES = 100 * 1024 * 1024 * 1024;
export const DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES = 10 * 1024 * 1024 * 1024;
export const GRAPHIC_ASSET_LIFECYCLE_ACTIONS = ['retire', 'trash', 'restore'] as const;

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

export type GraphicAssetLifecycleState = 'active' | 'retired' | 'trashed';
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
	}
	| { outcome: 'missing' }
	| { outcome: 'unavailable'; retryable: true };

export type GraphicsDuplicateContentPolicy = 'reuse' | 'create-separate';

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
		| 'font-name-invalid'
		| 'browser-font-load-failed'
		| 'browser-font-render-failed'
		| 'browser-font-evidence-mismatch';
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
		| 'validation-failed';
	retryable: boolean;
	message: string;
}

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
	result?: {
		outcome: 'published' | 'reused' | 'revision-created' | 'replacement-noop';
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	};
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

export type GraphicsRetentionEvidenceCategory
	= typeof GRAPHICS_RETENTION_EVIDENCE_CATEGORIES[number];

export type GraphicsAssetEvidenceSubjectKind
	= | 'graphics-ingestion-operation'
		| 'graphic-asset'
		| 'graphic-asset-revision'
		| 'graphic-asset-content';

/**
 * One durable administrator-facing record of an automated lifecycle decision.
 * Subjects are opaque domain identities: evidence never carries object keys,
 * digests, filenames, capability secrets, or deleted bytes.
 */
export interface GraphicsAssetEvidenceEntry {
	id: string;
	recordedAt: string;
	category: GraphicsRetentionEvidenceCategory;
	actor: string;
	subject: {
		kind: GraphicsAssetEvidenceSubjectKind;
		id: string;
	};
	outcome: string;
	reason: string;
	correlationId: string;
	detail: {
		checkedReferenceCount?: number;
		revisionCount?: number;
		bytesFreed?: number;
		bytesReserved?: number;
		deadline?: string;
		remainingMilliseconds?: number;
		canonicalUsedBytes?: number;
		canonicalLimitBytes?: number;
		canonicalPressure?: GraphicsCanonicalCapacityPressure;
	};
	expiresAt: string;
}

export interface GraphicsRetentionSweepResult {
	correlationId: string;
	startedAt: string;
	completedAt: string;
	stagedInput: {
		expiredIncompleteTransfers: number;
		expiredCompletedInput: number;
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
	recoverableUntil: string;
	purgeAfter: string;
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
	purgeAfter?: string;
	revisions: GraphicsRevisionPruningDeadline[];
}

export interface GraphicsContentQuarantineDeadline {
	id: string;
	byteLength: number;
	origin: 'orphaned-content' | 'abandoned-canonical-write';
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
		checkedReferenceCount: number;
		reason: 'trash-window-elapsed' | 'early-purge';
	}
	| {
		outcome: 'in-use';
		usage: GraphicAssetUsage[];
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

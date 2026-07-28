import type { STILL_IMAGE_COMPATIBILITY_PROFILE } from '../utils/graphicsAssetCompatibility';

declare const graphicAssetIdBrand: unique symbol;
declare const graphicAssetRevisionIdBrand: unique symbol;
declare const graphicsDerivativeIdBrand: unique symbol;
declare const graphicsIngestionOperationIdBrand: unique symbol;
declare const graphicsIngestionPartIdentityBrand: unique symbol;

export const DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES = 100 * 1024 * 1024 * 1024;
export const DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES = 10 * 1024 * 1024 * 1024;

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
		slot: string;
		eventId?: number;
	};
}

export type GraphicAssetReferenceStatus
	= | {
		outcome: 'available';
		lifecycleState: 'active' | 'retired' | 'trashed';
	}
	| { outcome: 'missing' }
	| { outcome: 'unavailable'; retryable: true };

export type GraphicsDuplicateContentPolicy = 'reuse' | 'create-separate';

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
	};

export interface GraphicAssetSourceDeclarations {
	sourceFileName?: string;
	declaredMime?: string;
	browserDecodeEvidence?: GraphicAssetBrowserDecodeEvidence;
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
		| 'browser-image-decode-mismatch';
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
		compatibilityProfile: typeof STILL_IMAGE_COMPATIBILITY_PROFILE;
		issues: GraphicAssetValidationIssue[];
	};

export interface GraphicsIngestionFailure {
	code:
		| 'ingestion-cancelled'
		| 'staging-unavailable'
		| 'staging-capacity-exhausted'
		| 'canonical-capacity-exhausted'
		| 'canonical-store-unavailable'
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
		outcome: 'published' | 'reused';
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
	kind: 'image';
	revisionId: GraphicAssetRevisionId;
	revisionNumber: number;
	facts: GraphicAssetImageFacts;
	eventIds: number[];
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

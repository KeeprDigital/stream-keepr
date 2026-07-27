declare const graphicAssetIdBrand: unique symbol;
declare const graphicAssetRevisionIdBrand: unique symbol;
declare const graphicsDerivativeIdBrand: unique symbol;
declare const graphicsIngestionOperationIdBrand: unique symbol;

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
	canonicalMime: 'image/png';
	byteLength: number;
	sha256: string;
	width: number;
	height: number;
	pixelCount: number;
	bitDepth: 8;
	colorModel: 'grayscale' | 'grayscale-alpha' | 'indexed' | 'rgb' | 'rgba';
	hasAlpha: boolean;
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
		| 'incomplete-png-frame';
	message: string;
}

export type GraphicAssetValidationReport
	= {
		outcome: 'accepted';
		compatibilityProfile: 'png-v1';
		issues: [];
		facts: GraphicAssetImageFacts;
	}
	| {
		outcome: 'rejected';
		compatibilityProfile: 'png-v1';
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

export interface GraphicsIngestionOperation {
	id: GraphicsIngestionOperationId;
	idempotencyKey: string;
	initiatedBy: string;
	name: string;
	defaultEventId?: number;
	duplicateContentPolicy: GraphicsDuplicateContentPolicy;
	declaredByteLength: number;
	transferredByteLength: number;
	stage: GraphicsIngestionStage;
	capacity?: GraphicsIngestionCapacityOutcome;
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

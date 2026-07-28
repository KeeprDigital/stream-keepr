import type {
	STATIC_FONT_COMPATIBILITY_PROFILE,
	STILL_IMAGE_COMPATIBILITY_PROFILE,
} from '../utils/graphicsAssetCompatibility';

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
		name?: string;
		slot: string;
		eventId?: number;
	};
}

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
		kind: 'image' | 'font';
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

export type GraphicAssetCanonicalMime
	= GraphicAssetImageFacts['canonicalMime'] | GraphicAssetFontFacts['canonicalMime'];

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
			| typeof STATIC_FONT_COMPATIBILITY_PROFILE;
		issues: GraphicAssetValidationIssue[];
	}
	| {
		outcome: 'accepted';
		compatibilityProfile: typeof STATIC_FONT_COMPATIBILITY_PROFILE;
		issues: [];
		facts: GraphicAssetFontFacts;
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
	kind: 'image' | 'font';
	revisionId: GraphicAssetRevisionId;
	revisionNumber: number;
	facts: GraphicAssetImageFacts | GraphicAssetFontFacts;
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

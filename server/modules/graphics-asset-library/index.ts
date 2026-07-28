import type {
	GraphicAsset,
	GraphicAssetCanonicalMime,
	GraphicAssetId,
	GraphicAssetLifecycleActionOutcome,
	GraphicAssetLifecycleState,
	GraphicAssetReferenceStatus,
	GraphicAssetRevisionId,
	GraphicAssetSourceDeclarations,
	GraphicAssetUsage,
	GraphicAssetValidationReport,
	GraphicsAssetCapacityLimits,
	GraphicsAssetLibraryCapacity,
	GraphicsAssetLibraryComponentHealth,
	GraphicsAssetLibraryHealth,
	GraphicsDerivativeId,
	GraphicsDuplicateContentPolicy,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsCapacityExhaustedDetails } from './errors';
import type { GraphicsImageMultipartState } from './multipart';
import type {
	BoundedByteStream,
	GraphicsCanonicalObjectStore,
	GraphicsMultipartPartIdentity,
	GraphicsObjectStoreHealth,
	GraphicsStagingObjectStore,
} from './object-store';
import { graphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import {
	GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
	GRAPHICS_MULTIPART_MAXIMUM_PART_ATTEMPTS,
	GRAPHICS_MULTIPART_PART_BYTES,
	GRAPHICS_MULTIPART_PART_TRANSFER_TIMEOUT_MILLISECONDS,
	MAX_STATIC_FONT_INGESTION_BYTES,
	MAX_STILL_IMAGE_INGESTION_BYTES,
	STATIC_FONT_COMPATIBILITY_PROFILE,
	STILL_IMAGE_COMPATIBILITY_PROFILE,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { GraphicsAssetLibraryError } from './errors';
import { processStaticFont } from './font';
import { graphicsIngestionPartIdentity } from './multipart';
import {
	boundedByteStreamWithDeadline,
	consumeBoundedByteStream,
	createBoundedByteStream,
	graphicsObjectIdentity,
} from './object-store';
import {
	sha256Hex,
	sha256HexStream,
} from './png';
import { processStillImage } from './still-image';
import {
	GraphicAssetValidationError,
	rejectedValidationReport,
	validationError,
} from './validation';

export { GraphicsAssetLibraryError } from './errors';
export { createInMemoryGraphicsAssetCatalogue } from './in-memory-catalogue';

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
	getImageMultipartState: (
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	) => Promise<GraphicsImageMultipartState | undefined>;
	updateImageMultipartState: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		expectedVersion: number;
		state: GraphicsImageMultipartState;
		updatedAt: string;
	}) => Promise<boolean>;
	recordImageMultipartCleanupComplete: (
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	) => Promise<void>;
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
		kind: 'image' | 'font';
		lifecycleState: 'active' | 'retired' | 'trashed';
	} | undefined>;
	listGraphicAssetUsage: (assetId: GraphicAssetId) => Promise<GraphicAssetUsage[]>;
	findThumbnailDigest: (assetId: GraphicAssetId) => Promise<string | undefined>;
}

export interface GraphicsAssetLibrary {
	getHealth: () => Promise<GraphicsAssetLibraryHealth>;
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
	startImageMultipartUpload: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	uploadImageMultipartPart: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		partNumber: number;
		bytes: BoundedByteStream;
	}) => Promise<GraphicsIngestionOperation>;
	completeImageMultipartUpload: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	retryGraphicsIngestion: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
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
	resolveGraphicAssetRevision: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
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
}

interface GraphicsAssetLibraryDependencies {
	catalogue: GraphicsAssetCatalogueHealth | GraphicsAssetCatalogue;
	staging: GraphicsObjectStoreHealth | GraphicsStagingObjectStore;
	canonical: GraphicsObjectStoreHealth | GraphicsCanonicalObjectStore;
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

export function graphicsDerivativeId(value: string): GraphicsDerivativeId {
	return requiredIdentity<GraphicsDerivativeId>(value, 'Graphics Derivative identity');
}

export function graphicsIngestionOperationId(value: string): GraphicsIngestionOperationId {
	return requiredIdentity<GraphicsIngestionOperationId>(value, 'Graphics Ingestion Operation identity');
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

	function timestampAfter(updatedAt: string) {
		return new Date(Math.max(
			now().getTime(),
			new Date(updatedAt).getTime() + 1,
		)).toISOString();
	}

	function validateGraphicsIngestionInput(input: GraphicAssetSourceDeclarations & {
		idempotencyKey: string;
		initiatedBy: string;
		declaredByteLength: number;
		defaultEventId?: number;
	}) {
		if (!input.idempotencyKey.trim() || !input.initiatedBy.trim())
			throw new GraphicsAssetLibraryError('Ingestion identity and author are required', 'invalid-ingestion-input');
		const sourceKind = graphicAssetSourceKind(input);
		const maximumByteLength = sourceKind === 'font'
			? MAX_STATIC_FONT_INGESTION_BYTES
			: MAX_STILL_IMAGE_INGESTION_BYTES;
		if (
			!Number.isSafeInteger(input.declaredByteLength)
			|| input.declaredByteLength <= 0
			|| input.declaredByteLength > maximumByteLength
		) {
			throw new GraphicsAssetLibraryError(
				`${sourceKind === 'font' ? 'Static font' : 'Still image'} must be between 1 and ${maximumByteLength} bytes`,
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
		if (evidence.outcome === 'font-loaded' || evidence.outcome === 'font-rejected') {
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
			() => catalogue.getImageMultipartState(operation.id, operation.initiatedBy),
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
			() => catalogue.recordImageMultipartCleanupComplete(operation.id, operation.initiatedBy),
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
		const identity = graphicsObjectIdentity(`sha256/${digest}`);
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

	async function continueGraphicsIngestion(
		initialOperation: GraphicsIngestionOperation,
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
				return;
			if (authoritative.stage === 'cancelled')
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
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
			await sha256HexStream({
				body: stagedRead.body,
				byteLength: stagedRead.object.byteLength,
				maximumByteLength: MAX_STILL_IMAGE_INGESTION_BYTES,
			});
			const hashingTerminal = await terminalOperationAtCheckpoint();
			if (hashingTerminal)
				return hashingTerminal;

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, { stage: 'validating' }),
				operation.updatedAt,
			);
			const validationRead = await staging.read(stagingIdentity);
			if (validationRead.outcome !== 'available') {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staged source bytes are temporarily unavailable.',
				}, operation.report);
			}
			let processed:
				| Awaited<ReturnType<typeof processStillImage>>
				| Awaited<ReturnType<typeof processStaticFont>>;
			let sourceKind: 'image' | 'font' = graphicAssetSourceKind(operation);
			try {
				const validationBytes = await consumeBoundedByteStream({
					body: validationRead.body,
					byteLength: validationRead.object.byteLength,
					maximumByteLength: MAX_STILL_IMAGE_INGESTION_BYTES,
				});
				sourceKind = graphicAssetSourceKind(operation, validationBytes.subarray(0, 64));
				processed = sourceKind === 'font'
					? await processStaticFont(validationBytes, {
							sourceFileName: operation.sourceFileName,
							declaredMime: operation.declaredMime,
						})
					: await processStillImage(validationBytes, {
							sourceFileName: operation.sourceFileName,
							declaredMime: operation.declaredMime,
						});
				if (processed.report.facts.kind === 'font' && !operation.browserDecodeEvidence) {
					return await catalogue.updateIngestionOperation(
						changedOperation(operation, {
							stage: 'awaiting-confirmation',
							report: processed.report,
						}),
						operation.updatedAt,
					);
				}
				processed = {
					...processed,
					report: reportWithBrowserDecodeEvidence(processed.report, operation),
				};
			}
			catch (error) {
				if (!(error instanceof GraphicAssetValidationError))
					throw error;
				const report = rejectedValidationReport(
					error,
					sourceKind === 'font'
						? STATIC_FONT_COMPATIBILITY_PROFILE
						: STILL_IMAGE_COMPATIBILITY_PROFILE,
				);
				const failed = await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'Graphic Asset did not satisfy its compatibility profile.',
				}, report);
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
				return failed;
			}
			const validationTerminal = await terminalOperationAtCheckpoint();
			if (validationTerminal)
				return validationTerminal;

			if (operation.targetAssetId) {
				const current = await catalogue.findCurrentGraphicAsset(operation.targetAssetId);
				if (!current)
					throw new Error('Replacement target Graphic Asset was not found');
				if (current.sourceDigest === processed.report.facts.sha256) {
					operation = await catalogue.updateIngestionOperation(
						changedOperation(operation, {
							stage: 'publishing',
							report: processed.report,
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
					report: processed.report,
				}),
				operation.updatedAt,
			);
			const derivativeStartTerminal = await terminalOperationAtCheckpoint();
			if (derivativeStartTerminal)
				return derivativeStartTerminal;

			const thumbnail = processed.thumbnail;
			const thumbnailDigest = await sha256Hex(thumbnail);
			const reservation = await catalogue.reserveGraphicAssetPublication({
				operation,
				sourceDigest: processed.report.facts.sha256,
				sourceByteLength: processed.report.facts.byteLength,
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
				}, processed.report);
			}
			operation = reservation.operation;
			const canonicalSourceRead = await staging.read(stagingIdentity);
			if (canonicalSourceRead.outcome !== 'available') {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staged source bytes are temporarily unavailable.',
				}, processed.report);
			}
			const [sourceWrite, thumbnailWrite] = await Promise.all([
				storeCanonicalStream(canonical, processed.report.facts.sha256, {
					body: canonicalSourceRead.body,
					byteLength: canonicalSourceRead.object.byteLength,
					maximumByteLength: MAX_STILL_IMAGE_INGESTION_BYTES,
				}, processed.report.facts.canonicalMime),
				storeCanonicalBytes(canonical, thumbnailDigest, thumbnail),
			]);
			const createdCanonicalContents = [
				sourceWrite.outcome === 'created'
					? {
							digest: processed.report.facts.sha256,
							byteLength: processed.report.facts.byteLength,
						}
					: undefined,
				thumbnailWrite.outcome === 'created'
					? { digest: thumbnailDigest, byteLength: thumbnail.byteLength }
					: undefined,
			].filter((content): content is { digest: string; byteLength: number } =>
				content !== undefined,
			);
			if (createdCanonicalContents.length > 0) {
				await catalogue.recordCanonicalWrites({
					operation,
					contents: createdCanonicalContents,
					recordedAt: timestamp(),
				});
			}
			if (sourceWrite.outcome === 'unavailable' || thumbnailWrite.outcome === 'unavailable') {
				return await failOperation(catalogue, operation, {
					code: 'canonical-store-unavailable',
					retryable: true,
					message: 'Canonical source or thumbnail storage is temporarily unavailable.',
				}, processed.report);
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
				? await catalogue.findReusableGraphicAsset(processed.report.facts.sha256)
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
					report: processed.report,
					assetId: operation.targetAssetId,
					revisionId: graphicAssetRevisionId(generateIdentity()),
					derivativeId: graphicsDerivativeId(generateIdentity()),
					sourceDigest: processed.report.facts.sha256,
					thumbnailDigest,
					thumbnailByteLength: thumbnail.byteLength,
					publishedAt: timestamp(),
				});
			}
			else {
				try {
					completed = await catalogue.publishGraphicAsset({
						operation,
						report: processed.report,
						assetId: graphicAssetId(generateIdentity()),
						revisionId: graphicAssetRevisionId(generateIdentity()),
						derivativeId: graphicsDerivativeId(generateIdentity()),
						sourceDigest: processed.report.facts.sha256,
						thumbnailDigest,
						thumbnailByteLength: thumbnail.byteLength,
						publishedAt: timestamp(),
					});
				}
				catch (publicationError) {
					if (operation.duplicateContentPolicy === 'create-separate')
						throw publicationError;
					const concurrentlyPublished = await catalogue.findReusableGraphicAsset(
						processed.report.facts.sha256,
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

	return {
		async getHealth() {
			const checkedAt = now().toISOString();
			const [catalogue, staging, canonical] = await Promise.all([
				catalogueHealth(dependencies.catalogue),
				byteStoreHealth(dependencies.staging),
				byteStoreHealth(dependencies.canonical),
			]);
			const status = catalogue.status === 'healthy'
				&& staging.status === 'healthy'
				&& canonical.status === 'healthy'
				? 'healthy'
				: 'degraded';

			return {
				status,
				checkedAt,
				catalogue,
				byteStores: { staging, canonical },
			};
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
				duplicateContentPolicy: input.duplicateContentPolicy ?? 'reuse',
			});
		},
		async initiateGraphicAssetReplacement(input) {
			return await initiateGraphicsOperation({
				...input,
				name: 'Graphic Asset replacement',
				targetAssetId: input.assetId,
				duplicateContentPolicy: 'create-separate',
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
			if (!cancelled.transfer) {
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await requireStaging().delete(
					graphicsObjectIdentity(`ingestion/${operation.id}/source`),
				);
			}
			return cleaned;
		},
		async startImageMultipartUpload(input) {
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
			if (operation.stage !== 'created' && operation.stage !== 'transferring') {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot start multipart transfer from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}

			const existing = await catalogueRequest(
				() => catalogue.getImageMultipartState(operation.id, operation.initiatedBy),
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
			const state: GraphicsImageMultipartState = {
				version: initialVersion + 1,
				uploadId: started.upload.uploadId,
				cleanupPending: false,
				parts: existing?.parts ?? [],
			};
			const recorded = await catalogueRequest(
				() => catalogue.updateImageMultipartState({
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
				return await this.startImageMultipartUpload(input);
			}
			return await this.getIngestionOperation(input);
		},
		async uploadImageMultipartPart(input) {
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

			let claimedState: GraphicsImageMultipartState | undefined;
			for (let claimAttempt = 0; claimAttempt < 8; claimAttempt++) {
				const state = await catalogueRequest(
					() => catalogue.getImageMultipartState(operation!.id, operation!.initiatedBy),
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
				const claimedPart: GraphicsImageMultipartState['parts'][number] = {
					partNumber: input.partNumber,
					partIdentity: graphicsIngestionPartIdentity(operation.id, input.partNumber),
					byteLength: expectedByteLength,
					status: 'uploading',
					claimedAt: timestamp(),
					attempts,
				};
				const claimed: GraphicsImageMultipartState = {
					...state,
					version: state.version + 1,
					parts: [
						...availableParts.filter(part => part.partNumber !== input.partNumber),
						claimedPart,
					],
				};
				const recorded = await catalogueRequest(
					() => catalogue.updateImageMultipartState({
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
				const failedState: GraphicsImageMultipartState = {
					...claimedState,
					version: claimedState.version + 1,
					parts: claimedState.parts.map(part =>
						part.partNumber === input.partNumber
							? { ...part, status: 'failed' as const }
							: part),
				};
				await catalogueRequest(
					() => catalogue.updateImageMultipartState({
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
					() => catalogue.getImageMultipartState(operation!.id, operation!.initiatedBy),
					'Graphics multipart checkpoint is temporarily unavailable',
				);
				if (!latest)
					break;
				const existing = latest.parts.find(part => part.partNumber === input.partNumber);
				if (existing?.status === 'completed')
					return await this.getIngestionOperation(input);
				const completed: GraphicsImageMultipartState = {
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
					() => catalogue.updateImageMultipartState({
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
		async completeImageMultipartUpload(input) {
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
				() => catalogue.getImageMultipartState(operation.id, operation.initiatedBy),
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
			if (initiatedMime && transferMime && initiatedMime !== transferMime) {
				const sourceKind = graphicAssetSourceKind(operation);
				return await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'Graphic Asset declarations conflict before validation.',
				}, {
					outcome: 'rejected',
					compatibilityProfile: sourceKind === 'font'
						? STATIC_FONT_COMPATIBILITY_PROFILE
						: STILL_IMAGE_COMPATIBILITY_PROFILE,
					issues: [{
						severity: 'error',
						code: sourceKind === 'font' ? 'conflicting-font-mime' : 'conflicting-image-mime',
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
				}),
				'Graphics staging progress could not be recorded',
			);
			return await continueGraphicsIngestion(operation);
		},
		async confirmFontBrowserEvidence(input) {
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
				|| operation.report.facts.kind !== 'font'
			) {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot confirm font rendering from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}
			if (input.evidence.outcome !== 'font-loaded' && input.evidence.outcome !== 'font-rejected') {
				throw new GraphicsAssetLibraryError(
					'Font browser challenge evidence is required',
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
				'Font browser challenge evidence could not be recorded',
			);
			return await continueGraphicsIngestion(confirmed);
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
			const result = await requireCanonical().readMetadata(
				graphicsObjectIdentity(`sha256/${content.digest}`),
			);
			if (
				result.outcome !== 'available'
				|| result.object.byteLength !== content.byteLength
				|| result.object.contentType !== content.canonicalMime
			) {
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				lifecycleState: content.lifecycleState,
				kind: content.kind,
			};
		},
		async resolveGraphicAssetRevision(input) {
			const content = await catalogueRequest(
				() => requireCatalogue().findRevisionContent(input),
				'Graphic Asset Revision lookup is temporarily unavailable',
			);
			if (!content)
				return { outcome: 'missing' };
			const result = await requireCanonical().read(
				graphicsObjectIdentity(`sha256/${content.digest}`),
			);
			if (result.outcome !== 'available')
				return { outcome: 'unavailable', retryable: true };
			if (
				result.object.byteLength !== content.byteLength
				|| result.object.contentType !== content.canonicalMime
			) {
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				body: result.body,
				byteLength: result.object.byteLength,
				contentType: content.canonicalMime,
			};
		},
		async resolveGraphicAssetThumbnail(input) {
			const digest = await catalogueRequest(
				() => requireCatalogue().findThumbnailDigest(input.assetId),
				'Graphic Asset preview lookup is temporarily unavailable',
			);
			if (!digest)
				return { outcome: 'missing' };
			const result = await requireCanonical().read(graphicsObjectIdentity(`sha256/${digest}`));
			if (result.outcome === 'missing')
				return { outcome: 'missing' };
			if (result.outcome === 'unavailable')
				return { outcome: 'unavailable', retryable: true };
			return {
				outcome: 'available',
				body: result.body,
				byteLength: result.object.byteLength,
				contentType: 'image/png',
			};
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

import type {
	GraphicAsset,
	GraphicAssetId,
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
import {
	GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
	GRAPHICS_MULTIPART_MAXIMUM_PART_ATTEMPTS,
	GRAPHICS_MULTIPART_PART_BYTES,
	GRAPHICS_MULTIPART_PART_TRANSFER_TIMEOUT_MILLISECONDS,
	MAX_STILL_IMAGE_INGESTION_BYTES,
	STILL_IMAGE_COMPATIBILITY_PROFILE,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { GraphicsAssetLibraryError } from './errors';
import { graphicsIngestionPartIdentity } from './multipart';
import {
	boundedByteStreamWithDeadline,
	createBoundedByteStream,
	graphicsObjectIdentity,
} from './object-store';
import {
	sha256Hex,
	sha256HexStream,
} from './png';
import {
	processStillImageStream,
} from './still-image';
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

export interface PublishImageCatalogueInput {
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

export interface ReusableImage {
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
}

export interface GraphicsAssetCatalogue extends GraphicsAssetCatalogueHealth {
	getCapacity: () => Promise<GraphicsAssetLibraryCapacity>;
	initiateImageIngestion: (operation: GraphicsIngestionOperation) => Promise<GraphicsIngestionOperation>;
	recordStagedBytes: (input: {
		operation: GraphicsIngestionOperation;
		usedBytes: number;
	}) => Promise<void>;
	recordCanonicalWrites: (input: {
		operation: GraphicsIngestionOperation;
		contents: readonly { digest: string; byteLength: number }[];
		recordedAt: string;
	}) => Promise<void>;
	reserveImagePublication: (input: {
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
	claimImageIngestion: (input: {
		operation: GraphicsIngestionOperation;
		claimedAt: string;
		staleBefore: string;
	}) => Promise<GraphicsIngestionOperation | undefined>;
	findReusableImage: (sourceDigest: string) => Promise<ReusableImage | undefined>;
	reuseImage: (input: {
		operation: GraphicsIngestionOperation;
		reusable: ReusableImage;
		publishedAt: string;
	}) => Promise<GraphicsIngestionOperation>;
	publishImage: (input: PublishImageCatalogueInput) => Promise<GraphicsIngestionOperation>;
	listGraphicAssets: (search: string) => Promise<GraphicAsset[]>;
	findRevisionContent: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) => Promise<{
		digest: string;
		byteLength: number;
		canonicalMime: 'image/png' | 'image/jpeg' | 'image/webp';
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
	initiateImageIngestion: (input: GraphicAssetSourceDeclarations & {
		idempotencyKey: string;
		initiatedBy: string;
		name: string;
		defaultEventId?: number;
		duplicateContentPolicy?: GraphicsDuplicateContentPolicy;
		declaredByteLength: number;
	}) => Promise<GraphicsIngestionOperation>;
	cancelImageIngestion: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	getIngestionOperation: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	uploadImage: (input: {
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
	retryImageIngestion: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	listGraphicAssets: (input: { search?: string }) => Promise<GraphicAsset[]>;
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
			contentType: 'image/png' | 'image/jpeg' | 'image/webp';
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

	function requireCatalogue(): GraphicsAssetCatalogue {
		if (!('initiateImageIngestion' in dependencies.catalogue))
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
		};
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
		contentType: 'image/png' | 'image/jpeg' | 'image/webp',
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

	async function continueImageIngestion(
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
			const sourceDigest = await sha256HexStream({
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
			let processed: Awaited<ReturnType<typeof processStillImageStream>>;
			try {
				processed = await processStillImageStream({
					body: validationRead.body,
					byteLength: validationRead.object.byteLength,
					maximumByteLength: MAX_STILL_IMAGE_INGESTION_BYTES,
				}, sourceDigest, {
					sourceFileName: operation.sourceFileName,
					declaredMime: operation.declaredMime,
				});
				processed = {
					...processed,
					report: reportWithBrowserDecodeEvidence(processed.report, operation),
				};
			}
			catch (error) {
				if (!(error instanceof GraphicAssetValidationError))
					throw error;
				const report = rejectedValidationReport(error);
				const failed = await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'Image did not satisfy the still-image-v1 compatibility profile.',
				}, report);
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
				return failed;
			}
			const validationTerminal = await terminalOperationAtCheckpoint();
			if (validationTerminal)
				return validationTerminal;

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
			const reservation = await catalogue.reserveImagePublication({
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

			const reusable = operation.duplicateContentPolicy === 'reuse'
				? await catalogue.findReusableImage(processed.report.facts.sha256)
				: undefined;
			let completed: GraphicsIngestionOperation;
			if (reusable) {
				completed = await catalogue.reuseImage({
					operation,
					reusable,
					publishedAt: timestamp(),
				});
			}
			else {
				try {
					completed = await catalogue.publishImage({
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
					const concurrentlyPublished = await catalogue.findReusableImage(
						processed.report.facts.sha256,
					);
					if (!concurrentlyPublished)
						throw publicationError;
					completed = await catalogue.reuseImage({
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
		async initiateImageIngestion(input) {
			if (!input.idempotencyKey.trim() || !input.initiatedBy.trim() || !input.name.trim())
				throw new GraphicsAssetLibraryError('Ingestion identity, author, and asset name are required', 'invalid-ingestion-input');
			if (
				!Number.isSafeInteger(input.declaredByteLength)
				|| input.declaredByteLength <= 0
				|| input.declaredByteLength > MAX_STILL_IMAGE_INGESTION_BYTES
			) {
				throw new GraphicsAssetLibraryError(`Still image must be between 1 and ${MAX_STILL_IMAGE_INGESTION_BYTES} bytes`, 'invalid-ingestion-input');
			}
			if (
				input.defaultEventId !== undefined
				&& (!Number.isSafeInteger(input.defaultEventId) || input.defaultEventId <= 0)
			) {
				throw new GraphicsAssetLibraryError('Default Event identity must be a positive integer', 'invalid-ingestion-input');
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

			const createdAt = timestamp();
			return await catalogueRequest(() => requireCatalogue().initiateImageIngestion({
				id: graphicsIngestionOperationId(generateIdentity()),
				idempotencyKey: input.idempotencyKey,
				initiatedBy: input.initiatedBy,
				name: input.name.trim(),
				sourceFileName: input.sourceFileName?.trim(),
				declaredMime: input.declaredMime?.trim().toLocaleLowerCase(),
				browserDecodeEvidence: input.browserDecodeEvidence,
				defaultEventId: input.defaultEventId,
				duplicateContentPolicy: input.duplicateContentPolicy ?? 'reuse',
				declaredByteLength: input.declaredByteLength,
				transferredByteLength: 0,
				stage: 'created',
				createdAt,
				updatedAt: createdAt,
			}), 'Graphics ingestion could not be initiated because the catalogue is unavailable');
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
		async cancelImageIngestion(input) {
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
			return await continueImageIngestion(authoritative);
		},
		async uploadImage(input) {
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
					'Transferred image length must match the initiated operation',
					'invalid-ingestion-input',
				);
			}
			const initiatedMime = operation.declaredMime?.trim().toLocaleLowerCase();
			const transferMime = input.declaredMime?.trim().toLocaleLowerCase();
			if (initiatedMime && transferMime && initiatedMime !== transferMime) {
				return await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'Image declarations conflict before validation.',
				}, {
					outcome: 'rejected',
					compatibilityProfile: STILL_IMAGE_COMPATIBILITY_PROFILE,
					issues: [{
						severity: 'error',
						code: 'conflicting-image-mime',
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
			return await continueImageIngestion(operation);
		},
		async retryImageIngestion(input) {
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
				() => catalogue.claimImageIngestion({
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
			return await continueImageIngestion(claimed);
		},
		async listGraphicAssets(input) {
			return await catalogueRequest(
				() => requireCatalogue().listGraphicAssets(input.search ?? ''),
				'Graphic Asset discovery is temporarily unavailable',
			);
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

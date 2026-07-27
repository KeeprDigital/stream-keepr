import type {
	GraphicAsset,
	GraphicAssetId,
	GraphicAssetReferenceStatus,
	GraphicAssetRevisionId,
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
import type {
	BoundedByteStream,
	GraphicsCanonicalObjectStore,
	GraphicsObjectStoreHealth,
	GraphicsStagingObjectStore,
} from './object-store';
import { MAX_PNG_INGESTION_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { GraphicsAssetLibraryError } from './errors';
import {
	createBoundedByteStream,
	graphicsObjectIdentity,
} from './object-store';
import {
	PngValidationError,
	processPngStream,
	rejectedPngReport,
	sha256Hex,
	sha256HexStream,
} from './png';

export { GraphicsAssetLibraryError } from './errors';
export { createInMemoryGraphicsAssetCatalogue } from './in-memory-catalogue';

export interface GraphicsAssetCatalogueHealth {
	checkHealth: () => Promise<{ outcome: 'healthy' }>;
}

export interface PublishPngCatalogueInput {
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

export interface ReusablePng {
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
}

export interface GraphicsAssetCatalogue extends GraphicsAssetCatalogueHealth {
	getCapacity: () => Promise<GraphicsAssetLibraryCapacity>;
	initiatePngIngestion: (operation: GraphicsIngestionOperation) => Promise<GraphicsIngestionOperation>;
	recordStagedBytes: (input: {
		operation: GraphicsIngestionOperation;
		usedBytes: number;
	}) => Promise<void>;
	recordCanonicalWrites: (input: {
		operation: GraphicsIngestionOperation;
		contents: readonly { digest: string; byteLength: number }[];
		recordedAt: string;
	}) => Promise<void>;
	reservePngPublication: (input: {
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
	updateIngestionOperation: (
		operation: GraphicsIngestionOperation,
		expectedUpdatedAt: string,
	) => Promise<GraphicsIngestionOperation>;
	claimPngIngestion: (input: {
		operation: GraphicsIngestionOperation;
		claimedAt: string;
		staleBefore: string;
	}) => Promise<GraphicsIngestionOperation | undefined>;
	findReusablePng: (sourceDigest: string) => Promise<ReusablePng | undefined>;
	reusePng: (input: {
		operation: GraphicsIngestionOperation;
		reusable: ReusablePng;
		publishedAt: string;
	}) => Promise<GraphicsIngestionOperation>;
	publishPng: (input: PublishPngCatalogueInput) => Promise<GraphicsIngestionOperation>;
	listGraphicAssets: (search: string) => Promise<GraphicAsset[]>;
	findRevisionContent: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) => Promise<{
		digest: string;
		byteLength: number;
		canonicalMime: 'image/png';
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
	initiatePngIngestion: (input: {
		idempotencyKey: string;
		initiatedBy: string;
		name: string;
		defaultEventId?: number;
		duplicateContentPolicy?: GraphicsDuplicateContentPolicy;
		declaredByteLength: number;
	}) => Promise<GraphicsIngestionOperation>;
	getIngestionOperation: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	cancelPngIngestion: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	uploadPng: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		bytes: BoundedByteStream;
	}) => Promise<GraphicsIngestionOperation>;
	retryPngIngestion: (input: {
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
			contentType: 'image/png';
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
	const activeIngestionLeaseMilliseconds = 30_000;

	function requireCatalogue(): GraphicsAssetCatalogue {
		if (!('initiatePngIngestion' in dependencies.catalogue))
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

	async function storeCanonicalStream(
		store: GraphicsCanonicalObjectStore,
		digest: string,
		bytes: BoundedByteStream,
	) {
		const identity = graphicsObjectIdentity(`sha256/${digest}`);
		const result = await store.createImmutable({
			identity,
			bytes,
			metadata: {
				contentType: 'image/png',
				custom: { sha256: digest },
			},
		});
		if (result.outcome === 'unavailable')
			return result;
		if (
			result.object.byteLength !== bytes.byteLength
			|| result.object.contentType !== 'image/png'
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
			|| stored.object.contentType !== 'image/png'
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
		);
	}

	async function continuePngIngestion(
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
				maximumByteLength: MAX_PNG_INGESTION_BYTES,
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
			let processed: Awaited<ReturnType<typeof processPngStream>>;
			try {
				processed = await processPngStream({
					body: validationRead.body,
					byteLength: validationRead.object.byteLength,
					maximumByteLength: MAX_PNG_INGESTION_BYTES,
				}, sourceDigest);
			}
			catch (error) {
				if (!(error instanceof PngValidationError))
					throw error;
				const report = rejectedPngReport(error);
				const failed = await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'PNG did not satisfy the png-v1 compatibility profile.',
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
			const reservation = await catalogue.reservePngPublication({
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
					maximumByteLength: MAX_PNG_INGESTION_BYTES,
				}),
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
				? await catalogue.findReusablePng(processed.report.facts.sha256)
				: undefined;
			let completed: GraphicsIngestionOperation;
			if (reusable) {
				completed = await catalogue.reusePng({
					operation,
					reusable,
					publishedAt: timestamp(),
				});
			}
			else {
				try {
					completed = await catalogue.publishPng({
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
					const concurrentlyPublished = await catalogue.findReusablePng(
						processed.report.facts.sha256,
					);
					if (!concurrentlyPublished)
						throw publicationError;
					completed = await catalogue.reusePng({
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
				'Graphics Asset Library capacity is temporarily unavailable',
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
		async initiatePngIngestion(input) {
			if (!input.idempotencyKey.trim() || !input.initiatedBy.trim() || !input.name.trim())
				throw new GraphicsAssetLibraryError('Ingestion identity, author, and asset name are required', 'invalid-ingestion-input');
			if (
				!Number.isSafeInteger(input.declaredByteLength)
				|| input.declaredByteLength <= 0
				|| input.declaredByteLength > MAX_PNG_INGESTION_BYTES
			) {
				throw new GraphicsAssetLibraryError(`PNG must be between 1 and ${MAX_PNG_INGESTION_BYTES} bytes`, 'invalid-ingestion-input');
			}
			if (
				input.defaultEventId !== undefined
				&& (!Number.isSafeInteger(input.defaultEventId) || input.defaultEventId <= 0)
			) {
				throw new GraphicsAssetLibraryError('Default Event identity must be a positive integer', 'invalid-ingestion-input');
			}

			const createdAt = timestamp();
			return await catalogueRequest(() => requireCatalogue().initiatePngIngestion({
				id: graphicsIngestionOperationId(generateIdentity()),
				idempotencyKey: input.idempotencyKey,
				initiatedBy: input.initiatedBy,
				name: input.name.trim(),
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
		async cancelPngIngestion(input) {
			const catalogue = requireCatalogue();
			const operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'cancelled' || operation.stage === 'completed')
				return operation;
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
			if ('delete' in dependencies.staging) {
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await dependencies.staging.delete(
					graphicsObjectIdentity(`ingestion/${operation.id}/source`),
				);
			}
			return cancelled;
		},
		async uploadPng(input) {
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
			if (input.bytes.byteLength !== operation.declaredByteLength) {
				throw new GraphicsAssetLibraryError(
					'Transferred PNG length must match the initiated operation',
					'invalid-ingestion-input',
				);
			}

			operation = await catalogueRequest(
				() => catalogue.updateIngestionOperation(
					changedOperation(operation!, {
						stage: 'transferring',
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
			return await continuePngIngestion(operation);
		},
		async retryPngIngestion(input) {
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
				() => catalogue.claimPngIngestion({
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
			return await continuePngIngestion(claimed);
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

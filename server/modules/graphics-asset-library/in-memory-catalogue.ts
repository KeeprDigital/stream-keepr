import type {
	GraphicAsset,
	GraphicAssetId,
	GraphicAssetImageFacts,
	GraphicAssetRevisionId,
	GraphicsAssetLibraryCapacity,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsAssetCatalogue,
	PublishImageCatalogueInput,
} from '.';
import {
	DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
	DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
} from '~~/shared/types/graphicsAsset';
import { graphicsCanonicalCapacityPressure } from '~~/shared/utils/graphicsAssetCapacity';
import { GraphicsAssetLibraryError } from './errors';

interface InMemoryGraphicsAssetCatalogueOptions {
	canonicalLimitBytes?: number;
	stagingLimitBytes?: number;
}

export function createInMemoryGraphicsAssetCatalogue(
	options: InMemoryGraphicsAssetCatalogueOptions = {},
): GraphicsAssetCatalogue {
	const operations = new Map<GraphicsIngestionOperationId, GraphicsIngestionOperation>();
	const operationsByIdentity = new Map<string, GraphicsIngestionOperationId>();
	const assets = new Map<GraphicAssetId, GraphicAsset>();
	const revisions = new Map<GraphicAssetRevisionId, {
		assetId: GraphicAssetId;
		revisionNumber: number;
		facts: GraphicAssetImageFacts;
		thumbnailDigest: string;
	}>();
	const thumbnailDigests = new Map<GraphicAssetId, string>();
	const canonicalContents = new Map<string, {
		byteLength: number;
		category: 'source' | 'derivative';
	}>();
	const stagingReservations = new Map<GraphicsIngestionOperationId, number>();
	const stagingUsage = new Map<GraphicsIngestionOperationId, number>();
	const canonicalReservations = new Map<GraphicsIngestionOperationId, number>();
	const canonicalWriteCandidates = new Map<
		GraphicsIngestionOperationId,
		Map<string, number>
	>();
	let canonicalLimitBytes = options.canonicalLimitBytes ?? DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES;
	let stagingLimitBytes = options.stagingLimitBytes ?? DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES;

	function cloneOperation(operation: GraphicsIngestionOperation): GraphicsIngestionOperation {
		return structuredClone(operation);
	}

	function operationIdentity(initiatedBy: string, idempotencyKey: string) {
		return `${initiatedBy}\0${idempotencyKey}`;
	}

	function sum(values: Iterable<number>) {
		return [...values].reduce((total, value) => total + value, 0);
	}

	function releaseCapacity(operationId: GraphicsIngestionOperationId) {
		// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
		stagingReservations.delete(operationId);
		// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
		stagingUsage.delete(operationId);
		// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
		canonicalReservations.delete(operationId);
	}

	function getCapacity(): GraphicsAssetLibraryCapacity {
		const retainedSourceBytes = [...canonicalContents.values()]
			.filter(content => content.category === 'source')
			.reduce((total, content) => total + content.byteLength, 0);
		const retainedDerivativeBytes = [...canonicalContents.values()]
			.filter(content => content.category === 'derivative')
			.reduce((total, content) => total + content.byteLength, 0);
		const usedBytes = retainedSourceBytes + retainedDerivativeBytes;
		const canonicalReservedBytes = sum(canonicalReservations.values());
		const stagingUsedBytes = sum(stagingUsage.values());
		const stagingReservedBytes = sum(stagingReservations.values());
		const metadataBytes = new TextEncoder().encode(JSON.stringify({
			settings: { canonicalLimitBytes, stagingLimitBytes },
			operations: [
				...operations.values(),
			],
			assets: [...assets.values()],
			thumbnailDigests: [...thumbnailDigests],
			canonicalContents: [...canonicalContents],
			canonicalWriteCandidates: [...canonicalWriteCandidates].map(
				([operationId, contents]) => [operationId, [...contents]],
			),
		})).byteLength;
		const unreachableDigests = new Map<string, number>();
		for (const [operationId, contents] of canonicalWriteCandidates) {
			const operation = operations.get(operationId);
			const isUnreachable = operation?.stage === 'cancelled'
				|| (operation?.stage === 'failed' && operation.failure?.retryable === false);
			if (!isUnreachable)
				continue;
			for (const [digest, byteLength] of contents) {
				if (!canonicalContents.has(digest))
					unreachableDigests.set(digest, byteLength);
			}
		}
		const unreachableQuarantineBytes = sum(unreachableDigests.values());
		return {
			canonical: {
				limitBytes: canonicalLimitBytes,
				usedBytes,
				reservedBytes: canonicalReservedBytes,
				availableBytes: Math.max(0, canonicalLimitBytes - usedBytes - canonicalReservedBytes),
				pressure: graphicsCanonicalCapacityPressure(usedBytes, canonicalLimitBytes),
				breakdown: {
					retainedSourceBytes,
					retainedDerivativeBytes,
					metadataBytes,
					providerCacheBytes: 0,
					unreachableQuarantineBytes,
				},
			},
			staging: {
				limitBytes: stagingLimitBytes,
				usedBytes: stagingUsedBytes,
				reservedBytes: stagingReservedBytes,
				availableBytes: Math.max(0, stagingLimitBytes - stagingUsedBytes - stagingReservedBytes),
			},
		};
	}

	return {
		async checkHealth() {
			return { outcome: 'healthy' };
		},
		async getCapacity() {
			return getCapacity();
		},
		async updateCapacityLimits(input) {
			const capacity = getCapacity();
			if (
				input.canonicalLimitBytes
				< capacity.canonical.usedBytes + capacity.canonical.reservedBytes
			) {
				throw new GraphicsAssetLibraryError(
					'Canonical capacity cannot be set below current usage and reservations',
					'canonical-capacity-exhausted',
				);
			}
			if (
				input.stagingLimitBytes
				< capacity.staging.usedBytes + capacity.staging.reservedBytes
			) {
				throw new GraphicsAssetLibraryError(
					'Staging capacity cannot be set below current usage and reservations',
					'staging-capacity-exhausted',
				);
			}
			canonicalLimitBytes = input.canonicalLimitBytes;
			stagingLimitBytes = input.stagingLimitBytes;
			return getCapacity();
		},
		async initiateImageIngestion(operation) {
			const identity = operationIdentity(operation.initiatedBy, operation.idempotencyKey);
			const existingId = operationsByIdentity.get(identity);
			if (existingId)
				return cloneOperation(operations.get(existingId)!);
			const usedBytes = sum(stagingUsage.values());
			const reservedBytes = sum(stagingReservations.values());
			const availableBytes = Math.max(0, stagingLimitBytes - usedBytes - reservedBytes);
			if (operation.declaredByteLength > availableBytes) {
				throw new GraphicsAssetLibraryError(
					'Graphics staging capacity is exhausted',
					'staging-capacity-exhausted',
					{
						capacity: {
							resource: 'staging',
							limitBytes: stagingLimitBytes,
							usedBytes,
							reservedBytes,
							requestedBytes: operation.declaredByteLength,
							availableBytes,
						},
					},
				);
			}
			operations.set(operation.id, cloneOperation(operation));
			operationsByIdentity.set(identity, operation.id);
			stagingReservations.set(operation.id, operation.declaredByteLength);
			return cloneOperation(operation);
		},
		async recordStagedBytes(input) {
			const operation = operations.get(input.operation.id);
			if (
				!operation
				|| operation.stage === 'completed'
				|| operation.stage === 'cancelled'
				|| input.usedBytes < 0
				|| input.usedBytes > operation.declaredByteLength
			) {
				throw new Error('Graphics staging progress could not be recorded');
			}
			stagingUsage.set(operation.id, input.usedBytes);
			stagingReservations.set(operation.id, operation.declaredByteLength - input.usedBytes);
		},
		async recordCanonicalWrites(input) {
			const existing = canonicalWriteCandidates.get(input.operation.id) ?? new Map<string, number>();
			for (const content of input.contents)
				existing.set(content.digest, content.byteLength);
			canonicalWriteCandidates.set(input.operation.id, existing);
		},
		async reserveImagePublication(input) {
			const existing = operations.get(input.operation.id);
			if (
				!existing
				|| existing.updatedAt !== input.operation.updatedAt
				|| existing.stage !== 'generating-derivatives'
			) {
				throw new Error('Graphics canonical reservation lost its operation claim');
			}
			const proposed = new Map<string, number>([
				[input.sourceDigest, input.sourceByteLength],
				[input.thumbnailDigest, input.thumbnailByteLength],
			]);
			const growthBytes = [...proposed]
				.filter(([digest]) => !canonicalContents.has(digest))
				.reduce((total, [, byteLength]) => total + byteLength, 0);
			const usedBytes = getCapacity().canonical.usedBytes;
			const otherReservedBytes = [...canonicalReservations]
				.filter(([operationId]) => operationId !== input.operation.id)
				.reduce((total, [, byteLength]) => total + byteLength, 0);
			const availableBytes = Math.max(
				0,
				canonicalLimitBytes - usedBytes - otherReservedBytes,
			);
			if (growthBytes > availableBytes) {
				return {
					outcome: 'blocked' as const,
					capacity: {
						resource: 'canonical' as const,
						limitBytes: canonicalLimitBytes,
						usedBytes,
						reservedBytes: otherReservedBytes,
						requestedBytes: growthBytes,
						availableBytes,
					},
				};
			}
			const reserved: GraphicsIngestionOperation = {
				...input.operation,
				canonicalCapacityOutcome: growthBytes === 0
					? {
							outcome: 'no-canonical-growth',
							growthBytes: 0,
							availableBytes,
						}
					: {
							outcome: 'canonical-growth-reserved',
							growthBytes,
							availableBytes: availableBytes - growthBytes,
						},
				updatedAt: input.reservedAt,
			};
			operations.set(reserved.id, cloneOperation(reserved));
			canonicalReservations.set(reserved.id, growthBytes);
			return { outcome: 'reserved' as const, operation: cloneOperation(reserved) };
		},
		async getIngestionOperation(operationId, initiatedBy) {
			const operation = operations.get(operationId);
			return operation?.initiatedBy === initiatedBy ? cloneOperation(operation) : undefined;
		},
		async updateIngestionOperation(operation, expectedUpdatedAt) {
			const existing = operations.get(operation.id);
			if (!existing)
				throw new Error('Graphics Ingestion Operation not found');
			if (
				existing.stage === 'cancelled'
				|| existing.stage === 'completed'
			) {
				return cloneOperation(existing);
			}
			if (existing.updatedAt !== expectedUpdatedAt)
				throw new Error('Graphics Ingestion Operation transition lost its claim');
			operations.set(operation.id, cloneOperation(operation));
			if (
				operation.stage === 'completed'
				|| operation.stage === 'cancelled'
				|| (operation.stage === 'failed' && operation.failure?.retryable === false)
			) {
				releaseCapacity(operation.id);
			}
			return cloneOperation(operation);
		},
		async claimImageIngestion(input) {
			const existing = operations.get(input.operation.id);
			if (!existing || existing.initiatedBy !== input.operation.initiatedBy)
				return undefined;
			const retryableFailure = existing.stage === 'failed' && existing.failure?.retryable;
			const staleActive = !['created', 'completed', 'cancelled', 'failed'].includes(existing.stage)
				&& existing.updatedAt <= input.staleBefore;
			if (!retryableFailure && !staleActive)
				return undefined;
			const claimed: GraphicsIngestionOperation = {
				...existing,
				stage: 'hashing',
				updatedAt: input.claimedAt,
			};
			operations.set(claimed.id, cloneOperation(claimed));
			return cloneOperation(claimed);
		},
		async findReusableImage(sourceDigest) {
			const revision = [...revisions.entries()].find(([, candidate]) =>
				candidate.facts.sha256 === sourceDigest,
			);
			const asset = revision && assets.get(revision[1].assetId);
			return asset
				? { assetId: asset.id, revisionId: revision![0] }
				: undefined;
		},
		async findCurrentImage(assetId) {
			const asset = assets.get(assetId);
			return asset
				? {
						assetId,
						revisionId: asset.revisionId,
						sourceDigest: asset.facts.sha256,
					}
				: undefined;
		},
		async reuseImage(input) {
			const existing = operations.get(input.operation.id);
			const asset = assets.get(input.reusable.assetId);
			if (!existing || !asset)
				throw new Error('Reusable Graphic Asset or operation not found');
			if (existing.stage === 'cancelled' || existing.stage === 'completed')
				return cloneOperation(existing);
			if (existing.stage !== 'publishing')
				throw new Error('Graphics Ingestion Operation is not ready to reuse');
			if (existing.updatedAt !== input.operation.updatedAt)
				throw new Error('Graphics Ingestion Operation reuse lost its claim');
			const completed: GraphicsIngestionOperation = {
				...input.operation,
				stage: 'completed',
				failure: undefined,
				result: {
					outcome: 'reused',
					assetId: input.reusable.assetId,
					revisionId: input.reusable.revisionId,
				},
				updatedAt: input.publishedAt,
			};
			operations.set(completed.id, cloneOperation(completed));
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			canonicalWriteCandidates.delete(completed.id);
			releaseCapacity(completed.id);
			const eventIds = input.operation.defaultEventId === undefined
				? asset.eventIds
				: [...new Set([...asset.eventIds, input.operation.defaultEventId])].sort((left, right) => left - right);
			assets.set(asset.id, {
				...asset,
				eventIds,
				operation: cloneOperation(completed),
			});
			return cloneOperation(completed);
		},
		async completeImageReplacementNoop(input) {
			const existing = operations.get(input.operation.id);
			if (
				!existing
				|| existing.stage !== 'publishing'
				|| existing.updatedAt !== input.operation.updatedAt
			) {
				throw new Error('Graphic Asset replacement no-op lost its claim');
			}
			const completed: GraphicsIngestionOperation = {
				...input.operation,
				stage: 'completed',
				failure: undefined,
				result: {
					outcome: 'replacement-noop',
					assetId: input.current.assetId,
					revisionId: input.current.revisionId,
				},
				updatedAt: input.completedAt,
			};
			operations.set(completed.id, cloneOperation(completed));
			releaseCapacity(completed.id);
			return cloneOperation(completed);
		},
		async publishImageReplacement(input) {
			const existing = operations.get(input.operation.id);
			const asset = assets.get(input.targetAssetId);
			if (
				!existing
				|| !asset
				|| existing.stage !== 'publishing'
				|| existing.updatedAt !== input.operation.updatedAt
			) {
				throw new Error('Graphic Asset replacement publication lost its claim');
			}
			const revisionNumber = asset.revisionNumber + 1;
			const completed: GraphicsIngestionOperation = {
				...input.operation,
				stage: 'completed',
				failure: undefined,
				result: {
					outcome: 'revision-created',
					assetId: input.targetAssetId,
					revisionId: input.revisionId,
				},
				updatedAt: input.publishedAt,
			};
			operations.set(completed.id, cloneOperation(completed));
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			canonicalWriteCandidates.delete(completed.id);
			releaseCapacity(completed.id);
			revisions.set(input.revisionId, {
				assetId: input.targetAssetId,
				revisionNumber,
				facts: input.report.facts,
				thumbnailDigest: input.thumbnailDigest,
			});
			assets.set(input.targetAssetId, {
				...asset,
				revisionId: input.revisionId,
				revisionNumber,
				facts: input.report.facts,
				operation: cloneOperation(completed),
			});
			canonicalContents.set(input.sourceDigest, {
				byteLength: input.report.facts.byteLength,
				category: 'source',
			});
			if (!canonicalContents.has(input.thumbnailDigest)) {
				canonicalContents.set(input.thumbnailDigest, {
					byteLength: input.thumbnailByteLength,
					category: 'derivative',
				});
			}
			thumbnailDigests.set(input.targetAssetId, input.thumbnailDigest);
			return cloneOperation(completed);
		},
		async publishImage(input: PublishImageCatalogueInput) {
			const existing = operations.get(input.operation.id);
			if (!existing)
				throw new Error('Graphics Ingestion Operation not found');
			if (existing.stage === 'cancelled' || existing.stage === 'completed')
				return cloneOperation(existing);
			if (existing.stage !== 'publishing')
				throw new Error('Graphics Ingestion Operation is not ready to publish');
			if (existing.updatedAt !== input.operation.updatedAt)
				throw new Error('Graphics Ingestion Operation publication lost its claim');
			const reusable = input.operation.duplicateContentPolicy === 'reuse'
				? [...assets.values()].find(asset => asset.facts.sha256 === input.sourceDigest)
				: undefined;
			if (reusable) {
				const completed: GraphicsIngestionOperation = {
					...input.operation,
					stage: 'completed',
					failure: undefined,
					result: {
						outcome: 'reused',
						assetId: reusable.id,
						revisionId: reusable.revisionId,
					},
					updatedAt: input.publishedAt,
				};
				operations.set(completed.id, cloneOperation(completed));
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
				canonicalWriteCandidates.delete(completed.id);
				releaseCapacity(completed.id);
				assets.set(reusable.id, {
					...reusable,
					eventIds: input.operation.defaultEventId === undefined
						? reusable.eventIds
						: [...new Set([...reusable.eventIds, input.operation.defaultEventId])]
								.sort((left, right) => left - right),
					operation: cloneOperation(completed),
				});
				return cloneOperation(completed);
			}
			const completed: GraphicsIngestionOperation = {
				...input.operation,
				stage: 'completed',
				failure: undefined,
				result: {
					outcome: 'published',
					assetId: input.assetId,
					revisionId: input.revisionId,
				},
				updatedAt: input.publishedAt,
			};
			operations.set(completed.id, cloneOperation(completed));
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			canonicalWriteCandidates.delete(completed.id);
			releaseCapacity(completed.id);
			assets.set(input.assetId, {
				id: input.assetId,
				name: input.operation.name,
				kind: 'image',
				revisionId: input.revisionId,
				revisionNumber: 1,
				facts: input.report.facts,
				eventIds: input.operation.defaultEventId === undefined
					? []
					: [input.operation.defaultEventId],
				operation: cloneOperation(completed),
			});
			revisions.set(input.revisionId, {
				assetId: input.assetId,
				revisionNumber: 1,
				facts: input.report.facts,
				thumbnailDigest: input.thumbnailDigest,
			});
			canonicalContents.set(input.sourceDigest, {
				byteLength: input.report.facts.byteLength,
				category: 'source',
			});
			if (!canonicalContents.has(input.thumbnailDigest)) {
				canonicalContents.set(input.thumbnailDigest, {
					byteLength: input.thumbnailByteLength,
					category: 'derivative',
				});
			}
			thumbnailDigests.set(input.assetId, input.thumbnailDigest);
			return cloneOperation(completed);
		},
		async updateGraphicAsset(input) {
			const asset = assets.get(input.assetId);
			if (!asset)
				return undefined;
			const updated = {
				...asset,
				name: input.name,
				eventIds: [...input.eventIds],
			};
			assets.set(input.assetId, updated);
			return structuredClone(updated);
		},
		async listGraphicAssets(search) {
			const normalizedSearch = search.trim().toLocaleLowerCase();
			return [...assets.values()]
				.filter(asset => !normalizedSearch || asset.name.toLocaleLowerCase().includes(normalizedSearch))
				.map(asset => structuredClone(asset));
		},
		async findRevisionContent(input) {
			const revision = revisions.get(input.revisionId);
			if (!revision || revision.assetId !== input.assetId)
				return undefined;
			return {
				digest: revision.facts.sha256,
				byteLength: revision.facts.byteLength,
				canonicalMime: revision.facts.canonicalMime,
				lifecycleState: 'active',
			};
		},
		async listGraphicAssetUsage() {
			return [];
		},
		async findThumbnailDigest(assetId: GraphicAssetId) {
			const asset = assets.get(assetId);
			return asset
				? revisions.get(asset.revisionId)?.thumbnailDigest
				: undefined;
		},
	};
}

export function asGraphicAssetId(value: string): GraphicAssetId {
	return value as GraphicAssetId;
}

export function asGraphicAssetRevisionId(value: string): GraphicAssetRevisionId {
	return value as GraphicAssetRevisionId;
}

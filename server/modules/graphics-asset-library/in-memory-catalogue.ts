import type {
	GraphicAsset,
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsAssetCatalogue,
	PublishPngCatalogueInput,
} from '.';

export function createInMemoryGraphicsAssetCatalogue(): GraphicsAssetCatalogue {
	const operations = new Map<GraphicsIngestionOperationId, GraphicsIngestionOperation>();
	const operationsByIdentity = new Map<string, GraphicsIngestionOperationId>();
	const assets = new Map<GraphicAssetId, GraphicAsset>();
	const thumbnailDigests = new Map<GraphicAssetId, string>();

	function cloneOperation(operation: GraphicsIngestionOperation): GraphicsIngestionOperation {
		return structuredClone(operation);
	}

	function operationIdentity(initiatedBy: string, idempotencyKey: string) {
		return `${initiatedBy}\0${idempotencyKey}`;
	}

	return {
		async checkHealth() {
			return { outcome: 'healthy' };
		},
		async initiatePngIngestion(operation) {
			const identity = operationIdentity(operation.initiatedBy, operation.idempotencyKey);
			const existingId = operationsByIdentity.get(identity);
			if (existingId)
				return cloneOperation(operations.get(existingId)!);
			operations.set(operation.id, cloneOperation(operation));
			operationsByIdentity.set(identity, operation.id);
			return cloneOperation(operation);
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
			return cloneOperation(operation);
		},
		async claimPngIngestion(input) {
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
		async findReusablePng(sourceDigest) {
			const asset = [...assets.values()].find(candidate => candidate.facts.sha256 === sourceDigest);
			return asset
				? { assetId: asset.id, revisionId: asset.revisionId }
				: undefined;
		},
		async reusePng(input) {
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
		async publishPng(input: PublishPngCatalogueInput) {
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
			thumbnailDigests.set(input.assetId, input.thumbnailDigest);
			return cloneOperation(completed);
		},
		async listGraphicAssets(search) {
			const normalizedSearch = search.trim().toLocaleLowerCase();
			return [...assets.values()]
				.filter(asset => !normalizedSearch || asset.name.toLocaleLowerCase().includes(normalizedSearch))
				.map(asset => structuredClone(asset));
		},
		async findThumbnailDigest(assetId: GraphicAssetId) {
			return thumbnailDigests.get(assetId);
		},
	};
}

export function asGraphicAssetId(value: string): GraphicAssetId {
	return value as GraphicAssetId;
}

export function asGraphicAssetRevisionId(value: string): GraphicAssetRevisionId {
	return value as GraphicAssetRevisionId;
}

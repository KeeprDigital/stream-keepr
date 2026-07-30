import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';
import { graphicsObjectIdentity } from './object-store';

/**
 * Every staging object one Graphics Ingestion Operation may own. Cancellation,
 * terminal failure, and staged-input expiry all reclaim the same complete set.
 */
export function stagedIngestionObjectIdentities(operationId: GraphicsIngestionOperationId) {
	return [
		graphicsObjectIdentity(`ingestion/${operationId}/source`),
		graphicsObjectIdentity(`ingestion/${operationId}/video-poster`),
	];
}

export function completedGraphicAssetReplacementOperation(input: {
	operation: GraphicsIngestionOperation;
	outcome: 'revision-created' | 'replacement-noop';
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	completedAt: string;
}): GraphicsIngestionOperation {
	return {
		...input.operation,
		stage: 'completed',
		failure: undefined,
		result: {
			outcome: input.outcome,
			assetId: input.assetId,
			revisionId: input.revisionId,
		},
		updatedAt: input.completedAt,
	};
}

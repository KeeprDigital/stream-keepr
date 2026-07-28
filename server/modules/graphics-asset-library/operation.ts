import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';

export function completedImageReplacementOperation(input: {
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

import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
	TemplatePackageInstallationResult,
} from '~~/shared/types/graphicsAsset';
import type { InstallTemplatePackageCatalogueInput } from '.';
import { graphicsObjectIdentity } from './object-store';

/**
 * Installation always creates a Template rather than revising one: a package
 * carries an independent copy, and installing the same package twice produces
 * two Installed Graphics Templates rather than a second revision of one. The
 * column exists because a Template's revision is managed once authors can edit
 * one in place, which is the graphics-editor work rather than this transfer.
 */
export const INSTALLED_GRAPHICS_TEMPLATE_FIRST_REVISION = 1;

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

/**
 * What one complete Template Package installation published, in the order an
 * author reads it.
 *
 * Both the D1 catalogue and its in-memory double record this, and a difference
 * between the two would be a difference in what callers are told rather than in
 * how it is stored — so they derive it from the same place.
 */
export function templatePackageInstallationResult(
	input: Pick<InstallTemplatePackageCatalogueInput, 'template' | 'created' | 'reused'>,
): TemplatePackageInstallationResult {
	return {
		templateId: input.template.id,
		templateKind: input.template.kind,
		templateName: input.template.name,
		assets: [
			...input.created.map(asset => ({
				packagedId: asset.packagedId,
				outcome: 'created' as const,
				basis: asset.basis,
				assetId: asset.assetId,
				revisionId: asset.revisionId,
				name: asset.name,
				kind: asset.kind,
				compatibilityProfile: asset.compatibilityProfile,
			})),
			...input.reused.map(asset => ({
				packagedId: asset.packagedId,
				outcome: 'reused' as const,
				// Reuse happens for one reason only, which is why it is the mapping
				// that leaves the local asset untouched.
				basis: 'exact-origin' as const,
				assetId: asset.assetId,
				revisionId: asset.revisionId,
				name: asset.name,
				kind: asset.kind,
				compatibilityProfile: asset.compatibilityProfile,
			})),
		].sort((left, right) => left.packagedId.localeCompare(right.packagedId)),
	};
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

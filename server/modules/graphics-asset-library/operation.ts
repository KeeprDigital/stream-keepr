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
 * An operation nobody will hear from again: completed, cancelled, or failed
 * for good. The catalogues' `TERMINAL_STAGE_SQL` states the same rule.
 */
export function isTerminalIngestionOperation(
	operation: Pick<GraphicsIngestionOperation, 'stage' | 'failure'>,
): boolean {
	return operation.stage === 'completed'
		|| operation.stage === 'cancelled'
		|| (operation.stage === 'failed' && operation.failure?.retryable === false);
}

/**
 * Every staging object one Graphics Ingestion Operation may own. Cancellation,
 * terminal failure, and staged-input expiry all reclaim the same complete set.
 */
export function stagedIngestionObjectIdentities(operationId: GraphicsIngestionOperationId) {
	return [
		graphicsObjectIdentity(`ingestion/${operationId}/source`),
		graphicsObjectIdentity(`ingestion/${operationId}/video-poster`),
		graphicsObjectIdentity(`ingestion/${templatePackageVideoWorkingCopyOperationId(operationId)}/source`),
	];
}

/**
 * The staged working copy of the one packaged silent video a Template Package
 * operation is validating.
 *
 * The pinned validation runtime reads the whole staged source of the operation
 * it is given, and a package's staged source is the archive, not the video. So
 * each video entry is copied out under this reserved operation name, where the
 * runtime reads it exactly as it reads an uploaded one. The copy is one of the
 * objects the package operation owns, so every release of its staged input
 * reclaims a copy an interrupted preflight left behind.
 */
export function templatePackageVideoWorkingCopyOperationId(
	operationId: GraphicsIngestionOperationId,
): GraphicsIngestionOperationId {
	return `${operationId}-packaged-video` as GraphicsIngestionOperationId;
}

/**
 * What one complete Template Package installation published, in the order an
 * author reads it.
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

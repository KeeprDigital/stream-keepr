import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicAssetValidationReport,
	GraphicsDerivativeId,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';

import type { GraphicsCapacityExhaustedDetails } from './errors';
import type { GraphicsAssetMultipartState } from './multipart';
import type {
	GraphicsMultipartUploadIdentity,
} from './object-store';
import type { GraphicsIngestionOperationCatalogue } from './operation';

import type {
	ReleaseStagedInputBytes,
} from './retention';

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

/**
 * What Graphic Asset ingestion reads and writes in the catalogue, beyond the
 * Graphics Ingestion Operation lifecycle it runs on: staged-byte accounting,
 * the multipart checkpoint, exact-content reuse and atomic publication
 * (ADR-0073).
 */
export interface GraphicsAssetIngestionCatalogue extends GraphicsIngestionOperationCatalogue {
	recordStagedBytes: (input: {
		operation: GraphicsIngestionOperation;
		usedBytes: number;
		recordedAt: string;
	}) => Promise<void>;
	/**
	 * An approved remote copy reserves the worst-case staging envelope before
	 * any byte moves, because the exact length is only knowable from the remote
	 * response. This records the observed length as the operation's declared
	 * length and releases the unused part of that reservation.
	 */
	recordRemoteCopyStagedSource: (input: {
		operation: GraphicsIngestionOperation;
		observedByteLength: number;
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
		/** Another attempt took the operation; this one has nothing left to reserve for. */
		| { outcome: 'lost-claim' }
	>;
	getGraphicAssetMultipartState: (
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	) => Promise<GraphicsAssetMultipartState | undefined>;
	updateGraphicAssetMultipartState: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		expectedVersion: number;
		state: GraphicsAssetMultipartState;
		updatedAt: string;
	}) => Promise<boolean>;
	/**
	 * Records the multipart upload an approved remote copy is holding, or clears
	 * it with `null` once that upload is provably released. A remote copy moves
	 * its bytes server-side, so the checkpoint carries the uploadId alone: it
	 * exists only so expiry and cancellation can abort an upload whose own
	 * request died before it could.
	 */
	checkpointRemoteCopyMultipartUpload: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		uploadId: GraphicsMultipartUploadIdentity | null;
	}) => Promise<void>;
	recordGraphicAssetMultipartCleanupComplete: (
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	) => Promise<void>;
	/**
	 * Zeroes a terminal operation's staging accounting once its staged objects
	 * are proven deleted. Ingestion reaches it only through
	 * `releaseTerminalStagedInput`, which proves the deletes first.
	 */
	releaseStagedInputBytes: ReleaseStagedInputBytes;
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
}

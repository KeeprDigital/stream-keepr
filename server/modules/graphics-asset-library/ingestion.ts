import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicAssetSourceDeclarations,
	GraphicAssetValidationReport,
	GraphicsDerivativeId,
	GraphicsDuplicateContentPolicy,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsCapacityExhaustedDetails } from './errors';
import type { GraphicsAssetMultipartState } from './multipart';
import type {
	BoundedByteStream,
	GraphicsMultipartUploadIdentity,
} from './object-store';
import type { GraphicsIngestionOperationCatalogue } from './operation';
import type { ReleaseStagedInputBytes } from './retention';

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

/**
 * Graphic Asset ingestion: every way a Graphics Ingestion Operation is started,
 * fed its bytes, confirmed, cancelled and retried. `GraphicsAssetLibrary`
 * exposes these unchanged (ADR-0073).
 */
export interface GraphicsAssetIngestion {
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
	/**
	 * Initiates a one-time copy of an approved public HTTPS resource. The remote
	 * length is unknown until the copy runs, so the operation starts with the
	 * worst-case bound for the Graphic Asset kind implied by its declarations.
	 */
	initiateRemoteGraphicAssetCopy: (input: GraphicAssetSourceDeclarations & {
		idempotencyKey: string;
		initiatedBy: string;
		name: string;
		defaultEventId?: number;
		duplicateContentPolicy?: GraphicsDuplicateContentPolicy;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * Runs the bounded remote copy. The URL is never persisted, logged, or
	 * reported: it is supplied per attempt and its query parameters and fragment
	 * are treated as secrets.
	 */
	copyRemoteGraphicAssetSource: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		sourceUrl: string;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * Provisional staged bytes for an operation paused for browser confirmation.
	 * Only the initiating author may read them, and they remain undiscoverable
	 * and non-addressable outside this operation.
	 */
	resolveStagedGraphicAssetSource: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<
		| {
			outcome: 'available';
			body: ReadableStream<Uint8Array>;
			byteLength: number;
		}
		| { outcome: 'missing' }
		| { outcome: 'unavailable'; retryable: true }
	>;
	confirmGraphicAssetBrowserEvidence: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		evidence: NonNullable<GraphicAssetSourceDeclarations['browserDecodeEvidence']>;
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
	startGraphicAssetMultipartUpload: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	uploadGraphicAssetMultipartPart: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		partNumber: number;
		bytes: BoundedByteStream;
	}) => Promise<GraphicsIngestionOperation>;
	completeGraphicAssetMultipartUpload: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	retryGraphicsIngestion: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
	}) => Promise<GraphicsIngestionOperation>;
	/**
	 * The font-specific entry point into {@link confirmGraphicAssetBrowserEvidence}.
	 * It rejects non-font evidence before the shared kind check so a font client
	 * receives a font-shaped error.
	 */
	confirmFontBrowserEvidence: (input: {
		operationId: GraphicsIngestionOperationId;
		initiatedBy: string;
		evidence: NonNullable<GraphicAssetSourceDeclarations['browserDecodeEvidence']>;
	}) => Promise<GraphicsIngestionOperation>;
}

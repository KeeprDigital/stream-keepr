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
import type { GraphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import type { GraphicsAssetCatalogueHealth } from '.';
import type { GraphicsCapacityExhaustedDetails } from './errors';
import type { processStaticFont } from './font';
import type { GraphicsAssetMultipartState } from './multipart';
import type {
	BoundedByteStream,
	GraphicsCanonicalObjectStore,
	GraphicsMultipartPart,
	GraphicsMultipartPartIdentity,
	GraphicsMultipartUploadIdentity,
	GraphicsObjectStoreHealth,
	GraphicsStagingObjectStore,
} from './object-store';
import type { GraphicsIngestionOperationCatalogue } from './operation';
import type { GraphicsIngestionOperationLifecycle } from './operation-lifecycle';
import type { GraphicsRemoteSourceFetcher } from './remote-source';
import type { ReleaseStagedInputBytes } from './retention';
import type { processSilentVideo } from './silent-video';
import type { processStillImage } from './still-image';
import { graphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import {
	GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
	GRAPHICS_MULTIPART_MAXIMUM_PART_ATTEMPTS,
	GRAPHICS_MULTIPART_PART_BYTES,
	GRAPHICS_MULTIPART_PART_TRANSFER_TIMEOUT_MILLISECONDS,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { catalogueRequest } from './catalogue-request';
import { GraphicsAssetLibraryError } from './errors';
import { GRAPHIC_ASSET_SOURCE_POLICIES, processGraphicAssetSource } from './graphic-asset-source';
import { graphicAssetId, graphicAssetRevisionId, graphicsDerivativeId } from './identities';
import { graphicsIngestionPartIdentity, graphicsMultipartPartByteLength } from './multipart';
import {
	boundedByteStreamWithDeadline,
	consumeBoundedByteStream,
	createBoundedByteStream,
	graphicsObjectIdentity,
	GraphicsObjectInputError,
} from './object-store';
import { sha256Hex, sha256HexStream } from './png';
import { processSilentVideoFromRandomAccess, SilentVideoInspectionSourceError } from './silent-video';
import { GraphicAssetValidationError, rejectedValidationReport, validationError } from './validation';

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

export interface GraphicsAssetIngestionDependencies {
	/** Anything short of the ingestion catalogue refuses every call with `graphics-asset-library-unavailable`. */
	catalogue: GraphicsAssetCatalogueHealth | GraphicsAssetIngestionCatalogue;
	/** Anything short of a byte store refuses every call that needs it, the same way. */
	staging: GraphicsObjectStoreHealth | GraphicsStagingObjectStore;
	canonical: GraphicsObjectStoreHealth | GraphicsCanonicalObjectStore;
	/** The one instance the facade built: both pipelines match its validation error with `instanceof`. */
	lifecycle: GraphicsIngestionOperationLifecycle;
	remoteSource?: GraphicsRemoteSourceFetcher;
	now: () => Date;
	generateIdentity: () => string;
	/** Retention's Evidence for the revisions a publication superseded. It never fails the publication. */
	recordSupersession: (input: {
		assetId: GraphicAssetId;
		supersededAt: string;
		actor: string;
	}) => Promise<void>;
	/**
	 * Continues a Template Package operation, which is the facade's pipeline and
	 * not this module's. Called at one place, as the first thing continuing such
	 * an operation does: its archive is already staged and counted and, on a
	 * retry, the operation is already claimed. Its answer is returned untouched.
	 * It must not call back into ingestion for that operation, and it records a
	 * pipeline failure on the operation rather than throwing.
	 */
	continueTemplatePackage: (operation: GraphicsIngestionOperation) => Promise<GraphicsIngestionOperation>;
}

/**
 * Graphic Asset ingestion behind its own interface (ADR-0073). It owns four
 * rules: one active attempt per Graphics Ingestion Operation; staged bytes
 * counted against the Graphics Staging Allowance until their deletes are
 * proven; publication complete or nothing, and idempotent; and exact-content
 * reuse, with the replacement no-op.
 */
export function createGraphicsAssetIngestion(
	dependencies: GraphicsAssetIngestionDependencies,
): GraphicsAssetIngestion {
	const { now, generateIdentity, recordSupersession, continueTemplatePackage } = dependencies;
	const {
		activeIngestionLeaseMilliseconds,
		initiateGraphicsOperation,
		changedOperation,
		SilentVideoValidationRuntimeError,
		reportWithTrustedSilentVideoValidation,
		failOperation,
		releaseOwedStagedInput,
		releaseCancelledStagedInput,
		storeCanonicalStream,
		storeCanonicalBytes,
	} = dependencies.lifecycle;

	function requireCatalogue(): GraphicsAssetIngestionCatalogue {
		if (!('initiateGraphicsIngestion' in dependencies.catalogue))
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

	function timestamp() {
		return now().toISOString();
	}

	function timestampAfter(updatedAt: string) {
		return new Date(Math.max(
			now().getTime(),
			new Date(updatedAt).getTime() + 1,
		)).toISOString();
	}

	function reportWithBrowserDecodeEvidence(
		report: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>,
		operation: GraphicsIngestionOperation,
	): Extract<GraphicAssetValidationReport, { outcome: 'accepted' }> {
		const evidence = operation.browserDecodeEvidence;
		if (report.facts.kind === 'font') {
			if (
				!evidence
				|| evidence.outcome === 'decoded'
				|| evidence.outcome === 'rejected'
			) {
				validationError(
					'browser-font-load-failed',
					'FontFace challenge evidence is required before publication.',
				);
			}
			if (evidence.sourceDigest !== report.facts.sha256) {
				validationError(
					'browser-font-evidence-mismatch',
					'Browser font evidence does not match the staged source bytes.',
				);
			}
			if (evidence.outcome === 'font-rejected') {
				validationError(
					evidence.stage === 'load'
						? 'browser-font-load-failed'
						: 'browser-font-render-failed',
					evidence.stage === 'load'
						? 'The representative browser could not load the exact font bytes.'
						: 'The representative browser could not render covered glyphs without fallback.',
				);
			}
			if (evidence.challengeDigest !== report.facts.browserChallenge.digest) {
				validationError(
					'browser-font-evidence-mismatch',
					'Browser font evidence does not match the server-selected glyph challenge.',
				);
			}
			const challenge = report.facts.browserChallenge;
			// This is a same-origin browser attestation, not cryptographic remote
			// attestation. Binding every proof to server-inspected coverage and two
			// distinct fallback rasters prevents accidental fallback in the authoring
			// client; deployed browser acceptance remains the trusted runtime proof.
			if (
				evidence.glyphProofs.length !== challenge.codePoints.length
				|| evidence.glyphProofs.some((proof, index) => {
					const digest = /^[a-f0-9]{64}$/;
					return proof.codePoint !== challenge.codePoints[index]
						|| !digest.test(proof.exactWithSansDigest)
						|| !digest.test(proof.exactWithMonoDigest)
						|| !digest.test(proof.sansFallbackDigest)
						|| !digest.test(proof.monoFallbackDigest)
						|| proof.exactWithSansDigest !== proof.exactWithMonoDigest
						|| proof.sansFallbackDigest === proof.monoFallbackDigest
						|| proof.exactWithSansDigest === proof.sansFallbackDigest
						|| proof.exactWithSansDigest === proof.monoFallbackDigest;
				})
			) {
				validationError(
					'browser-font-render-failed',
					'Each challenged glyph must render identically through the exact face and differently through independent fallbacks.',
				);
			}
			return {
				...report,
				facts: {
					...report.facts,
					browserLoadable: true,
					representativeGlyphsRendered: true,
				},
			} as Extract<GraphicAssetValidationReport, { compatibilityProfile: 'static-font-v1' }>;
		}
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
		if (
			evidence.outcome === 'font-loaded'
			|| evidence.outcome === 'font-rejected'
		) {
			validationError(
				'browser-image-decode-failed',
				'Image browser decode evidence is required before publication.',
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
		} as Extract<GraphicAssetValidationReport, { compatibilityProfile: 'still-image-v1' }>;
	}

	type StageRemoteSourceOutcome
		= | { outcome: 'staged'; byteLength: number }
			/** Only a source that declared a length can contradict it. */
			| { outcome: 'length-mismatch'; declaredByteLength: number }
			| { outcome: 'length-exceeded' }
			| { outcome: 'empty' }
			| { outcome: 'unavailable' };

	/**
	 * Copies a remote body into staging without ever holding a complete Graphic
	 * Asset in Worker memory.
	 *
	 * A declared length lets the object store write one fixed-length object. When
	 * the origin declared none, the length is discovered while reading: bytes
	 * accumulate up to one multipart part, and only if the source outgrows that
	 * part does a resumable multipart transfer start. So at most one part is ever
	 * resident, which is the same bound the single-shot upload route enforces.
	 */
	async function stageRemoteSource(input: {
		staging: GraphicsStagingObjectStore;
		identity: ReturnType<typeof graphicsObjectIdentity>;
		operationId: GraphicsIngestionOperationId;
		body: ReadableStream<Uint8Array>;
		maximumByteLength: number;
		declaredByteLength?: number;
		/**
		 * Told which multipart upload this copy holds, and told `null` once that
		 * upload is provably released. An upload outlives the request that opened
		 * it, so the caller's record of it has to be durable before the first part
		 * is sent and may only be dropped once there is nothing left to abort.
		 */
		onMultipartCheckpoint?: (
			uploadId: GraphicsMultipartUploadIdentity | null,
		) => Promise<void>;
	}): Promise<StageRemoteSourceOutcome> {
		const metadata = {
			contentType: 'application/octet-stream',
			custom: { operationId: input.operationId },
		} as const;

		if (input.declaredByteLength !== undefined) {
			let staged: Awaited<ReturnType<typeof input.staging.createImmutable>>;
			try {
				staged = await input.staging.createImmutable({
					identity: input.identity,
					bytes: createBoundedByteStream(input.body, {
						byteLength: input.declaredByteLength,
						maximumByteLength: input.maximumByteLength,
					}),
					metadata,
				});
			}
			catch (error) {
				return error instanceof GraphicsObjectInputError
					? { outcome: 'length-mismatch', declaredByteLength: input.declaredByteLength }
					: { outcome: 'unavailable' };
			}
			if (staged.outcome === 'unavailable')
				return { outcome: 'unavailable' };
			return staged.object.byteLength === input.declaredByteLength
				? { outcome: 'staged', byteLength: staged.object.byteLength }
				: { outcome: 'length-mismatch', declaredByteLength: input.declaredByteLength };
		}

		const reader = input.body.getReader();
		const pending: Uint8Array[] = [];
		let pendingByteLength = 0;
		let totalByteLength = 0;
		let upload: { identity: typeof input.identity; uploadId: GraphicsMultipartUploadIdentity } | undefined;
		const parts: GraphicsMultipartPart[] = [];

		function takePendingPart(byteCount: number) {
			const part = new Uint8Array(byteCount);
			let offset = 0;
			while (offset < byteCount) {
				const chunk = pending[0]!;
				const take = Math.min(chunk.byteLength, byteCount - offset);
				part.set(chunk.subarray(0, take), offset);
				offset += take;
				if (take === chunk.byteLength)
					pending.shift();
				else
					pending[0] = chunk.subarray(take);
			}
			pendingByteLength -= byteCount;
			return part;
		}

		async function abort() {
			await reader.cancel().catch(() => undefined);
			if (!upload)
				return;
			const aborted = await input.staging.abortMultipart(upload);
			// An abort that did not land leaves the upload for a later sweep, which
			// can only find it while the caller's checkpoint still names it. An
			// upload the store no longer holds needs no sweep, so its checkpoint is
			// cleared too: only `unavailable` is a reason to keep one.
			if (aborted.outcome !== 'unavailable')
				await input.onMultipartCheckpoint?.(null);
		}

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done)
					break;
				totalByteLength += value.byteLength;
				if (totalByteLength > input.maximumByteLength) {
					await abort();
					return { outcome: 'length-exceeded' };
				}
				pending.push(value);
				pendingByteLength += value.byteLength;
				// Keep one whole part in hand so the last part can be the short one.
				while (pendingByteLength > GRAPHICS_MULTIPART_PART_BYTES) {
					if (!upload) {
						const started = await input.staging.beginMultipart({
							identity: input.identity,
							metadata,
						});
						if (started.outcome === 'unavailable') {
							await abort();
							return { outcome: 'unavailable' };
						}
						upload = started.upload;
						await input.onMultipartCheckpoint?.(upload.uploadId);
					}
					const uploaded = await input.staging.uploadPart({
						upload,
						partNumber: parts.length + 1,
						bytes: createBoundedByteStream(takePendingPart(GRAPHICS_MULTIPART_PART_BYTES), {
							byteLength: GRAPHICS_MULTIPART_PART_BYTES,
							maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
						}),
					});
					if (uploaded.outcome === 'unavailable') {
						await abort();
						return { outcome: 'unavailable' };
					}
					parts.push(uploaded.part);
				}
			}
		}
		catch {
			await abort();
			return { outcome: 'unavailable' };
		}

		if (totalByteLength === 0) {
			await abort();
			return { outcome: 'empty' };
		}

		const tail = takePendingPart(pendingByteLength);
		if (!upload) {
			const staged = await input.staging.createImmutable({
				identity: input.identity,
				bytes: createBoundedByteStream(tail, {
					byteLength: tail.byteLength,
					maximumByteLength: input.maximumByteLength,
				}),
				metadata,
			});
			if (staged.outcome === 'unavailable')
				return { outcome: 'unavailable' };
			return { outcome: 'staged', byteLength: staged.object.byteLength };
		}
		const uploadedTail = await input.staging.uploadPart({
			upload,
			partNumber: parts.length + 1,
			bytes: createBoundedByteStream(tail, {
				byteLength: tail.byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		});
		if (uploadedTail.outcome === 'unavailable') {
			await abort();
			return { outcome: 'unavailable' };
		}
		parts.push(uploadedTail.part);
		const completed = await input.staging.completeMultipart({ upload, parts });
		if (completed.outcome === 'unavailable')
			return { outcome: 'unavailable' };
		await input.onMultipartCheckpoint?.(null);
		// The source declared no length to contradict, so a store that assembles a
		// different total is a staging integrity failure, not a remote rejection.
		return completed.object.byteLength === totalByteLength
			? { outcome: 'staged', byteLength: completed.object.byteLength }
			: { outcome: 'unavailable' };
	}

	async function continueGraphicsIngestion(
		initialOperation: GraphicsIngestionOperation,
	): Promise<GraphicsIngestionOperation> {
		if (initialOperation.source === 'template-package')
			return await continueTemplatePackage(initialOperation);
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
				await releaseOwedStagedInput(authoritative);
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
				maximumByteLength: GRAPHIC_ASSET_SOURCE_POLICIES[
					graphicAssetSourceKind(operation)
				].maximumByteLength,
			});
			const hashingTerminal = await terminalOperationAtCheckpoint();
			if (hashingTerminal)
				return hashingTerminal;

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, { stage: 'validating' }),
				operation.updatedAt,
			);
			const leadingLength = Math.min(64, operation.declaredByteLength);
			const leadingRead = await staging.read(stagingIdentity, {
				offset: 0,
				length: leadingLength,
			});
			if (leadingRead.outcome !== 'available') {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staged source bytes are temporarily unavailable.',
				}, operation.report);
			}
			let processed:
				| Awaited<ReturnType<typeof processStillImage>>
				| Awaited<ReturnType<typeof processSilentVideo>>
				| Awaited<ReturnType<typeof processStaticFont>>;
			let sourceKind: GraphicAssetSourceKind = graphicAssetSourceKind(operation);
			let derivative: Uint8Array | undefined;
			let report: Extract<GraphicAssetValidationReport, { outcome: 'accepted' }>;
			try {
				const leadingBytes = await consumeBoundedByteStream({
					body: leadingRead.body,
					byteLength: leadingLength,
					maximumByteLength: leadingLength,
				});
				sourceKind = graphicAssetSourceKind(operation, leadingBytes);
				if (sourceKind === 'silent-video') {
					processed = await processSilentVideoFromRandomAccess({
						byteLength: stagedMetadata.object.byteLength,
						sha256: sourceDigest,
						read: async (offset, length) => {
							const range = await staging.read(stagingIdentity, { offset, length });
							if (range.outcome !== 'available') {
								return range.outcome === 'missing'
									? { outcome: 'missing' as const }
									: { outcome: 'unavailable' as const, retryable: true as const };
							}
							try {
								const bytes = await consumeBoundedByteStream({
									body: range.body,
									byteLength: length,
									maximumByteLength: length,
								});
								if (
									range.range.offset !== offset
									|| range.range.length !== length
									|| range.range.completeLength !== stagedMetadata.object.byteLength
								) {
									return { outcome: 'unavailable' as const, retryable: true as const };
								}
								return {
									outcome: 'available' as const,
									bytes,
									completeLength: range.range.completeLength,
								};
							}
							catch {
								return { outcome: 'unavailable' as const, retryable: true as const };
							}
						},
					}, {
						sourceFileName: operation.sourceFileName,
						declaredMime: operation.declaredMime,
					});
				}
				else {
					const validationRead = await staging.read(stagingIdentity);
					if (validationRead.outcome !== 'available')
						throw new Error('Staged source bytes are temporarily unavailable.');
					const validationBytes = await consumeBoundedByteStream({
						body: validationRead.body,
						byteLength: validationRead.object.byteLength,
						maximumByteLength: GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind].maximumByteLength,
					});
					processed = await processGraphicAssetSource(sourceKind, validationBytes, {
						sourceFileName: operation.sourceFileName,
						declaredMime: operation.declaredMime,
					});
				}
				// A local upload arrives with browser evidence for its own file. An
				// approved remote copy has no client-side bytes, so the operation
				// pauses here until the author confirms the staged source instead.
				if (
					!operation.browserDecodeEvidence
					&& (
						processed.report.facts.kind === 'font'
						|| (operation.source === 'remote-copy' && processed.report.facts.kind === 'image')
					)
				) {
					return await catalogue.updateIngestionOperation(
						changedOperation(operation, {
							stage: 'awaiting-confirmation',
							report: processed.report,
						}),
						operation.updatedAt,
					);
				}
				if (processed.report.facts.kind === 'silent-video') {
					const trusted = await reportWithTrustedSilentVideoValidation(
						processed.report as Extract<GraphicAssetValidationReport, {
							outcome: 'accepted';
							compatibilityProfile: 'silent-video-v1';
						}>,
						operation,
					);
					report = trusted.report;
					derivative = trusted.derivative;
				}
				else {
					report = reportWithBrowserDecodeEvidence(processed.report, operation);
					if (!('thumbnail' in processed))
						throw new Error('Validated still image or font is missing its deterministic derivative');
					derivative = processed.thumbnail;
				}
			}
			catch (error) {
				if (error instanceof SilentVideoInspectionSourceError) {
					return await failOperation(catalogue, operation, {
						code: 'staging-unavailable',
						retryable: true,
						message: error.outcome === 'missing'
							? 'Staged source bytes are missing.'
							: 'Staged source bytes are temporarily unavailable.',
					}, operation.report);
				}
				if (error instanceof SilentVideoValidationRuntimeError) {
					return await failOperation(catalogue, operation, {
						code: 'validation-runtime-unavailable',
						retryable: true,
						message: 'Trusted silent-video playback validation is temporarily unavailable.',
					}, operation.report);
				}
				if (!(error instanceof GraphicAssetValidationError))
					throw error;
				const report = rejectedValidationReport(
					error,
					GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind].compatibilityProfile,
				);
				// A permanent rejection: `failOperation` releases the staged input.
				return await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'Graphic Asset did not satisfy its compatibility profile.',
				}, report);
			}
			const validationTerminal = await terminalOperationAtCheckpoint();
			if (validationTerminal)
				return validationTerminal;

			if (operation.targetAssetId) {
				const current = await catalogue.findCurrentGraphicAsset(operation.targetAssetId);
				if (!current)
					throw new Error('Replacement target Graphic Asset was not found');
				if (current.sourceDigest === report.facts.sha256) {
					operation = await catalogue.updateIngestionOperation(
						changedOperation(operation, {
							stage: 'publishing',
							report,
						}),
						operation.updatedAt,
					);
					const completed = await catalogue.completeGraphicAssetReplacementNoop({
						operation,
						current,
						completedAt: timestamp(),
					});
					await releaseOwedStagedInput(completed);
					return completed;
				}
			}

			operation = await catalogue.updateIngestionOperation(
				changedOperation(operation, {
					stage: 'generating-derivatives',
					report,
				}),
				operation.updatedAt,
			);
			const derivativeStartTerminal = await terminalOperationAtCheckpoint();
			if (derivativeStartTerminal)
				return derivativeStartTerminal;

			const thumbnail = derivative!;
			const thumbnailDigest = await sha256Hex(thumbnail);
			const reservation = await catalogue.reserveGraphicAssetPublication({
				operation,
				sourceDigest: report.facts.sha256,
				sourceByteLength: report.facts.byteLength,
				thumbnailDigest,
				thumbnailByteLength: thumbnail.byteLength,
				reservedAt: changedOperation(operation, {}).updatedAt,
			});
			if (reservation.outcome === 'lost-claim') {
				// Another attempt owns this operation now, and whatever it decided is the
				// authoritative answer — so it is read rather than guessed at, and never
				// reported as a capacity problem the author would go off and try to solve.
				return await catalogueRequest(
					() => catalogue.getIngestionOperation(operation.id, operation.initiatedBy),
					'Graphics ingestion state is temporarily unavailable',
				) ?? operation;
			}
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
				}, report);
			}
			operation = reservation.operation;
			const canonicalSourceRead = await staging.read(stagingIdentity);
			if (canonicalSourceRead.outcome !== 'available') {
				return await failOperation(catalogue, operation, {
					code: 'staging-unavailable',
					retryable: true,
					message: 'Staged source bytes are temporarily unavailable.',
				}, report);
			}
			// The claim is recorded before a byte moves. An object present in the
			// canonical store that nothing in the catalogue accounts for is exactly
			// what the reconciliation scan quarantines as unexpected, so writing
			// first would leave a window in which a publication in flight could have
			// its own bytes quarantined out from under it.
			//
			// Claiming a digest whose write then never happens is harmless: the
			// candidate is removed by publication, and an abandoned operation's
			// candidates are collected by the retention path, whose byte deletion
			// treats an already-absent object as deleted rather than as a failure.
			await catalogue.recordCanonicalWrites({
				operation,
				contents: [
					{ digest: report.facts.sha256, byteLength: report.facts.byteLength },
					{ digest: thumbnailDigest, byteLength: thumbnail.byteLength },
				],
				recordedAt: timestamp(),
			});
			const [sourceWrite, thumbnailWrite] = await Promise.all([
				storeCanonicalStream(canonical, report.facts.sha256, {
					body: canonicalSourceRead.body,
					byteLength: canonicalSourceRead.object.byteLength,
					maximumByteLength: GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind].maximumByteLength,
				}, report.facts.canonicalMime),
				storeCanonicalBytes(canonical, thumbnailDigest, thumbnail),
			]);
			if (sourceWrite.outcome === 'unavailable' || thumbnailWrite.outcome === 'unavailable') {
				return await failOperation(catalogue, operation, {
					code: 'canonical-store-unavailable',
					retryable: true,
					message: 'Canonical source or thumbnail storage is temporarily unavailable.',
				}, report);
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

			const reusable = !operation.targetAssetId && operation.duplicateContentPolicy === 'reuse'
				? await catalogue.findReusableGraphicAsset(report.facts.sha256)
				: undefined;
			let completed: GraphicsIngestionOperation;
			// Replacement supersedes the previous revision and the catalogue
			// authors its retention deadline inside that same transaction, so the
			// exact instant is captured here to record the deadline as Evidence.
			let supersededAt: string | undefined;
			if (reusable) {
				completed = await catalogue.reuseGraphicAsset({
					operation,
					reusable,
					publishedAt: timestamp(),
				});
			}
			else if (operation.targetAssetId) {
				supersededAt = timestamp();
				completed = await catalogue.publishGraphicAssetReplacement({
					operation,
					targetAssetId: operation.targetAssetId,
					report,
					assetId: operation.targetAssetId,
					revisionId: graphicAssetRevisionId(generateIdentity()),
					derivativeId: graphicsDerivativeId(generateIdentity()),
					sourceDigest: report.facts.sha256,
					thumbnailDigest,
					thumbnailByteLength: thumbnail.byteLength,
					publishedAt: supersededAt,
				});
			}
			else {
				try {
					completed = await catalogue.publishGraphicAsset({
						operation,
						report,
						assetId: graphicAssetId(generateIdentity()),
						revisionId: graphicAssetRevisionId(generateIdentity()),
						derivativeId: graphicsDerivativeId(generateIdentity()),
						sourceDigest: report.facts.sha256,
						thumbnailDigest,
						thumbnailByteLength: thumbnail.byteLength,
						publishedAt: timestamp(),
					});
				}
				catch (publicationError) {
					if (operation.duplicateContentPolicy === 'create-separate')
						throw publicationError;
					const concurrentlyPublished = await catalogue.findReusableGraphicAsset(
						report.facts.sha256,
					);
					if (!concurrentlyPublished)
						throw publicationError;
					completed = await catalogue.reuseGraphicAsset({
						operation,
						reusable: concurrentlyPublished,
						publishedAt: timestamp(),
					});
				}
			}
			// Published: whatever the release below manages, `completed` is the
			// answer, and a release the store refuses stays owed (#700).
			await releaseOwedStagedInput(completed);
			if (supersededAt && operation.targetAssetId) {
				await recordSupersession({
					assetId: operation.targetAssetId,
					supersededAt,
					actor: operation.initiatedBy,
				});
			}
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
			if (authoritative?.stage === 'completed' || authoritative?.stage === 'cancelled') {
				// Whatever was interrupted, the operation is terminal and owes its
				// staged input back; repeating a release that already ran is safe.
				await releaseOwedStagedInput(authoritative);
				return authoritative;
			}
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
		async initiateGraphicsIngestion(input) {
			if (!input.name.trim())
				throw new GraphicsAssetLibraryError('Graphic Asset name is required', 'invalid-ingestion-input');
			return await initiateGraphicsOperation({
				...input,
				name: input.name,
				source: 'local-upload',
				duplicateContentPolicy: input.duplicateContentPolicy ?? 'reuse',
			});
		},
		async initiateGraphicAssetReplacement(input) {
			return await initiateGraphicsOperation({
				...input,
				name: 'Graphic Asset replacement',
				source: 'replacement',
				targetAssetId: input.assetId,
				duplicateContentPolicy: 'create-separate',
			});
		},
		async initiateRemoteGraphicAssetCopy(input) {
			if (!input.name.trim())
				throw new GraphicsAssetLibraryError('Graphic Asset name is required', 'invalid-ingestion-input');
			return await initiateGraphicsOperation({
				...input,
				name: input.name,
				source: 'remote-copy',
				duplicateContentPolicy: input.duplicateContentPolicy ?? 'reuse',
				declaredByteLength:
					GRAPHIC_ASSET_SOURCE_POLICIES[graphicAssetSourceKind(input)].maximumByteLength,
			});
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
		async cancelGraphicsIngestion(input) {
			const catalogue = requireCatalogue();
			const operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'completed')
				return operation;
			// Repeating a cancellation retries whatever release it still owes.
			if (operation.stage === 'cancelled')
				return await releaseCancelledStagedInput(catalogue, operation);
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
			return await releaseCancelledStagedInput(catalogue, cancelled);
		},
		async startGraphicAssetMultipartUpload(input) {
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
			// An approved remote copy owns the same staging identity for the whole
			// of its own transfer, so a client-driven multipart must not race it.
			if (operation.source === 'remote-copy') {
				throw new GraphicsAssetLibraryError(
					'An approved remote copy transfers its own source and cannot accept a client multipart upload',
					'ingestion-operation-not-uploadable',
				);
			}
			if (operation.stage !== 'created' && operation.stage !== 'transferring') {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot start multipart transfer from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}

			const existing = await catalogueRequest(
				() => catalogue.getGraphicAssetMultipartState(operation.id, operation.initiatedBy),
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
			const state: GraphicsAssetMultipartState = {
				version: initialVersion + 1,
				uploadId: started.upload.uploadId,
				cleanupPending: false,
				parts: existing?.parts ?? [],
			};
			const recorded = await catalogueRequest(
				() => catalogue.updateGraphicAssetMultipartState({
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
				return await this.startGraphicAssetMultipartUpload(input);
			}
			return await this.getIngestionOperation(input);
		},
		async uploadGraphicAssetMultipartPart(input) {
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

			let claimedState: GraphicsAssetMultipartState | undefined;
			for (let claimAttempt = 0; claimAttempt < 8; claimAttempt++) {
				const state = await catalogueRequest(
					() => catalogue.getGraphicAssetMultipartState(operation!.id, operation!.initiatedBy),
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
				const claimedPart: GraphicsAssetMultipartState['parts'][number] = {
					partNumber: input.partNumber,
					partIdentity: graphicsIngestionPartIdentity(operation.id, input.partNumber),
					byteLength: expectedByteLength,
					status: 'uploading',
					claimedAt: timestamp(),
					attempts,
				};
				const claimed: GraphicsAssetMultipartState = {
					...state,
					version: state.version + 1,
					parts: [
						...availableParts.filter(part => part.partNumber !== input.partNumber),
						claimedPart,
					],
				};
				const recorded = await catalogueRequest(
					() => catalogue.updateGraphicAssetMultipartState({
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
			// The claim is given back however the transfer ends short of a recorded
			// part: a claim left `uploading` refuses every retry until its lease lapses.
			// Sibling parts move the checkpoint meanwhile, so the write re-reads it and
			// gives back only this request's own claim, never one that superseded it.
			const ownClaim = claimedState.parts.find(part => part.partNumber === input.partNumber);
			const releasePartClaim = async () => {
				for (let releaseAttempt = 0; releaseAttempt < 8; releaseAttempt++) {
					const latest = await catalogueRequest(
						() => catalogue.getGraphicAssetMultipartState(operation!.id, operation!.initiatedBy),
						'Graphics multipart checkpoint is temporarily unavailable',
					);
					const held = latest?.parts.find(part => part.partNumber === input.partNumber);
					if (
						!latest
						|| held?.status !== 'uploading'
						|| held.claimedAt !== ownClaim?.claimedAt
						|| held.attempts !== ownClaim?.attempts
					) {
						return;
					}
					const released = await catalogueRequest(
						() => catalogue.updateGraphicAssetMultipartState({
							operationId: operation!.id,
							initiatedBy: operation!.initiatedBy,
							expectedVersion: latest.version,
							state: {
								...latest,
								version: latest.version + 1,
								parts: latest.parts.map(part =>
									part.partNumber === input.partNumber
										? { ...part, status: 'failed' as const }
										: part),
							},
							updatedAt: timestampAfter(operation!.updatedAt),
						}),
						'Graphics multipart retry checkpoint could not be recorded',
					);
					if (released)
						return;
				}
			};
			let claimHeld = true;
			try {
				const uploaded = await staging.uploadPart({
					upload,
					partNumber: input.partNumber,
					bytes: boundedByteStreamWithDeadline(
						input.bytes,
						GRAPHICS_MULTIPART_PART_TRANSFER_TIMEOUT_MILLISECONDS,
					),
				});
				if (uploaded.outcome === 'unavailable') {
					throw new GraphicsAssetLibraryError(
						`Multipart part ${input.partNumber} is temporarily unavailable`,
						'graphics-asset-library-unavailable',
					);
				}

				for (let recordAttempt = 0; recordAttempt < 8; recordAttempt++) {
					const latest = await catalogueRequest(
						() => catalogue.getGraphicAssetMultipartState(operation!.id, operation!.initiatedBy),
						'Graphics multipart checkpoint is temporarily unavailable',
					);
					if (!latest)
						break;
					const existing = latest.parts.find(part => part.partNumber === input.partNumber);
					if (existing?.status === 'completed') {
						claimHeld = false;
						return await this.getIngestionOperation(input);
					}
					const completed: GraphicsAssetMultipartState = {
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
						() => catalogue.updateGraphicAssetMultipartState({
							operationId: operation!.id,
							initiatedBy: operation!.initiatedBy,
							expectedVersion: latest.version,
							state: completed,
							updatedAt: timestampAfter(operation!.updatedAt),
						}),
						'Graphics multipart completed part could not be recorded',
					);
					if (recorded) {
						claimHeld = false;
						return await this.getIngestionOperation(input);
					}
					operation = await this.getIngestionOperation(input);
					if (operation.stage === 'completed' || operation.stage === 'cancelled') {
						claimHeld = false;
						return operation;
					}
				}
				throw new GraphicsAssetLibraryError(
					'Graphics multipart completed part could not be checkpointed',
					'graphics-asset-library-unavailable',
				);
			}
			finally {
				// A release the catalogue refuses must not hide why the part failed;
				// the claim then lapses with its lease, as before.
				if (claimHeld)
					await releasePartClaim().catch(() => undefined);
			}
		},
		async completeGraphicAssetMultipartUpload(input) {
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
				() => catalogue.getGraphicAssetMultipartState(operation.id, operation.initiatedBy),
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
					recordedAt: timestamp(),
				}),
				'Graphics staging progress could not be recorded',
			);
			const authoritative = await this.getIngestionOperation(input);
			return await continueGraphicsIngestion(authoritative);
		},
		async uploadGraphicAsset(input) {
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
			// A transfer that staged nothing left no bytes a retry could resume
			// from, so sending them again is its only way on. Once bytes are held
			// the operation is continued by a retry, never by a second transfer.
			const uploadable = operation.stage === 'created'
				|| (
					operation.transferredByteLength === 0
					&& !operation.transfer
					&& (
						operation.stage === 'transferring'
						|| (operation.stage === 'failed' && operation.failure?.retryable !== false)
					)
				);
			if (!uploadable) {
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
					'Transferred Graphic Asset length must match the initiated operation',
					'invalid-ingestion-input',
				);
			}
			const initiatedMime = operation.declaredMime?.trim().toLocaleLowerCase();
			const transferMime = input.declaredMime?.trim().toLocaleLowerCase();
			// A Template Package declares its artifact type in its own manifest, and
			// preflight holds that declaration to the archive it actually received.
			// A transfer header disagreeing with it is not a validation report about
			// one Graphic Asset, so it is left for preflight to judge.
			if (
				operation.source !== 'template-package'
				&& initiatedMime
				&& transferMime
				&& initiatedMime !== transferMime
			) {
				const sourceKind = graphicAssetSourceKind(operation);
				const sourcePolicy = GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind];
				return await failOperation(catalogue, operation, {
					code: 'validation-failed',
					retryable: false,
					message: 'Graphic Asset declarations conflict before validation.',
				}, {
					outcome: 'rejected',
					compatibilityProfile: sourcePolicy.compatibilityProfile,
					issues: [
						{
							severity: 'error',
							code: sourcePolicy.conflictingMimeCode,
							message: `Initiated MIME ${initiatedMime} conflicts with transfer MIME ${transferMime}.`,
						},
					],
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
				await releaseOwedStagedInput(authoritative);
				return authoritative;
			}
			await catalogueRequest(
				() => catalogue.recordStagedBytes({
					operation,
					usedBytes: staged.object.byteLength,
					recordedAt: timestamp(),
				}),
				'Graphics staging progress could not be recorded',
			);
			return await continueGraphicsIngestion(operation);
		},
		async copyRemoteGraphicAssetSource(input) {
			const catalogue = requireCatalogue();
			const staging = requireStaging();
			const remoteSource = dependencies.remoteSource;
			if (!remoteSource) {
				throw new GraphicsAssetLibraryError(
					'Approved remote Graphic Asset copying is unavailable',
					'graphics-asset-library-unavailable',
				);
			}
			let operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage === 'completed' || operation.stage === 'cancelled')
				return operation;
			if (operation.source !== 'remote-copy') {
				throw new GraphicsAssetLibraryError(
					'This Graphics Ingestion Operation does not copy an approved remote source',
					'ingestion-operation-not-uploadable',
				);
			}
			// The remote URL is supplied per attempt rather than persisted, so the
			// byte-source phase may be re-run while no staged bytes exist.
			const resumable = operation.transferredByteLength === 0
				&& (
					operation.stage === 'created'
					|| operation.stage === 'transferring'
					|| (operation.stage === 'failed' && operation.failure?.retryable !== false)
				);
			if (!resumable) {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot copy an approved remote source from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}

			const stagingIdentity = graphicsObjectIdentity(`ingestion/${operation.id}/source`);
			// An earlier attempt may have died holding a multipart upload. Its
			// checkpoint is the only record of that upload, and this attempt would
			// overwrite the checkpoint with one of its own, so the old upload is
			// reclaimed before a new one can be taken. An abort that cannot reach the
			// store keeps its checkpoint and stops the attempt: starting a second
			// upload here is what would make the first unreclaimable.
			const stranded = await catalogueRequest(
				() => catalogue.getGraphicAssetMultipartState(operation!.id, operation!.initiatedBy),
				'Approved remote Graphic Asset copy checkpoint is temporarily unavailable',
			);
			if (stranded?.uploadId) {
				const aborted = await staging.abortMultipart({
					identity: stagingIdentity,
					uploadId: stranded.uploadId,
				});
				// An upload the store no longer holds is already reclaimed, so the
				// checkpoint below is cleared and this attempt goes on. Only a store
				// that could not answer stops it: the previous upload may still be
				// held, and starting a second one is what would strand the first.
				if (aborted.outcome === 'unavailable') {
					throw new GraphicsAssetLibraryError(
						'Graphics Asset staging byte store could not release a previous approved remote Graphic Asset copy attempt',
						'graphics-asset-library-unavailable',
					);
				}
				await catalogueRequest(
					() => catalogue.checkpointRemoteCopyMultipartUpload({
						operationId: operation!.id,
						initiatedBy: operation!.initiatedBy,
						uploadId: null,
					}),
					'Approved remote Graphic Asset copy checkpoint could not be recorded',
				);
			}

			const sourceKind = graphicAssetSourceKind(operation);
			const policy = GRAPHIC_ASSET_SOURCE_POLICIES[sourceKind];
			const opened = await remoteSource.open({
				sourceUrl: input.sourceUrl,
				maximumByteLength: policy.maximumByteLength,
			});
			if (opened.outcome === 'unavailable') {
				throw new GraphicsAssetLibraryError(
					opened.message,
					'graphics-asset-library-unavailable',
				);
			}
			if (opened.outcome === 'rejected') {
				return await failOperation(catalogue, operation, {
					code: 'remote-source-rejected',
					retryable: false,
					message: 'The approved remote Graphic Asset source was rejected before any byte was copied.',
				}, {
					outcome: 'rejected',
					compatibilityProfile: policy.compatibilityProfile,
					issues: [
						{
							severity: 'error',
							code: opened.rejection.code,
							message: opened.rejection.message,
						},
					],
				});
			}

			operation = await catalogueRequest(
				() => catalogue.updateIngestionOperation(
					changedOperation(operation!, {
						stage: 'transferring',
						failure: undefined,
						report: undefined,
					}),
					operation!.updatedAt,
				),
				'Approved remote Graphic Asset copy could not be started',
			);
			const staged = await stageRemoteSource({
				staging,
				identity: stagingIdentity,
				operationId: operation.id,
				body: opened.body,
				maximumByteLength: policy.maximumByteLength,
				declaredByteLength: opened.byteLength,
				onMultipartCheckpoint: uploadId => catalogueRequest(
					() => catalogue.checkpointRemoteCopyMultipartUpload({
						operationId: operation!.id,
						initiatedBy: operation!.initiatedBy,
						uploadId,
					}),
					'Approved remote Graphic Asset copy checkpoint could not be recorded',
				),
			});
			if (staged.outcome !== 'staged') {
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(stagingIdentity);
				if (staged.outcome === 'unavailable') {
					return await failOperation(catalogue, operation, {
						code: 'staging-unavailable',
						retryable: true,
						message: 'Copied remote source bytes could not be staged and verified.',
					});
				}
				const rejection = staged.outcome === 'length-exceeded'
					? {
							code: 'remote-source-length-exceeded' as const,
							message: `The remote source delivered more than the ${policy.maximumByteLength}-byte limit for this Graphic Asset kind.`,
						}
					: staged.outcome === 'empty'
						? {
								code: 'remote-source-not-retrievable' as const,
								message: 'The remote source returned no content.',
							}
						: {
								code: 'remote-source-length-mismatch' as const,
								message: `The remote source declared ${staged.declaredByteLength} bytes but delivered a different length.`,
							};
				return await failOperation(catalogue, operation, {
					code: 'remote-source-rejected',
					retryable: false,
					message: 'The approved remote Graphic Asset source did not deliver a usable bounded copy.',
				}, {
					outcome: 'rejected',
					compatibilityProfile: policy.compatibilityProfile,
					issues: [
						{ severity: 'error', ...rejection },
					],
				});
			}
			const authoritative = await catalogueRequest(
				() => catalogue.getIngestionOperation(operation!.id, operation!.initiatedBy),
				'Approved remote Graphic Asset copy checkpoint is temporarily unavailable',
			);
			if (authoritative?.stage === 'cancelled' || authoritative?.stage === 'completed') {
				await releaseOwedStagedInput(authoritative);
				return authoritative;
			}
			await catalogueRequest(
				() => catalogue.recordRemoteCopyStagedSource({
					operation: operation!,
					observedByteLength: staged.byteLength,
					recordedAt: timestamp(),
				}),
				'Approved remote Graphic Asset copy progress could not be recorded',
			);
			return await continueGraphicsIngestion(await catalogueRequest(
				() => catalogue.getIngestionOperation(operation!.id, operation!.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			) ?? operation);
		},
		async resolveStagedGraphicAssetSource(input) {
			const operation = await catalogueRequest(
				() => requireCatalogue().getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (operation.stage !== 'awaiting-confirmation')
				return { outcome: 'missing' };
			const result = await requireStaging().read(
				graphicsObjectIdentity(`ingestion/${operation.id}/source`),
			);
			if (result.outcome === 'missing')
				return { outcome: 'missing' };
			if (
				result.outcome === 'unavailable'
				|| result.object.byteLength !== operation.declaredByteLength
			) {
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				body: result.body,
				byteLength: result.object.byteLength,
			};
		},
		async confirmGraphicAssetBrowserEvidence(input) {
			const catalogue = requireCatalogue();
			const operation = await catalogueRequest(
				() => catalogue.getIngestionOperation(input.operationId, input.initiatedBy),
				'Graphics ingestion state is temporarily unavailable',
			);
			if (!operation)
				throw new GraphicsAssetLibraryError('Graphics Ingestion Operation not found', 'ingestion-operation-not-found');
			if (
				operation.stage !== 'awaiting-confirmation'
				|| operation.report?.outcome !== 'accepted'
			) {
				throw new GraphicsAssetLibraryError(
					`Graphics Ingestion Operation cannot confirm browser evidence from stage ${operation.stage}`,
					'ingestion-operation-not-uploadable',
				);
			}
			const fontEvidence = input.evidence.outcome === 'font-loaded'
				|| input.evidence.outcome === 'font-rejected';
			if ((operation.report.facts.kind === 'font') !== fontEvidence) {
				throw new GraphicsAssetLibraryError(
					'Browser evidence must answer the challenge for this Graphic Asset kind',
					'invalid-ingestion-input',
				);
			}
			const confirmed = await catalogueRequest(
				() => catalogue.updateIngestionOperation(
					changedOperation(operation, {
						stage: 'validating',
						browserDecodeEvidence: input.evidence,
						failure: undefined,
					}),
					operation.updatedAt,
				),
				'Browser validation evidence could not be recorded',
			);
			return await continueGraphicsIngestion(confirmed);
		},
		async confirmFontBrowserEvidence(input) {
			if (input.evidence.outcome !== 'font-loaded' && input.evidence.outcome !== 'font-rejected') {
				throw new GraphicsAssetLibraryError(
					'Font browser challenge evidence is required',
					'invalid-ingestion-input',
				);
			}
			return await this.confirmGraphicAssetBrowserEvidence(input);
		},
		async retryGraphicsIngestion(input) {
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
				() => catalogue.claimGraphicsIngestion({
					operation,
					claimedAt,
					staleBefore: new Date(
						new Date(claimedAt).getTime() - activeIngestionLeaseMilliseconds,
					).toISOString(),
				}),
				'Graphics ingestion retry could not claim the durable operation',
			);
			if (!claimed) {
				// Still leased by whoever is working it. That lapses on its own, so
				// this is worth trying again — unlike a stage a retry cannot resume
				// from, which never becomes retryable.
				throw new GraphicsAssetLibraryError(
					'Graphics Ingestion Operation is still active and cannot be claimed for retry',
					'ingestion-operation-lease-held',
				);
			}
			return await continueGraphicsIngestion(claimed);
		},
	};
}

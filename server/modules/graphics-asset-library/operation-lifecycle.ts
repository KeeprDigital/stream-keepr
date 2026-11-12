import type {
	GraphicAssetCanonicalMime,
	GraphicAssetId,
	GraphicAssetSourceDeclarations,
	GraphicAssetValidationReport,
	GraphicsDuplicateContentPolicy,
	GraphicsIngestionOperation,
	GraphicsIngestionSource,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsAssetCatalogue } from '.';
import type {
	BoundedByteStream,
	GraphicsCanonicalObjectStore,
	GraphicsStagingObjectStore,
} from './object-store';
import type { GraphicsIngestionOperationCatalogue } from './operation';
import type {
	GraphicsStagedInputReleaseCatalogue,
	TerminalStagedInputReleaseOutcome,
} from './retention';
import type { SilentVideoPlaybackValidator } from './silent-video-playback-validator';
import { TEMPLATE_PACKAGE_LIMITS } from '~~/shared/types/templatePackage';
import { graphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import { MAX_SILENT_VIDEO_POSTER_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { canonicalContentIdentity } from './canonical-integrity';
import { catalogueRequest } from './catalogue-request';
import { GraphicsAssetLibraryError } from './errors';
import { GRAPHIC_ASSET_SOURCE_POLICIES } from './graphic-asset-source';
import { graphicsIngestionOperationId } from './identities';
import { consumeBoundedByteStream, createBoundedByteStream } from './object-store';
import { isTerminalIngestionOperation } from './operation';
import { sha256Hex, sha256HexStream } from './png';
import { releaseTerminalStagedInput } from './retention';
import { silentVideoPlaybackValidationIssue } from './silent-video-playback-validator';
import { processStillImage } from './still-image';
import { logGraphicsStoreFailure } from './store-failure-log';
import { validationError } from './validation';

export interface GraphicsIngestionOperationLifecycleDependencies {
	/** Refuses with `graphics-asset-library-unavailable` over a health-only catalogue. */
	requireCatalogue: () => Pick<GraphicsAssetCatalogue, 'initiateGraphicsIngestion'>
		& GraphicsStagedInputReleaseCatalogue;
	/** Refuses with `graphics-asset-library-unavailable` over a health-only byte store. */
	requireStaging: () => GraphicsStagingObjectStore;
	silentVideoPlaybackValidator: SilentVideoPlaybackValidator;
	now: () => Date;
	generateIdentity: () => string;
}

/**
 * The steps every Graphics Ingestion Operation pipeline takes, whatever it
 * publishes: starting an operation, stamping a change to it, failing it,
 * releasing the staged input a terminal one owes, writing canonical bytes, and
 * holding a silent video to the pinned validation runtime. Graphic Asset
 * ingestion and Template Packages both run on these, and reconciliation
 * regenerates a poster through the last (ADR-0073).
 */
export function createGraphicsIngestionOperationLifecycle(
	dependencies: GraphicsIngestionOperationLifecycleDependencies,
) {
	const {
		requireCatalogue,
		requireStaging,
		silentVideoPlaybackValidator,
		now,
		generateIdentity,
	} = dependencies;

	function timestamp() {
		return now().toISOString();
	}

	function validateGraphicsIngestionInput(input: GraphicAssetSourceDeclarations & {
		idempotencyKey: string;
		initiatedBy: string;
		source: GraphicsIngestionSource;
		declaredByteLength: number;
		defaultEventId?: number;
	}) {
		if (!input.idempotencyKey.trim() || !input.initiatedBy.trim())
			throw new GraphicsAssetLibraryError('Ingestion identity and author are required', 'invalid-ingestion-input');
		// A Template Package is an envelope rather than one Graphic Asset, so it is
		// held to the archive limit instead of any single asset kind's limit.
		const { label, maximumByteLength } = input.source === 'template-package'
			? {
					label: 'Template Package',
					maximumByteLength: TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength,
				}
			: GRAPHIC_ASSET_SOURCE_POLICIES[graphicAssetSourceKind(input)];
		if (
			!Number.isSafeInteger(input.declaredByteLength)
			|| input.declaredByteLength <= 0
			|| input.declaredByteLength > maximumByteLength
		) {
			throw new GraphicsAssetLibraryError(
				`${label} must be between 1 and ${maximumByteLength} bytes`,
				'invalid-ingestion-input',
			);
		}
		if (
			input.defaultEventId !== undefined
			&& (!Number.isSafeInteger(input.defaultEventId) || input.defaultEventId <= 0)
		) {
			throw new GraphicsAssetLibraryError('Default Event identity must be a positive integer', 'invalid-ingestion-input');
		}
		if (input.browserDecodeEvidence?.outcome === 'font-loaded' || input.browserDecodeEvidence?.outcome === 'font-rejected') {
			throw new GraphicsAssetLibraryError(
				'Font browser evidence can only answer the server-selected post-validation challenge',
				'invalid-ingestion-input',
			);
		}
		if (
			input.browserDecodeEvidence
			&& (
				!/^[a-f0-9]{64}$/.test(input.browserDecodeEvidence.sourceDigest)
				|| (
					input.browserDecodeEvidence.outcome === 'decoded'
					&& (
						!Number.isSafeInteger(input.browserDecodeEvidence.width)
						|| input.browserDecodeEvidence.width <= 0
						|| !Number.isSafeInteger(input.browserDecodeEvidence.height)
						|| input.browserDecodeEvidence.height <= 0
					)
				)
			)
		) {
			throw new GraphicsAssetLibraryError('Browser decode evidence is malformed', 'invalid-ingestion-input');
		}
	}

	async function initiateGraphicsOperation(input: GraphicAssetSourceDeclarations & {
		idempotencyKey: string;
		initiatedBy: string;
		name: string;
		source: GraphicsIngestionSource;
		targetAssetId?: GraphicAssetId;
		defaultEventId?: number;
		duplicateContentPolicy: GraphicsDuplicateContentPolicy;
		declaredByteLength: number;
	}) {
		validateGraphicsIngestionInput(input);
		const createdAt = timestamp();
		return await catalogueRequest(() => requireCatalogue().initiateGraphicsIngestion({
			id: graphicsIngestionOperationId(generateIdentity()),
			idempotencyKey: input.idempotencyKey,
			source: input.source,
			initiatedBy: input.initiatedBy,
			name: input.name.trim(),
			targetAssetId: input.targetAssetId,
			sourceFileName: input.sourceFileName?.trim(),
			declaredMime: input.declaredMime?.trim().toLocaleLowerCase(),
			browserDecodeEvidence: input.browserDecodeEvidence,
			defaultEventId: input.defaultEventId,
			duplicateContentPolicy: input.duplicateContentPolicy,
			declaredByteLength: input.declaredByteLength,
			transferredByteLength: 0,
			stage: 'created',
			createdAt,
			updatedAt: createdAt,
		}), 'Graphics ingestion could not be initiated because the catalogue is unavailable');
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

	class SilentVideoValidationRuntimeError extends Error {}

	async function reportWithTrustedSilentVideoValidation(
		report: Extract<GraphicAssetValidationReport, {
			outcome: 'accepted';
			compatibilityProfile: 'silent-video-v1';
		}>,
		operation: GraphicsIngestionOperation,
	) {
		const factsDigest = await sha256Hex(
			new TextEncoder().encode(JSON.stringify(report.facts)),
		);
		const idempotencyKey = [
			'silent-video-playback-v1',
			operation.id,
			report.facts.sha256,
			factsDigest,
		].join(':');
		const validationInput = {
			operationId: operation.id,
			idempotencyKey,
			sourceDigest: report.facts.sha256,
			sourceByteLength: report.facts.byteLength,
			sourceContentType: report.facts.canonicalMime,
			factsDigest,
			inspectedFacts: report.facts,
		} as const;
		let validation;
		try {
			validation = await silentVideoPlaybackValidator.validate(validationInput);
		}
		catch {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation runtime failed while executing the bound operation',
			);
		}
		if (validation.outcome === 'unavailable')
			throw new SilentVideoValidationRuntimeError('Silent-video validation runtime is unavailable');
		if (
			validation.operationId !== operation.id
			|| validation.idempotencyKey !== idempotencyKey
			|| validation.sourceDigest !== report.facts.sha256
			|| validation.factsDigest !== factsDigest
		) {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation result was not bound to the exact operation, source, and inspected facts',
			);
		}
		const validationIssue = silentVideoPlaybackValidationIssue(validationInput, validation);
		if (validationIssue) {
			validationError(
				validationIssue,
				'Pinned native validation could not decode, play, and seek the exact silent video.',
			);
		}
		if (validation.outcome === 'rejected')
			throw new SilentVideoValidationRuntimeError('Rejected validation did not produce an issue');
		if (
			validation.mutedInlinePlayback !== true
			|| validation.seeked !== true
			|| validation.width !== report.facts.width
			|| validation.height !== report.facts.height
			|| Math.abs(validation.durationSeconds - report.facts.durationSeconds) > 0.05
			|| Math.abs(validation.posterTimeSeconds - report.facts.posterTimeSeconds) > 0.001
		) {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation facts conflict with bounded inspection',
			);
		}
		if (
			validation.poster.byteLength <= 0
			|| validation.poster.byteLength > MAX_SILENT_VIDEO_POSTER_BYTES
			|| !/^[a-f0-9]{64}$/.test(validation.posterDigest)
		) {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation returned an invalid deterministic poster envelope',
			);
		}
		let poster;
		try {
			const posterBytes = await consumeBoundedByteStream(validation.poster);
			if (await sha256Hex(posterBytes) !== validation.posterDigest) {
				throw new SilentVideoValidationRuntimeError(
					'Silent-video validation poster digest does not match its exact bytes',
				);
			}
			poster = await processStillImage(posterBytes, {
				sourceFileName: 'poster.png',
				declaredMime: 'image/png',
			});
		}
		catch (error) {
			if (error instanceof SilentVideoValidationRuntimeError)
				throw error;
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation returned a poster that could not be verified',
			);
		}
		const scale = Math.min(1, 640 / report.facts.width, 360 / report.facts.height);
		const expectedWidth = Math.max(1, Math.round(report.facts.width * scale));
		const expectedHeight = Math.max(1, Math.round(report.facts.height * scale));
		if (
			poster.report.facts.kind !== 'image'
			|| poster.report.facts.width !== expectedWidth
			|| poster.report.facts.height !== expectedHeight
		) {
			throw new SilentVideoValidationRuntimeError(
				'Silent-video validation poster violates the deterministic fit rule',
			);
		}
		return {
			report: {
				...report,
				facts: {
					...report.facts,
					browserPlayable: true as const,
					...(report.facts.hasAlpha
						? { chromiumTransparencyPlayback: true as const }
						: {}),
				},
			},
			derivative: poster.thumbnail,
		};
	}

	async function failOperation(
		catalogue: GraphicsIngestionOperationCatalogue,
		operation: GraphicsIngestionOperation,
		failure: NonNullable<GraphicsIngestionOperation['failure']>,
		report?: GraphicAssetValidationReport,
	) {
		let failed: GraphicsIngestionOperation;
		try {
			failed = await catalogue.updateIngestionOperation(
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
		// A permanent failure is terminal, so the staged input it held is owed
		// back now. A retryable one keeps it: a retry resumes from those bytes.
		await releaseOwedStagedInput(failed);
		return failed;
	}

	/**
	 * Runs the release a terminal operation owes its staged input (#700), and
	 * does nothing for one still working. It never fails the caller: the
	 * terminal transition already happened and is reported as it is, and a
	 * release that could not land leaves the obligation on the books, in the
	 * unreleased-staged-input Operational Queue, for the sweep or the queue's
	 * retry action to finish.
	 */
	async function releaseOwedStagedInput(
		operation: GraphicsIngestionOperation,
	): Promise<TerminalStagedInputReleaseOutcome | { outcome: 'not-terminal' }> {
		if (!isTerminalIngestionOperation(operation))
			return { outcome: 'not-terminal' };
		try {
			return await releaseTerminalStagedInput(
				{
					catalogue: requireCatalogue(),
					staging: requireStaging(),
				},
				{ operationId: operation.id, initiatedBy: operation.initiatedBy },
			);
		}
		catch (error) {
			logGraphicsStoreFailure(
				'graphics_staged_input_release_deferred',
				{ operationId: operation.id },
				error,
			);
			return { outcome: 'unavailable' };
		}
	}

	/**
	 * A cancellation's release: the staged input, any multipart upload it was
	 * holding included, and — once that release is proven — the multipart
	 * checkpoint's `cleanupPending`. A checkpoint already cleared means an
	 * earlier pass proved the release, so repeating a cancellation aborts
	 * nothing twice.
	 */
	async function releaseCancelledStagedInput(
		catalogue: GraphicsAssetCatalogue,
		operation: GraphicsIngestionOperation,
	): Promise<GraphicsIngestionOperation> {
		const multipart = await catalogueRequest(
			() => catalogue.getGraphicAssetMultipartState(operation.id, operation.initiatedBy),
			'Graphics multipart cancellation checkpoint is temporarily unavailable',
		);
		if (multipart && !multipart.cleanupPending)
			return operation;
		const release = await releaseOwedStagedInput(operation);
		if (release.outcome === 'unavailable' || release.outcome === 'not-terminal' || !multipart)
			return operation;
		await catalogueRequest(
			() => catalogue.recordGraphicAssetMultipartCleanupComplete(operation.id, operation.initiatedBy),
			'Graphics multipart cleanup completion could not be recorded',
		);
		return await catalogueRequest(
			() => catalogue.getIngestionOperation(operation.id, operation.initiatedBy),
			'Graphics ingestion state is temporarily unavailable',
		) ?? operation;
	}

	async function storeCanonicalStream(
		store: GraphicsCanonicalObjectStore,
		digest: string,
		bytes: BoundedByteStream,
		contentType: GraphicAssetCanonicalMime,
	) {
		const identity = canonicalContentIdentity(digest);
		const result = await store.createImmutable({
			identity,
			bytes,
			metadata: {
				contentType,
				custom: { sha256: digest },
			},
		});
		if (result.outcome === 'unavailable')
			return result;
		if (
			result.object.byteLength !== bytes.byteLength
			|| result.object.contentType !== contentType
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
			|| stored.object.contentType !== contentType
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
			'image/png',
		);
	}

	return {
		initiateGraphicsOperation,
		changedOperation,
		SilentVideoValidationRuntimeError,
		reportWithTrustedSilentVideoValidation,
		failOperation,
		releaseOwedStagedInput,
		releaseCancelledStagedInput,
		storeCanonicalStream,
		storeCanonicalBytes,
	};
}

import type {
	GraphicAsset,
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicAssetUsage,
	GraphicsAssetLibraryCapacity,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
	InstalledGraphicsTemplate,
	InstalledGraphicsTemplateId,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsAssetCatalogue,
	PublishGraphicAssetCatalogueInput,
} from '.';
import type { GraphicsAssetMultipartState } from './multipart';
import type { TemplatePackagePreflightState } from './template-package-preflight';
import {
	DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
	DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
} from '~~/shared/types/graphicsAsset';
import { graphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import { graphicsCanonicalCapacityPressure } from '~~/shared/utils/graphicsAssetCapacity';
import { MAX_SILENT_VIDEO_POSTER_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { GraphicsAssetLibraryError } from './errors';
import {
	graphicsMultipartCompletedByteLength,
	graphicsMultipartTransfer,
} from './multipart';
import {
	completedGraphicAssetReplacementOperation,
	INSTALLED_GRAPHICS_TEMPLATE_FIRST_REVISION,
	templatePackageInstallationResult,
} from './operation';

function stagingReservationBytes(operation: GraphicsIngestionOperation) {
	return operation.declaredByteLength
		+ (graphicAssetSourceKind(operation) === 'silent-video'
			? MAX_SILENT_VIDEO_POSTER_BYTES
			: 0);
}

interface InMemoryGraphicsAssetCatalogueOptions {
	canonicalLimitBytes?: number;
	stagingLimitBytes?: number;
	usage?: GraphicAssetUsage[];
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
		facts: GraphicAsset['facts'];
		/**
		 * The profile this exact revision was accepted under, which is not derivable
		 * from its media kind: a packaged font installs under the unattested profile
		 * because no browser loaded it here, and reusing that revision must keep
		 * saying so.
		 */
		compatibilityProfile: string;
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
	const multipartStates = new Map<GraphicsIngestionOperationId, GraphicsAssetMultipartState>();
	const packagePreflights = new Map<GraphicsIngestionOperationId, TemplatePackagePreflightState>();
	/**
	 * Graphic Asset Origin by local revision. Template Package installation is its
	 * only writer, and recognising a later import is its only reader, so the
	 * double keeps the same shape the catalogue does: immutable, at most one per
	 * revision, never inherited by a revision created afterwards.
	 */
	const origins = new Map<GraphicAssetRevisionId, {
		assetId: GraphicAssetId;
		sourceAssetId: string;
		sourceRevisionId: string;
		sourceRevisionNumber: number;
		digest: string;
	}>();
	const installedTemplates = new Map<InstalledGraphicsTemplateId, InstalledGraphicsTemplate>();
	/** Persisted Graphic Asset References, which are the authoritative usage. */
	const references = new Map<string, GraphicAssetUsage>();
	const usage = options.usage ?? [];
	let canonicalLimitBytes = options.canonicalLimitBytes ?? DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES;
	let stagingLimitBytes = options.stagingLimitBytes ?? DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES;

	function cloneOperation(operation: GraphicsIngestionOperation): GraphicsIngestionOperation {
		const clone = structuredClone(operation);
		// The preflight report and multipart transfer are derived state: the
		// checkpoint that owns each is authoritative, so a stale copy carried on an
		// operation being written back never survives the read.
		const preflight = packagePreflights.get(operation.id);
		clone.templatePackagePreflight = preflight
			? structuredClone(preflight.report)
			: undefined;
		const multipart = multipartStates.get(operation.id);
		// A remote copy's multipart state is a server-side abort checkpoint, not a
		// client transfer: it holds an uploadId and no parts, so reporting it as one
		// would advertise a part count no client is ever asked to send.
		if (!multipart || operation.source === 'remote-copy')
			return clone;
		return {
			...clone,
			transfer: graphicsMultipartTransfer(operation.declaredByteLength, multipart),
		};
	}

	function operationIdentity(initiatedBy: string, idempotencyKey: string) {
		return `${initiatedBy}\0${idempotencyKey}`;
	}

	function sum(values: Iterable<number>) {
		return [...values].reduce((total, value) => total + value, 0);
	}

	/**
	 * Everything pinning a Graphic Asset: the usage a test injected, plus every
	 * reference an installed Template actually persisted.
	 */
	function allUsage(): GraphicAssetUsage[] {
		return [...usage, ...references.values()];
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
		async initiateGraphicsIngestion(operation) {
			const identity = operationIdentity(operation.initiatedBy, operation.idempotencyKey);
			const existingId = operationsByIdentity.get(identity);
			if (existingId)
				return cloneOperation(operations.get(existingId)!);
			const usedBytes = sum(stagingUsage.values());
			const reservedBytes = sum(stagingReservations.values());
			const availableBytes = Math.max(0, stagingLimitBytes - usedBytes - reservedBytes);
			const requestedBytes = stagingReservationBytes(operation);
			if (requestedBytes > availableBytes) {
				throw new GraphicsAssetLibraryError(
					'Graphics staging capacity is exhausted',
					'staging-capacity-exhausted',
					{
						capacity: {
							resource: 'staging',
							limitBytes: stagingLimitBytes,
							usedBytes,
							reservedBytes,
							requestedBytes,
							availableBytes,
						},
					},
				);
			}
			operations.set(operation.id, cloneOperation(operation));
			operationsByIdentity.set(identity, operation.id);
			stagingReservations.set(operation.id, requestedBytes);
			return cloneOperation(operation);
		},
		async recordStagedBytes(input) {
			const operation = operations.get(input.operation.id);
			const stagingEnvelope = (stagingUsage.get(input.operation.id) ?? 0)
				+ (stagingReservations.get(input.operation.id) ?? 0);
			if (
				!operation
				|| operation.stage === 'completed'
				|| operation.stage === 'cancelled'
				|| input.usedBytes < 0
				|| input.usedBytes > stagingEnvelope
			) {
				throw new Error('Graphics staging progress could not be recorded');
			}
			stagingUsage.set(operation.id, input.usedBytes);
			stagingReservations.set(operation.id, stagingEnvelope - input.usedBytes);
		},
		async recordRemoteCopyStagedSource(input) {
			const operation = operations.get(input.operation.id);
			const { observedByteLength } = input;
			const residualReservation = stagingReservationBytes({
				...input.operation,
				declaredByteLength: observedByteLength,
			}) - observedByteLength;
			const stagingEnvelope = (stagingUsage.get(input.operation.id) ?? 0)
				+ (stagingReservations.get(input.operation.id) ?? 0);
			if (
				!operation
				|| operation.source !== 'remote-copy'
				|| operation.stage === 'completed'
				|| operation.stage === 'cancelled'
				|| observedByteLength + residualReservation > stagingEnvelope
			) {
				throw new Error('Remote Graphic Asset copy progress could not be recorded');
			}
			// Durably staged bytes mean every multipart upload this copy ever held is
			// finished, so no abort checkpoint can still be owed.
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			multipartStates.delete(operation.id);
			operations.set(operation.id, cloneOperation({
				...operation,
				declaredByteLength: observedByteLength,
				transferredByteLength: observedByteLength,
			}));
			stagingUsage.set(operation.id, observedByteLength);
			stagingReservations.set(operation.id, residualReservation);
		},
		async recordCanonicalWrites(input) {
			const existing = canonicalWriteCandidates.get(input.operation.id) ?? new Map<string, number>();
			for (const content of input.contents)
				existing.set(content.digest, content.byteLength);
			canonicalWriteCandidates.set(input.operation.id, existing);
		},
		async reserveGraphicAssetPublication(input) {
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
		async getGraphicAssetMultipartState(operationId, initiatedBy) {
			const operation = operations.get(operationId);
			if (!operation || operation.initiatedBy !== initiatedBy)
				return undefined;
			const state = multipartStates.get(operationId);
			return state ? structuredClone(state) : undefined;
		},
		async updateGraphicAssetMultipartState(input) {
			const operation = operations.get(input.operationId);
			const existing = multipartStates.get(input.operationId);
			if (
				!operation
				|| operation.initiatedBy !== input.initiatedBy
				|| operation.stage === 'cancelled'
				|| operation.stage === 'completed'
				|| (existing?.version ?? 0) !== input.expectedVersion
				|| input.state.version !== input.expectedVersion + 1
			) {
				return false;
			}
			const completedByteLength = graphicsMultipartCompletedByteLength(input.state);
			multipartStates.set(input.operationId, structuredClone(input.state));
			operations.set(input.operationId, {
				...operation,
				stage: 'transferring',
				transferredByteLength: completedByteLength,
				updatedAt: input.updatedAt,
			});
			return true;
		},
		async checkpointRemoteCopyMultipartUpload(input) {
			const operation = operations.get(input.operationId);
			if (
				!operation
				|| operation.initiatedBy !== input.initiatedBy
				|| operation.source !== 'remote-copy'
			) {
				return;
			}
			// A remote copy has no client parts to record, so the checkpoint carries
			// the uploadId alone. Taking one is confined to a running copy; clearing
			// one stays legal from any stage, because by then the upload it named is
			// already completed or aborted.
			if (!input.uploadId) {
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
				multipartStates.delete(input.operationId);
				return;
			}
			if (operation.stage !== 'created' && operation.stage !== 'transferring')
				return;
			multipartStates.set(input.operationId, {
				version: 1,
				uploadId: input.uploadId,
				cleanupPending: false,
				parts: [],
			});
		},
		async getTemplatePackagePreflight(operationId, initiatedBy) {
			const operation = operations.get(operationId);
			if (operation?.initiatedBy !== initiatedBy || operation.source !== 'template-package')
				return undefined;
			const state = packagePreflights.get(operationId);
			return state ? structuredClone(state) : undefined;
		},
		async updateTemplatePackagePreflight(input) {
			const operation = operations.get(input.operationId);
			if (
				operation?.initiatedBy !== input.initiatedBy
				|| operation.source !== 'template-package'
				|| operation.stage === 'completed'
				|| operation.stage === 'cancelled'
				// A retry finishing after the author confirmed must not overwrite the
				// proposal they accepted.
				|| operation.stage === 'awaiting-installation'
			) {
				return false;
			}
			packagePreflights.set(input.operationId, structuredClone(input.state));
			return true;
		},
		async confirmTemplatePackagePreflight(input) {
			const operation = operations.get(input.operationId);
			const state = packagePreflights.get(input.operationId);
			// The same compare-and-set the D1 catalogue performs in one statement:
			// commit only while the operation is still paused on this exact report.
			if (
				operation?.initiatedBy !== input.initiatedBy
				|| operation.source !== 'template-package'
				|| operation.stage !== 'awaiting-confirmation'
				|| state?.report.fingerprint !== input.fingerprint
			) {
				return false;
			}
			packagePreflights.set(input.operationId, {
				...structuredClone(state),
				confirmedFingerprint: input.fingerprint,
				confirmedAt: input.confirmedAt,
			});
			operations.set(input.operationId, {
				...operation,
				stage: 'awaiting-installation',
				failure: undefined,
				updatedAt: input.updatedAt,
			});
			return true;
		},
		async findTemplatePackageOriginCandidates(input) {
			// A package can name a source this installation already holds in two
			// ways: it was exported from here, so the source identity is a local
			// identity; or it was imported here before, so a local revision records
			// that source as its Graphic Asset Origin. Both are the same exact
			// provenance and both reuse the same local revision.
			const localRevision = revisions.get(input.sourceRevisionId as GraphicAssetRevisionId);
			const localMatch = localRevision?.assetId === input.sourceAssetId
				? { revisionId: input.sourceRevisionId as GraphicAssetRevisionId, revision: localRevision }
				: undefined;
			const importedMatch = [...origins.entries()]
				.filter(([, origin]) =>
					origin.sourceAssetId === input.sourceAssetId
					&& origin.sourceRevisionId === input.sourceRevisionId,
				)
				.map(([revisionId]) => ({ revisionId, revision: revisions.get(revisionId) }))
				.find((candidate): candidate is {
					revisionId: GraphicAssetRevisionId;
					revision: NonNullable<ReturnType<typeof revisions.get>>;
				} => candidate.revision !== undefined);
			const exactMatch = localMatch ?? importedMatch;
			const exactAsset = exactMatch ? assets.get(exactMatch.revision.assetId) : undefined;
			const relatedRevisionExists = [...revisions.entries()].some(
				([revisionId, candidate]) =>
					candidate.assetId === input.sourceAssetId
					&& revisionId !== input.sourceRevisionId,
			) || [...origins.values()].some(origin =>
				origin.sourceAssetId === input.sourceAssetId
				&& origin.sourceRevisionId !== input.sourceRevisionId,
			);
			return {
				exact: exactAsset && exactMatch
					? {
							reference: {
								assetId: exactAsset.id,
								revisionId: exactMatch.revisionId,
							},
							digest: exactMatch.revision.facts.sha256,
							name: exactAsset.name,
							lifecycleState: exactAsset.lifecycle.state,
						}
					: undefined,
				relatedRevisionExists,
			};
		},
		async reserveTemplatePackagePublication(input) {
			const existing = operations.get(input.operation.id);
			if (
				!existing
				|| existing.stage !== 'generating-derivatives'
				|| existing.updatedAt !== input.operation.updatedAt
			) {
				throw new Error('Graphics Ingestion Operation is not ready to reserve canonical capacity');
			}
			const growthBytes = Math.max(0, input.growthBytes);
			const ownReservedBytes = canonicalReservations.get(input.operation.id) ?? 0;
			const before = getCapacity();
			const availableBytes = before.canonical.availableBytes + ownReservedBytes;
			if (growthBytes > availableBytes) {
				return {
					outcome: 'blocked' as const,
					capacity: {
						resource: 'canonical' as const,
						limitBytes: before.canonical.limitBytes,
						usedBytes: before.canonical.usedBytes,
						reservedBytes: before.canonical.reservedBytes - ownReservedBytes,
						requestedBytes: growthBytes,
						availableBytes,
					},
				};
			}
			canonicalReservations.set(input.operation.id, growthBytes);
			const reserved: GraphicsIngestionOperation = {
				...existing,
				canonicalCapacityOutcome: growthBytes === 0
					? {
							outcome: 'no-canonical-growth',
							growthBytes: 0,
							availableBytes,
						}
					: {
							outcome: 'canonical-growth-reserved',
							growthBytes,
							availableBytes: Math.max(0, availableBytes - growthBytes),
						},
				updatedAt: input.reservedAt,
			};
			operations.set(reserved.id, cloneOperation(reserved));
			return { outcome: 'reserved' as const, operation: cloneOperation(reserved) };
		},
		async installTemplatePackage(input) {
			const existing = operations.get(input.operation.id);
			// The D1 batch guards every statement on the operation still being the
			// claimed one, and refuses rather than answering when it is not — so a
			// cancellation or a completed installation that arrived first raises
			// here too. The caller re-reads the authoritative operation and reports
			// what actually happened to it.
			if (
				!existing
				|| existing.stage !== 'publishing'
				|| existing.updatedAt !== input.operation.updatedAt
			) {
				throw new Error('Template Package installation lost its claim before publishing');
			}
			// The same single condition the D1 batch commits against: an exact-origin
			// reuse whose asset or revision moved underneath this installation
			// publishes nothing at all rather than pinning a reference the library no
			// longer allows.
			for (const asset of input.reused) {
				if (
					assets.get(asset.assetId)?.lifecycle.state !== 'active'
					|| revisions.get(asset.revisionId)?.assetId !== asset.assetId
				) {
					throw new Error('Template Package installation lost an exact-origin revision it reuses');
				}
			}

			const publishedAt = input.publishedAt;
			for (const asset of input.created) {
				assets.set(asset.assetId, {
					id: asset.assetId,
					name: asset.name,
					kind: asset.kind,
					revisionId: asset.revisionId,
					revisionNumber: 1,
					revisions: [{
						id: asset.revisionId,
						revisionNumber: 1,
						facts: asset.facts,
					}],
					facts: asset.facts,
					eventIds: input.operation.defaultEventId === undefined
						? []
						: [input.operation.defaultEventId],
					lifecycle: { state: 'active' },
					// Filled in below, once the terminal result exists.
					operation: cloneOperation(existing),
				});
				revisions.set(asset.revisionId, {
					assetId: asset.assetId,
					revisionNumber: 1,
					facts: asset.facts,
					compatibilityProfile: asset.compatibilityProfile,
					thumbnailDigest: asset.thumbnailDigest,
				});
				origins.set(asset.revisionId, {
					assetId: asset.assetId,
					sourceAssetId: asset.origin.sourceAssetId,
					sourceRevisionId: asset.origin.sourceRevisionId,
					sourceRevisionNumber: asset.origin.sourceRevisionNumber,
					digest: asset.origin.digest,
				});
				thumbnailDigests.set(asset.assetId, asset.thumbnailDigest);
				canonicalContents.set(asset.sourceDigest, {
					byteLength: asset.sourceByteLength,
					category: 'source',
				});
				if (!canonicalContents.has(asset.thumbnailDigest)) {
					canonicalContents.set(asset.thumbnailDigest, {
						byteLength: asset.thumbnailByteLength,
						category: 'derivative',
					});
				}
			}
			// An installation run inside an Event associates everything it touched
			// with that Event, including a reused asset, whose own metadata it still
			// leaves alone.
			if (input.operation.defaultEventId !== undefined) {
				for (const asset of input.reused) {
					const existingAsset = assets.get(asset.assetId)!;
					assets.set(asset.assetId, {
						...existingAsset,
						eventIds: [...new Set([...existingAsset.eventIds, input.operation.defaultEventId])]
							.sort((left, right) => left - right),
					});
				}
			}
			for (const reference of input.references) {
				references.set(reference.id, {
					id: reference.id,
					reference: {
						assetId: reference.assetId,
						revisionId: reference.revisionId,
					},
					owner: {
						kind: 'installed-graphics-template',
						id: input.template.id,
						name: input.template.name,
						// An Installed Graphics Template's references carry no Event
						// context: the Template belongs to the installation-wide library,
						// not to the Event whose workflow installed it.
						slot: reference.ownerSlot,
					},
				});
			}
			installedTemplates.set(input.template.id, {
				id: input.template.id,
				kind: input.template.kind,
				name: input.template.name,
				revisionNumber: INSTALLED_GRAPHICS_TEMPLATE_FIRST_REVISION,
				document: structuredClone(input.template.document),
				sourceTemplateIdentity: input.template.sourceTemplateIdentity,
				sourceTemplateRevision: input.template.sourceTemplateRevision,
				installedByOperationId: input.operation.id,
				eventId: input.operation.defaultEventId,
				references: input.references
					.map(reference => ({
						ownerSlot: reference.ownerSlot,
						reference: {
							assetId: reference.assetId,
							revisionId: reference.revisionId,
						},
					}))
					// Code-point order, which is what the catalogue's own ORDER BY
					// gives; a locale-aware comparison would order these differently
					// from the database this double stands in for.
					.sort((left, right) => (left.ownerSlot < right.ownerSlot ? -1 : left.ownerSlot > right.ownerSlot ? 1 : 0)),
				installedAt: publishedAt,
			});

			const completed: GraphicsIngestionOperation = {
				...input.operation,
				stage: 'completed',
				failure: undefined,
				templatePackageInstallation: templatePackageInstallationResult(input),
				updatedAt: publishedAt,
			};
			operations.set(completed.id, cloneOperation(completed));
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			canonicalWriteCandidates.delete(completed.id);
			releaseCapacity(completed.id);
			for (const asset of input.created) {
				assets.set(asset.assetId, {
					...assets.get(asset.assetId)!,
					operation: cloneOperation(completed),
				});
			}
			return cloneOperation(completed);
		},
		async findInstalledGraphicsTemplate(templateId) {
			const template = installedTemplates.get(templateId);
			return template ? structuredClone(template) : undefined;
		},
		async listInstalledGraphicsTemplates(kind) {
			return [...installedTemplates.values()]
				.filter(template => template.kind === kind)
				// Name then identity, matching the catalogue's own ORDER BY, and by code
				// point rather than locale for the same reason the references above are.
				.sort((left, right) => {
					const order = `${left.name} ${left.id}` < `${right.name} ${right.id}` ? -1 : 1;
					return left.id === right.id ? 0 : order;
				})
				.map(({ references: _references, ...summary }) => structuredClone(summary));
		},
		async findGraphicAssetByContentDigest(digest) {
			const revision = [...revisions.entries()].find(
				([, candidate]) => candidate.facts.sha256 === digest,
			);
			const asset = revision && assets.get(revision[1].assetId);
			return asset
				? { assetId: asset.id, revisionId: revision![0], name: asset.name }
				: undefined;
		},
		async recordGraphicAssetMultipartCleanupComplete(operationId, initiatedBy) {
			const operation = operations.get(operationId);
			const state = multipartStates.get(operationId);
			if (!operation || operation.initiatedBy !== initiatedBy || operation.stage !== 'cancelled' || !state)
				return;
			multipartStates.set(operationId, {
				...state,
				cleanupPending: false,
			});
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
			if (operation.stage === 'cancelled') {
				const multipart = multipartStates.get(operation.id);
				if (multipart) {
					multipartStates.set(operation.id, {
						...multipart,
						cleanupPending: true,
					});
				}
			}
			if (
				operation.stage === 'completed'
				|| operation.stage === 'cancelled'
				|| (operation.stage === 'failed' && operation.failure?.retryable === false)
			) {
				releaseCapacity(operation.id);
			}
			return cloneOperation(operation);
		},
		async claimGraphicsIngestion(input) {
			const existing = operations.get(input.operation.id);
			if (
				!existing
				|| existing.initiatedBy !== input.operation.initiatedBy
				// The same compare-and-set the D1 catalogue makes: two callers
				// reading one operation cannot both claim it.
				|| existing.updatedAt !== input.operation.updatedAt
			) {
				return undefined;
			}
			const retryableFailure = existing.stage === 'failed' && existing.failure?.retryable;
			// A confirmed Template Package proposal is resting rather than running,
			// so claiming it needs no staleness proof.
			const resting = existing.stage === 'awaiting-installation';
			const staleActive = !['created', 'completed', 'cancelled', 'failed', 'awaiting-installation'].includes(existing.stage)
				&& existing.updatedAt <= input.staleBefore;
			if (!retryableFailure && !resting && !staleActive)
				return undefined;
			const claimed: GraphicsIngestionOperation = {
				...existing,
				stage: 'hashing',
				updatedAt: input.claimedAt,
			};
			operations.set(claimed.id, cloneOperation(claimed));
			return cloneOperation(claimed);
		},
		async findReusableGraphicAsset(sourceDigest) {
			const revision = [...revisions.entries()].find(([, candidate]) =>
				candidate.facts.sha256 === sourceDigest
				&& assets.get(candidate.assetId)?.lifecycle.state === 'active',
			);
			const asset = revision && assets.get(revision[1].assetId);
			return asset
				? { assetId: asset.id, revisionId: revision![0] }
				: undefined;
		},
		async findCurrentGraphicAsset(assetId) {
			const asset = assets.get(assetId);
			return asset?.lifecycle.state === 'active'
				? {
						assetId,
						revisionId: asset.revisionId,
						sourceDigest: asset.facts.sha256,
					}
				: undefined;
		},
		async reuseGraphicAsset(input) {
			const existing = operations.get(input.operation.id);
			const asset = assets.get(input.reusable.assetId);
			if (!existing || !asset || asset.lifecycle.state !== 'active')
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
		async completeGraphicAssetReplacementNoop(input) {
			const existing = operations.get(input.operation.id);
			const asset = assets.get(input.current.assetId);
			if (
				!existing
				|| !asset
				|| asset.lifecycle.state !== 'active'
				|| existing.stage !== 'publishing'
				|| existing.updatedAt !== input.operation.updatedAt
				|| asset.revisionId !== input.current.revisionId
				|| asset.facts.sha256 !== input.current.sourceDigest
			) {
				throw new Error('Graphic Asset replacement no-op lost its claim');
			}
			const completed = completedGraphicAssetReplacementOperation({
				operation: input.operation,
				outcome: 'replacement-noop',
				assetId: input.current.assetId,
				revisionId: input.current.revisionId,
				completedAt: input.completedAt,
			});
			operations.set(completed.id, cloneOperation(completed));
			releaseCapacity(completed.id);
			return cloneOperation(completed);
		},
		async publishGraphicAssetReplacement(input) {
			const existing = operations.get(input.operation.id);
			const asset = assets.get(input.targetAssetId);
			if (
				!existing
				|| !asset
				|| asset.lifecycle.state !== 'active'
				|| existing.stage !== 'publishing'
				|| existing.updatedAt !== input.operation.updatedAt
			) {
				throw new Error('Graphic Asset replacement publication lost its claim');
			}
			if (asset.facts.sha256 === input.sourceDigest) {
				const completed = completedGraphicAssetReplacementOperation({
					operation: input.operation,
					outcome: 'replacement-noop',
					assetId: input.targetAssetId,
					revisionId: asset.revisionId,
					completedAt: input.publishedAt,
				});
				operations.set(completed.id, cloneOperation(completed));
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
				canonicalWriteCandidates.delete(completed.id);
				releaseCapacity(completed.id);
				return cloneOperation(completed);
			}
			const revisionNumber = asset.revisionNumber + 1;
			const completed = completedGraphicAssetReplacementOperation({
				operation: input.operation,
				outcome: 'revision-created',
				assetId: input.targetAssetId,
				revisionId: input.revisionId,
				completedAt: input.publishedAt,
			});
			operations.set(completed.id, cloneOperation(completed));
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			canonicalWriteCandidates.delete(completed.id);
			releaseCapacity(completed.id);
			revisions.set(input.revisionId, {
				assetId: input.targetAssetId,
				revisionNumber,
				facts: input.report.facts,
				compatibilityProfile: input.report.compatibilityProfile,
				thumbnailDigest: input.thumbnailDigest,
			});
			assets.set(input.targetAssetId, {
				...asset,
				kind: input.report.facts.kind,
				revisionId: input.revisionId,
				revisionNumber,
				revisions: [
					...asset.revisions,
					{
						id: input.revisionId,
						revisionNumber,
						facts: input.report.facts,
					},
				],
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
		async publishGraphicAsset(input: PublishGraphicAssetCatalogueInput) {
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
				? [...assets.values()].find(asset =>
						asset.lifecycle.state === 'active'
						&& asset.facts.sha256 === input.sourceDigest,
					)
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
				kind: input.report.facts.kind,
				revisionId: input.revisionId,
				revisionNumber: 1,
				revisions: [{
					id: input.revisionId,
					revisionNumber: 1,
					facts: input.report.facts,
				}],
				facts: input.report.facts,
				eventIds: input.operation.defaultEventId === undefined
					? []
					: [input.operation.defaultEventId],
				lifecycle: { state: 'active' },
				operation: cloneOperation(completed),
			});
			revisions.set(input.revisionId, {
				assetId: input.assetId,
				revisionNumber: 1,
				facts: input.report.facts,
				compatibilityProfile: input.report.compatibilityProfile,
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
			if (!asset || asset.lifecycle.state !== 'active')
				return undefined;
			const updated = {
				...asset,
				name: input.name,
				eventIds: [...input.eventIds],
			};
			assets.set(input.assetId, updated);
			return structuredClone(updated);
		},
		async listGraphicAssets(search, lifecycleStates) {
			const normalizedSearch = search.trim().toLocaleLowerCase();
			return [...assets.values()]
				.filter(asset => lifecycleStates.includes(asset.lifecycle.state))
				.filter(asset => !normalizedSearch || asset.name.toLocaleLowerCase().includes(normalizedSearch))
				.map(asset => structuredClone(asset));
		},
		async retireGraphicAsset(input) {
			const asset = assets.get(input.assetId);
			if (!asset)
				return { outcome: 'not-found' };
			if (asset.lifecycle.state !== 'active')
				return { outcome: 'not-allowed' };
			const retired: GraphicAsset = {
				...asset,
				lifecycle: { state: 'retired' },
			};
			assets.set(input.assetId, retired);
			return { outcome: 'updated', asset: structuredClone(retired) };
		},
		async trashGraphicAsset(input) {
			const asset = assets.get(input.assetId);
			if (!asset)
				return { outcome: 'not-found' };
			if (asset.lifecycle.state !== 'active' && asset.lifecycle.state !== 'retired')
				return { outcome: 'not-allowed' };
			const currentUsage = allUsage()
				.filter(item => item.reference.assetId === input.assetId)
				.map(item => structuredClone(item));
			if (currentUsage.length > 0)
				return { outcome: 'in-use', usage: currentUsage };
			const trashed: GraphicAsset = {
				...asset,
				lifecycle: {
					state: 'trashed',
					priorState: asset.lifecycle.state,
					trashedAt: input.trashedAt,
					recoverableUntil: input.recoverableUntil,
				},
			};
			assets.set(input.assetId, trashed);
			return { outcome: 'updated', asset: structuredClone(trashed) };
		},
		async restoreGraphicAsset(input) {
			const asset = assets.get(input.assetId);
			if (!asset)
				return { outcome: 'not-found' };
			if (asset.lifecycle.state === 'retired') {
				const active: GraphicAsset = {
					...asset,
					lifecycle: { state: 'active' },
				};
				assets.set(input.assetId, active);
				return { outcome: 'updated', asset: structuredClone(active) };
			}
			if (
				asset.lifecycle.state !== 'trashed'
				|| asset.lifecycle.recoverableUntil < input.restoredAt
			) {
				return { outcome: 'not-allowed' };
			}
			const restored: GraphicAsset = {
				...asset,
				lifecycle: { state: asset.lifecycle.priorState },
			};
			assets.set(input.assetId, restored);
			return { outcome: 'updated', asset: structuredClone(restored) };
		},
		async findRevisionContent(input) {
			const revision = revisions.get(input.revisionId);
			if (!revision || revision.assetId !== input.assetId)
				return undefined;
			const asset = assets.get(revision.assetId);
			return {
				digest: revision.facts.sha256,
				byteLength: revision.facts.byteLength,
				canonicalMime: revision.facts.canonicalMime,
				kind: revision.facts.kind,
				lifecycleState: asset?.lifecycle.state ?? 'active',
				name: asset?.name ?? '',
				revisionNumber: revision.revisionNumber,
				compatibilityProfile: revision.compatibilityProfile,
				facts: structuredClone(revision.facts),
			};
		},
		async listGraphicAssetUsage(assetId) {
			return allUsage()
				.filter(item => item.reference.assetId === assetId)
				.map(item => structuredClone(item));
		},
		async findThumbnailContent(assetId: GraphicAssetId) {
			const asset = assets.get(assetId);
			const digest = asset ? revisions.get(asset.revisionId)?.thumbnailDigest : undefined;
			const content = digest === undefined ? undefined : canonicalContents.get(digest);
			return digest !== undefined && content !== undefined
				? {
						digest,
						byteLength: content.byteLength,
						// Every deterministic Graphics Derivative is a transparent sRGB PNG.
						canonicalMime: 'image/png',
					}
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

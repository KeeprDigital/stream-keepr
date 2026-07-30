import type {
	GraphicAssetId,
	GraphicAssetLifecycle,
	GraphicAssetRetentionView,
	GraphicAssetRevisionId,
	GraphicsAssetEvidenceCategory,
	GraphicsAssetEvidenceEntry,
	GraphicsAssetLibraryCapacity,
	GraphicsContentQuarantineDeadline,
	GraphicsIngestionOperationId,
	GraphicsIngestionStage,
	GraphicsRetentionEvidenceCategory,
	GraphicsRetentionOverview,
	GraphicsRetentionSweepResult,
	GraphicsRevisionPruningDeadline,
	GraphicsStagedInputDeadline,
	GraphicsTrashDeadline,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsAssetMultipartState } from './multipart';
import type {
	GraphicsCanonicalObjectStore,
	GraphicsStagingObjectStore,
} from './object-store';
import {
	GRAPHICS_RETENTION_ACTOR,
	GRAPHICS_RETENTION_GUARANTEES,
	graphicsRetentionDeadline,
} from '~~/shared/utils/graphicsAssetRetention';
import { graphicsObjectIdentity } from './object-store';
import { stagedIngestionObjectIdentities } from './operation';

/** How many candidates one scheduled sweep processes per retention stage. */
export const GRAPHICS_RETENTION_STAGE_BATCH = 200;

/**
 * How long one sweep's claim on quarantined content stays exclusive. A sweep
 * that dies between claiming and confirming leaves the row claimed; after this
 * lease a later sweep may reclaim it and retry the byte deletion.
 */
export const GRAPHICS_CONTENT_DELETION_CLAIM_LEASE_MILLISECONDS = 60 * 60 * 1000;

export interface StagedInputExpiryCandidate {
	operationId: GraphicsIngestionOperationId;
	initiatedBy: string;
	stage: GraphicsIngestionStage;
	transferComplete: boolean;
	stagingBytes: number;
	observedUpdatedAt: string;
}

export interface RevisionPruningSchedule {
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	revisionNumber: number;
	unreferencedSince: string;
	pruneAfter: string;
	frozen: boolean;
}

export interface RevisionPruningCancellation {
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	revisionNumber: number;
	reason: 'referenced' | 'latest-revision';
	referenceCount: number;
}

export interface PrunableRevision {
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	revisionNumber: number;
	unreferencedSince: string;
	pruneAfter: string;
}

export interface PurgeableTrashedAsset {
	assetId: GraphicAssetId;
	name: string;
	trashedAt: string;
	recoverableUntil: string;
	revisionCount: number;
}

export interface QuarantinedContent {
	id: string;
	digest: string;
	byteLength: number;
	origin: 'orphaned-content' | 'abandoned-canonical-write';
	quarantinedAt: string;
	deleteAfter: string;
}

export type PurgeGraphicAssetOutcome
	= | { outcome: 'purged'; revisionCount: number; referenceCount: 0 }
		| { outcome: 'blocked'; revisionCount: number; referenceCount: number }
		| { outcome: 'not-trashed' }
		| { outcome: 'not-found' };

/**
 * The catalogue capabilities the scheduled retention path needs. They are kept
 * separate from ordinary catalogue access so every one of them is a
 * transactional proof rather than a read followed by an unguarded write.
 */
export interface GraphicsAssetRetentionCatalogue {
	listStagedInputExpiryCandidates: (input: {
		incompleteTransferBefore: string;
		completedInputBefore: string;
		limit: number;
	}) => Promise<StagedInputExpiryCandidate[]>;
	expireStagedInput: (input: {
		operationId: GraphicsIngestionOperationId;
		observedUpdatedAt: string;
		expiredAt: string;
	}) => Promise<boolean>;
	/**
	 * Removes pruning state from revisions that are reachable again — a new
	 * reference or the asset's latest revision — which cancels their pruning.
	 */
	cancelRevisionPruning: (input: { limit: number }) => Promise<RevisionPruningCancellation[]>;
	/**
	 * Starts the recovery window for superseded revisions no reference reaches.
	 * A revision observed while its asset is in Trash is scheduled frozen.
	 */
	scheduleRevisionPruning: (input: {
		observedAt: string;
		pruneAfter: string;
		limit: number;
	}) => Promise<RevisionPruningSchedule[]>;
	listPrunableRevisions: (input: {
		prunableBefore: string;
		limit: number;
	}) => Promise<PrunableRevision[]>;
	/**
	 * Removes one revision and its dependent derivatives after re-proving, in
	 * the same transaction, that nothing references it, it is not the latest
	 * revision, its asset is not in Trash, and its deadline has passed.
	 */
	pruneRevision: (input: {
		revisionId: GraphicAssetRevisionId;
		prunedAt: string;
	}) => Promise<boolean>;
	listPurgeableTrashedAssets: (input: {
		purgeableBefore: string;
		limit: number;
	}) => Promise<PurgeableTrashedAsset[]>;
	/**
	 * Purges one Trashed Graphic Asset. The tombstone and the removal of every
	 * restorable row happen in one transaction that re-proves, at purge time,
	 * that no revision of the asset is referenced.
	 */
	purgeGraphicAsset: (input: {
		assetId: GraphicAssetId;
		purgedAt: string;
		reason: 'trash-window-elapsed' | 'early-purge';
		requireRecoveryWindowElapsed: boolean;
	}) => Promise<PurgeGraphicAssetOutcome>;
	/**
	 * Quarantines content whose final reachability has disappeared and releases
	 * quarantined content a retained revision or derivative reaches again.
	 */
	reconcileContentQuarantine: (input: {
		generateIdentity: () => string;
		quarantinedAt: string;
		deleteAfter: string;
		limit: number;
	}) => Promise<{
		quarantined: QuarantinedContent[];
		released: { id: string; byteLength: number }[];
	}>;
	listDeletableQuarantinedContent: (input: {
		deletableBefore: string;
		limit: number;
	}) => Promise<QuarantinedContent[]>;
	/**
	 * Rechecks D1 and, only when the content is still unreachable, claims it for
	 * byte deletion. The quarantine row survives the claim so an unavailable byte
	 * store can never strand an object without a catalogue trace.
	 */
	claimQuarantinedContentDeletion: (input: {
		id: string;
		digest: string;
		deletableBefore: string;
		claimedAt: string;
		staleClaimsBefore: string;
	}) => Promise<boolean>;
	/** Returns a claimed row to the queue without deleting anything. */
	releaseQuarantinedContentClaim: (input: { id: string }) => Promise<void>;
	/**
	 * Removes the catalogue trace once the bytes are confirmed gone, and reports
	 * whether this caller's own claim was the one completed.
	 */
	completeQuarantinedContentDeletion: (input: {
		id: string;
		digest: string;
		claimedAt: string;
	}) => Promise<boolean>;
	/** Counts the revisions and derivatives that currently reach one content. */
	countContentReachability: (input: { digest: string }) => Promise<number>;
	/** Records content that became reachable again while its bytes were being deleted. */
	markContentUnavailable: (input: {
		digest: string;
		reasonCode: string;
		since: string;
	}) => Promise<void>;
	/** Every revision's retention policy, for one asset or for every candidate. */
	listRevisionRetention: (input: {
		assetId?: GraphicAssetId;
		limit: number;
	}) => Promise<GraphicsRevisionPruningDeadline[]>;
	listTrashDeadlines: (input: { limit: number }) => Promise<GraphicsTrashDeadline[]>;
	listStagedInputDeadlines: (input: { limit: number }) => Promise<GraphicsStagedInputDeadline[]>;
	listQuarantineDeadlines: (input: {
		limit: number;
	}) => Promise<GraphicsContentQuarantineDeadline[]>;
	findGraphicAssetLifecycle: (
		assetId: GraphicAssetId,
	) => Promise<GraphicAssetLifecycle | undefined>;
	recordGraphicsAssetEvidence: (
		entries: readonly GraphicsAssetEvidenceEntry[],
	) => Promise<void>;
	listGraphicsAssetEvidence: (input: {
		limit: number;
		categories?: readonly GraphicsAssetEvidenceCategory[];
	}) => Promise<GraphicsAssetEvidenceEntry[]>;
	expireGraphicsAssetEvidence: (input: { expiredBefore: string }) => Promise<number>;
}

interface GraphicsRetentionDependencies {
	catalogue: GraphicsAssetRetentionCatalogue & {
		getCapacity: () => Promise<GraphicsAssetLibraryCapacity>;
		getGraphicAssetMultipartState: (
			operationId: GraphicsIngestionOperationId,
			initiatedBy: string,
		) => Promise<GraphicsAssetMultipartState | undefined>;
	};
	staging: GraphicsStagingObjectStore;
	canonical: GraphicsCanonicalObjectStore;
	now: () => Date;
	generateIdentity: () => string;
}

export function createGraphicsRetention(dependencies: GraphicsRetentionDependencies) {
	const { catalogue, staging, now, generateIdentity } = dependencies;

	function timestamp() {
		return now().toISOString();
	}

	function evidence(input: {
		recordedAt: string;
		correlationId: string;
		category: GraphicsRetentionEvidenceCategory;
		actor?: string;
		subject: GraphicsAssetEvidenceEntry['subject'];
		outcome: string;
		reason: string;
		detail?: GraphicsAssetEvidenceEntry['detail'];
	}): GraphicsAssetEvidenceEntry {
		return {
			id: generateIdentity(),
			recordedAt: input.recordedAt,
			category: input.category,
			actor: input.actor ?? GRAPHICS_RETENTION_ACTOR,
			subject: input.subject,
			outcome: input.outcome,
			reason: input.reason,
			correlationId: input.correlationId,
			detail: input.detail ?? {},
			expiresAt: graphicsRetentionDeadline(
				input.recordedAt,
				GRAPHICS_RETENTION_GUARANTEES.evidenceMilliseconds,
			),
		};
	}

	/**
	 * Releases every staging object one operation may own. Object-store
	 * unavailability leaves the objects for the next sweep instead of reporting
	 * reclaimed bytes that still exist.
	 */
	async function releaseStagedObjects(
		operationId: GraphicsIngestionOperationId,
		initiatedBy: string,
	): Promise<boolean> {
		const multipart = await catalogue.getGraphicAssetMultipartState(operationId, initiatedBy);
		let released = true;
		if (multipart?.uploadId) {
			const aborted = await staging.abortMultipart({
				identity: stagedIngestionObjectIdentities(operationId)[0]!,
				uploadId: multipart.uploadId,
			});
			released = released && aborted.outcome === 'aborted';
		}
		for (const identity of stagedIngestionObjectIdentities(operationId)) {
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
			const deleted = await staging.delete(identity);
			released = released && deleted.outcome !== 'unavailable';
		}
		return released;
	}

	/**
	 * The canonical quota state observed when this sweep started. Evidence for
	 * an action that frees or reserves bytes records it so an incident stays
	 * explainable without re-deriving capacity later.
	 */
	async function observeQuotaState(): Promise<GraphicsAssetEvidenceEntry['detail']> {
		const capacity = await catalogue.getCapacity();
		return {
			canonicalUsedBytes: capacity.canonical.usedBytes,
			canonicalLimitBytes: capacity.canonical.limitBytes,
			canonicalPressure: capacity.canonical.pressure,
		};
	}

	async function expireStagedInput(
		correlationId: string,
		quotaState: GraphicsAssetEvidenceEntry['detail'],
	) {
		const startedAt = timestamp();
		const candidates = await catalogue.listStagedInputExpiryCandidates({
			incompleteTransferBefore: graphicsRetentionDeadline(
				startedAt,
				-GRAPHICS_RETENTION_GUARANTEES.incompleteTransferMilliseconds,
			),
			completedInputBefore: graphicsRetentionDeadline(
				startedAt,
				-GRAPHICS_RETENTION_GUARANTEES.completedInputMilliseconds,
			),
			limit: GRAPHICS_RETENTION_STAGE_BATCH,
		});
		const records: GraphicsAssetEvidenceEntry[] = [];
		let expiredIncompleteTransfers = 0;
		let expiredCompletedInput = 0;
		for (const candidate of candidates) {
			const expiredAt = timestamp();
			const expired = await catalogue.expireStagedInput({
				operationId: candidate.operationId,
				observedUpdatedAt: candidate.observedUpdatedAt,
				expiredAt,
			});
			if (!expired)
				continue;
			await releaseStagedObjects(candidate.operationId, candidate.initiatedBy);
			if (candidate.transferComplete)
				expiredCompletedInput++;
			else
				expiredIncompleteTransfers++;
			records.push(evidence({
				recordedAt: expiredAt,
				correlationId,
				category: 'staged-input-expired',
				subject: {
					kind: 'graphics-ingestion-operation',
					id: candidate.operationId,
				},
				outcome: 'staged-input-expired',
				reason: candidate.transferComplete
					? 'completed-input-retention-elapsed'
					: 'incomplete-transfer-without-verified-progress',
				detail: {
					...quotaState,
					bytesFreed: candidate.stagingBytes,
					deadline: graphicsRetentionDeadline(
						candidate.observedUpdatedAt,
						candidate.transferComplete
							? GRAPHICS_RETENTION_GUARANTEES.completedInputMilliseconds
							: GRAPHICS_RETENTION_GUARANTEES.incompleteTransferMilliseconds,
					),
				},
			}));
		}
		return {
			stagedInput: { expiredIncompleteTransfers, expiredCompletedInput },
			records,
		};
	}

	/**
	 * Maintains revision pruning deadlines and prunes the revisions whose
	 * complete recovery window has elapsed. Cancellation runs before scheduling
	 * so a reference that appeared since the last sweep always wins.
	 */
	async function pruneRevisions(correlationId: string) {
		const records: GraphicsAssetEvidenceEntry[] = [];
		const cancelled = await catalogue.cancelRevisionPruning({
			limit: GRAPHICS_RETENTION_STAGE_BATCH,
		});
		for (const revision of cancelled) {
			records.push(evidence({
				recordedAt: timestamp(),
				correlationId,
				category: 'revision-pruning-cancelled',
				subject: { kind: 'graphic-asset-revision', id: revision.revisionId },
				outcome: 'revision-retained',
				reason: revision.reason,
				detail: { referenceCount: revision.referenceCount },
			}));
		}

		const observedAt = timestamp();
		const scheduled = await catalogue.scheduleRevisionPruning({
			observedAt,
			pruneAfter: graphicsRetentionDeadline(
				observedAt,
				GRAPHICS_RETENTION_GUARANTEES.supersededRevisionMilliseconds,
			),
			limit: GRAPHICS_RETENTION_STAGE_BATCH,
		});
		for (const revision of scheduled) {
			records.push(evidence({
				recordedAt: observedAt,
				correlationId,
				category: revision.frozen
					? 'revision-pruning-frozen'
					: 'revision-pruning-scheduled',
				subject: { kind: 'graphic-asset-revision', id: revision.revisionId },
				outcome: revision.frozen ? 'revision-pruning-frozen' : 'revision-pruning-scheduled',
				reason: revision.frozen
					? 'trash-freezes-revision-pruning'
					: 'unreferenced-superseded-revision',
				detail: {
					referenceCount: 0,
					deadline: revision.pruneAfter,
					remainingMilliseconds: GRAPHICS_RETENTION_GUARANTEES.supersededRevisionMilliseconds,
				},
			}));
		}

		const prunableBefore = timestamp();
		const prunable = await catalogue.listPrunableRevisions({
			prunableBefore,
			limit: GRAPHICS_RETENTION_STAGE_BATCH,
		});
		let pruned = 0;
		for (const revision of prunable) {
			const prunedAt = timestamp();
			if (!await catalogue.pruneRevision({ revisionId: revision.revisionId, prunedAt }))
				continue;
			pruned++;
			records.push(evidence({
				recordedAt: prunedAt,
				correlationId,
				category: 'revision-pruned',
				subject: { kind: 'graphic-asset-revision', id: revision.revisionId },
				outcome: 'revision-pruned',
				reason: 'unreferenced-superseded-retention-elapsed',
				detail: {
					referenceCount: 0,
					deadline: revision.pruneAfter,
				},
			}));
		}

		return {
			revisions: {
				pruningScheduled: scheduled.filter(revision => !revision.frozen).length,
				pruningCancelled: cancelled.length,
				pruned,
			},
			records,
		};
	}

	/**
	 * Quarantines unreachable content, then deletes only the bytes that a fresh
	 * D1 recheck has just proven unreachable. If content becomes reachable while
	 * its bytes are being deleted, the conflict is recorded and the content is
	 * marked unavailable rather than silently losing a reachable identity.
	 */
	async function collectUnreachableContent(
		correlationId: string,
		quotaState: GraphicsAssetEvidenceEntry['detail'],
	) {
		const records: GraphicsAssetEvidenceEntry[] = [];
		const quarantinedAt = timestamp();
		const reconciled = await catalogue.reconcileContentQuarantine({
			generateIdentity,
			quarantinedAt,
			deleteAfter: graphicsRetentionDeadline(
				quarantinedAt,
				GRAPHICS_RETENTION_GUARANTEES.orphanContentQuarantineMilliseconds,
			),
			limit: GRAPHICS_RETENTION_STAGE_BATCH,
		});
		for (const content of reconciled.quarantined) {
			records.push(evidence({
				recordedAt: quarantinedAt,
				correlationId,
				category: 'content-quarantined',
				subject: { kind: 'graphic-asset-content', id: content.id },
				outcome: 'content-quarantined',
				reason: content.origin === 'orphaned-content'
					? 'final-reachability-disappeared'
					: 'canonical-write-abandoned-before-publication',
				detail: {
					bytesReserved: content.byteLength,
					deadline: content.deleteAfter,
				},
			}));
		}
		for (const content of reconciled.released) {
			records.push(evidence({
				recordedAt: quarantinedAt,
				correlationId,
				category: 'content-quarantine-released',
				subject: { kind: 'graphic-asset-content', id: content.id },
				outcome: 'content-retained',
				reason: 'reachable-again-at-recheck',
				detail: { bytesReserved: content.byteLength },
			}));
		}

		const deletable = await catalogue.listDeletableQuarantinedContent({
			deletableBefore: timestamp(),
			limit: GRAPHICS_RETENTION_STAGE_BATCH,
		});
		let deleted = 0;
		let bytesReclaimed = 0;
		for (const content of deletable) {
			const deletedAt = timestamp();
			const claimed = await catalogue.claimQuarantinedContentDeletion({
				id: content.id,
				digest: content.digest,
				deletableBefore: deletedAt,
				claimedAt: deletedAt,
				staleClaimsBefore: graphicsRetentionDeadline(
					deletedAt,
					-GRAPHICS_CONTENT_DELETION_CLAIM_LEASE_MILLISECONDS,
				),
			});
			if (!claimed)
				continue;
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable content identity.
			const removal = await dependencies.canonical.delete(
				graphicsObjectIdentity(`sha256/${content.digest}`),
			);
			if (removal.outcome === 'unavailable') {
				// The quarantine row still holds the only record of these bytes, so
				// hand it back for the next sweep instead of losing track of them.
				await catalogue.releaseQuarantinedContentClaim({ id: content.id });
				continue;
			}
			const reachableAgain = await catalogue.countContentReachability({
				digest: content.digest,
			});
			if (reachableAgain > 0) {
				await catalogue.markContentUnavailable({
					digest: content.digest,
					reasonCode: 'quarantine-deletion-conflict',
					since: deletedAt,
				});
				await catalogue.releaseQuarantinedContentClaim({ id: content.id });
				records.push(evidence({
					recordedAt: deletedAt,
					correlationId,
					category: 'content-deletion-conflict',
					subject: { kind: 'graphic-asset-content', id: content.id },
					outcome: 'content-unavailable',
					reason: 'became-reachable-during-deletion',
					detail: { referenceCount: reachableAgain, ...quotaState },
				}));
				continue;
			}
			const completed = await catalogue.completeQuarantinedContentDeletion({
				id: content.id,
				digest: content.digest,
				claimedAt: deletedAt,
			});
			// Another sweep reclaimed this row past our lease and did the work, so
			// it is theirs to count and to record.
			if (!completed)
				continue;
			deleted++;
			bytesReclaimed += content.byteLength;
			records.push(evidence({
				recordedAt: deletedAt,
				correlationId,
				category: 'content-deleted',
				subject: { kind: 'graphic-asset-content', id: content.id },
				outcome: 'content-deleted',
				reason: 'unreachable-after-quarantine-recheck',
				detail: {
					bytesFreed: content.byteLength,
					deadline: content.deleteAfter,
					...quotaState,
				},
			}));
		}

		return {
			content: {
				quarantined: reconciled.quarantined.length,
				quarantineReleased: reconciled.released.length,
				deleted,
				bytesReclaimed,
			},
			records,
		};
	}

	function purgeEvidence(input: {
		assetId: GraphicAssetId;
		purgedAt: string;
		correlationId: string;
		actor?: string;
		reason: 'trash-window-elapsed' | 'early-purge';
		outcome: PurgeGraphicAssetOutcome;
	}): GraphicsAssetEvidenceEntry {
		const purged = input.outcome.outcome === 'purged';
		return evidence({
			recordedAt: input.purgedAt,
			correlationId: input.correlationId,
			actor: input.actor,
			category: purged ? 'graphic-asset-purged' : 'graphic-asset-purge-blocked',
			subject: { kind: 'graphic-asset', id: input.assetId },
			outcome: purged ? 'graphic-asset-purged' : 'graphic-asset-retained',
			reason: purged ? input.reason : 'reference-proof-found-usage',
			detail: input.outcome.outcome === 'purged' || input.outcome.outcome === 'blocked'
				? {
						referenceCount: input.outcome.referenceCount,
						revisionCount: input.outcome.revisionCount,
					}
				: {},
		});
	}

	async function purgeElapsedTrash(correlationId: string) {
		const records: GraphicsAssetEvidenceEntry[] = [];
		const purgeable = await catalogue.listPurgeableTrashedAssets({
			purgeableBefore: timestamp(),
			limit: GRAPHICS_RETENTION_STAGE_BATCH,
		});
		let purged = 0;
		let blockedByReferences = 0;
		for (const asset of purgeable) {
			const purgedAt = timestamp();
			const outcome = await catalogue.purgeGraphicAsset({
				assetId: asset.assetId,
				purgedAt,
				reason: 'trash-window-elapsed',
				requireRecoveryWindowElapsed: true,
			});
			if (outcome.outcome === 'purged')
				purged++;
			else if (outcome.outcome === 'blocked')
				blockedByReferences++;
			else
				continue;
			records.push(purgeEvidence({
				assetId: asset.assetId,
				purgedAt,
				correlationId,
				reason: 'trash-window-elapsed',
				outcome,
			}));
		}
		return { trash: { purged, blockedByReferences }, records };
	}

	/** How many deadlines one operational view lists per queue. */
	const OVERVIEW_LIMIT = 200;

	return {
		/**
		 * The operational retention view. Deadlines here are the same values the
		 * sweep enforces, and storage pressure is reported without ever scaling a
		 * guarantee down.
		 */
		async overview(capacity: GraphicsAssetLibraryCapacity): Promise<GraphicsRetentionOverview> {
			const [stagedInput, trashedAssets, prunableRevisions, quarantinedContent] = await Promise.all([
				catalogue.listStagedInputDeadlines({ limit: OVERVIEW_LIMIT }),
				catalogue.listTrashDeadlines({ limit: OVERVIEW_LIMIT }),
				catalogue.listRevisionRetention({ limit: OVERVIEW_LIMIT }),
				catalogue.listQuarantineDeadlines({ limit: OVERVIEW_LIMIT }),
			]);
			return {
				checkedAt: timestamp(),
				guarantees: { ...GRAPHICS_RETENTION_GUARANTEES },
				storagePressure: capacity.canonical.pressure,
				guaranteesShortenedUnderPressure: false,
				stagedInput,
				trashedAssets,
				prunableRevisions,
				quarantinedContent,
			};
		},
		/**
		 * Records what a Trash or restore transition did to revision pruning
		 * deadlines. Freezing and resuming are automated deadline changes, so they
		 * belong in the Evidence ledger alongside the sweep's own decisions.
		 */
		async recordPruningTransition(input: {
			assetId: GraphicAssetId;
			transition: 'frozen' | 'resumed';
			actor: string;
			recordedAt: string;
		}) {
			const revisions = await catalogue.listRevisionRetention({
				assetId: input.assetId,
				limit: OVERVIEW_LIMIT,
			});
			const affected = revisions.filter(revision =>
				revision.retention.policy === (
					input.transition === 'frozen' ? 'pruning-frozen' : 'unreferenced-superseded'
				));
			if (affected.length === 0)
				return;
			const correlationId = generateIdentity();
			await catalogue.recordGraphicsAssetEvidence(affected.map(revision => evidence({
				recordedAt: input.recordedAt,
				correlationId,
				actor: input.actor,
				category: input.transition === 'frozen'
					? 'revision-pruning-frozen'
					: 'revision-pruning-resumed',
				subject: { kind: 'graphic-asset-revision', id: revision.revisionId },
				outcome: input.transition === 'frozen'
					? 'revision-pruning-frozen'
					: 'revision-pruning-resumed',
				reason: input.transition === 'frozen'
					? 'trash-freezes-revision-pruning'
					: 'restoration-resumes-remaining-recovery-time',
				detail: revision.retention.policy === 'pruning-frozen'
					? { remainingMilliseconds: revision.retention.remainingMilliseconds }
					: revision.retention.policy === 'unreferenced-superseded'
						? { deadline: revision.retention.pruneAfter }
						: {},
			})));
		},
		async inspect(assetId: GraphicAssetId): Promise<GraphicAssetRetentionView | undefined> {
			const lifecycle = await catalogue.findGraphicAssetLifecycle(assetId);
			if (!lifecycle)
				return undefined;
			return {
				assetId,
				lifecycle,
				revisions: await catalogue.listRevisionRetention({
					assetId,
					limit: OVERVIEW_LIMIT,
				}),
			};
		},
		/**
		 * The administrator's explicitly confirmed early purge. It uses the same
		 * fresh reference proof, tombstone, and atomic removal as scheduled purge.
		 */
		async purge(input: { assetId: GraphicAssetId; actor: string }) {
			const purgedAt = timestamp();
			const correlationId = generateIdentity();
			const outcome = await catalogue.purgeGraphicAsset({
				assetId: input.assetId,
				purgedAt,
				reason: 'early-purge',
				requireRecoveryWindowElapsed: false,
			});
			if (outcome.outcome === 'not-found' || outcome.outcome === 'not-trashed')
				return outcome;
			await catalogue.recordGraphicsAssetEvidence([purgeEvidence({
				assetId: input.assetId,
				purgedAt,
				correlationId,
				actor: input.actor,
				reason: 'early-purge',
				outcome,
			})]);
			return outcome.outcome === 'purged'
				? {
						outcome: 'purged' as const,
						purgedAt,
						revisionCount: outcome.revisionCount,
						referenceCount: outcome.referenceCount,
					}
				: outcome;
		},
		async run(): Promise<GraphicsRetentionSweepResult> {
			const correlationId = generateIdentity();
			const startedAt = timestamp();
			const quotaState = await observeQuotaState();
			const staged = await expireStagedInput(correlationId, quotaState);
			const trash = await purgeElapsedTrash(correlationId);
			const revisions = await pruneRevisions(correlationId);
			const content = await collectUnreachableContent(correlationId, quotaState);
			const records = [
				...staged.records,
				...trash.records,
				...revisions.records,
				...content.records,
			];
			if (records.length > 0)
				await catalogue.recordGraphicsAssetEvidence(records);
			const expiredEvidence = await catalogue.expireGraphicsAssetEvidence({
				expiredBefore: timestamp(),
			});
			return {
				correlationId,
				startedAt,
				completedAt: timestamp(),
				stagedInput: staged.stagedInput,
				revisions: revisions.revisions,
				trash: trash.trash,
				content: content.content,
				evidence: { recorded: records.length, expired: expiredEvidence },
			};
		},
		async listEvidence(input: {
			limit?: number;
			categories?: readonly GraphicsAssetEvidenceCategory[];
		} = {}) {
			return await catalogue.listGraphicsAssetEvidence({
				limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
				categories: input.categories,
			});
		},
	};
}

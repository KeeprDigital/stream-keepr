import type {
	GraphicAssetId,
	GraphicAssetPurgeReason,
	GraphicAssetRevisionId,
	GraphicAssetRevisionRetention,
	GraphicsAssetEvidenceEntry,
	GraphicsContentQuarantineDeadline,
	GraphicsIngestionOperationId,
	GraphicsIngestionStage,
	GraphicsRevisionPruningDeadline,
	GraphicsStagedInputDeadline,
	GraphicsTrashDeadline,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsAssetRetentionCatalogue,
	PrunableRevision,
	PurgeableTrashedAsset,
	QuarantinedContent,
	RetiredGraphicAsset,
	RevisionPruningCancellation,
	RevisionPruningSchedule,
	StagedInputExpiryCandidate,
} from './retention';
import { GRAPHICS_RETENTION_GUARANTEES } from '~~/shared/utils/graphicsAssetRetention';
import { boundJsonArray, valuesFromJsonArray } from './catalogue-sql';

/** Stages that still hold staged input and may therefore expire. */
const RETAINED_INPUT_STAGES = [
	'created',
	'transferring',
	'hashing',
	'validating',
	'generating-derivatives',
	'awaiting-confirmation',
	'awaiting-installation',
	'publishing',
] as const;

/**
 * Whether an operation's transfer had completed, which decides between the
 * 24-hour incomplete-transfer guarantee and the seven-day completed-input one.
 *
 * Stage alone cannot answer this: `failed` is reachable both mid-transfer and
 * after the input was durably staged, and those carry different guarantees.
 * The durable transfer-completed fact is the only correct source.
 */
const TRANSFER_COMPLETE_SQL
	= 'CASE WHEN transfer_completed_at IS NOT NULL THEN 1 ELSE 0 END';

/** Operations still holding staged input: working stages, or a retryable failure. */
const RETAINS_STAGED_INPUT_SQL = `(
	stage IN (${RETAINED_INPUT_STAGES.map(stage => `'${stage}'`).join(', ')})
	OR (stage = 'failed' AND json_extract(failure, '$.retryable') = 1)
)`;

/** An operation nobody will hear from again: completed, cancelled, or failed for good. */
const TERMINAL_STAGE_SQL = `(
	stage IN ('completed', 'cancelled')
	OR (stage = 'failed' AND json_extract(failure, '$.retryable') = 0)
)`;

/**
 * A terminal operation still holding staging bytes is a stranded release, and
 * only that (#358): every ordinary terminal transition zeroes the staging byte
 * columns in the same statement that makes the stage terminal
 * (`updateOperationStatement`), and the staged-input expiry above now leaves
 * them standing precisely when `releaseStagedObjects` could not land. So the
 * accounting is the marker — no separate column records the strand.
 */
const UNRELEASED_STAGED_INPUT_SQL = `(
	${TERMINAL_STAGE_SQL}
	AND staging_used_byte_length + staging_reserved_byte_length > 0
)`;

/**
 * Content is reachable only through a retained revision or a derivative of one.
 * Derivatives cascade away with their source revision, so they can never keep
 * their source's content alive independently.
 */
function unreachableDigest(column: string) {
	return `
		NOT EXISTS (
			SELECT 1 FROM graphic_asset_revisions revision
			WHERE revision.content_digest = ${column}
		)
		AND NOT EXISTS (
			SELECT 1 FROM graphics_derivatives derivative
			WHERE derivative.content_digest = ${column}
		)
	`;
}

/** A digest with a write candidate on an operation that may still publish it. */
function claimedByPendingOperation(column: string) {
	return `
		EXISTS (
			SELECT 1
			FROM graphics_canonical_write_candidates active
			JOIN graphics_ingestion_operations pending
				ON pending.id = active.operation_id
			WHERE active.digest = ${column}
				AND pending.stage NOT IN ('completed', 'cancelled')
				AND NOT (
					pending.stage = 'failed'
					AND json_extract(pending.failure, '$.retryable') = 0
				)
		)
	`;
}

interface RevisionRetentionRow {
	id: string;
	asset_id: string;
	revision_number: number;
	reference_count: number;
	is_latest: number;
	unreferenced_since: number | null;
	prune_after: number | null;
	frozen_at: number | null;
	frozen_remaining_milliseconds: number | null;
}

/**
 * Retention is derived from reachability first: a referenced revision and an
 * asset's latest revision have no deadline at all. Only a superseded revision
 * nothing reaches carries one.
 */
function revisionRetentionFromRow(row: RevisionRetentionRow): GraphicsRevisionPruningDeadline {
	function policy(): GraphicAssetRevisionRetention {
		if (row.reference_count > 0)
			return { policy: 'referenced', referenceCount: row.reference_count };
		if (row.is_latest === 1)
			return { policy: 'latest-revision' };
		const unreferencedSince = new Date(
			row.unreferenced_since ?? row.frozen_at ?? 0,
		).toISOString();
		if (row.frozen_at !== null) {
			return {
				policy: 'pruning-frozen',
				unreferencedSince,
				frozenAt: new Date(row.frozen_at).toISOString(),
				remainingMilliseconds: row.frozen_remaining_milliseconds ?? 0,
			};
		}
		return {
			policy: 'unreferenced-superseded',
			unreferencedSince,
			pruneAfter: new Date(
				row.prune_after
				?? (row.unreferenced_since ?? 0)
				+ GRAPHICS_RETENTION_GUARANTEES.supersededRevisionMilliseconds,
			).toISOString(),
		};
	}
	return {
		assetId: row.asset_id as GraphicAssetId,
		revisionId: row.id as GraphicAssetRevisionId,
		revisionNumber: row.revision_number,
		retention: policy(),
	};
}

interface EvidenceRow {
	id: string;
	recorded_at: number;
	category: string;
	actor: string;
	subject_kind: GraphicsAssetEvidenceEntry['subject']['kind'];
	subject_id: string;
	outcome: string;
	reason: string;
	correlation_id: string;
	detail: string;
	expires_at: number | null;
}

function evidenceFromRow(row: EvidenceRow): GraphicsAssetEvidenceEntry {
	return {
		id: row.id,
		recordedAt: new Date(row.recorded_at).toISOString(),
		category: row.category as GraphicsAssetEvidenceEntry['category'],
		actor: row.actor,
		subject: { kind: row.subject_kind, id: row.subject_id },
		outcome: row.outcome,
		reason: row.reason,
		correlationId: row.correlation_id,
		detail: JSON.parse(row.detail) as GraphicsAssetEvidenceEntry['detail'],
		expiresAt: row.expires_at === null
			? null
			: new Date(row.expires_at).toISOString(),
	};
}

export function createD1GraphicsAssetRetentionCatalogue(
	database: D1Database,
): GraphicsAssetRetentionCatalogue {
	return {
		async listStagedInputExpiryCandidates(input) {
			const result = await database.prepare(`
				SELECT id, initiated_by, stage, updated_at,
					staging_used_byte_length + staging_reserved_byte_length AS staging_bytes,
					${TRANSFER_COMPLETE_SQL} AS transfer_complete
				FROM graphics_ingestion_operations
				WHERE ${RETAINS_STAGED_INPUT_SQL}
					AND updated_at <= CASE
						WHEN transfer_completed_at IS NOT NULL THEN ?
						ELSE ?
					END
				ORDER BY updated_at, id
				LIMIT ?
			`).bind(
				new Date(input.completedInputBefore).getTime(),
				new Date(input.incompleteTransferBefore).getTime(),
				input.limit,
			).all<{
				id: string;
				initiated_by: string;
				stage: GraphicsIngestionStage;
				updated_at: number;
				staging_bytes: number;
				transfer_complete: number;
			}>();
			if (!result.success)
				throw new Error('Graphics staged input expiry candidates could not be read');
			return result.results.map((row): StagedInputExpiryCandidate => ({
				operationId: row.id as GraphicsIngestionOperationId,
				initiatedBy: row.initiated_by,
				stage: row.stage,
				transferComplete: row.transfer_complete === 1,
				stagingBytes: row.staging_bytes,
				observedUpdatedAt: new Date(row.updated_at).toISOString(),
			}));
		},
		async expireStagedInput(input) {
			// Binding expiry to the observed instant means any durable checkpoint
			// that advanced in the meantime cancels this expiry.
			//
			// The staging byte columns are deliberately not zeroed here (#358).
			// The expiry is the sweep's claim, and the release of the staged
			// objects comes after it and can fail against an unavailable store —
			// so the bytes stay on the books until `releaseStagedInputBytes`
			// proves the delete landed, and capacity keeps reporting what the
			// store is still holding.
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET stage = 'failed',
					failure = json_object(
						'code', 'staged-input-expired',
						'retryable', json('false'),
						'message', 'Staged Graphic Asset input passed its retention deadline; start a new ingestion operation.'
					),
					canonical_reserved_byte_length = 0,
					updated_at = ?
				WHERE id = ?
					AND updated_at = ?
					AND stage NOT IN ('completed', 'cancelled')
					AND NOT (stage = 'failed' AND json_extract(failure, '$.retryable') = 0)
			`).bind(
				new Date(input.expiredAt).getTime(),
				input.operationId,
				new Date(input.observedUpdatedAt).getTime(),
			).run();
			if (!result.success)
				throw new Error('Graphics staged input expiry failed');
			return result.meta.changes === 1;
		},
		async releaseStagedInputBytes(input) {
			// The proof half of the pair above: run only once the staged objects
			// are known deleted, it zeroes the accounting and reports what was
			// actually freed. Guarded to terminal stages holding bytes, so it is
			// idempotent — a second run finds nothing to zero and says so — and
			// so it can never write over an operation that is still working. The
			// read-then-write pair is safe because nothing else writes a terminal
			// operation's staging bytes, and the write re-states the figure it
			// read as its own guard regardless.
			const before = await database.prepare(`
				SELECT staging_used_byte_length + staging_reserved_byte_length AS staging_bytes
				FROM graphics_ingestion_operations
				WHERE id = ? AND ${TERMINAL_STAGE_SQL}
			`).bind(input.operationId).first<{ staging_bytes: number }>();
			if (!before || before.staging_bytes <= 0)
				return { released: false, bytesFreed: 0 };
			const zeroed = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET staging_reserved_byte_length = 0,
					staging_used_byte_length = 0,
					updated_at = ?
				WHERE id = ?
					AND ${TERMINAL_STAGE_SQL}
					AND staging_used_byte_length + staging_reserved_byte_length = ?
			`).bind(
				new Date(input.releasedAt).getTime(),
				input.operationId,
				before.staging_bytes,
			).run();
			if (!zeroed.success)
				throw new Error('Graphics stranded staged input bytes could not be zeroed');
			return {
				released: zeroed.meta.changes === 1,
				bytesFreed: zeroed.meta.changes === 1 ? before.staging_bytes : 0,
			};
		},
		async listUnreleasedStagedInput(input) {
			const result = await database.prepare(`
				SELECT id, initiated_by, stage, proposed_name, updated_at,
					staging_used_byte_length + staging_reserved_byte_length AS staging_bytes
				FROM graphics_ingestion_operations
				WHERE ${UNRELEASED_STAGED_INPUT_SQL}
				ORDER BY updated_at, id
				LIMIT ?
			`).bind(input.limit).all<{
				id: string;
				initiated_by: string;
				stage: GraphicsIngestionStage;
				proposed_name: string;
				updated_at: number;
				staging_bytes: number;
			}>();
			if (!result.success)
				throw new Error('Graphics unreleased staged input could not be read');
			return result.results.map(row => ({
				operationId: row.id as GraphicsIngestionOperationId,
				initiatedBy: row.initiated_by,
				stage: row.stage,
				name: row.proposed_name,
				stagingBytes: row.staging_bytes,
				updatedAt: new Date(row.updated_at).toISOString(),
			}));
		},
		async findUnreleasedStagedInput(operationId) {
			const row = await database.prepare(`
				SELECT id, initiated_by, stage, proposed_name, updated_at,
					staging_used_byte_length + staging_reserved_byte_length AS staging_bytes
				FROM graphics_ingestion_operations
				WHERE id = ? AND ${UNRELEASED_STAGED_INPUT_SQL}
			`).bind(operationId).first<{
				id: string;
				initiated_by: string;
				stage: GraphicsIngestionStage;
				proposed_name: string;
				updated_at: number;
				staging_bytes: number;
			}>();
			if (!row)
				return undefined;
			return {
				operationId: row.id as GraphicsIngestionOperationId,
				initiatedBy: row.initiated_by,
				stage: row.stage,
				name: row.proposed_name,
				stagingBytes: row.staging_bytes,
				updatedAt: new Date(row.updated_at).toISOString(),
			};
		},
		async countUnreleasedStagedInput() {
			const row = await database.prepare(`
				SELECT COUNT(*) AS total FROM graphics_ingestion_operations
				WHERE ${UNRELEASED_STAGED_INPUT_SQL}
			`).first<{ total: number }>();
			if (!row)
				throw new Error('Graphics unreleased staged input could not be counted');
			return row.total;
		},
		async cancelRevisionPruning(input) {
			const result = await database.prepare(`
				SELECT retention.revision_id, revision.asset_id, revision.revision_number,
					(
						SELECT COUNT(*) FROM graphic_asset_references reference
						WHERE reference.revision_id = revision.id
					) AS reference_count
				FROM graphic_asset_revision_retention retention
				JOIN graphic_asset_revisions revision ON revision.id = retention.revision_id
				WHERE EXISTS (
						SELECT 1 FROM graphic_asset_references reference
						WHERE reference.revision_id = revision.id
					)
					OR revision.revision_number = (
						SELECT MAX(latest.revision_number)
						FROM graphic_asset_revisions latest
						WHERE latest.asset_id = revision.asset_id
					)
				ORDER BY retention.revision_id
				LIMIT ?
			`).bind(input.limit).all<{
				revision_id: string;
				asset_id: string;
				revision_number: number;
				reference_count: number;
			}>();
			if (!result.success)
				throw new Error('Graphic Asset Revision pruning cancellations could not be read');
			if (result.results.length === 0)
				return [];
			const cancelled = result.results.map((row): RevisionPruningCancellation => ({
				assetId: row.asset_id as GraphicAssetId,
				revisionId: row.revision_id as GraphicAssetRevisionId,
				revisionNumber: row.revision_number,
				reason: row.reference_count > 0 ? 'referenced' : 'latest-revision',
				referenceCount: row.reference_count,
			}));
			const removal = await database.prepare(`
				DELETE FROM graphic_asset_revision_retention
				WHERE revision_id IN ${valuesFromJsonArray()}
			`).bind(boundJsonArray(cancelled.map(revision => revision.revisionId))).run();
			if (!removal.success)
				throw new Error('Graphic Asset Revision pruning could not be cancelled');
			return cancelled;
		},
		async scheduleRevisionPruning(input) {
			const observedAt = new Date(input.observedAt).getTime();
			const pruneAfter = new Date(input.pruneAfter).getTime();
			const result = await database.prepare(`
				SELECT revision.id AS revision_id, revision.asset_id, revision.revision_number,
					CASE WHEN asset.lifecycle_state = 'trashed' THEN 1 ELSE 0 END AS frozen
				FROM graphic_asset_revisions revision
				JOIN graphic_assets asset ON asset.id = revision.asset_id
				WHERE NOT EXISTS (
						SELECT 1 FROM graphic_asset_revision_retention existing
						WHERE existing.revision_id = revision.id
					)
					AND NOT EXISTS (
						SELECT 1 FROM graphic_asset_references reference
						WHERE reference.revision_id = revision.id
					)
					AND revision.revision_number < (
						SELECT MAX(latest.revision_number)
						FROM graphic_asset_revisions latest
						WHERE latest.asset_id = revision.asset_id
					)
				ORDER BY revision.asset_id, revision.revision_number
				LIMIT ?
			`).bind(input.limit).all<{
				revision_id: string;
				asset_id: string;
				revision_number: number;
				frozen: number;
			}>();
			if (!result.success)
				throw new Error('Graphic Asset Revision pruning candidates could not be read');
			if (result.results.length === 0)
				return [];
			const statements = result.results.map(row => database.prepare(`
				INSERT OR IGNORE INTO graphic_asset_revision_retention (
					revision_id, unreferenced_since, prune_after,
					frozen_at, frozen_remaining_milliseconds, created_at
				)
				SELECT revision.id, ?, ?, ?, ?, ?
				FROM graphic_asset_revisions revision
				WHERE revision.id = ?
					AND NOT EXISTS (
						SELECT 1 FROM graphic_asset_references reference
						WHERE reference.revision_id = revision.id
					)
					AND revision.revision_number < (
						SELECT MAX(latest.revision_number)
						FROM graphic_asset_revisions latest
						WHERE latest.asset_id = revision.asset_id
					)
			`).bind(
				observedAt,
				pruneAfter,
				row.frozen === 1 ? observedAt : null,
				row.frozen === 1 ? pruneAfter - observedAt : null,
				observedAt,
				row.revision_id,
			)) as [D1PreparedStatement, ...D1PreparedStatement[]];
			const insertions = await database.batch(statements);
			if (insertions.some(insertion => !insertion.success))
				throw new Error('Graphic Asset Revision pruning could not be scheduled');
			return result.results
				.filter((_, index) => insertions[index]?.meta.changes === 1)
				.map((row): RevisionPruningSchedule => ({
					assetId: row.asset_id as GraphicAssetId,
					revisionId: row.revision_id as GraphicAssetRevisionId,
					revisionNumber: row.revision_number,
					unreferencedSince: input.observedAt,
					pruneAfter: input.pruneAfter,
					frozen: row.frozen === 1,
				}));
		},
		async listPrunableRevisions(input) {
			const result = await database.prepare(`
				SELECT retention.revision_id, retention.unreferenced_since, retention.prune_after,
					revision.asset_id, revision.revision_number
				FROM graphic_asset_revision_retention retention
				JOIN graphic_asset_revisions revision ON revision.id = retention.revision_id
				JOIN graphic_assets asset ON asset.id = revision.asset_id
				WHERE retention.frozen_at IS NULL
					AND retention.prune_after <= ?
					AND asset.lifecycle_state <> 'trashed'
				ORDER BY retention.prune_after, retention.revision_id
				LIMIT ?
			`).bind(new Date(input.prunableBefore).getTime(), input.limit).all<{
				revision_id: string;
				unreferenced_since: number;
				prune_after: number;
				asset_id: string;
				revision_number: number;
			}>();
			if (!result.success)
				throw new Error('Prunable Graphic Asset Revisions could not be read');
			return result.results.map((row): PrunableRevision => ({
				assetId: row.asset_id as GraphicAssetId,
				revisionId: row.revision_id as GraphicAssetRevisionId,
				revisionNumber: row.revision_number,
				unreferencedSince: new Date(row.unreferenced_since).toISOString(),
				pruneAfter: new Date(row.prune_after).toISOString(),
			}));
		},
		async pruneRevision(input) {
			// The delete predicate is the proof: it re-checks references, the
			// latest-revision rule, Trash, and the deadline transactionally.
			// Dependent derivatives and the retention row cascade away with it.
			const result = await database.prepare(`
				DELETE FROM graphic_asset_revisions
				WHERE id = ?
					AND EXISTS (
						SELECT 1 FROM graphic_asset_revision_retention retention
						WHERE retention.revision_id = graphic_asset_revisions.id
							AND retention.frozen_at IS NULL
							AND retention.prune_after <= ?
					)
					AND NOT EXISTS (
						SELECT 1 FROM graphic_asset_references reference
						WHERE reference.revision_id = graphic_asset_revisions.id
					)
					AND revision_number < (
						SELECT MAX(latest.revision_number)
						FROM graphic_asset_revisions latest
						WHERE latest.asset_id = graphic_asset_revisions.asset_id
					)
					AND EXISTS (
						SELECT 1 FROM graphic_assets asset
						WHERE asset.id = graphic_asset_revisions.asset_id
							AND asset.lifecycle_state <> 'trashed'
					)
			`).bind(input.revisionId, new Date(input.prunedAt).getTime()).run();
			if (!result.success)
				throw new Error('Graphic Asset Revision pruning failed');
			// Cascaded rows make a provider's reported change count ambiguous, so
			// the absence of the revision is the authoritative outcome.
			return !await database.prepare(
				'SELECT 1 FROM graphic_asset_revisions WHERE id = ?',
			).bind(input.revisionId).first();
		},
		async listPurgeableTrashedAssets(input) {
			const result = await database.prepare(`
				SELECT asset.id, asset.name, asset.trashed_at, asset.trash_recoverable_until,
					(
						SELECT COUNT(*) FROM graphic_asset_revisions revision
						WHERE revision.asset_id = asset.id
					) AS revision_count
				FROM graphic_assets asset
				WHERE asset.lifecycle_state = 'trashed'
					AND asset.trash_recoverable_until <= ?
				ORDER BY asset.trash_recoverable_until, asset.id
				LIMIT ?
			`).bind(new Date(input.purgeableBefore).getTime(), input.limit).all<{
				id: string;
				name: string;
				trashed_at: number;
				trash_recoverable_until: number;
				revision_count: number;
			}>();
			if (!result.success)
				throw new Error('Purgeable Trashed Graphic Assets could not be read');
			return result.results.map((row): PurgeableTrashedAsset => ({
				assetId: row.id as GraphicAssetId,
				name: row.name,
				trashedAt: new Date(row.trashed_at).toISOString(),
				recoverableUntil: new Date(row.trash_recoverable_until).toISOString(),
				revisionCount: row.revision_count,
			}));
		},
		async purgeGraphicAsset(input) {
			const purgedAt = new Date(input.purgedAt).getTime();
			const current = await database.prepare(`
				SELECT asset.lifecycle_state, asset.trash_recoverable_until,
					(
						SELECT COUNT(*) FROM graphic_asset_revisions revision
						WHERE revision.asset_id = asset.id
					) AS revision_count,
					(
						SELECT COUNT(*) FROM graphic_asset_references reference
						WHERE reference.asset_id = asset.id
					) AS reference_count
				FROM graphic_assets asset
				WHERE asset.id = ?
			`).bind(input.assetId).first<{
				lifecycle_state: string;
				trash_recoverable_until: number | null;
				revision_count: number;
				reference_count: number;
			}>();
			if (!current)
				return { outcome: 'not-found' };
			if (
				current.lifecycle_state !== 'trashed'
				|| (
					input.requireRecoveryWindowElapsed
					&& (current.trash_recoverable_until ?? Number.POSITIVE_INFINITY) > purgedAt
				)
			) {
				return { outcome: 'not-trashed' };
			}

			const recoveryWindowPredicate = input.requireRecoveryWindowElapsed
				? 'AND asset.trash_recoverable_until <= ?'
				: '';
			const recoveryWindowBindings = input.requireRecoveryWindowElapsed ? [purgedAt] : [];
			// Removing the asset cascades its revisions, derivatives, retention
			// rows, and Event associations. Persisted references are RESTRICT, so
			// this transaction cannot commit against a reference that appeared
			// after the proof.
			const [tombstone, removal] = await database.batch([
				database.prepare(`
					INSERT OR IGNORE INTO graphic_asset_tombstones (
						asset_id, purged_at, purge_reason, revision_count,
						reference_count, created_at
					)
					SELECT asset.id, ?, ?, (
						SELECT COUNT(*) FROM graphic_asset_revisions revision
						WHERE revision.asset_id = asset.id
					), 0, ?
					FROM graphic_assets asset
					WHERE asset.id = ? AND asset.lifecycle_state = 'trashed'
						${recoveryWindowPredicate}
						AND NOT EXISTS (
							SELECT 1 FROM graphic_asset_references reference
							WHERE reference.asset_id = asset.id
						)
				`).bind(
					purgedAt,
					input.reason,
					purgedAt,
					input.assetId,
					...recoveryWindowBindings,
				),
				database.prepare(`
					DELETE FROM graphic_assets
					WHERE id = ? AND lifecycle_state = 'trashed'
						AND NOT EXISTS (
							SELECT 1 FROM graphic_asset_references reference
							WHERE reference.asset_id = graphic_assets.id
						)
						AND EXISTS (
							SELECT 1 FROM graphic_asset_tombstones tombstone
							WHERE tombstone.asset_id = graphic_assets.id
								AND tombstone.purged_at = ?
						)
				`).bind(input.assetId, purgedAt),
			]);
			if (!tombstone?.success || !removal?.success)
				throw new Error('Graphic Asset purge transaction failed');
			// Purge cascades revisions, derivatives, retention, and associations, so
			// a provider's change count is ambiguous. The absence of the asset is
			// the authoritative outcome.
			const survivor = await database.prepare(
				'SELECT 1 FROM graphic_assets WHERE id = ?',
			).bind(input.assetId).first();
			// The recovery deadline this purge proof observed. Reporting it lets the
			// Evidence say which deadline authorised the purge, rather than leaving
			// a reader to assume it from the reason.
			const recoverableUntil = current.trash_recoverable_until === null
				? undefined
				: new Date(current.trash_recoverable_until).toISOString();
			if (survivor) {
				return {
					outcome: 'blocked',
					revisionCount: current.revision_count,
					referenceCount: current.reference_count,
					recoverableUntil,
				};
			}
			return {
				outcome: 'purged',
				revisionCount: current.revision_count,
				referenceCount: 0,
				recoverableUntil,
			};
		},
		async reconcileContentQuarantine(input) {
			const quarantinedAt = new Date(input.quarantinedAt).getTime();
			const deleteAfter = new Date(input.deleteAfter).getTime();
			const [candidates, reachable] = await Promise.all([
				database.prepare(`
					SELECT contents.digest, contents.byte_length,
						'orphaned-content' AS origin
					FROM graphic_asset_contents contents
					WHERE ${unreachableDigest('contents.digest')}
						AND NOT EXISTS (
							SELECT 1 FROM graphics_content_quarantine quarantine
							WHERE quarantine.digest = contents.digest
						)
					UNION ALL
					SELECT candidates.digest, MAX(candidates.byte_length) AS byte_length,
						'abandoned-canonical-write' AS origin
					FROM graphics_canonical_write_candidates candidates
					JOIN graphics_ingestion_operations operations
						ON operations.id = candidates.operation_id
					WHERE (
							operations.stage = 'cancelled'
							OR (
								operations.stage = 'failed'
								AND json_extract(operations.failure, '$.retryable') = 0
							)
						)
						AND ${unreachableDigest('candidates.digest')}
						AND NOT EXISTS (
							SELECT 1 FROM graphic_asset_contents contents
							WHERE contents.digest = candidates.digest
						)
						AND NOT EXISTS (
							SELECT 1 FROM graphics_content_quarantine quarantine
							WHERE quarantine.digest = candidates.digest
						)
						AND NOT ${claimedByPendingOperation('candidates.digest')}
					GROUP BY candidates.digest
					LIMIT ?
				`).bind(input.limit).all<{
					digest: string;
					byte_length: number;
					origin: QuarantinedContent['origin'];
				}>(),
				database.prepare(`
					SELECT quarantine.id, quarantine.byte_length
					FROM graphics_content_quarantine quarantine
					WHERE NOT (${unreachableDigest('quarantine.digest')})
					ORDER BY quarantine.id
					LIMIT ?
				`).bind(input.limit).all<{ id: string; byte_length: number }>(),
			]);
			if (!candidates.success || !reachable.success)
				throw new Error('Unreachable Graphic Asset Content could not be reconciled');

			const quarantined = candidates.results.map((row): QuarantinedContent => ({
				id: input.generateIdentity(),
				digest: row.digest,
				byteLength: row.byte_length,
				origin: row.origin,
				quarantinedAt: input.quarantinedAt,
				deleteAfter: input.deleteAfter,
			}));
			const statements = [
				...quarantined.map(content => database.prepare(`
					INSERT OR IGNORE INTO graphics_content_quarantine (
						id, digest, byte_length, origin, quarantined_at, delete_after, created_at
					) VALUES (?, ?, ?, ?, ?, ?, ?)
				`).bind(
					content.id,
					content.digest,
					content.byteLength,
					content.origin,
					quarantinedAt,
					deleteAfter,
					quarantinedAt,
				)),
				...(reachable.results.length > 0
					? [database.prepare(`
							DELETE FROM graphics_content_quarantine
							WHERE id IN ${valuesFromJsonArray()}
						`).bind(boundJsonArray(reachable.results.map(row => row.id)))]
					: []),
			];
			if (statements.length > 0) {
				const results = await database.batch(
					statements as [D1PreparedStatement, ...D1PreparedStatement[]],
				);
				if (results.some(result => !result.success))
					throw new Error('Graphic Asset Content quarantine could not be recorded');
			}
			return {
				quarantined,
				released: reachable.results.map(row => ({
					id: row.id,
					byteLength: row.byte_length,
				})),
			};
		},
		async listDeletableQuarantinedContent(input) {
			const result = await database.prepare(`
				SELECT id, digest, byte_length, origin, quarantined_at, delete_after
				FROM graphics_content_quarantine
				WHERE delete_after <= ?
				ORDER BY delete_after, id
				LIMIT ?
			`).bind(new Date(input.deletableBefore).getTime(), input.limit).all<{
				id: string;
				digest: string;
				byte_length: number;
				origin: QuarantinedContent['origin'];
				quarantined_at: number;
				delete_after: number;
			}>();
			if (!result.success)
				throw new Error('Deletable quarantined Graphic Asset Content could not be read');
			return result.results.map((row): QuarantinedContent => ({
				id: row.id,
				digest: row.digest,
				byteLength: row.byte_length,
				origin: row.origin,
				quarantinedAt: new Date(row.quarantined_at).toISOString(),
				deleteAfter: new Date(row.delete_after).toISOString(),
			}));
		},
		async claimQuarantinedContentDeletion(input) {
			// The claim marks the row; it does not remove it. The durable record must
			// outlive the byte deletion it authorises, otherwise an unavailable byte
			// store would strand an object no later sweep could find. A claim older
			// than its lease is reclaimable.
			const result = await database.prepare(`
				UPDATE graphics_content_quarantine
				SET deleting_since = ?
				WHERE id = ? AND delete_after <= ?
					AND (deleting_since IS NULL OR deleting_since <= ?)
					AND ${unreachableDigest('digest')}
					AND NOT ${claimedByPendingOperation('graphics_content_quarantine.digest')}
			`).bind(
				new Date(input.claimedAt).getTime(),
				input.id,
				new Date(input.deletableBefore).getTime(),
				new Date(input.staleClaimsBefore).getTime(),
			).run();
			if (!result.success)
				throw new Error('Quarantined Graphic Asset Content could not be claimed for deletion');
			return result.meta.changes === 1;
		},
		async releaseQuarantinedContentClaim(input) {
			const result = await database.prepare(`
				UPDATE graphics_content_quarantine SET deleting_since = NULL WHERE id = ?
			`).bind(input.id).run();
			if (!result.success)
				throw new Error('Quarantined Graphic Asset Content claim could not be released');
		},
		async completeQuarantinedContentDeletion(input) {
			// Only once the bytes are gone does the catalogue trace go too. Each
			// statement re-proves unreachability, so a digest that became reachable
			// during deletion keeps its catalogue state.
			//
			// The claim instant is part of the predicate, so a sweep can only
			// complete the claim it made itself. A sweep resuming past its lease
			// finds the row reclaimed and reports that it deleted nothing, rather
			// than counting another sweep's work as its own.
			const results = await database.batch([
				database.prepare(`
					DELETE FROM graphics_content_quarantine
					WHERE id = ? AND deleting_since = ?
						AND ${unreachableDigest('digest')}
				`).bind(input.id, new Date(input.claimedAt).getTime()),
				database.prepare(`
					DELETE FROM graphic_asset_contents
					WHERE digest = ?
						AND ${unreachableDigest('digest')}
						AND NOT EXISTS (
							SELECT 1 FROM graphics_content_quarantine quarantine
							WHERE quarantine.digest = graphic_asset_contents.digest
						)
				`).bind(input.digest),
				database.prepare(`
					DELETE FROM graphics_canonical_write_candidates
					WHERE digest = ?
						AND NOT EXISTS (
							SELECT 1 FROM graphics_content_quarantine quarantine
							WHERE quarantine.digest = graphics_canonical_write_candidates.digest
						)
						AND NOT EXISTS (
							SELECT 1 FROM graphic_asset_contents contents
							WHERE contents.digest = graphics_canonical_write_candidates.digest
						)
				`).bind(input.digest),
			]);
			if (results.some(result => !result.success))
				throw new Error('Quarantined Graphic Asset Content deletion could not be completed');
			return results[0]?.meta.changes === 1;
		},
		async countContentReachability(input) {
			const row = await database.prepare(`
				SELECT (
						SELECT COUNT(*) FROM graphic_asset_revisions revision
						WHERE revision.content_digest = ?
					) + (
						SELECT COUNT(*) FROM graphics_derivatives derivative
						WHERE derivative.content_digest = ?
					) AS reachability
			`).bind(input.digest, input.digest).first<{ reachability: number }>();
			return row?.reachability ?? 0;
		},
		async markContentUnavailable(input) {
			// Reachability implies a catalogue content row, so an update is enough:
			// the identity and its references stay intact and become an explicit,
			// repairable Unavailable Graphic Asset Content incident.
			//
			// The first observation is kept, so a repeating reconciliation sweep
			// reports how long an incident has been open rather than resetting its
			// age on every pass.
			const result = await database.prepare(`
				UPDATE graphic_asset_contents
				SET availability = 'unavailable',
					unavailable_reason_code = ?,
					unavailable_since = COALESCE(unavailable_since, ?)
				WHERE digest = ?
			`).bind(
				input.reasonCode,
				new Date(input.since).getTime(),
				input.digest,
			).run();
			if (!result.success)
				throw new Error('Unavailable Graphic Asset Content could not be recorded');
		},
		async listRevisionRetention(input) {
			const result = await database.prepare(`
				SELECT revision.id, revision.asset_id, revision.revision_number,
					(
						SELECT COUNT(*) FROM graphic_asset_references reference
						WHERE reference.revision_id = revision.id
					) AS reference_count,
					CASE WHEN revision.revision_number = (
						SELECT MAX(latest.revision_number)
						FROM graphic_asset_revisions latest
						WHERE latest.asset_id = revision.asset_id
					) THEN 1 ELSE 0 END AS is_latest,
					retention.unreferenced_since, retention.prune_after,
					retention.frozen_at, retention.frozen_remaining_milliseconds
				FROM graphic_asset_revisions revision
				LEFT JOIN graphic_asset_revision_retention retention
					ON retention.revision_id = revision.id
				${input.assetId === undefined
					? `WHERE retention.revision_id IS NOT NULL${
						input.prunableOnly
							? ' AND retention.prune_after IS NOT NULL AND retention.frozen_at IS NULL'
							: ''}`
					: 'WHERE revision.asset_id = ?'}
				${input.assetId === undefined
					// Installation-wide, the question is which revision is pruned
					// soonest. Per asset it is which revision came first, because
					// that read describes one asset's history rather than a queue.
					? 'ORDER BY retention.prune_after, revision.id'
					: 'ORDER BY revision.asset_id, revision.revision_number'}
				LIMIT ?
			`).bind(
				...(input.assetId === undefined ? [] : [input.assetId]),
				input.limit,
			).all<RevisionRetentionRow>();
			if (!result.success)
				throw new Error('Graphic Asset Revision retention could not be read');
			return result.results.map(revisionRetentionFromRow);
		},
		async findRevisionRetention(revisionId) {
			const row = await database.prepare(`
				SELECT revision.id, revision.asset_id, revision.revision_number,
					(
						SELECT COUNT(*) FROM graphic_asset_references reference
						WHERE reference.revision_id = revision.id
					) AS reference_count,
					CASE WHEN revision.revision_number = (
						SELECT MAX(latest.revision_number)
						FROM graphic_asset_revisions latest
						WHERE latest.asset_id = revision.asset_id
					) THEN 1 ELSE 0 END AS is_latest,
					retention.unreferenced_since, retention.prune_after,
					retention.frozen_at, retention.frozen_remaining_milliseconds
				FROM graphic_asset_revisions revision
				LEFT JOIN graphic_asset_revision_retention retention
					ON retention.revision_id = revision.id
				WHERE revision.id = ?
			`).bind(revisionId).first<RevisionRetentionRow>();
			return row ? revisionRetentionFromRow(row) : undefined;
		},
		async findGraphicAssetName(assetId) {
			const row = await database.prepare(
				'SELECT name FROM graphic_assets WHERE id = ?',
			).bind(assetId).first<{ name: string }>();
			return row?.name;
		},
		async listRetiredGraphicAssets(input) {
			const result = await database.prepare(`
				SELECT asset.id, asset.name,
					(
						SELECT COUNT(*) FROM graphic_asset_references reference
						WHERE reference.asset_id = asset.id
					) AS reference_count
				FROM graphic_assets asset
				WHERE asset.lifecycle_state = 'retired'
				ORDER BY asset.updated_at, asset.id
				LIMIT ?
			`).bind(input.limit).all<{
				id: string;
				name: string;
				reference_count: number;
			}>();
			if (!result.success)
				throw new Error('Retired Graphic Assets could not be read');
			return result.results.map((row): RetiredGraphicAsset => ({
				assetId: row.id as GraphicAssetId,
				name: row.name,
				referenceCount: row.reference_count,
			}));
		},
		async listTrashDeadlines(input) {
			const result = await database.prepare(`
				SELECT asset.id, asset.name, asset.trashed_at, asset.trash_recoverable_until,
					(
						SELECT COUNT(*) FROM graphic_asset_references reference
						WHERE reference.asset_id = asset.id
					) AS reference_count,
					(
						SELECT COUNT(*) FROM graphic_asset_revisions revision
						WHERE revision.asset_id = asset.id
					) AS revision_count
				FROM graphic_assets asset
				WHERE asset.lifecycle_state = 'trashed'
				ORDER BY asset.trash_recoverable_until, asset.id
				LIMIT ?
			`).bind(input.limit).all<{
				id: string;
				name: string;
				trashed_at: number;
				trash_recoverable_until: number;
				reference_count: number;
				revision_count: number;
			}>();
			if (!result.success)
				throw new Error('Trashed Graphic Asset deadlines could not be read');
			return result.results.map((row): GraphicsTrashDeadline => ({
				assetId: row.id as GraphicAssetId,
				name: row.name,
				trashedAt: new Date(row.trashed_at).toISOString(),
				recoverableUntil: new Date(row.trash_recoverable_until).toISOString(),
				referenceCount: row.reference_count,
				revisionCount: row.revision_count,
			}));
		},
		async listStagedInputDeadlines(input) {
			const result = await database.prepare(`
				SELECT id, initiated_by, stage, updated_at,
					staging_used_byte_length + staging_reserved_byte_length AS staging_bytes,
					${TRANSFER_COMPLETE_SQL} AS transfer_complete
				FROM graphics_ingestion_operations
				WHERE ${RETAINS_STAGED_INPUT_SQL}
				ORDER BY updated_at, id
				LIMIT ?
			`).bind(input.limit).all<{
				id: string;
				initiated_by: string;
				stage: GraphicsIngestionStage;
				updated_at: number;
				staging_bytes: number;
				transfer_complete: number;
			}>();
			if (!result.success)
				throw new Error('Staged Graphic Asset input deadlines could not be read');
			return result.results.map((row): GraphicsStagedInputDeadline => ({
				operationId: row.id as GraphicsIngestionOperationId,
				initiatedBy: row.initiated_by,
				stage: row.stage,
				transferComplete: row.transfer_complete === 1,
				stagingBytes: row.staging_bytes,
				expiresAt: new Date(row.updated_at + (
					row.transfer_complete === 1
						? GRAPHICS_RETENTION_GUARANTEES.completedInputMilliseconds
						: GRAPHICS_RETENTION_GUARANTEES.incompleteTransferMilliseconds
				)).toISOString(),
			}));
		},
		async listQuarantineDeadlines(input) {
			const result = await database.prepare(`
				SELECT id, byte_length, origin, quarantined_at, delete_after
				FROM graphics_content_quarantine
				ORDER BY delete_after, id
				LIMIT ?
			`).bind(input.limit).all<{
				id: string;
				byte_length: number;
				origin: QuarantinedContent['origin'];
				quarantined_at: number;
				delete_after: number;
			}>();
			if (!result.success)
				throw new Error('Quarantined Graphic Asset Content deadlines could not be read');
			return result.results.map((row): GraphicsContentQuarantineDeadline => ({
				id: row.id,
				byteLength: row.byte_length,
				origin: row.origin,
				quarantinedAt: new Date(row.quarantined_at).toISOString(),
				deleteAfter: new Date(row.delete_after).toISOString(),
			}));
		},
		async findGraphicAssetLifecycle(assetId) {
			const row = await database.prepare(`
				SELECT lifecycle_state, trash_prior_state, trashed_at, trash_recoverable_until
				FROM graphic_assets
				WHERE id = ?
			`).bind(assetId).first<{
				lifecycle_state: 'active' | 'retired' | 'trashed';
				trash_prior_state: 'active' | 'retired' | null;
				trashed_at: number | null;
				trash_recoverable_until: number | null;
			}>();
			if (!row)
				return undefined;
			if (row.lifecycle_state !== 'trashed')
				return { state: row.lifecycle_state };
			if (
				!row.trash_prior_state
				|| row.trashed_at === null
				|| row.trash_recoverable_until === null
			) {
				throw new Error('Trashed Graphic Asset is missing recovery facts');
			}
			return {
				state: 'trashed',
				priorState: row.trash_prior_state,
				trashedAt: new Date(row.trashed_at).toISOString(),
				recoverableUntil: new Date(row.trash_recoverable_until).toISOString(),
			};
		},
		async recordGraphicsAssetEvidence(entries) {
			if (entries.length === 0)
				return;
			const statements = entries.map(entry => database.prepare(`
				INSERT OR IGNORE INTO graphics_asset_evidence (
					id, recorded_at, category, actor, subject_kind, subject_id,
					outcome, reason, correlation_id, detail, expires_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).bind(
				entry.id,
				new Date(entry.recordedAt).getTime(),
				entry.category,
				entry.actor,
				entry.subject.kind,
				entry.subject.id,
				entry.outcome,
				entry.reason,
				entry.correlationId,
				JSON.stringify(entry.detail),
				entry.expiresAt === null ? null : new Date(entry.expiresAt).getTime(),
			)) as [D1PreparedStatement, ...D1PreparedStatement[]];
			const results = await database.batch(statements);
			if (results.some(result => !result.success))
				throw new Error('Graphics Asset Evidence could not be recorded');
		},
		async listGraphicsAssetEvidence(input) {
			const categories = input.categories ?? [];
			// The category list stays one bound JSON array, so every other filter
			// below can take ordinary parameters without any list length being
			// able to push the statement past D1's bound-parameter ceiling. With
			// the list as one value the whole statement binds at most ten.
			const conditions: string[] = [];
			const bindings: (string | number)[] = [];
			function bind(...values: (string | number)[]) {
				const first = bindings.length + 1;
				bindings.push(...values);
				return values.map((_, offset) => `?${first + offset}`);
			}
			if (categories.length > 0)
				conditions.push(`category IN ${valuesFromJsonArray(bind(boundJsonArray(categories))[0]!)}`);
			if (input.subject) {
				const [kind, id] = bind(input.subject.kind, input.subject.id);
				conditions.push(`subject_kind = ${kind} AND subject_id = ${id}`);
			}
			if (input.actor !== undefined)
				conditions.push(`actor = ${bind(input.actor)[0]}`);
			if (input.correlationId !== undefined)
				conditions.push(`correlation_id = ${bind(input.correlationId)[0]}`);
			if (input.recordedFrom !== undefined)
				conditions.push(`recorded_at >= ${bind(new Date(input.recordedFrom).getTime())[0]}`);
			if (input.recordedUntil !== undefined)
				conditions.push(`recorded_at <= ${bind(new Date(input.recordedUntil).getTime())[0]}`);
			// Reading newer than a cursor walks the ledger the other way, so the
			// comparison, the ordering, and the tiebreak all have to flip together.
			// Ordering by anything the cursor does not also compare would let a
			// page skip an entry written in the same millisecond as the boundary.
			const older = input.direction !== 'newer';
			if (input.cursor) {
				const [at, id] = bind(
					new Date(input.cursor.recordedAt).getTime(),
					input.cursor.id,
				);
				conditions.push(older
					? `(recorded_at < ${at} OR (recorded_at = ${at} AND id < ${id}))`
					: `(recorded_at > ${at} OR (recorded_at = ${at} AND id > ${id}))`);
			}
			const result = await database.prepare(`
				SELECT id, recorded_at, category, actor, subject_kind, subject_id,
					outcome, reason, correlation_id, detail, expires_at
				FROM graphics_asset_evidence
				${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
				ORDER BY recorded_at ${older ? 'DESC' : 'ASC'}, id ${older ? 'DESC' : 'ASC'}
				LIMIT ${bind(input.limit)[0]}
			`).bind(...bindings).all<EvidenceRow>();
			if (!result.success)
				throw new Error('Graphics Asset Evidence could not be read');
			return result.results.map(evidenceFromRow);
		},
		async sealGraphicsAssetEvidence(input) {
			// Sealing is driven from inside the ledger: the entry that records a
			// terminal cleanup is what proves the subject will never be heard from
			// again, so no other table has to be consulted to know when a subject's
			// window may start. The batch is bounded by subject, and a subject that
			// records further Evidence after being sealed is simply sealed again on
			// the next sweep against the same anchor.
			const terminal = await database.prepare(`
				SELECT terminal.subject_kind, terminal.subject_id,
					MAX(terminal.recorded_at) AS terminal_at
				FROM graphics_asset_evidence terminal
				WHERE terminal.category IN ${valuesFromJsonArray('?1')}
					AND EXISTS (
						SELECT 1 FROM graphics_asset_evidence unsealed
						WHERE unsealed.subject_kind = terminal.subject_kind
							AND unsealed.subject_id = terminal.subject_id
							AND unsealed.expires_at IS NULL
					)
				GROUP BY terminal.subject_kind, terminal.subject_id
				ORDER BY terminal_at
				LIMIT ?2
			`).bind(
				boundJsonArray(input.terminalCategories),
				input.limit,
			).all<{ subject_kind: string; subject_id: string; terminal_at: number }>();
			if (!terminal.success)
				throw new Error('Terminal Graphics Asset Evidence could not be read');
			if (terminal.results.length === 0)
				return 0;
			// The anchor is the subject's terminal cleanup, but an entry may be
			// written after it — a tombstone explains provenance observations for
			// as long as the identity is asked about, and one recorded more than a
			// year later would otherwise be sealed already expired and deleted by
			// the very same sweep, so it could never be read at all. The floor
			// gives every entry its own full window from when it was recorded, and
			// leaves the ordinary case, where entries precede the cleanup they
			// explain, anchored exactly on that cleanup.
			const statements = terminal.results.map(subject => database.prepare(`
				UPDATE graphics_asset_evidence
				SET expires_at = MAX(?1, recorded_at + ?2)
				WHERE subject_kind = ?3 AND subject_id = ?4 AND expires_at IS NULL
			`).bind(
				subject.terminal_at + input.retentionMilliseconds,
				input.retentionMilliseconds,
				subject.subject_kind,
				subject.subject_id,
			)) as [D1PreparedStatement, ...D1PreparedStatement[]];
			const results = await database.batch(statements);
			if (results.some(result => !result.success))
				throw new Error('Graphics Asset Evidence could not be sealed');
			return terminal.results.length;
		},
		async findGraphicAssetTombstone(assetId) {
			const row = await database.prepare(`
				SELECT purged_at, purge_reason, revision_count, reference_count
				FROM graphic_asset_tombstones WHERE asset_id = ?
			`).bind(assetId).first<{
				purged_at: number;
				purge_reason: GraphicAssetPurgeReason;
				revision_count: number;
				reference_count: number;
			}>();
			return row
				? {
						assetId,
						purgedAt: new Date(row.purged_at).toISOString(),
						reason: row.purge_reason,
						revisionCount: row.revision_count,
						referenceCount: row.reference_count,
					}
				: undefined;
		},
		async expireGraphicsAssetEvidence(input) {
			// Unsealed Evidence has no expiry to have passed. Comparing a null
			// against the cutoff is already false in SQL, but saying so keeps the
			// one statement that destroys Evidence explicit about what it spares.
			const result = await database.prepare(`
				DELETE FROM graphics_asset_evidence
				WHERE expires_at IS NOT NULL AND expires_at <= ?
			`).bind(new Date(input.expiredBefore).getTime()).run();
			if (!result.success)
				throw new Error('Expired Graphics Asset Evidence could not be removed');
			return result.meta.changes;
		},
	};
}

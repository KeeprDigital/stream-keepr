import type {
	GraphicsIngestionAttentionItem,
	GraphicsIngestionOperationId,
	GraphicsIngestionSource,
	GraphicsIngestionStage,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsIngestionAttentionState } from '~~/shared/utils/graphicsOperationsCockpit';
import type { GraphicsOperationalQueuesCatalogue } from './operational-queues';
import type {
	GraphicsDeadlineGroupSummary,
	GraphicsIngestionAttentionRead,
	GraphicsOperationsCockpitCatalogue,
	GraphicsRetentionDeadlineSummary,
} from './operations-cockpit';
import { GRAPHICS_RETENTION_GUARANTEES } from '~~/shared/utils/graphicsAssetRetention';
import {
	GRAPHICS_INGESTION_ACTIVE_STAGES,
	GRAPHICS_INGESTION_AWAITING_CONFIRMATION_STAGES,
} from '~~/shared/utils/graphicsOperationsCockpit';

function quoted(values: readonly string[]) {
	return values.map(value => `'${value}'`).join(', ');
}

/**
 * Whether an operation's transfer had completed, which decides between the
 * 24-hour incomplete-transfer guarantee and the seven-day completed-input one.
 * Stage alone cannot answer it, for the same reason the retention queries state:
 * `failed` is reachable both mid-transfer and long after the input was staged.
 */
const TRANSFER_COMPLETE_SQL
	= 'CASE WHEN transfer_completed_at IS NOT NULL THEN 1 ELSE 0 END';

/** When this operation's staged input reaches its retention guarantee. */
const INPUT_EXPIRES_AT_SQL = `(updated_at + CASE
	WHEN transfer_completed_at IS NOT NULL
		THEN ${GRAPHICS_RETENTION_GUARANTEES.completedInputMilliseconds}
	ELSE ${GRAPHICS_RETENTION_GUARANTEES.incompleteTransferMilliseconds}
END)`;

/** A retryable failure is resumable; a permanent one leaves nothing to do. */
const RETRYABLE_FAILURE_SQL
	= `stage = 'failed' AND json_extract(failure, '$.retryable') = 1`;

/**
 * What an operation needs from an administrator right now.
 *
 * Expiry is decided first, because an operation whose staged input has passed
 * its guarantee needs a new operation whatever stage it was paused in. Every
 * other unfinished operation is classified by the stage it is actually in, and
 * a terminal one is classified as nothing at all so it never appears.
 */
const ATTENTION_SQL = `CASE
	WHEN ${INPUT_EXPIRES_AT_SQL} <= ?1 THEN 'input-expired'
	WHEN ${RETRYABLE_FAILURE_SQL} THEN 'retryable'
	WHEN stage IN (${quoted(GRAPHICS_INGESTION_AWAITING_CONFIRMATION_STAGES)})
		THEN 'awaiting-confirmation'
	WHEN stage IN (${quoted(GRAPHICS_INGESTION_ACTIVE_STAGES)}) THEN 'active'
	ELSE NULL
END`;

/**
 * Only operations that are not finished are considered at all. A completed,
 * cancelled, or permanently failed operation has no attention state and is
 * excluded before the classification above ever runs.
 */
const UNFINISHED_SQL = `(
	stage IN (${quoted([
		...GRAPHICS_INGESTION_ACTIVE_STAGES,
		...GRAPHICS_INGESTION_AWAITING_CONFIRMATION_STAGES,
	])})
	OR (${RETRYABLE_FAILURE_SQL})
)`;

/**
 * Risk order: an expired input has already lost its guarantee, a retryable
 * failure is waiting on someone, a confirmation is waiting on its author, and
 * active work is waiting on nobody. Oldest first inside each band.
 */
const ATTENTION_RISK_ORDER_SQL = `CASE attention
	WHEN 'input-expired' THEN 0
	WHEN 'retryable' THEN 1
	WHEN 'awaiting-confirmation' THEN 2
	ELSE 3
END, updated_at, id`;

interface AttentionRow {
	id: string;
	attention: GraphicsIngestionAttentionState;
	stage: GraphicsIngestionStage;
	source: GraphicsIngestionSource;
	initiated_by: string;
	proposed_name: string;
	transferred_byte_length: number;
	/**
	 * Always present. Every initiation path binds it, including an approved
	 * remote copy, which starts at the worst-case bound for its Graphic Asset
	 * kind precisely because the exact length is not knowable until the copy
	 * runs. Treating it as absent here would invent an unknown-length operation
	 * the domain never produces.
	 */
	declared_byte_length: number;
	transfer_complete: number;
	staging_bytes: number;
	input_expires_at: number;
	failure_code: string | null;
	updated_at: number;
}

const ATTENTION_COLUMNS = `id, ${ATTENTION_SQL} AS attention, stage, source, initiated_by,
	proposed_name, transferred_byte_length, declared_byte_length,
	${TRANSFER_COMPLETE_SQL} AS transfer_complete,
	staging_used_byte_length + staging_reserved_byte_length AS staging_bytes,
	${INPUT_EXPIRES_AT_SQL} AS input_expires_at,
	json_extract(failure, '$.code') AS failure_code,
	updated_at`;

function attentionItem(row: AttentionRow): GraphicsIngestionAttentionItem {
	return {
		operationId: row.id as GraphicsIngestionOperationId,
		attention: row.attention,
		stage: row.stage,
		source: row.source,
		initiatedBy: row.initiated_by,
		name: row.proposed_name,
		transferredByteLength: row.transferred_byte_length,
		declaredByteLength: row.declared_byte_length,
		transferComplete: row.transfer_complete === 1,
		stagingBytes: row.staging_bytes,
		inputExpiresAt: new Date(row.input_expires_at).toISOString(),
		...(row.failure_code === null
			? {}
			: {
					failureCode: row.failure_code as NonNullable<
						GraphicsIngestionAttentionItem['failureCode']
					>,
				}),
		updatedAt: new Date(row.updated_at).toISOString(),
	};
}

function deadlineGroup(row: {
	group_count: number;
	next_deadline: number | null;
}): GraphicsDeadlineGroupSummary {
	return {
		count: row.group_count,
		...(row.next_deadline === null
			? {}
			: { nextDeadline: new Date(row.next_deadline).toISOString() }),
	};
}

async function countOf(database: D1Database, sql: string, label: string) {
	const row = await database.prepare(sql).first<{ total: number }>();
	if (!row)
		throw new Error(label);
	return row.total;
}

/**
 * The Operations Cockpit's catalogue reads.
 *
 * Every one is an aggregate or a bounded, ordered sample. Nothing here expands
 * rows to count them, so one cockpit reading costs the same against a library
 * holding a handful of assets and one holding a large backlog.
 */
export function createD1GraphicsOperationsCockpitCatalogue(
	database: D1Database,
): Pick<
	GraphicsOperationsCockpitCatalogue,
	| 'countUnavailableContent'
	| 'countIsolatedDiscrepancies'
	| 'summariseIngestionAttention'
	| 'summariseRetentionDeadlines'
> & Pick<
	GraphicsOperationalQueuesCatalogue,
	'summariseIngestionQueues' | 'findIngestionAttentionItem'
> {
	return {
		async countUnavailableContent() {
			return await countOf(
				database,
				`SELECT COUNT(*) AS total FROM graphic_asset_contents
					WHERE availability = 'unavailable'`,
				'Unavailable Graphic Asset Content could not be counted',
			);
		},
		async countIsolatedDiscrepancies() {
			return await countOf(
				database,
				`SELECT COUNT(*) AS total FROM graphics_discrepancies
					WHERE state = 'open' AND isolated = 1`,
				'Isolated Graphics Discrepancies could not be counted',
			);
		},
		async summariseIngestionAttention(input): Promise<GraphicsIngestionAttentionRead> {
			const checkedAt = new Date(input.now).getTime();
			const [counted, listed] = await database.batch<
				{ attention: GraphicsIngestionAttentionState; total: number } | AttentionRow
			>([
				database.prepare(`
					SELECT ${ATTENTION_SQL} AS attention, COUNT(*) AS total
					FROM graphics_ingestion_operations
					WHERE ${UNFINISHED_SQL}
					GROUP BY attention
				`).bind(checkedAt),
				database.prepare(`
					SELECT id, ${ATTENTION_SQL} AS attention, stage, source, initiated_by,
						proposed_name, transferred_byte_length, declared_byte_length,
						${TRANSFER_COMPLETE_SQL} AS transfer_complete,
						staging_used_byte_length + staging_reserved_byte_length AS staging_bytes,
						${INPUT_EXPIRES_AT_SQL} AS input_expires_at,
						json_extract(failure, '$.code') AS failure_code,
						updated_at
					FROM graphics_ingestion_operations
					WHERE ${UNFINISHED_SQL}
					ORDER BY ${ATTENTION_RISK_ORDER_SQL}
					LIMIT ?2
				`).bind(checkedAt, input.limit),
			]);
			if (!counted?.success || !listed?.success)
				throw new Error('Graphics Ingestion Operations awaiting attention could not be read');

			const counts = {} as Record<GraphicsIngestionAttentionState, number>;
			for (const row of counted.results as {
				attention: GraphicsIngestionAttentionState | null;
				total: number;
			}[]) {
				if (row.attention !== null)
					counts[row.attention] = row.total;
			}

			return {
				counts,
				operations: (listed.results as AttentionRow[]).map(attentionItem),
			};
		},
		/**
		 * Complete counts plus one independent sample per attention state.
		 *
		 * The cockpit's single risk-ordered sample is right for a cockpit, which
		 * shows the most urgent work of any kind. It is wrong for queues: one
		 * shared budget ordered expired-before-retryable means a backlog of
		 * expired input empties the retryable queue, and a queue whose only
		 * action is unreachable is the same as no queue at all. Each state
		 * therefore gets its own budget, and each is ordered by the deadline the
		 * queue states rather than by when the operation last moved.
		 */
		async summariseIngestionQueues(input) {
			const checkedAt = new Date(input.now).getTime();
			const [counted, retryable, expired] = await database.batch<
				{ attention: GraphicsIngestionAttentionState; total: number } | AttentionRow
			>([
				database.prepare(`
					SELECT ${ATTENTION_SQL} AS attention, COUNT(*) AS total
					FROM graphics_ingestion_operations
					WHERE ${UNFINISHED_SQL}
					GROUP BY attention
				`).bind(checkedAt),
				...(['retryable', 'input-expired'] as const).map(state =>
					database.prepare(`
						SELECT ${ATTENTION_COLUMNS}
						FROM graphics_ingestion_operations
						WHERE ${UNFINISHED_SQL} AND ${ATTENTION_SQL} = ?2
						ORDER BY input_expires_at, id
						LIMIT ?3
					`).bind(checkedAt, state, input.limit)),
			]);
			if (!counted?.success || !retryable?.success || !expired?.success)
				throw new Error('Graphics Ingestion Operation queues could not be read');

			const counts = {} as Record<GraphicsIngestionAttentionState, number>;
			for (const row of counted.results as {
				attention: GraphicsIngestionAttentionState | null;
				total: number;
			}[]) {
				if (row.attention !== null)
					counts[row.attention] = row.total;
			}
			return {
				counts,
				retryable: (retryable.results as AttentionRow[]).map(attentionItem),
				expired: (expired.results as AttentionRow[]).map(attentionItem),
			};
		},
		/**
		 * One unfinished operation by identity, for the inspector and for
		 * resolving the author an administrator's retry acts on behalf of.
		 * Scanning a triage sample for it would make both fail past the sample.
		 */
		async findIngestionAttentionItem(input) {
			const row = await database.prepare(`
				SELECT ${ATTENTION_COLUMNS}
				FROM graphics_ingestion_operations
				WHERE id = ?2 AND ${UNFINISHED_SQL}
			`).bind(new Date(input.now).getTime(), input.operationId).first<AttentionRow>();
			return row ? attentionItem(row) : undefined;
		},
		async summariseRetentionDeadlines(): Promise<GraphicsRetentionDeadlineSummary> {
			const [lifecycle, revisions, quarantine, stagedInput] = await database.batch([
				database.prepare(`
					SELECT
						SUM(CASE WHEN lifecycle_state = 'retired' THEN 1 ELSE 0 END) AS retired_count,
						SUM(CASE WHEN lifecycle_state = 'trashed' THEN 1 ELSE 0 END) AS group_count,
						MIN(CASE WHEN lifecycle_state = 'trashed'
							THEN trash_recoverable_until END) AS next_deadline
					FROM graphic_assets
				`),
				database.prepare(`
					SELECT
						SUM(CASE WHEN frozen_at IS NULL THEN 1 ELSE 0 END) AS group_count,
						MIN(CASE WHEN frozen_at IS NULL THEN prune_after END) AS next_deadline,
						SUM(CASE WHEN frozen_at IS NOT NULL THEN 1 ELSE 0 END) AS frozen_count
					FROM graphic_asset_revision_retention
				`),
				database.prepare(`
					SELECT COUNT(*) AS group_count, MIN(delete_after) AS next_deadline
					FROM graphics_content_quarantine
				`),
				database.prepare(`
					SELECT COUNT(*) AS group_count, MIN(${INPUT_EXPIRES_AT_SQL}) AS next_deadline
					FROM graphics_ingestion_operations
					WHERE ${UNFINISHED_SQL}
				`),
			]);
			if (!lifecycle?.success || !revisions?.success
				|| !quarantine?.success || !stagedInput?.success) {
				throw new Error('Graphics Asset lifecycle deadlines could not be read');
			}

			const lifecycleRow = (lifecycle.results as {
				retired_count: number | null;
				group_count: number | null;
				next_deadline: number | null;
			}[])[0];
			const revisionRow = (revisions.results as {
				group_count: number | null;
				next_deadline: number | null;
				frozen_count: number | null;
			}[])[0];

			return {
				retiredCount: lifecycleRow?.retired_count ?? 0,
				trashed: deadlineGroup({
					group_count: lifecycleRow?.group_count ?? 0,
					next_deadline: lifecycleRow?.next_deadline ?? null,
				}),
				supersededRevisions: deadlineGroup({
					group_count: revisionRow?.group_count ?? 0,
					next_deadline: revisionRow?.next_deadline ?? null,
				}),
				frozenRevisionCount: revisionRow?.frozen_count ?? 0,
				quarantinedContent: deadlineGroup(
					(quarantine.results as { group_count: number; next_deadline: number | null }[])[0]
					?? { group_count: 0, next_deadline: null },
				),
				stagedInput: deadlineGroup(
					(stagedInput.results as { group_count: number; next_deadline: number | null }[])[0]
					?? { group_count: 0, next_deadline: null },
				),
			};
		},
	};
}

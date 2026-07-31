/**
 * The operational queue contract.
 *
 * The Operations Cockpit answers whether the Graphics Asset Library is safe.
 * The queues answer what to do about it: they organise the same durable state
 * by the operational meaning of the work, order it by risk, and offer only the
 * actions that are valid for the state an item is actually in.
 *
 * Queues are named for what is wrong, never for the provider object underneath.
 * Nothing here carries a bucket, object key, content digest, capability secret,
 * raw URL, or database row; subjects are opaque domain identities.
 */
import type {
	GraphicAssetLifecycleActionOutcome,
	GraphicAssetPurgeOutcome,
	GraphicsDiscrepancyActionOutcome,
	GraphicsIngestionOperation,
	GraphicsRepairRejectionCode,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsStorageHealthAlertSeverity } from '~~/shared/utils/graphicsOperationsCockpit';

/**
 * Every operational state an administrator triages, one queue each, declared
 * most urgent first.
 *
 * These stay distinct rather than collapsing into one "needs attention" list
 * because the valid action differs in every one of them. Unavailable content
 * takes exact bytes; a missing derivative is regenerated from its source; a
 * quarantined object is only ever rechecked; a Trashed asset is restored or
 * purged; an expired operation cannot be resumed at all. A merged queue would
 * offer an action the library would refuse.
 *
 * A critical integrity incident is separate from unavailable content for the
 * same reason: it fails closed and is never repaired in place, so it must not
 * inherit unavailable content's repair action.
 */
export const GRAPHICS_OPERATIONAL_QUEUES = [
	/** Stored bytes contradict the digest that owns their key. Isolated, never repaired. */
	'critical-integrity-incident',
	/** The catalogue expects content whose bytes do not currently resolve. */
	'unavailable-content',
	/** A deterministic preview is missing and can be regenerated from its source. */
	'missing-derivative',
	/** A Graphics Ingestion Operation resumable from its retained verified input. */
	'retryable-ingestion',
	/** Staged input passed its retention guarantee; a new operation is required. */
	'expired-ingestion-input',
	/** A Trashed Graphic Asset inside its recovery window, awaiting restore or purge. */
	'trashed-asset',
	/** An unreferenced superseded Graphic Asset Revision awaiting pruning. */
	'superseded-revision',
	/** Bytes the catalogue never expected, held in Content Quarantine for recheck. */
	'quarantined-object',
	/** A Retired Graphic Asset: reversible, referenced-safe, and under no deadline. */
	'retired-asset',
] as const;

export type GraphicsOperationalQueueId = typeof GRAPHICS_OPERATIONAL_QUEUES[number];

/**
 * How urgently each queue needs an administrator.
 *
 * Only the incident that fails closed is critical. A queue whose deadline
 * destroys restorable state is a warning; a queue holding state safely under a
 * guarantee nobody is about to lose is informational.
 */
const QUEUE_SEVERITIES: Record<GraphicsOperationalQueueId, GraphicsStorageHealthAlertSeverity> = {
	'critical-integrity-incident': 'critical',
	'unavailable-content': 'warning',
	'missing-derivative': 'warning',
	'retryable-ingestion': 'warning',
	'expired-ingestion-input': 'warning',
	'trashed-asset': 'warning',
	'superseded-revision': 'info',
	'quarantined-object': 'info',
	'retired-asset': 'info',
};

export function graphicsQueueSeverity(
	queue: GraphicsOperationalQueueId,
): GraphicsStorageHealthAlertSeverity {
	return QUEUE_SEVERITIES[queue];
}

/** Ranks a severity for ordering, most urgent first. */
export const GRAPHICS_QUEUE_SEVERITY_RANK: Record<GraphicsStorageHealthAlertSeverity, number> = {
	critical: 0,
	warning: 1,
	info: 2,
};

/**
 * Every action a queue item can offer.
 *
 * The first four are the reconciliation actions from the discrepancy that
 * offers them, carried through unchanged rather than re-derived here: the
 * library decides which are valid, and it re-proves that decision before
 * writing anything. The rest are the lifecycle and operation actions.
 *
 * Adoption of an unexpected object is deliberately absent. Quarantined bytes
 * expose their evidence and their recheck deadline and are deleted only if
 * still unaccounted for; nothing anywhere turns them into catalogue state.
 */
export const GRAPHICS_QUEUE_ACTIONS = [
	'recheck',
	'verify-stored-bytes',
	'repair-with-exact-bytes',
	'regenerate-derivative',
	/** Resume a Graphics Ingestion Operation from its retained verified input. */
	'retry-ingestion',
	/** Return a Retired asset to discovery, or a Trashed one to its prior state. */
	'restore-graphic-asset',
	/** Explicitly confirmed early purge of unreferenced Trash. */
	'purge-now',
] as const;

export type GraphicsQueueAction = typeof GRAPHICS_QUEUE_ACTIONS[number];

/**
 * What every queue action reports, without exception.
 *
 * Each action is idempotent, so running one twice reports `already-in-state`
 * rather than inventing a second success or a bare error. The remaining
 * outcomes name the only reasons the library refuses: a pinned Graphic Asset
 * Reference, bytes that are temporarily out of reach, or a disagreement that
 * fails closed.
 */
export const GRAPHICS_QUEUE_ACTION_OUTCOMES = [
	/** The action changed durable state and the subject left this queue. */
	'completed',
	/** The subject was already in the state the action asks for. */
	'already-in-state',
	/** A fresh reference proof found pinned usage, so nothing was reclaimed. */
	'reference-blocked',
	/** Bytes or a component could not answer. The same action is worth running again. */
	'retryable-unavailable',
	/** The library refused rather than write over a disagreement. Fails closed. */
	'integrity-conflict',
] as const;

export type GraphicsQueueActionOutcome = typeof GRAPHICS_QUEUE_ACTION_OUTCOMES[number];

/**
 * Which outcome each reconciliation rejection reports.
 *
 * `action-not-valid-in-state` reads as `already-in-state` because the queue
 * offers an action only while it is valid: by the time the library refuses one,
 * the subject has moved to a state where it no longer applies.
 */
const REJECTION_OUTCOMES: Record<GraphicsRepairRejectionCode, GraphicsQueueActionOutcome> = {
	'discrepancy-already-resolved': 'already-in-state',
	'action-not-valid-in-state': 'already-in-state',
	'digest-mismatch': 'integrity-conflict',
	'byte-length-mismatch': 'integrity-conflict',
	'canonical-mime-mismatch': 'integrity-conflict',
	'validation-facts-mismatch': 'integrity-conflict',
	'integrity-incident-isolated': 'integrity-conflict',
	'source-content-unavailable': 'retryable-unavailable',
	'stored-bytes-missing': 'retryable-unavailable',
	'derivative-regeneration-unavailable': 'retryable-unavailable',
	'byte-store-unavailable': 'retryable-unavailable',
};

export function graphicsDiscrepancyQueueOutcome(
	outcome: GraphicsDiscrepancyActionOutcome,
): GraphicsQueueActionOutcome {
	if (outcome.outcome === 'resolved')
		return 'completed';
	if (outcome.outcome === 'unchanged')
		return 'already-in-state';
	return REJECTION_OUTCOMES[outcome.code];
}

export function graphicsLifecycleQueueOutcome(
	outcome: GraphicAssetLifecycleActionOutcome,
): GraphicsQueueActionOutcome {
	return outcome.outcome === 'in-use' ? 'reference-blocked' : 'completed';
}

export function graphicsPurgeQueueOutcome(
	outcome: GraphicAssetPurgeOutcome,
): GraphicsQueueActionOutcome {
	return outcome.outcome === 'in-use' ? 'reference-blocked' : 'completed';
}

/**
 * What a retry did, read from the operation it returned.
 *
 * A terminal operation reports `already-in-state`: retrying a completed or
 * cancelled ingestion is the idempotent no-op the library defines it as. A
 * permanently failed one reports the same, because expired staged input cannot
 * be resumed and needs a new operation rather than another retry. Anything
 * still failing retryably is worth running again.
 */
export function graphicsIngestionRetryQueueOutcome(
	operation: GraphicsIngestionOperation,
): GraphicsQueueActionOutcome {
	if (operation.stage === 'completed' || operation.stage === 'cancelled')
		return 'already-in-state';
	if (operation.stage === 'failed')
		return operation.failure?.retryable ? 'retryable-unavailable' : 'already-in-state';
	return 'completed';
}

/**
 * What a refused request reports.
 *
 * The library answers a queue action with a status rather than a domain code,
 * so this is where a refusal becomes one of the five outcomes. A subject the
 * library will not act on because it has already moved — purged, restored, or
 * past the stage a retry resumes from — is `already-in-state`; anything the
 * library could not reach is retryable.
 */
export function graphicsQueueOutcomeFromStatus(status: number): GraphicsQueueActionOutcome {
	if (status === 404 || status === 409)
		return 'already-in-state';
	if (status >= 500)
		return 'retryable-unavailable';
	return 'integrity-conflict';
}

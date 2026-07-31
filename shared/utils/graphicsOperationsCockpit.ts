/**
 * The Operations Cockpit contract.
 *
 * The cockpit's first answer is whether the Graphics Asset Library is safe and
 * what needs attention. Everything here is a classification of durable domain
 * state the library already holds — component conditions, open discrepancies,
 * capacity pressure, ingestion stages, and Evidence — into the severities and
 * groups an administrator triages by. It invents no state of its own, so a
 * cockpit reading can always be reproduced from the catalogue.
 *
 * Nothing in this contract carries a provider key, bucket, object key, content
 * digest, raw URL, database row, or provider error message. Subjects are opaque
 * domain identities and reasons are stable domain codes.
 */
import type {
	GraphicsAssetEvidenceCategory,
	GraphicsDiscrepancyKind,
	GraphicsIngestionStage,
} from '~~/shared/types/graphicsAsset';

/**
 * How urgently an open alert needs an administrator.
 *
 * `critical` means the library cannot be trusted to serve or protect what it
 * holds until someone acts; `warning` means a guarantee is at risk or a
 * retryable incident is open; `info` means state is being held safely and is
 * only worth knowing about.
 */
export const GRAPHICS_STORAGE_HEALTH_ALERT_SEVERITIES = ['critical', 'warning', 'info'] as const;

/**
 * Every alert the cockpit can raise. Each one is derived from durable state, so
 * an alert an administrator has not resolved reappears on the next reading.
 */
export const GRAPHICS_STORAGE_HEALTH_ALERT_CODES = [
	/** The catalogue cannot answer, so the library cannot say what it expects to hold. */
	'catalogue-unavailable',
	/** The canonical byte store cannot answer, so no validated content resolves. */
	'canonical-byte-store-unavailable',
	/** The staging byte store cannot answer, so no new input can be received. */
	'staging-byte-store-unavailable',
	/** Stored bytes contradict the digest that owns their key. Fails closed. */
	'critical-integrity-incident-open',
	/** Referenced content exists in the catalogue but its bytes do not resolve. */
	'unavailable-content-open',
	/** A deterministic preview is missing and can be regenerated from its source. */
	'missing-derivative-open',
	/** Bytes the catalogue never expected are being held rather than deleted. */
	'unexpected-object-quarantined',
	/** Net-new canonical publication is blocked at 100% of the quota. */
	'canonical-quota-full',
	/** Canonical use has passed the 95% critical boundary. */
	'canonical-quota-critical',
	/** Canonical use has passed the 80% warning boundary. */
	'canonical-quota-warning',
	/** The Graphics Staging Allowance has no room for a further transfer. */
	'staging-allowance-exhausted',
	/** Staged input passed its retention guarantee; those operations need a new one. */
	'graphics-ingestion-input-expired',
] as const;

export type GraphicsStorageHealthAlertSeverity
	= typeof GRAPHICS_STORAGE_HEALTH_ALERT_SEVERITIES[number];
export type GraphicsStorageHealthAlertCode
	= typeof GRAPHICS_STORAGE_HEALTH_ALERT_CODES[number];

/**
 * Which alerts outlive the reading that reported them.
 *
 * A persistent alert is backed by a durable record that only an administrator
 * action or a byte-store recovery can clear, so navigating away or reloading
 * cannot dismiss it. A non-persistent alert is a live condition that clears
 * itself the moment the underlying reading changes.
 */
const PERSISTENT_ALERT_CODES = new Set<GraphicsStorageHealthAlertCode>([
	'critical-integrity-incident-open',
	'unavailable-content-open',
	'missing-derivative-open',
	'unexpected-object-quarantined',
	'graphics-ingestion-input-expired',
]);

export function graphicsStorageHealthAlertPersists(
	code: GraphicsStorageHealthAlertCode,
): boolean {
	return PERSISTENT_ALERT_CODES.has(code);
}

const ALERT_SEVERITIES: Record<GraphicsStorageHealthAlertCode, GraphicsStorageHealthAlertSeverity> = {
	'catalogue-unavailable': 'critical',
	'canonical-byte-store-unavailable': 'critical',
	'staging-byte-store-unavailable': 'warning',
	'critical-integrity-incident-open': 'critical',
	'unavailable-content-open': 'warning',
	'missing-derivative-open': 'warning',
	'unexpected-object-quarantined': 'info',
	'canonical-quota-full': 'critical',
	'canonical-quota-critical': 'critical',
	'canonical-quota-warning': 'warning',
	'staging-allowance-exhausted': 'warning',
	'graphics-ingestion-input-expired': 'warning',
};

export function graphicsStorageHealthAlertSeverity(
	code: GraphicsStorageHealthAlertCode,
): GraphicsStorageHealthAlertSeverity {
	return ALERT_SEVERITIES[code];
}

/**
 * How severely each kind of open disagreement counts against the backlog.
 *
 * A critical integrity incident is the only kind that fails closed, so it is
 * the only kind that is critical. Unexpected objects are being held safely in
 * Content Quarantine and are rechecked before any byte is deleted.
 */
const DISCREPANCY_SEVERITIES: Record<GraphicsDiscrepancyKind, GraphicsStorageHealthAlertSeverity> = {
	'critical-integrity-incident': 'critical',
	'unavailable-content': 'warning',
	'missing-derivative': 'warning',
	'unexpected-object': 'info',
};

export function graphicsDiscrepancySeverity(
	kind: GraphicsDiscrepancyKind,
): GraphicsStorageHealthAlertSeverity {
	return DISCREPANCY_SEVERITIES[kind];
}

/**
 * Whether a kind of open disagreement counts against the byte store's condition.
 *
 * An `info` disagreement does not. An unexpected object is bytes the catalogue
 * never asked for, held safely in Content Quarantine and rechecked before
 * anything is deleted: nothing the library is expected to serve is affected by
 * it. Letting one degrade the headline would put the condition badge and the
 * alert row into open disagreement — "Degraded" above a row reporting nothing
 * worse than info — and teach an administrator to stop trusting the headline.
 */
export function graphicsDiscrepancyDegradesCondition(
	kind: GraphicsDiscrepancyKind,
): boolean {
	return graphicsDiscrepancySeverity(kind) !== 'info';
}

/** The alert each open discrepancy kind raises. */
const DISCREPANCY_ALERT_CODES: Record<GraphicsDiscrepancyKind, GraphicsStorageHealthAlertCode> = {
	'critical-integrity-incident': 'critical-integrity-incident-open',
	'unavailable-content': 'unavailable-content-open',
	'missing-derivative': 'missing-derivative-open',
	'unexpected-object': 'unexpected-object-quarantined',
};

export function graphicsDiscrepancyAlertCode(
	kind: GraphicsDiscrepancyKind,
): GraphicsStorageHealthAlertCode {
	return DISCREPANCY_ALERT_CODES[kind];
}

/**
 * What a Graphics Ingestion Operation needs from an administrator right now.
 *
 * These are attention states, not stages: they answer whether anyone has to do
 * something. Terminal operations have no attention state and never appear.
 */
export const GRAPHICS_INGESTION_ATTENTION_STATES = [
	/** Staged input passed its retention guarantee; a new operation is required. */
	'input-expired',
	/** A retryable failure is resumable from its durable checkpoints. */
	'retryable',
	/** The author has an exact proposal to accept before anything publishes. */
	'awaiting-confirmation',
	/** Work is in flight and no one is blocked. */
	'active',
] as const;

export type GraphicsIngestionAttentionState
	= typeof GRAPHICS_INGESTION_ATTENTION_STATES[number];

/** Stages in which a Graphics Ingestion Operation is waiting on its author. */
export const GRAPHICS_INGESTION_AWAITING_CONFIRMATION_STAGES = [
	'awaiting-confirmation',
	'awaiting-installation',
] as const satisfies readonly GraphicsIngestionStage[];

/** Stages in which a Graphics Ingestion Operation is doing work of its own. */
export const GRAPHICS_INGESTION_ACTIVE_STAGES = [
	'created',
	'transferring',
	'hashing',
	'validating',
	'generating-derivatives',
	'publishing',
] as const satisfies readonly GraphicsIngestionStage[];

/**
 * The outcome groups recent Evidence is read through.
 *
 * Every group is one question an administrator asks after an incident: did
 * content stop resolving, did a preview go missing, are unexpected bytes being
 * held, did integrity fail closed, and did anything actually get fixed.
 */
export const GRAPHICS_RECENT_OUTCOME_GROUPS = [
	'unavailable-content',
	'missing-derivative',
	'quarantined-object',
	'integrity-incident',
	'resolved-repair',
	/**
	 * A repair, restoration, or regeneration the library refused. It sits beside
	 * resolved repairs rather than among them: an administrator who tried to fix
	 * something and was turned down has to see that, and counting it as resolved
	 * would report the opposite of what happened.
	 */
	'rejected-repair',
] as const;

export type GraphicsRecentOutcomeGroup = typeof GRAPHICS_RECENT_OUTCOME_GROUPS[number];

/**
 * Which outcome group each Evidence category answers.
 *
 * Every category maps to at most one group, so the counts never double-count a
 * single decision.
 *
 * Every reconciliation category is mapped. `discrepancy-rechecked` belongs with
 * the resolved repairs because reconciliation only ever records it alongside a
 * resolution — bytes verified as agreeing, an unexpected object gone after its
 * recheck, or content withdrawn as no longer expected. A recheck that changes
 * nothing records no Evidence at all, so this can never inflate the resolved
 * count with non-events.
 *
 * The categories deliberately left out are the routine retention decisions —
 * pruning scheduled, cancelled, frozen, resumed, or carried out; retirement,
 * Trash, and restoration; purge and blocked purge; staged-input expiry;
 * ordinary content deletion. Those are the lifecycle working as designed rather
 * than outcomes of an incident, and the Evidence ledger remains the place to
 * read them.
 */
const OUTCOME_GROUPS: Partial<Record<GraphicsAssetEvidenceCategory, GraphicsRecentOutcomeGroup>> = {
	'content-unavailable-detected': 'unavailable-content',
	'derivative-missing-detected': 'missing-derivative',
	'unexpected-object-quarantined': 'quarantined-object',
	'content-quarantined': 'quarantined-object',
	'content-deletion-conflict': 'quarantined-object',
	'critical-integrity-incident': 'integrity-incident',
	'content-availability-restored': 'resolved-repair',
	'content-repaired': 'resolved-repair',
	'content-restored-from-quarantine': 'resolved-repair',
	'content-quarantine-released': 'resolved-repair',
	'derivative-regenerated': 'resolved-repair',
	'discrepancy-rechecked': 'resolved-repair',
	'repair-rejected': 'rejected-repair',
};

export function graphicsRecentOutcomeGroup(
	category: GraphicsAssetEvidenceCategory,
): GraphicsRecentOutcomeGroup | undefined {
	return OUTCOME_GROUPS[category];
}

/** Every Evidence category the cockpit's recent outcomes are read from. */
export const GRAPHICS_RECENT_OUTCOME_CATEGORIES = Object.keys(
	OUTCOME_GROUPS,
) as readonly GraphicsAssetEvidenceCategory[];

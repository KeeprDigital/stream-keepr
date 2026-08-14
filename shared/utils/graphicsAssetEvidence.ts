import type { GraphicsAssetEvidenceCategory } from '~~/shared/types/graphicsAsset';
import type { GraphicsOperationalQueueId } from '~~/shared/utils/graphicsOperationalQueues';
import { GRAPHICS_RETENTION_GUARANTEES } from './graphicsAssetRetention';

/**
 * How the one shared Evidence ledger is read and how long it is kept.
 *
 * The ledger's categories are written by two independent policies, so the
 * vocabulary an administrator reads it with lives here rather than in either
 * writer. Two questions in particular have answers that must not drift apart:
 * which categories belong together when someone is looking for "everything
 * about pruning", and which categories mean a subject is finished with.
 */

/**
 * The categories that record a subject's terminal cleanup.
 *
 * The retention guarantee is one year *after* final purge or terminal operation
 * cleanup, not one year after each entry was written. An entry's own age
 * therefore says nothing about whether it may go: evidence explaining a live
 * asset is still the answer to a question someone may ask tomorrow, and
 * evidence explaining a purge is worth least on the day of the purge and most
 * a month later. So the ledger anchors expiry on these entries, which are the
 * ones that say a subject will never be heard from again.
 *
 * Detection and refusal are deliberately absent. A discrepancy that was found,
 * or a repair that was refused, leaves the subject open and still explainable.
 */
export const GRAPHICS_EVIDENCE_TERMINAL_CATEGORIES = [
	/** The Graphic Asset identity is gone and only a tombstone remains. */
	'graphic-asset-purged',
	/** The revision and its derivatives were removed after their full window. */
	'revision-pruned',
	/** The bytes were deleted after a fresh proof of unreachability. */
	'content-deleted',
	/**
	 * The ingestion operation is over: its staged input passed its deadline. The
	 * bytes can outlive the entry, because a staging store that was unavailable
	 * when the sweep acted leaves them recorded as reserved rather than freed.
	 */
	'staged-input-expired',
	/** The disagreement was withdrawn or settled, closing the discrepancy. */
	'discrepancy-rechecked',
	'content-availability-restored',
	'content-repaired',
	'content-restored-from-quarantine',
	'derivative-regenerated',
] as const satisfies readonly GraphicsAssetEvidenceCategory[];

/**
 * How long Evidence outlives the cleanup it explains. Re-exported here so a
 * reader of the ledger does not have to know that the number is defined among
 * the retention guarantees.
 */
export const GRAPHICS_EVIDENCE_RETENTION_MILLISECONDS
	= GRAPHICS_RETENTION_GUARANTEES.evidenceMilliseconds;

/**
 * The named groups the ledger offers instead of twenty-five separate category
 * checkboxes. They follow the operational vocabulary — ingestion, lifecycle,
 * reconciliation, quarantine, repair, regeneration, restoration, pruning, and
 * purge — so an administrator can ask a question in the words they would use.
 *
 * Groups overlap on purpose: a restoration from quarantine is both a
 * restoration and a quarantine outcome, and someone tracing either one wants
 * to see it.
 */
export const GRAPHICS_EVIDENCE_CATEGORY_GROUPS = {
	ingestion: ['staged-input-expired'],
	lifecycle: [
		'graphic-asset-retired',
		'graphic-asset-trashed',
		'graphic-asset-restored',
		'graphic-asset-purged',
		'graphic-asset-purge-blocked',
	],
	pruning: [
		'revision-pruning-scheduled',
		'revision-pruning-cancelled',
		'revision-pruning-frozen',
		'revision-pruning-resumed',
		'revision-pruned',
	],
	purge: ['graphic-asset-purged', 'graphic-asset-purge-blocked'],
	quarantine: [
		'content-quarantined',
		'content-quarantine-released',
		'content-deleted',
		'content-deletion-conflict',
		'unexpected-object-quarantined',
		'content-restored-from-quarantine',
	],
	reconciliation: [
		'content-unavailable-detected',
		'content-availability-restored',
		'derivative-missing-detected',
		'unexpected-object-quarantined',
		'critical-integrity-incident',
		'discrepancy-rechecked',
	],
	repair: ['content-repaired', 'repair-rejected'],
	regeneration: ['derivative-regenerated', 'derivative-missing-detected'],
	restoration: [
		'graphic-asset-restored',
		'content-restored-from-quarantine',
		'content-availability-restored',
	],
} as const satisfies Record<string, readonly GraphicsAssetEvidenceCategory[]>;

export type GraphicsEvidenceCategoryGroup = keyof typeof GRAPHICS_EVIDENCE_CATEGORY_GROUPS;

/**
 * The operational queue an entry's subject would still be sitting in, for the
 * categories where it is still sitting anywhere.
 *
 * An entry is a record of something that happened; the queue is where the thing
 * it happened to is being worked now. Terminal categories are deliberately
 * absent: after a purge, a prune, or a byte deletion there is no subject left to
 * inspect, and offering a link to one would promise a page that answers 404.
 */
const GRAPHICS_EVIDENCE_QUEUE_BY_CATEGORY = {
	'critical-integrity-incident': 'critical-integrity-incident',
	'content-unavailable-detected': 'unavailable-content',
	'derivative-missing-detected': 'missing-derivative',
	'repair-rejected': 'unavailable-content',
	'graphic-asset-trashed': 'trashed-asset',
	'graphic-asset-purge-blocked': 'trashed-asset',
	'graphic-asset-retired': 'retired-asset',
	'revision-pruning-scheduled': 'superseded-revision',
	'revision-pruning-frozen': 'superseded-revision',
	'revision-pruning-resumed': 'superseded-revision',
	'content-quarantined': 'quarantined-object',
	'unexpected-object-quarantined': 'quarantined-object',
} as const satisfies Partial<Record<GraphicsAssetEvidenceCategory, GraphicsOperationalQueueId>>;

/** Where to go on from an entry, or undefined when its subject is gone. */
export function graphicsEvidenceQueueFor(
	category: GraphicsAssetEvidenceCategory,
): GraphicsOperationalQueueId | undefined {
	return (GRAPHICS_EVIDENCE_QUEUE_BY_CATEGORY as
		Partial<Record<GraphicsAssetEvidenceCategory, GraphicsOperationalQueueId>>)[category];
}

export const GRAPHICS_EVIDENCE_CATEGORY_GROUP_VALUES = Object.keys(
	GRAPHICS_EVIDENCE_CATEGORY_GROUPS,
) as [GraphicsEvidenceCategoryGroup, ...GraphicsEvidenceCategoryGroup[]];

/**
 * The categories a set of groups asks for, de-duplicated. An empty selection
 * means every category rather than none: a ledger filtered to nothing would be
 * an empty page, which is never the question being asked.
 */
export function graphicsEvidenceCategoriesForGroups(
	groups: readonly GraphicsEvidenceCategoryGroup[],
): GraphicsAssetEvidenceCategory[] {
	return [...new Set(groups.flatMap(group => GRAPHICS_EVIDENCE_CATEGORY_GROUPS[group]))];
}

/**
 * Graphics Asset Library retention guarantees.
 *
 * These durations are the installation's recovery promise. Nothing may shorten
 * them: they are not administrator-configurable, they are not derived from
 * capacity, and storage pressure never scales them down. Only an explicitly
 * confirmed administrator purge of unreferenced Trash reclaims state early.
 */
export const GRAPHICS_RETENTION_GUARANTEES = {
	/** An incomplete transfer expires this long after its last verified progress. */
	incompleteTransferMilliseconds: 24 * 60 * 60 * 1000,
	/** Completed staged input awaiting confirmation or retry is kept this long. */
	completedInputMilliseconds: 7 * 24 * 60 * 60 * 1000,
	/** A Trashed Graphic Asset stays restorable this long before final purge. */
	trashRecoveryMilliseconds: 30 * 24 * 60 * 60 * 1000,
	/** An unreferenced superseded revision is kept this long after its last reference disappears. */
	supersededRevisionMilliseconds: 90 * 24 * 60 * 60 * 1000,
	/** Content that lost its final reachability is quarantined and rechecked after this long. */
	orphanContentQuarantineMilliseconds: 7 * 24 * 60 * 60 * 1000,
	/** Evidence outlives the cleanup it explains by this long. */
	evidenceMilliseconds: 365 * 24 * 60 * 60 * 1000,
} as const;

/** The policy actor recorded against every automated retention decision. */
export const GRAPHICS_RETENTION_ACTOR = 'graphics-retention-policy';

/** Why a Graphic Asset was purged: its recovery window elapsed, or it was confirmed early. */
export const GRAPHIC_ASSET_PURGE_REASONS = ['trash-window-elapsed', 'early-purge'] as const;

export const GRAPHICS_RETENTION_EVIDENCE_CATEGORIES = [
	'staged-input-expired',
	'staged-input-released',
	'revision-pruning-scheduled',
	'revision-pruning-cancelled',
	'revision-pruning-frozen',
	'revision-pruning-resumed',
	'revision-pruned',
	'graphic-asset-retired',
	'graphic-asset-trashed',
	'graphic-asset-restored',
	'graphic-asset-purged',
	'graphic-asset-purge-blocked',
	'content-quarantined',
	'content-quarantine-released',
	'content-deleted',
	'content-deletion-conflict',
] as const;

export function graphicsRetentionDeadline(from: string, milliseconds: number): string {
	return new Date(new Date(from).getTime() + milliseconds).toISOString();
}

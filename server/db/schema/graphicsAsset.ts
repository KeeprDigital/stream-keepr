import type { GraphicAssetPurgeReason } from '~~/shared/types/graphicsAsset';
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
	DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES,
	DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES,
	INSTALLED_GRAPHICS_TEMPLATE_KINDS,
} from '~~/shared/types/graphicsAsset';
import {
	GRAPHICS_DISCREPANCY_KINDS,
	GRAPHICS_DISCREPANCY_REASON_CODES,
	GRAPHICS_DISCREPANCY_RESOLUTIONS,
	GRAPHICS_DISCREPANCY_STATES,
	GRAPHICS_RECONCILIATION_EVIDENCE_CATEGORIES,
} from '~~/shared/utils/graphicsAssetReconciliation';
import { GRAPHICS_RETENTION_EVIDENCE_CATEGORIES } from '~~/shared/utils/graphicsAssetRetention';
import { events } from '../schema';

/** Every category the one shared Evidence ledger accepts. */
export const GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES = [
	...GRAPHICS_RETENTION_EVIDENCE_CATEGORIES,
	...GRAPHICS_RECONCILIATION_EVIDENCE_CATEGORIES,
] as const;

export const GRAPHIC_ASSET_KIND_VALUES = ['image', 'silent-video', 'font'] as const;
export const GRAPHIC_ASSET_LIFECYCLE_STATE_VALUES = ['active', 'retired', 'trashed'] as const;
export const GRAPHIC_ASSET_CONTENT_AVAILABILITY_VALUES = ['available', 'unavailable'] as const;
export const GRAPHICS_DERIVATIVE_KIND_VALUES = ['thumbnail', 'video-poster', 'font-specimen'] as const;
export const GRAPHICS_INGESTION_SOURCE_VALUES = ['local-upload', 'remote-copy', 'replacement', 'template-package'] as const;
export const GRAPHICS_DUPLICATE_CONTENT_POLICY_VALUES = ['reuse', 'create-separate'] as const;
/**
 * Written out rather than aliased to the shared `GRAPHIC_ASSET_PURGE_REASONS`.
 * Sourcing a column enum from another module makes the inferred table types
 * depend on it, and that dependency propagates through the schema barrel far
 * enough to collapse unrelated inference elsewhere. The type assertion below is
 * what keeps the two lists honest instead.
 */
export const GRAPHIC_ASSET_PURGE_REASON_VALUES = ['trash-window-elapsed', 'early-purge'] as const;
export const GRAPHICS_CONTENT_QUARANTINE_ORIGIN_VALUES = [
	'orphaned-content',
	'abandoned-canonical-write',
	/** Bytes the canonical store held that the catalogue never expected. */
	'unexpected-object',
] as const;
export const GRAPHICS_ASSET_EVIDENCE_SUBJECT_KIND_VALUES = [
	'graphics-ingestion-operation',
	'graphic-asset',
	'graphic-asset-revision',
	'graphic-asset-content',
	'graphics-derivative',
	'graphics-discrepancy',
] as const;
export const GRAPHICS_INGESTION_STAGE_VALUES = [
	'created',
	'transferring',
	'hashing',
	'validating',
	'generating-derivatives',
	'awaiting-confirmation',
	'awaiting-installation',
	'publishing',
	'completed',
	'failed',
	'cancelled',
] as const;

const createdAt = integer('created_at', { mode: 'timestamp_ms' })
	.notNull()
	.default(sql`(unixepoch() * 1000)`);

const updatedAt = integer('updated_at', { mode: 'timestamp_ms' })
	.notNull()
	.default(sql`(unixepoch() * 1000)`)
	.$onUpdateFn(() => new Date());

/** Installation-wide capacity limits. The singleton row is administrator-managed. */
export const graphicsCapacitySettings = sqliteTable('graphics_capacity_settings', {
	id: integer('id').primaryKey().default(1),
	canonicalLimitBytes: integer('canonical_limit_bytes')
		.notNull()
		.default(DEFAULT_GRAPHICS_CANONICAL_QUOTA_BYTES),
	stagingLimitBytes: integer('staging_limit_bytes')
		.notNull()
		.default(DEFAULT_GRAPHICS_STAGING_ALLOWANCE_BYTES),
	updatedAt,
});

/**
 * Installation-wide library identity and author-managed catalogue metadata.
 * Binary content is represented separately by an immutable digest row.
 */
export const graphicAssets = sqliteTable('graphic_assets', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	kind: text('kind', { enum: GRAPHIC_ASSET_KIND_VALUES }).notNull(),
	lifecycleState: text('lifecycle_state', { enum: GRAPHIC_ASSET_LIFECYCLE_STATE_VALUES }).notNull().default('active'),
	trashPriorState: text('trash_prior_state', { enum: ['active', 'retired'] }),
	trashedAt: integer('trashed_at', { mode: 'timestamp_ms' }),
	trashRecoverableUntil: integer('trash_recoverable_until', { mode: 'timestamp_ms' }),
	createdAt,
	updatedAt,
}, table => [
	index('graphic_assets_kind_state_idx').on(table.kind, table.lifecycleState),
	index('graphic_assets_name_idx').on(table.name),
]);

/**
 * Deduplicated immutable source or derivative bytes. D1 stores only verified
 * identity and technical facts; payload bytes stay in the canonical byte store.
 */
export const graphicAssetContents = sqliteTable('graphic_asset_contents', {
	digest: text('digest').primaryKey(),
	byteLength: integer('byte_length').notNull(),
	canonicalMime: text('canonical_mime').notNull(),
	/**
	 * Advisory reconciliation state, not a reader authority. A caller that needs
	 * bytes asks the canonical byte store, which is the only current source;
	 * this column keeps a known incident visible, alertable, and repairable
	 * between sweeps. Reconciliation is its only writer.
	 */
	availability: text('availability', { enum: GRAPHIC_ASSET_CONTENT_AVAILABILITY_VALUES }).notNull().default('available'),
	unavailableReasonCode: text('unavailable_reason_code'),
	unavailableSince: integer('unavailable_since', { mode: 'timestamp_ms' }),
	/**
	 * When reconciliation last compared this content against the byte store.
	 * A null value sorts first, so newly published content is checked before
	 * content a recent sweep already agreed on.
	 */
	reconciledAt: integer('reconciled_at', { mode: 'timestamp_ms' }),
	createdAt,
}, table => [
	index('graphic_asset_contents_availability_idx').on(table.availability),
	index('graphic_asset_contents_reconciled_idx').on(table.reconciledAt),
]);

/** One immutable, ordered, content-bearing version of a Graphic Asset. */
export const graphicAssetRevisions = sqliteTable('graphic_asset_revisions', {
	id: text('id').primaryKey(),
	assetId: text('asset_id')
		.references(() => graphicAssets.id, { onDelete: 'cascade' })
		.notNull(),
	revisionNumber: integer('revision_number').notNull(),
	contentDigest: text('content_digest')
		.references(() => graphicAssetContents.digest, { onDelete: 'restrict' })
		.notNull(),
	compatibilityProfile: text('compatibility_profile').notNull(),
	technicalFacts: text('technical_facts', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
	createdAt,
}, table => [
	uniqueIndex('graphic_asset_revisions_asset_number_idx').on(table.assetId, table.revisionNumber),
	index('graphic_asset_revisions_content_idx').on(table.contentDigest),
]);

/**
 * Graphic Asset Origin: the immutable source identity, source revision, and
 * content digest of the Template Package that produced this exact local
 * revision.
 *
 * It exists to recognise a future import, not to create a live link. A revision
 * has at most one origin, a locally created revision has none, and the row is
 * never rewritten — a package claiming an origin already recorded here with a
 * different digest is an integrity conflict rather than an update.
 */
export const graphicAssetOrigins = sqliteTable('graphic_asset_origins', {
	revisionId: text('revision_id')
		.primaryKey()
		.references(() => graphicAssetRevisions.id, { onDelete: 'cascade' }),
	assetId: text('asset_id')
		.references(() => graphicAssets.id, { onDelete: 'cascade' })
		.notNull(),
	sourceAssetId: text('source_asset_id').notNull(),
	sourceRevisionId: text('source_revision_id').notNull(),
	sourceRevisionNumber: integer('source_revision_number').notNull(),
	digest: text('digest').notNull(),
	createdAt,
}, table => [
	uniqueIndex('graphic_asset_origins_source_revision_idx')
		.on(table.sourceAssetId, table.sourceRevisionId),
	index('graphic_asset_origins_source_asset_idx').on(table.sourceAssetId),
	index('graphic_asset_origins_asset_idx').on(table.assetId),
]);

/** Generated, non-selectable bytes owned by one exact source revision. */
export const graphicsDerivatives = sqliteTable('graphics_derivatives', {
	id: text('id').primaryKey(),
	sourceRevisionId: text('source_revision_id')
		.references(() => graphicAssetRevisions.id, { onDelete: 'cascade' })
		.notNull(),
	kind: text('kind', { enum: GRAPHICS_DERIVATIVE_KIND_VALUES }).notNull(),
	contentDigest: text('content_digest')
		.references(() => graphicAssetContents.digest, { onDelete: 'restrict' })
		.notNull(),
	createdAt,
}, table => [
	uniqueIndex('graphics_derivatives_source_kind_idx').on(table.sourceRevisionId, table.kind),
	index('graphics_derivatives_content_idx').on(table.contentDigest),
]);

/** Optional discovery association; an Event never owns the Graphic Asset. */
export const graphicAssetEventAssociations = sqliteTable('graphic_asset_event_associations', {
	assetId: text('asset_id')
		.references(() => graphicAssets.id, { onDelete: 'cascade' })
		.notNull(),
	eventId: integer('event_id')
		.references(() => events.id, { onDelete: 'cascade' })
		.notNull(),
	createdAt,
}, table => [
	primaryKey({ columns: [table.assetId, table.eventId] }),
	index('graphic_asset_event_associations_event_idx').on(table.eventId),
]);

/**
 * Authoritative exact-revision usage. ownerKind/ownerId/ownerSlot describe the
 * graphics artifact field without coupling this foundation to later artifacts.
 */
export const graphicAssetReferences = sqliteTable('graphic_asset_references', {
	id: text('id').primaryKey(),
	assetId: text('asset_id')
		.references(() => graphicAssets.id, { onDelete: 'restrict' })
		.notNull(),
	revisionId: text('revision_id')
		.references(() => graphicAssetRevisions.id, { onDelete: 'restrict' })
		.notNull(),
	ownerKind: text('owner_kind').notNull(),
	ownerId: text('owner_id').notNull(),
	ownerSlot: text('owner_slot').notNull(),
	eventId: integer('event_id').references(() => events.id, { onDelete: 'cascade' }),
	createdAt,
	updatedAt,
}, table => [
	uniqueIndex('graphic_asset_references_owner_slot_idx').on(table.ownerKind, table.ownerId, table.ownerSlot),
	index('graphic_asset_references_revision_idx').on(table.revisionId),
	index('graphic_asset_references_asset_idx').on(table.assetId),
	index('graphic_asset_references_event_idx').on(table.eventId),
]);

/**
 * Durable identity and checkpoints for every ingestion path. Structured JSON
 * contains domain reports/outcomes only; byte payloads always remain in R2.
 */
export const graphicsIngestionOperations = sqliteTable('graphics_ingestion_operations', {
	id: text('id').primaryKey(),
	idempotencyKey: text('idempotency_key').notNull(),
	source: text('source', { enum: GRAPHICS_INGESTION_SOURCE_VALUES }).notNull(),
	stage: text('stage', { enum: GRAPHICS_INGESTION_STAGE_VALUES }).notNull().default('created'),
	initiatedBy: text('initiated_by').notNull(),
	proposedName: text('proposed_name').notNull(),
	sourceFileName: text('source_file_name'),
	declaredMime: text('declared_mime'),
	browserDecodeEvidence: text('browser_decode_evidence', { mode: 'json' }).$type<Record<string, unknown>>(),
	duplicateContentPolicy: text('duplicate_content_policy', {
		enum: GRAPHICS_DUPLICATE_CONTENT_POLICY_VALUES,
	}).notNull().default('reuse'),
	defaultEventId: integer('default_event_id').references(() => events.id, { onDelete: 'set null' }),
	targetAssetId: text('target_asset_id').references(() => graphicAssets.id, { onDelete: 'set null' }),
	declaredByteLength: integer('declared_byte_length'),
	transferredByteLength: integer('transferred_byte_length').notNull().default(0),
	multipartState: text('multipart_state', { mode: 'json' }).$type<Record<string, unknown>>(),
	/**
	 * The immutable Template Package preflight report, its proposed mappings, and
	 * the fingerprint any confirmation is bound to. It lives beside the operation
	 * so a reconnecting author, a retry, and a cancellation all read the same
	 * durable proposal rather than re-deriving one that might have changed.
	 */
	packagePreflight: text('package_preflight', { mode: 'json' }).$type<Record<string, unknown>>(),
	/**
	 * What one complete Template Package installation published: the Template it
	 * created and every packaged identity's local outcome. It sits beside the
	 * single-revision `result` the other ingestion paths produce, because a
	 * package's terminal result is the whole set or nothing.
	 */
	packageInstallation: text('package_installation', { mode: 'json' }).$type<Record<string, unknown>>(),
	stagingReservedByteLength: integer('staging_reserved_byte_length').notNull().default(0),
	stagingUsedByteLength: integer('staging_used_byte_length').notNull().default(0),
	canonicalReservedByteLength: integer('canonical_reserved_byte_length').notNull().default(0),
	capacityOutcome: text('capacity_outcome', { mode: 'json' }).$type<Record<string, unknown>>(),
	report: text('report', { mode: 'json' }).$type<Record<string, unknown>>(),
	result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
	failure: text('failure', { mode: 'json' }).$type<Record<string, unknown>>(),
	/**
	 * When the complete input became durably staged. This is the authoritative
	 * transfer-completed fact: a stage alone cannot answer it, because `failed`
	 * is reachable both mid-transfer and long after the transfer finished, and
	 * the two cases carry different retention guarantees.
	 */
	transferCompletedAt: integer('transfer_completed_at', { mode: 'timestamp_ms' }),
	cancelRequestedAt: integer('cancel_requested_at', { mode: 'timestamp_ms' }),
	createdAt,
	updatedAt,
}, table => [
	uniqueIndex('graphics_ingestion_operations_author_idempotency_idx').on(table.initiatedBy, table.idempotencyKey),
	index('graphics_ingestion_operations_stage_idx').on(table.stage),
	index('graphics_ingestion_operations_event_idx').on(table.defaultEventId),
]);

/**
 * One graphics Template a Template Package installed here.
 *
 * The document is an independent local copy whose Graphic Asset References were
 * rewritten to exact local identities and revisions before it was written, so it
 * is valid the instant it exists, and its references are indexed under this
 * Template's own owner identity. The source Template identity is provenance for
 * recognising a related package later, never a link to the installation that
 * exported it; placing this Template on a Screen copies it again.
 */
export const installedGraphicsTemplates = sqliteTable('installed_graphics_templates', {
	id: text('id').primaryKey(),
	kind: text('kind', { enum: INSTALLED_GRAPHICS_TEMPLATE_KINDS }).notNull(),
	name: text('name').notNull(),
	revisionNumber: integer('revision_number').notNull().default(1),
	document: text('document', { mode: 'json' }).notNull(),
	sourceTemplateIdentity: text('source_template_identity').notNull(),
	/**
	 * The revision the source Template was exported at, where the package declared
	 * one.
	 *
	 * It completes the provenance the identity starts. An identity alone cannot tell
	 * a re-import of the same design from a later revision of it, which is the one
	 * question recognising a related package has to answer. Null for a package that
	 * came from a workflow with no managed revision.
	 */
	sourceTemplateRevision: integer('source_template_revision'),
	/**
	 * Which Graphics Ingestion Operation installed this Template, recorded as a
	 * plain identity rather than a foreign key.
	 *
	 * A Template is permanent library state; the operation that installed it is a
	 * transient workflow record the retention contract plans to clean up a year
	 * after it goes terminal. A cascade would let that cleanup delete the Template
	 * — and leave its owner-less references behind, permanently blocking Trash on
	 * assets nothing can be shown to use. A restrict would instead make the
	 * cleanup fail forever on every operation that ever installed anything. So
	 * this outlives what it names, exactly as a Graphic Asset Tombstone does.
	 */
	installedByOperationId: text('installed_by_operation_id').notNull(),
	/** The Event the installation ran inside, when it ran inside one. */
	eventId: integer('event_id').references(() => events.id, { onDelete: 'set null' }),
	createdAt,
	updatedAt,
}, table => [
	index('installed_graphics_templates_kind_idx').on(table.kind),
	index('installed_graphics_templates_operation_idx').on(table.installedByOperationId),
	index('installed_graphics_templates_source_idx').on(table.sourceTemplateIdentity),
]);

/**
 * Canonical objects created before atomic catalogue publication. Terminal
 * failures remain here as unreachable quarantine; successful publication
 * removes the operation's candidates in the same D1 batch.
 */
export const graphicsCanonicalWriteCandidates = sqliteTable('graphics_canonical_write_candidates', {
	operationId: text('operation_id')
		.references(() => graphicsIngestionOperations.id, { onDelete: 'cascade' })
		.notNull(),
	digest: text('digest').notNull(),
	byteLength: integer('byte_length').notNull(),
	createdAt,
}, table => [
	primaryKey({ columns: [table.operationId, table.digest] }),
	index('graphics_canonical_write_candidates_digest_idx').on(table.digest),
]);

/**
 * Pruning state for a superseded, unreferenced Graphic Asset Revision. A row
 * exists only while the revision is a pruning candidate; a new reference
 * removes it and cancels pruning. Trash freezes the remaining recovery time so
 * restoration resumes it rather than restarting the guarantee.
 */
export const graphicAssetRevisionRetention = sqliteTable('graphic_asset_revision_retention', {
	revisionId: text('revision_id')
		.primaryKey()
		.references(() => graphicAssetRevisions.id, { onDelete: 'cascade' }),
	unreferencedSince: integer('unreferenced_since', { mode: 'timestamp_ms' }).notNull(),
	pruneAfter: integer('prune_after', { mode: 'timestamp_ms' }).notNull(),
	frozenAt: integer('frozen_at', { mode: 'timestamp_ms' }),
	frozenRemainingMilliseconds: integer('frozen_remaining_milliseconds'),
	createdAt,
}, table => [
	index('graphic_asset_revision_retention_prune_idx').on(table.pruneAfter),
]);

/**
 * Proof that a Graphic Asset identity was purged. Tombstones outlive the
 * catalogue state they replace so asynchronous byte deletion cannot resurrect
 * the asset and re-ingestion cannot reuse the purged local identity.
 */
export const graphicAssetTombstones = sqliteTable('graphic_asset_tombstones', {
	assetId: text('asset_id').primaryKey(),
	purgedAt: integer('purged_at', { mode: 'timestamp_ms' }).notNull(),
	purgeReason: text('purge_reason', { enum: GRAPHIC_ASSET_PURGE_REASON_VALUES }).notNull(),
	/** How many revisions the reference proof covered. */
	revisionCount: integer('revision_count').notNull(),
	/** How many references that proof found. Purge only commits when this is 0. */
	referenceCount: integer('reference_count').notNull(),
	createdAt,
});

/**
 * Content whose final reachability has disappeared. Quarantine holds the bytes
 * for a complete recheck window; only a fresh D1 proof of unreachability may
 * release them for deletion.
 */
export const graphicsContentQuarantine = sqliteTable('graphics_content_quarantine', {
	id: text('id').primaryKey(),
	digest: text('digest').notNull(),
	byteLength: integer('byte_length').notNull(),
	origin: text('origin', { enum: GRAPHICS_CONTENT_QUARANTINE_ORIGIN_VALUES }).notNull(),
	quarantinedAt: integer('quarantined_at', { mode: 'timestamp_ms' }).notNull(),
	deleteAfter: integer('delete_after', { mode: 'timestamp_ms' }).notNull(),
	/**
	 * When a sweep claimed this content for byte deletion. The row outlives the
	 * byte deletion it authorises so an unavailable byte store cannot strand an
	 * object with no catalogue trace; a stale claim is reclaimable.
	 */
	deletingSince: integer('deleting_since', { mode: 'timestamp_ms' }),
	createdAt,
}, table => [
	uniqueIndex('graphics_content_quarantine_digest_idx').on(table.digest),
	index('graphics_content_quarantine_delete_after_idx').on(table.deleteAfter),
]);

/**
 * One durable disagreement between the catalogue and the canonical byte store.
 *
 * The row carries the internal digest or object key it is about, because acting
 * on it requires them; nothing that leaves the module ever does. At most one
 * open row exists per subject, so a repeating sweep re-observes an incident
 * instead of stacking duplicates.
 */
export const graphicsDiscrepancies = sqliteTable('graphics_discrepancies', {
	id: text('id').primaryKey(),
	kind: text('kind', { enum: GRAPHICS_DISCREPANCY_KINDS }).notNull(),
	/** The exact expectation this row is about: a digest, derivative, or object key. */
	subjectKey: text('subject_key').notNull(),
	digest: text('digest'),
	objectKey: text('object_key'),
	derivativeId: text('derivative_id'),
	state: text('state', { enum: GRAPHICS_DISCREPANCY_STATES }).notNull().default('open'),
	reasonCode: text('reason_code', { enum: GRAPHICS_DISCREPANCY_REASON_CODES }).notNull(),
	/**
	 * A critical integrity incident fails closed: it is excluded from repair,
	 * regeneration, and automatic deletion until an administrator resolves it.
	 */
	isolated: integer('isolated', { mode: 'boolean' }).notNull().default(false),
	expected: text('expected', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
	observed: text('observed', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
	detectedAt: integer('detected_at', { mode: 'timestamp_ms' }).notNull(),
	lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }).notNull(),
	resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
	resolution: text('resolution', { enum: GRAPHICS_DISCREPANCY_RESOLUTIONS }),
	/**
	 * The staging identity a repair or regeneration is currently holding, and
	 * when it claimed it. The claim outlives the byte work it authorises so a
	 * crashed action cannot leak staged bytes with no catalogue trace.
	 */
	workingCopyKey: text('working_copy_key'),
	workingCopySince: integer('working_copy_since', { mode: 'timestamp_ms' }),
	correlationId: text('correlation_id').notNull(),
	createdAt,
}, table => [
	uniqueIndex('graphics_discrepancies_open_subject_idx')
		.on(table.kind, table.subjectKey)
		.where(sql`state = 'open'`),
	index('graphics_discrepancies_state_idx').on(table.state, table.kind),
	index('graphics_discrepancies_digest_idx').on(table.digest),
	index('graphics_discrepancies_working_copy_idx').on(table.workingCopySince),
]);

/**
 * Singleton progress for the canonical byte-store scan. The scan is a cursor
 * over an external store rather than over catalogue rows, so its position must
 * survive between scheduled sweeps for a large bucket to be covered at all.
 */
export const graphicsReconciliationState = sqliteTable('graphics_reconciliation_state', {
	id: integer('id').primaryKey().default(1),
	canonicalScanCursor: text('canonical_scan_cursor'),
	canonicalScanStartedAt: integer('canonical_scan_started_at', { mode: 'timestamp_ms' }),
	lastSweepCorrelationId: text('last_sweep_correlation_id'),
	lastSweepStartedAt: integer('last_sweep_started_at', { mode: 'timestamp_ms' }),
	lastSweepCompletedAt: integer('last_sweep_completed_at', { mode: 'timestamp_ms' }),
});

/**
 * Chronological administrator-facing Evidence for automated lifecycle work.
 * Subjects are domain identities; no object key, filename, digest, capability
 * secret, or deleted byte ever enters this ledger.
 */
export const graphicsAssetEvidence = sqliteTable('graphics_asset_evidence', {
	id: text('id').primaryKey(),
	recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull(),
	category: text('category', { enum: GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES }).notNull(),
	actor: text('actor').notNull(),
	subjectKind: text('subject_kind', {
		enum: GRAPHICS_ASSET_EVIDENCE_SUBJECT_KIND_VALUES,
	}).notNull(),
	subjectId: text('subject_id').notNull(),
	outcome: text('outcome').notNull(),
	reason: text('reason').notNull(),
	correlationId: text('correlation_id').notNull(),
	detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
	/**
	 * Null until the subject records a terminal cleanup. The one-year window is
	 * anchored on that cleanup rather than on when the entry was written, so an
	 * entry about a live subject has no expiry to hold yet.
	 */
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
}, table => [
	index('graphics_asset_evidence_recorded_idx').on(table.recordedAt),
	index('graphics_asset_evidence_expires_idx').on(table.expiresAt),
	index('graphics_asset_evidence_subject_idx').on(table.subjectKind, table.subjectId),
	// The ledger is always read chronologically under a filter, so each filter
	// an administrator can apply leads with its own column and carries the
	// ordering key after it. Without these, a category or actor question scans
	// the whole ledger and sorts it — the one read here that grows without
	// bound.
	index('graphics_asset_evidence_category_idx').on(table.category, table.recordedAt),
	index('graphics_asset_evidence_actor_idx').on(table.actor, table.recordedAt),
	index('graphics_asset_evidence_correlation_idx').on(table.correlationId, table.recordedAt),
]);

export type DbGraphicAsset = typeof graphicAssets.$inferSelect;
export type DbGraphicAssetInsert = typeof graphicAssets.$inferInsert;
export type DbGraphicAssetContent = typeof graphicAssetContents.$inferSelect;
export type DbGraphicAssetContentInsert = typeof graphicAssetContents.$inferInsert;
export type DbGraphicAssetRevision = typeof graphicAssetRevisions.$inferSelect;
export type DbGraphicAssetRevisionInsert = typeof graphicAssetRevisions.$inferInsert;
export type DbGraphicsDerivative = typeof graphicsDerivatives.$inferSelect;
export type DbGraphicsDerivativeInsert = typeof graphicsDerivatives.$inferInsert;
export type DbGraphicAssetReference = typeof graphicAssetReferences.$inferSelect;
export type DbGraphicAssetReferenceInsert = typeof graphicAssetReferences.$inferInsert;
export type DbInstalledGraphicsTemplate = typeof installedGraphicsTemplates.$inferSelect;
export type DbInstalledGraphicsTemplateInsert = typeof installedGraphicsTemplates.$inferInsert;
export type DbGraphicsIngestionOperation = typeof graphicsIngestionOperations.$inferSelect;
export type DbGraphicsIngestionOperationInsert = typeof graphicsIngestionOperations.$inferInsert;
export type DbGraphicsCanonicalWriteCandidate = typeof graphicsCanonicalWriteCandidates.$inferSelect;
export type DbGraphicAssetRevisionRetention = typeof graphicAssetRevisionRetention.$inferSelect;
/** The stored purge reasons and the domain's are the same list, in both directions. */
type PurgeReasonsAgree = [
	Exclude<GraphicAssetPurgeReason, typeof GRAPHIC_ASSET_PURGE_REASON_VALUES[number]>,
	Exclude<typeof GRAPHIC_ASSET_PURGE_REASON_VALUES[number], GraphicAssetPurgeReason>,
] extends [never, never] ? true : never;
export const GRAPHIC_ASSET_PURGE_REASONS_AGREE: PurgeReasonsAgree = true;

export type DbGraphicAssetTombstone = typeof graphicAssetTombstones.$inferSelect;
export type DbGraphicsContentQuarantine = typeof graphicsContentQuarantine.$inferSelect;
export type DbGraphicsDiscrepancy = typeof graphicsDiscrepancies.$inferSelect;
export type DbGraphicsReconciliationState = typeof graphicsReconciliationState.$inferSelect;
export type DbGraphicsAssetEvidence = typeof graphicsAssetEvidence.$inferSelect;

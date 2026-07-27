import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { events } from '../schema';

export const GRAPHIC_ASSET_KIND_VALUES = ['image', 'silent-video', 'font'] as const;
export const GRAPHIC_ASSET_LIFECYCLE_STATE_VALUES = ['active', 'retired', 'trashed'] as const;
export const GRAPHIC_ASSET_CONTENT_AVAILABILITY_VALUES = ['available', 'unavailable'] as const;
export const GRAPHICS_DERIVATIVE_KIND_VALUES = ['thumbnail', 'video-poster', 'font-specimen'] as const;
export const GRAPHICS_INGESTION_SOURCE_VALUES = ['local-upload', 'remote-copy', 'replacement', 'template-package'] as const;
export const GRAPHICS_INGESTION_STAGE_VALUES = [
	'created',
	'transferring',
	'hashing',
	'validating',
	'generating-derivatives',
	'awaiting-confirmation',
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

/**
 * Installation-wide library identity and author-managed catalogue metadata.
 * Binary content is represented separately by an immutable digest row.
 */
export const graphicAssets = sqliteTable('graphic_assets', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	kind: text('kind', { enum: GRAPHIC_ASSET_KIND_VALUES }).notNull(),
	lifecycleState: text('lifecycle_state', { enum: GRAPHIC_ASSET_LIFECYCLE_STATE_VALUES }).notNull().default('active'),
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
	availability: text('availability', { enum: GRAPHIC_ASSET_CONTENT_AVAILABILITY_VALUES }).notNull().default('available'),
	unavailableReasonCode: text('unavailable_reason_code'),
	unavailableSince: integer('unavailable_since', { mode: 'timestamp_ms' }),
	createdAt,
}, table => [
	index('graphic_asset_contents_availability_idx').on(table.availability),
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
	defaultEventId: integer('default_event_id').references(() => events.id, { onDelete: 'set null' }),
	targetAssetId: text('target_asset_id').references(() => graphicAssets.id, { onDelete: 'set null' }),
	declaredByteLength: integer('declared_byte_length'),
	transferredByteLength: integer('transferred_byte_length').notNull().default(0),
	report: text('report', { mode: 'json' }).$type<Record<string, unknown>>(),
	result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
	failure: text('failure', { mode: 'json' }).$type<Record<string, unknown>>(),
	cancelRequestedAt: integer('cancel_requested_at', { mode: 'timestamp_ms' }),
	createdAt,
	updatedAt,
}, table => [
	uniqueIndex('graphics_ingestion_operations_idempotency_idx').on(table.idempotencyKey),
	index('graphics_ingestion_operations_stage_idx').on(table.stage),
	index('graphics_ingestion_operations_event_idx').on(table.defaultEventId),
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
export type DbGraphicsIngestionOperation = typeof graphicsIngestionOperations.$inferSelect;
export type DbGraphicsIngestionOperationInsert = typeof graphicsIngestionOperations.$inferInsert;

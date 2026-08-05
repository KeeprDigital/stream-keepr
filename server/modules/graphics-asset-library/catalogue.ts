import type {
	GraphicAsset,
	GraphicAssetCanonicalMime,
	GraphicAssetFontFacts,
	GraphicAssetId,
	GraphicAssetImageFacts,
	GraphicAssetRevisionId,
	GraphicAssetUsage,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
	GraphicsIngestionSource,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsAssetCatalogue,
	PublishGraphicAssetCatalogueInput,
} from '.';
import type { GraphicsAssetMultipartState } from './multipart';
import type { GraphicsOperationsCockpitCatalogue } from './operations-cockpit';
import type { GraphicsAssetReconciliationCatalogue } from './reconciliation';
import type { GraphicsAssetRetentionCatalogue } from './retention';
import type { TemplatePackagePreflightState } from './template-package-preflight';
import { graphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import { graphicsCanonicalCapacityPressure } from '~~/shared/utils/graphicsAssetCapacity';
import { MAX_SILENT_VIDEO_POSTER_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { GRAPHICS_RETENTION_GUARANTEES } from '~~/shared/utils/graphicsAssetRetention';
import { createD1GraphicsOperationsCockpitCatalogue } from './catalogue-cockpit';
import { createD1GraphicsAssetReconciliationCatalogue } from './catalogue-reconciliation';
import { createD1GraphicsAssetRetentionCatalogue } from './catalogue-retention';
import { boundJsonArray, valuesFromJsonArray } from './catalogue-sql';
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

interface OperationRow {
	id: string;
	idempotency_key: string;
	source: GraphicsIngestionSource;
	initiated_by: string;
	proposed_name: string;
	source_file_name: string | null;
	declared_mime: string | null;
	browser_decode_evidence: string | null;
	duplicate_content_policy: GraphicsIngestionOperation['duplicateContentPolicy'];
	default_event_id: number | null;
	target_asset_id: string | null;
	declared_byte_length: number;
	transferred_byte_length: number;
	multipart_state: string | null;
	package_preflight: string | null;
	package_installation: string | null;
	stage: GraphicsIngestionOperation['stage'];
	capacity_outcome: string | null;
	report: string | null;
	result: string | null;
	failure: string | null;
	created_at: number;
	updated_at: number;
}

interface AssetRow {
	id: string;
	name: string;
	kind: GraphicAsset['kind'];
	lifecycle_state: 'active' | 'retired' | 'trashed';
	trash_prior_state: 'active' | 'retired' | null;
	trashed_at: number | null;
	trash_recoverable_until: number | null;
	revision_id: string;
	revision_number: number;
	revision_history: string;
	technical_facts: string;
	event_ids: string;
	operation_id: string;
	idempotency_key: string;
	source: GraphicsIngestionSource;
	initiated_by: string;
	proposed_name: string;
	source_file_name: string | null;
	declared_mime: string | null;
	browser_decode_evidence: string | null;
	duplicate_content_policy: GraphicsIngestionOperation['duplicateContentPolicy'];
	default_event_id: number | null;
	target_asset_id: string | null;
	declared_byte_length: number;
	transferred_byte_length: number;
	stage: GraphicsIngestionOperation['stage'];
	capacity_outcome: string | null;
	report: string | null;
	result: string | null;
	package_installation: string | null;
	failure: string | null;
	operation_created_at: number;
	operation_updated_at: number;
}

interface UsageRow {
	id: string;
	asset_id: string;
	revision_id: string;
	owner_kind: string;
	owner_id: string;
	owner_slot: string;
	event_id: number | null;
	owner_name: string | null;
}

function parseJson<T>(value: string | null): T | undefined {
	return value === null ? undefined : JSON.parse(value) as T;
}

function operationFromRow(row: OperationRow): GraphicsIngestionOperation {
	const multipart = parseJson<GraphicsAssetMultipartState>(row.multipart_state);
	const preflight = parseJson<TemplatePackagePreflightState>(row.package_preflight);
	const operation: GraphicsIngestionOperation = {
		id: row.id as GraphicsIngestionOperationId,
		idempotencyKey: row.idempotency_key,
		source: row.source,
		initiatedBy: row.initiated_by,
		name: row.proposed_name,
		sourceFileName: row.source_file_name ?? undefined,
		declaredMime: row.declared_mime ?? undefined,
		browserDecodeEvidence: parseJson(row.browser_decode_evidence),
		duplicateContentPolicy: row.duplicate_content_policy,
		defaultEventId: row.default_event_id ?? undefined,
		targetAssetId: row.target_asset_id as GraphicAssetId | null ?? undefined,
		declaredByteLength: row.declared_byte_length,
		transferredByteLength: row.transferred_byte_length,
		stage: row.stage,
		canonicalCapacityOutcome: parseJson(row.capacity_outcome),
		report: parseJson(row.report),
		templatePackagePreflight: preflight?.report,
		result: parseJson(row.result),
		templatePackageInstallation: parseJson(row.package_installation),
		failure: parseJson(row.failure),
		createdAt: new Date(row.created_at).toISOString(),
		updatedAt: new Date(row.updated_at).toISOString(),
	};
	// A remote copy's multipart state is a server-side abort checkpoint, not a
	// client transfer: it holds an uploadId and no parts, so reporting it as one
	// would advertise a part count no client is ever asked to send.
	if (!multipart || row.source === 'remote-copy')
		return operation;
	return {
		...operation,
		transfer: graphicsMultipartTransfer(operation.declaredByteLength, multipart),
	};
}

function operationRowFromAsset(row: AssetRow): OperationRow {
	return {
		id: row.operation_id,
		idempotency_key: row.idempotency_key,
		source: row.source,
		initiated_by: row.initiated_by,
		proposed_name: row.proposed_name,
		source_file_name: row.source_file_name,
		declared_mime: row.declared_mime,
		browser_decode_evidence: row.browser_decode_evidence,
		duplicate_content_policy: row.duplicate_content_policy,
		default_event_id: row.default_event_id,
		target_asset_id: row.target_asset_id,
		declared_byte_length: row.declared_byte_length,
		transferred_byte_length: row.transferred_byte_length,
		multipart_state: null,
		package_preflight: null,
		package_installation: row.package_installation,
		stage: row.stage,
		capacity_outcome: row.capacity_outcome,
		report: row.report,
		result: row.result,
		failure: row.failure,
		created_at: row.operation_created_at,
		updated_at: row.operation_updated_at,
	};
}

function lifecycleFromRow(row: AssetRow): GraphicAsset['lifecycle'] {
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
}

function assetFromRow(row: AssetRow): GraphicAsset {
	return {
		id: row.id as GraphicAssetId,
		name: row.name,
		kind: row.kind,
		revisionId: row.revision_id as GraphicAsset['revisionId'],
		revisionNumber: row.revision_number,
		revisions: JSON.parse(row.revision_history) as GraphicAsset['revisions'],
		facts: JSON.parse(row.technical_facts) as GraphicAssetImageFacts | GraphicAssetFontFacts,
		eventIds: JSON.parse(row.event_ids) as number[],
		lifecycle: lifecycleFromRow(row),
		operation: operationFromRow(operationRowFromAsset(row)),
	};
}

function usageFromRow(row: UsageRow): GraphicAssetUsage {
	return {
		id: row.id,
		reference: {
			assetId: row.asset_id as GraphicAssetId,
			revisionId: row.revision_id as GraphicAssetRevisionId,
		},
		owner: {
			kind: row.owner_kind,
			id: row.owner_id,
			name: row.owner_name ?? undefined,
			slot: row.owner_slot,
			eventId: row.event_id ?? undefined,
		},
	};
}

function usageSelect() {
	return `
		SELECT asset_reference.id, asset_reference.asset_id, asset_reference.revision_id,
			asset_reference.owner_kind, asset_reference.owner_id,
			asset_reference.owner_slot, asset_reference.event_id,
			CASE
				WHEN asset_reference.owner_kind = 'screen' THEN screens.name
				-- Inspecting usage before a lifecycle action is how an author learns
				-- what would break, and "some installed Template" does not answer
				-- that. Every owner kind that has a name says it.
				WHEN asset_reference.owner_kind = 'installed-graphics-template'
					THEN installed_template.name
				WHEN asset_reference.owner_kind = 'broadcast-graphic-template'
					THEN broadcast_graphic_template.name
				WHEN asset_reference.owner_kind = 'feature-match-layout-template'
					THEN feature_match_layout_template.name
				ELSE NULL
			END AS owner_name
		FROM graphic_asset_references asset_reference
		LEFT JOIN screens
			ON asset_reference.owner_kind = 'screen'
			AND CAST(screens.id AS TEXT) = asset_reference.owner_id
			AND screens.event_id = asset_reference.event_id
		LEFT JOIN installed_graphics_templates installed_template
			ON asset_reference.owner_kind = 'installed-graphics-template'
			AND installed_template.id = asset_reference.owner_id
		LEFT JOIN broadcast_graphic_templates broadcast_graphic_template
			ON asset_reference.owner_kind = 'broadcast-graphic-template'
			AND broadcast_graphic_template.id = asset_reference.owner_id
		LEFT JOIN feature_match_layout_templates feature_match_layout_template
			ON asset_reference.owner_kind = 'feature-match-layout-template'
			AND feature_match_layout_template.id = asset_reference.owner_id
		WHERE asset_reference.asset_id = ?
		ORDER BY asset_reference.owner_kind, asset_reference.owner_id,
			asset_reference.owner_slot, asset_reference.id
	`;
}

async function readLifecycleTransitionAsset(
	catalogue: Pick<GraphicsAssetCatalogue, 'listGraphicAssets'>,
	assetId: GraphicAssetId,
	failureMessage: string,
) {
	const asset = (await catalogue.listGraphicAssets(
		'',
		['active', 'retired', 'trashed'],
	)).find(candidate => candidate.id === assetId);
	if (!asset)
		throw new Error(failureMessage);
	return asset;
}

async function classifyLifecycleTransitionMiss(
	database: D1Database,
	assetId: GraphicAssetId,
): Promise<{ outcome: 'not-allowed' | 'not-found' }> {
	const existing = await database.prepare(
		'SELECT lifecycle_state FROM graphic_assets WHERE id = ?',
	).bind(assetId).first();
	return { outcome: existing ? 'not-allowed' : 'not-found' };
}

function operationSelect(where: string) {
	return `
		SELECT id, idempotency_key, source, initiated_by, proposed_name,
				source_file_name, declared_mime, browser_decode_evidence,
			duplicate_content_policy, default_event_id, target_asset_id,
			declared_byte_length, transferred_byte_length, multipart_state, package_preflight,
			package_installation, stage, report, result,
			capacity_outcome, failure, created_at, updated_at
		FROM graphics_ingestion_operations
		WHERE ${where}
	`;
}

async function firstOperation(
	database: D1Database,
	where: string,
	...bindings: unknown[]
): Promise<GraphicsIngestionOperation | undefined> {
	const row = await database.prepare(operationSelect(where)).bind(...bindings).first<OperationRow>();
	return row ? operationFromRow(row) : undefined;
}

async function assertContentCompatible(
	database: D1Database,
	input: { digest: string; byteLength: number; canonicalMime: string },
) {
	const existing = await database.prepare(`
		SELECT byte_length, canonical_mime
		FROM graphic_asset_contents
		WHERE digest = ?
	`).bind(input.digest).first<{ byte_length: number; canonical_mime: string }>();
	if (
		existing
		&& (existing.byte_length !== input.byteLength || existing.canonical_mime !== input.canonicalMime)
	) {
		throw new Error('Graphic Asset Content digest conflicts with existing catalogue facts');
	}
}

/**
 * Publication makes its content reachable again, so it cancels any pending
 * orphan quarantine for those digests inside the same atomic transaction.
 *
 * A batch that can commit without having published passes the condition its
 * publication actually depends on, so a release can never outlive the
 * reachability that justified it.
 */
function releaseContentQuarantineStatement(
	database: D1Database,
	digests: readonly string[],
	publication?: { guard: string; bindings: readonly unknown[] },
) {
	return database.prepare(`
		DELETE FROM graphics_content_quarantine
		WHERE digest IN ${valuesFromJsonArray()}
		${publication ? `AND ${publication.guard}` : ''}
	`).bind(boundJsonArray(digests), ...(publication?.bindings ?? []));
}

function updateOperationStatement(
	database: D1Database,
	operation: GraphicsIngestionOperation,
	expectedUpdatedAt: string,
	additionalWhere = '',
	additionalBindings: unknown[] = [],
) {
	return database.prepare(`
		UPDATE graphics_ingestion_operations
			SET stage = ?, transferred_byte_length = ?, source_file_name = ?,
				declared_mime = ?, browser_decode_evidence = ?, report = ?, result = ?,
			-- Written once, by the installation that produced it. Every other
			-- transition passes null and keeps whatever is already recorded, so a
			-- terminal result can never be blanked by an unrelated update.
			package_installation = COALESCE(?, package_installation),
			failure = ?, capacity_outcome = ?, updated_at = ?,
			multipart_state = CASE
				WHEN ? = 'cancelled' AND multipart_state IS NOT NULL
					THEN json_set(multipart_state, '$.cleanupPending', json('true'))
				ELSE multipart_state
			END,
			staging_reserved_byte_length = CASE
				WHEN ? IN ('completed', 'cancelled')
					OR (? = 'failed' AND json_extract(?, '$.retryable') = 0)
					THEN 0
				ELSE staging_reserved_byte_length
			END,
			staging_used_byte_length = CASE
				WHEN ? IN ('completed', 'cancelled')
					OR (? = 'failed' AND json_extract(?, '$.retryable') = 0)
					THEN 0
				ELSE staging_used_byte_length
			END,
			canonical_reserved_byte_length = CASE
				WHEN ? IN ('completed', 'cancelled')
					OR (? = 'failed' AND json_extract(?, '$.retryable') = 0)
					THEN 0
				ELSE canonical_reserved_byte_length
			END
		WHERE id = ? AND initiated_by = ?
			AND stage NOT IN ('cancelled', 'completed')
			AND updated_at = ?
			${additionalWhere}
	`).bind(
		operation.stage,
		operation.transferredByteLength,
		operation.sourceFileName ?? null,
		operation.declaredMime ?? null,
		operation.browserDecodeEvidence === undefined
			? null
			: JSON.stringify(operation.browserDecodeEvidence),
		operation.report === undefined ? null : JSON.stringify(operation.report),
		operation.result === undefined ? null : JSON.stringify(operation.result),
		operation.templatePackageInstallation === undefined
			? null
			: JSON.stringify(operation.templatePackageInstallation),
		operation.failure === undefined ? null : JSON.stringify(operation.failure),
		operation.canonicalCapacityOutcome === undefined
			? null
			: JSON.stringify(operation.canonicalCapacityOutcome),
		new Date(operation.updatedAt).getTime(),
		operation.stage,
		operation.stage,
		operation.stage,
		operation.failure === undefined ? null : JSON.stringify(operation.failure),
		operation.stage,
		operation.stage,
		operation.failure === undefined ? null : JSON.stringify(operation.failure),
		operation.stage,
		operation.stage,
		operation.failure === undefined ? null : JSON.stringify(operation.failure),
		operation.id,
		operation.initiatedBy,
		new Date(expectedUpdatedAt).getTime(),
		...additionalBindings,
	);
}

export function createD1GraphicsAssetCatalogue(
	database: D1Database,
): GraphicsAssetCatalogue
	& GraphicsAssetRetentionCatalogue
	& GraphicsAssetReconciliationCatalogue
	& GraphicsOperationsCockpitCatalogue {
	return {
		...createD1GraphicsAssetReconciliationCatalogue(database),
		...createD1GraphicsAssetRetentionCatalogue(database),
		...createD1GraphicsOperationsCockpitCatalogue(database),
		async checkHealth() {
			const result = await database
				.prepare('SELECT 1 AS healthy FROM graphic_assets LIMIT 1')
				.all<{ healthy: number }>();
			if (!result.success)
				throw new Error('Graphics Asset catalogue health query failed');
			return { outcome: 'healthy' };
		},
		async getCapacity() {
			const row = await database.prepare(`
				SELECT
					settings.canonical_limit_bytes,
					settings.staging_limit_bytes,
					COALESCE((
						SELECT SUM(contents.byte_length)
						FROM graphic_asset_contents contents
						WHERE EXISTS (
							SELECT 1 FROM graphic_asset_revisions revisions
							WHERE revisions.content_digest = contents.digest
						)
					), 0) AS retained_source_bytes,
					COALESCE((
						SELECT SUM(contents.byte_length)
						FROM graphic_asset_contents contents
						WHERE NOT EXISTS (
							SELECT 1 FROM graphic_asset_revisions revisions
							WHERE revisions.content_digest = contents.digest
						)
							AND EXISTS (
								SELECT 1 FROM graphics_derivatives derivatives
								WHERE derivatives.content_digest = contents.digest
							)
					), 0) AS retained_derivative_bytes,
					COALESCE((
						SELECT SUM(canonical_reserved_byte_length)
						FROM graphics_ingestion_operations
					), 0) AS canonical_reserved_bytes,
					COALESCE((
						SELECT SUM(staging_used_byte_length)
						FROM graphics_ingestion_operations
					), 0) AS staging_used_bytes,
					COALESCE((
						SELECT SUM(staging_reserved_byte_length)
						FROM graphics_ingestion_operations
					), 0) AS staging_reserved_bytes,
					(
						COALESCE((
							SELECT SUM(length(CAST(json_array(
								id, canonical_limit_bytes, staging_limit_bytes, updated_at
							) AS BLOB)))
							FROM graphics_capacity_settings
						), 0)
						+ COALESCE((
							SELECT SUM(length(CAST(json_array(
								id, name, kind, lifecycle_state, created_at, updated_at
							) AS BLOB)))
							FROM graphic_assets
						), 0)
						+ COALESCE((
							SELECT SUM(length(CAST(json_array(
								digest, byte_length, canonical_mime, availability,
								unavailable_reason_code, unavailable_since, created_at
							) AS BLOB)))
							FROM graphic_asset_contents
						), 0)
						+ COALESCE((
							SELECT SUM(length(CAST(json_array(
								id, asset_id, revision_number, content_digest,
								compatibility_profile, technical_facts, created_at
							) AS BLOB)))
							FROM graphic_asset_revisions
						), 0)
						+ COALESCE((
							SELECT SUM(length(CAST(json_array(
								id, source_revision_id, kind, content_digest, created_at
							) AS BLOB)))
							FROM graphics_derivatives
						), 0)
						+ COALESCE((
							SELECT SUM(length(CAST(json_array(
								asset_id, event_id, created_at
							) AS BLOB)))
							FROM graphic_asset_event_associations
						), 0)
						+ COALESCE((
							SELECT SUM(length(CAST(json_array(
								id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
								event_id, created_at, updated_at
							) AS BLOB)))
							FROM graphic_asset_references
						), 0)
						+ COALESCE((
							SELECT SUM(length(CAST(json_array(
									id, idempotency_key, source, stage, initiated_by,
									proposed_name, source_file_name, declared_mime,
									browser_decode_evidence,
								duplicate_content_policy, default_event_id,
								target_asset_id, declared_byte_length, transferred_byte_length,
								staging_reserved_byte_length, staging_used_byte_length,
								canonical_reserved_byte_length, capacity_outcome, report, result,
								failure, cancel_requested_at, created_at, updated_at
							) AS BLOB)))
							FROM graphics_ingestion_operations
						), 0)
						+ COALESCE((
							SELECT SUM(length(CAST(json_array(
								operation_id, digest, byte_length, created_at
							) AS BLOB)))
							FROM graphics_canonical_write_candidates
						), 0)
					) AS metadata_bytes,
					COALESCE((
						SELECT SUM(quarantine.byte_length)
						FROM (
							SELECT candidates.digest, MAX(candidates.byte_length) AS byte_length
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
								AND NOT EXISTS (
									SELECT 1
									FROM graphics_content_quarantine held
									WHERE held.digest = candidates.digest
								)
								AND NOT EXISTS (
									SELECT 1
									FROM graphic_asset_contents contents
									WHERE contents.digest = candidates.digest
										AND (
											EXISTS (
												SELECT 1 FROM graphic_asset_revisions revisions
												WHERE revisions.content_digest = contents.digest
											)
											OR EXISTS (
												SELECT 1 FROM graphics_derivatives derivatives
												WHERE derivatives.content_digest = contents.digest
											)
										)
								)
							GROUP BY candidates.digest
						) quarantine
					), 0) + COALESCE((
						SELECT SUM(byte_length) FROM graphics_content_quarantine
					), 0) AS unreachable_quarantine_bytes
				FROM graphics_capacity_settings settings
				WHERE settings.id = 1
			`).first<{
				canonical_limit_bytes: number;
				staging_limit_bytes: number;
				retained_source_bytes: number;
				retained_derivative_bytes: number;
				canonical_reserved_bytes: number;
				staging_used_bytes: number;
				staging_reserved_bytes: number;
				metadata_bytes: number;
				unreachable_quarantine_bytes: number;
			}>();
			if (!row)
				throw new Error('Graphics capacity settings are unavailable');
			const usedBytes = row.retained_source_bytes + row.retained_derivative_bytes;
			return {
				canonical: {
					limitBytes: row.canonical_limit_bytes,
					usedBytes,
					reservedBytes: row.canonical_reserved_bytes,
					availableBytes: Math.max(
						0,
						row.canonical_limit_bytes - usedBytes - row.canonical_reserved_bytes,
					),
					pressure: graphicsCanonicalCapacityPressure(usedBytes, row.canonical_limit_bytes),
					breakdown: {
						retainedSourceBytes: row.retained_source_bytes,
						retainedDerivativeBytes: row.retained_derivative_bytes,
						metadataBytes: row.metadata_bytes,
						providerCacheBytes: 0,
						unreachableQuarantineBytes: row.unreachable_quarantine_bytes,
					},
				},
				staging: {
					limitBytes: row.staging_limit_bytes,
					usedBytes: row.staging_used_bytes,
					reservedBytes: row.staging_reserved_bytes,
					availableBytes: Math.max(
						0,
						row.staging_limit_bytes - row.staging_used_bytes - row.staging_reserved_bytes,
					),
				},
			};
		},
		async updateCapacityLimits(input) {
			const result = await database.prepare(`
					UPDATE graphics_capacity_settings
					SET canonical_limit_bytes = ?, staging_limit_bytes = ?, updated_at = ?
					WHERE id = 1
							AND ? >= (
								SELECT COALESCE(SUM(byte_length), 0)
								FROM graphic_asset_contents
								WHERE EXISTS (
									SELECT 1 FROM graphic_asset_revisions
									WHERE content_digest = graphic_asset_contents.digest
								)
									OR EXISTS (
										SELECT 1 FROM graphics_derivatives
										WHERE content_digest = graphic_asset_contents.digest
									)
							) + (
							SELECT COALESCE(SUM(canonical_reserved_byte_length), 0)
							FROM graphics_ingestion_operations
						)
						AND ? >= (
							SELECT COALESCE(SUM(
								staging_used_byte_length + staging_reserved_byte_length
							), 0)
							FROM graphics_ingestion_operations
						)
				`).bind(
				input.canonicalLimitBytes,
				input.stagingLimitBytes,
				new Date(input.updatedAt).getTime(),
				input.canonicalLimitBytes,
				input.stagingLimitBytes,
			).run();
			if (!result.success)
				throw new Error('Graphics capacity settings update failed');
			if (result.meta.changes !== 1) {
				const capacity = await this.getCapacity();
				const canonicalRequired
					= capacity.canonical.usedBytes + capacity.canonical.reservedBytes;
				if (input.canonicalLimitBytes < canonicalRequired) {
					throw new GraphicsAssetLibraryError(
						'Canonical capacity cannot be set below current usage and reservations',
						'canonical-capacity-exhausted',
					);
				}
				throw new GraphicsAssetLibraryError(
					'Staging capacity cannot be set below current usage and reservations',
					'staging-capacity-exhausted',
				);
			}
			return await this.getCapacity();
		},
		async initiateGraphicsIngestion(operation) {
			const requestedStagingBytes = stagingReservationBytes(operation);
			const existing = await firstOperation(
				database,
				'initiated_by = ? AND idempotency_key = ?',
				operation.initiatedBy,
				operation.idempotencyKey,
			);
			if (existing)
				return existing;

			await database.prepare(`
					INSERT OR IGNORE INTO graphics_ingestion_operations (
						id, idempotency_key, source, stage, initiated_by, proposed_name,
						source_file_name, declared_mime, browser_decode_evidence,
					duplicate_content_policy, default_event_id, target_asset_id,
					declared_byte_length, transferred_byte_length,
					staging_reserved_byte_length,
					created_at, updated_at
				)
					SELECT ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?
				FROM graphics_capacity_settings settings
				WHERE settings.id = 1
					AND (
						SELECT COALESCE(SUM(
							staging_reserved_byte_length + staging_used_byte_length
						), 0)
						FROM graphics_ingestion_operations
					) + ? <= settings.staging_limit_bytes
			`).bind(
				operation.id,
				operation.idempotencyKey,
				operation.source,
				operation.initiatedBy,
				operation.name,
				operation.sourceFileName ?? null,
				operation.declaredMime ?? null,
				operation.browserDecodeEvidence === undefined
					? null
					: JSON.stringify(operation.browserDecodeEvidence),
				operation.duplicateContentPolicy,
				operation.defaultEventId ?? null,
				operation.targetAssetId ?? null,
				operation.declaredByteLength,
				requestedStagingBytes,
				new Date(operation.createdAt).getTime(),
				new Date(operation.updatedAt).getTime(),
				requestedStagingBytes,
			).run();
			const authoritative = await firstOperation(
				database,
				'initiated_by = ? AND idempotency_key = ?',
				operation.initiatedBy,
				operation.idempotencyKey,
			);
			if (!authoritative) {
				const capacity = await this.getCapacity();
				throw new GraphicsAssetLibraryError(
					'Graphics staging capacity is exhausted',
					'staging-capacity-exhausted',
					{
						capacity: {
							resource: 'staging',
							limitBytes: capacity.staging.limitBytes,
							usedBytes: capacity.staging.usedBytes,
							reservedBytes: capacity.staging.reservedBytes,
							requestedBytes: requestedStagingBytes,
							availableBytes: capacity.staging.availableBytes,
						},
					},
				);
			}
			return authoritative;
		},
		async recordStagedBytes(input) {
			// This is the one point at which a complete input is durably staged,
			// for both single-shot and multipart transfer, so it is where the
			// transfer-completed fact is recorded.
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET staging_used_byte_length = ?,
					staging_reserved_byte_length =
						staging_reserved_byte_length + staging_used_byte_length - ?,
					transfer_completed_at = COALESCE(transfer_completed_at, ?)
				WHERE id = ? AND initiated_by = ?
					AND stage NOT IN ('completed', 'cancelled')
					AND ? BETWEEN 0
						AND staging_reserved_byte_length + staging_used_byte_length
			`).bind(
				input.usedBytes,
				input.usedBytes,
				new Date(input.recordedAt).getTime(),
				input.operation.id,
				input.operation.initiatedBy,
				input.usedBytes,
			).run();
			if (!result.success || result.meta.changes !== 1)
				throw new Error('Graphics staging progress could not be recorded');
		},
		async recordRemoteCopyStagedSource(input) {
			const { observedByteLength } = input;
			const residualReservation = stagingReservationBytes({
				...input.operation,
				declaredByteLength: observedByteLength,
			}) - observedByteLength;
			// This is the remote-copy equivalent of recordStagedBytes: the one point
			// at which a complete remote input is durably staged, so it records the
			// same transfer-completed fact. Without it the copy would read as an
			// incomplete transfer and lose its seven-day staged-input guarantee.
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET declared_byte_length = ?,
					transferred_byte_length = ?,
					staging_used_byte_length = ?,
					staging_reserved_byte_length = ?,
					-- Durably staged bytes mean every multipart upload this copy ever
					-- held is finished, so no abort checkpoint can still be owed.
					multipart_state = NULL,
					transfer_completed_at = COALESCE(transfer_completed_at, ?)
				WHERE id = ? AND initiated_by = ?
					AND source = 'remote-copy'
					AND stage NOT IN ('completed', 'cancelled')
					AND ? <= staging_reserved_byte_length + staging_used_byte_length
			`).bind(
				observedByteLength,
				observedByteLength,
				observedByteLength,
				residualReservation,
				new Date(input.recordedAt).getTime(),
				input.operation.id,
				input.operation.initiatedBy,
				observedByteLength + residualReservation,
			).run();
			if (!result.success || result.meta.changes !== 1)
				throw new Error('Remote Graphic Asset copy progress could not be recorded');
		},
		async recordCanonicalWrites(input) {
			if (input.contents.length === 0)
				return;
			const results = await database.batch(input.contents.map(content =>
				database.prepare(`
					INSERT OR IGNORE INTO graphics_canonical_write_candidates (
						operation_id, digest, byte_length, created_at
					) VALUES (?, ?, ?, ?)
				`).bind(
					input.operation.id,
					content.digest,
					content.byteLength,
					new Date(input.recordedAt).getTime(),
				),
			) as [D1PreparedStatement, ...D1PreparedStatement[]]);
			if (results.some(result => !result.success))
				throw new Error('Graphics canonical writes could not be recorded');
		},
		async reserveGraphicAssetPublication(input) {
			const proposed = new Map<string, number>([
				[input.sourceDigest, input.sourceByteLength],
				[input.thumbnailDigest, input.thumbnailByteLength],
			]);
			const existing = await Promise.all(
				[...proposed].map(async ([digest, byteLength]) => ({
					digest,
					byteLength,
					exists: Boolean(await database.prepare(`
							SELECT 1
							FROM graphic_asset_contents contents
							WHERE contents.digest = ?
								AND (
									EXISTS (
										SELECT 1 FROM graphic_asset_revisions revisions
										WHERE revisions.content_digest = contents.digest
									)
									OR EXISTS (
										SELECT 1 FROM graphics_derivatives derivatives
										WHERE derivatives.content_digest = contents.digest
									)
								)
						`).bind(digest).first()),
				})),
			);
			const growthBytes = existing
				.filter(content => !content.exists)
				.reduce((total, content) => total + content.byteLength, 0);
			const currentReservation = await database.prepare(`
				SELECT canonical_reserved_byte_length
				FROM graphics_ingestion_operations
				WHERE id = ? AND initiated_by = ?
			`).bind(
				input.operation.id,
				input.operation.initiatedBy,
			).first<{ canonical_reserved_byte_length: number }>();
			const ownReservedBytes = currentReservation?.canonical_reserved_byte_length ?? 0;
			const before = await this.getCapacity();
			const availableBeforeReservation = before.canonical.availableBytes + ownReservedBytes;
			const capacityOutcome = growthBytes === 0
				? {
						outcome: 'no-canonical-growth' as const,
						growthBytes: 0 as const,
						availableBytes: availableBeforeReservation,
					}
				: {
						outcome: 'canonical-growth-reserved' as const,
						growthBytes,
						availableBytes: Math.max(0, availableBeforeReservation - growthBytes),
					};
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET canonical_reserved_byte_length = ?,
					capacity_outcome = ?,
					updated_at = ?
				WHERE id = ? AND initiated_by = ? AND updated_at = ?
					AND stage = 'generating-derivatives'
					AND ? <= (
						SELECT canonical_limit_bytes
						FROM graphics_capacity_settings
						WHERE id = 1
					) - (
						SELECT COALESCE(SUM(byte_length), 0)
						FROM graphic_asset_contents
						WHERE EXISTS (
							SELECT 1 FROM graphic_asset_revisions
							WHERE content_digest = graphic_asset_contents.digest
						)
							OR EXISTS (
								SELECT 1 FROM graphics_derivatives
								WHERE content_digest = graphic_asset_contents.digest
							)
					) - (
						SELECT COALESCE(SUM(canonical_reserved_byte_length), 0)
						FROM graphics_ingestion_operations
						WHERE id <> ?
					)
			`).bind(
				growthBytes,
				JSON.stringify(capacityOutcome),
				new Date(input.reservedAt).getTime(),
				input.operation.id,
				input.operation.initiatedBy,
				new Date(input.operation.updatedAt).getTime(),
				growthBytes,
				input.operation.id,
			).run();
			if (!result.success)
				throw new Error('Graphics canonical reservation failed');
			const operation = await firstOperation(
				database,
				'id = ? AND initiated_by = ?',
				input.operation.id,
				input.operation.initiatedBy,
			);
			if (result.meta.changes === 1) {
				if (!operation)
					throw new Error('Graphics canonical reservation was not durable');
				return { outcome: 'reserved' as const, operation };
			}
			// The statement is conditional on both the operation's claim and the
			// capacity, so a miss has two very different causes. Telling an author
			// their library is full when another attempt took the operation from under
			// this one sends them to free space that was never the problem, so the two
			// are distinguished before either is reported.
			if (
				!operation
				|| operation.stage !== 'generating-derivatives'
				|| operation.updatedAt !== input.operation.updatedAt
			) {
				return { outcome: 'lost-claim' as const };
			}
			const capacity = await this.getCapacity();
			const availableBytes = capacity.canonical.availableBytes + ownReservedBytes;
			return {
				outcome: 'blocked' as const,
				capacity: {
					resource: 'canonical' as const,
					limitBytes: capacity.canonical.limitBytes,
					usedBytes: capacity.canonical.usedBytes,
					reservedBytes: capacity.canonical.reservedBytes - ownReservedBytes,
					requestedBytes: growthBytes,
					availableBytes,
				},
			};
		},
		async reserveTemplatePackagePublication(input) {
			const growthBytes = Math.max(0, input.growthBytes);
			const currentReservation = await database.prepare(`
				SELECT canonical_reserved_byte_length
				FROM graphics_ingestion_operations
				WHERE id = ? AND initiated_by = ?
			`).bind(
				input.operation.id,
				input.operation.initiatedBy,
			).first<{ canonical_reserved_byte_length: number }>();
			const ownReservedBytes = currentReservation?.canonical_reserved_byte_length ?? 0;
			const before = await this.getCapacity();
			const availableBeforeReservation = before.canonical.availableBytes + ownReservedBytes;
			const capacityOutcome = growthBytes === 0
				? {
						outcome: 'no-canonical-growth' as const,
						growthBytes: 0 as const,
						availableBytes: availableBeforeReservation,
					}
				: {
						outcome: 'canonical-growth-reserved' as const,
						growthBytes,
						availableBytes: Math.max(0, availableBeforeReservation - growthBytes),
					};
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET canonical_reserved_byte_length = ?,
					capacity_outcome = ?,
					updated_at = ?
				WHERE id = ? AND initiated_by = ? AND updated_at = ?
					AND stage = 'generating-derivatives'
					AND ? <= (
						SELECT canonical_limit_bytes
						FROM graphics_capacity_settings
						WHERE id = 1
					) - (
						SELECT COALESCE(SUM(byte_length), 0)
						FROM graphic_asset_contents
						WHERE EXISTS (
							SELECT 1 FROM graphic_asset_revisions
							WHERE content_digest = graphic_asset_contents.digest
						)
							OR EXISTS (
								SELECT 1 FROM graphics_derivatives
								WHERE content_digest = graphic_asset_contents.digest
							)
					) - (
						SELECT COALESCE(SUM(canonical_reserved_byte_length), 0)
						FROM graphics_ingestion_operations
						WHERE id <> ?
					)
			`).bind(
				growthBytes,
				JSON.stringify(capacityOutcome),
				new Date(input.reservedAt).getTime(),
				input.operation.id,
				input.operation.initiatedBy,
				new Date(input.operation.updatedAt).getTime(),
				growthBytes,
				input.operation.id,
			).run();
			if (!result.success)
				throw new Error('Template Package canonical reservation failed');
			const operation = await firstOperation(
				database,
				'id = ? AND initiated_by = ?',
				input.operation.id,
				input.operation.initiatedBy,
			);
			if (result.meta.changes === 1) {
				if (!operation)
					throw new Error('Template Package canonical reservation was not durable');
				return { outcome: 'reserved' as const, operation };
			}
			// The statement is conditional on both the operation's claim and the
			// capacity, so a miss has two very different causes. Telling an author
			// their library is full when in fact another attempt took the operation
			// from under this one sends them to free space that was never the
			// problem, so the two are distinguished before either is reported.
			if (
				!operation
				|| operation.stage !== 'generating-derivatives'
				|| operation.updatedAt !== input.operation.updatedAt
			) {
				return { outcome: 'lost-claim' as const };
			}
			const capacity = await this.getCapacity();
			return {
				outcome: 'blocked' as const,
				capacity: {
					resource: 'canonical' as const,
					limitBytes: capacity.canonical.limitBytes,
					usedBytes: capacity.canonical.usedBytes,
					reservedBytes: capacity.canonical.reservedBytes - ownReservedBytes,
					requestedBytes: growthBytes,
					availableBytes: capacity.canonical.availableBytes + ownReservedBytes,
				},
			};
		},
		async installTemplatePackage(input) {
			const publishedAt = new Date(input.publishedAt).getTime();
			const createdAssetIds = input.created.map(asset => asset.assetId);
			const reusedAssetIds = [...new Set(input.reused.map(asset => asset.assetId))];
			const reusedRevisionIds = [...new Set(input.reused.map(asset => asset.revisionId))];
			await Promise.all([
				...input.created.map(asset => assertContentCompatible(database, {
					digest: asset.sourceDigest,
					byteLength: asset.sourceByteLength,
					canonicalMime: asset.canonicalMime,
				})),
				...input.created.map(asset => assertContentCompatible(database, {
					digest: asset.thumbnailDigest,
					byteLength: asset.thumbnailByteLength,
					canonicalMime: 'image/png',
				})),
			]);

			/**
			 * The one condition every statement in this batch commits against.
			 *
			 * D1 runs a batch as one transaction, but a statement whose own condition
			 * is false simply writes nothing rather than aborting the rest. So
			 * sharing a single condition is what makes the publication all-or-nothing:
			 * either every statement sees it hold, or none does.
			 *
			 * It covers the operation's claim, the exact-origin revisions being
			 * reused, and the local identities about to be created — so a Trash,
			 * retirement, or pruning that commits first, or a generated identity
			 * colliding with the tombstone of a purged one, leaves this installation
			 * writing nothing at all rather than pinning a reference the library no
			 * longer allows or resurrecting an asset a purge retired for good.
			 */
			const guard = `
				EXISTS (
					SELECT 1 FROM graphics_ingestion_operations
					WHERE id = ? AND initiated_by = ? AND stage = 'publishing'
						AND updated_at = ?
				)
				AND (
					SELECT COUNT(*) FROM graphic_assets
					WHERE id IN ${valuesFromJsonArray('?')} AND lifecycle_state = 'active'
				) = ?
				AND (
					SELECT COUNT(*) FROM graphic_asset_revisions
					WHERE id IN ${valuesFromJsonArray('?')}
				) = ?
				AND NOT EXISTS (
					SELECT 1 FROM graphic_asset_tombstones
					WHERE asset_id IN ${valuesFromJsonArray('?')}
				)
			`;
			const guardBindings = [
				input.operation.id,
				input.operation.initiatedBy,
				new Date(input.operation.updatedAt).getTime(),
				boundJsonArray(reusedAssetIds),
				reusedAssetIds.length,
				boundJsonArray(reusedRevisionIds),
				reusedRevisionIds.length,
				boundJsonArray(createdAssetIds),
			];

			// Every list-shaped payload travels as one bound JSON array. A package
			// carries up to 100 packaged revisions, and one placeholder each would
			// pass every local test and then fail on D1's 100-parameter limit.
			const created = JSON.stringify(input.created.map(asset => ({
				assetId: asset.assetId,
				revisionId: asset.revisionId,
				derivativeId: asset.derivativeId,
				name: asset.name,
				kind: asset.kind,
				sourceDigest: asset.sourceDigest,
				sourceByteLength: asset.sourceByteLength,
				canonicalMime: asset.canonicalMime,
				compatibilityProfile: asset.compatibilityProfile,
				facts: asset.facts,
				derivativeKind: asset.derivativeKind,
				thumbnailDigest: asset.thumbnailDigest,
				thumbnailByteLength: asset.thumbnailByteLength,
				sourceAssetId: asset.origin.sourceAssetId,
				sourceRevisionId: asset.origin.sourceRevisionId,
				sourceRevisionNumber: asset.origin.sourceRevisionNumber,
				originDigest: asset.origin.digest,
			})));
			const references = JSON.stringify(input.references);
			const associatedAssetIds = boundJsonArray([
				...new Set([...createdAssetIds, ...reusedAssetIds]),
			]);
			const quarantineDigests = [
				...new Set(input.created.flatMap(asset => [asset.sourceDigest, asset.thumbnailDigest])),
			];

			const completed: GraphicsIngestionOperation = {
				...input.operation,
				stage: 'completed',
				failure: undefined,
				templatePackageInstallation: templatePackageInstallationResult(input),
				updatedAt: input.publishedAt,
			};

			/**
			 * One statement, and the number of rows it must write.
			 *
			 * The guard makes the batch all-or-nothing, but "all" still has to mean
			 * every row. A statement whose count the payload decides is checked
			 * against that count, which is what makes the guard something the
			 * transaction proves rather than something these comments assert.
			 * `undefined` marks the statements whose count legitimately varies —
			 * shared content and repeated Event associations both write fewer rows
			 * than the payload has entries.
			 */
			const planned: { statement: D1PreparedStatement; expectedChanges?: number }[] = [
				{
					statement: database.prepare(`
						INSERT OR IGNORE INTO graphic_asset_contents (
							digest, byte_length, canonical_mime, availability, created_at
						)
						SELECT json_extract(value, '$.sourceDigest'),
							json_extract(value, '$.sourceByteLength'),
							json_extract(value, '$.canonicalMime'), 'available', ?
						FROM json_each(?)
						WHERE ${guard}
					`).bind(publishedAt, created, ...guardBindings),
				},
				{
					statement: database.prepare(`
						INSERT OR IGNORE INTO graphic_asset_contents (
							digest, byte_length, canonical_mime, availability, created_at
						)
						SELECT json_extract(value, '$.thumbnailDigest'),
							json_extract(value, '$.thumbnailByteLength'), 'image/png', 'available', ?
						FROM json_each(?)
						WHERE ${guard}
					`).bind(publishedAt, created, ...guardBindings),
				},
				{
					statement: database.prepare(`
						INSERT INTO graphic_assets (id, name, kind, lifecycle_state, created_at, updated_at)
						SELECT json_extract(value, '$.assetId'), json_extract(value, '$.name'),
							json_extract(value, '$.kind'), 'active', ?, ?
						FROM json_each(?)
						WHERE ${guard}
					`).bind(publishedAt, publishedAt, created, ...guardBindings),
					expectedChanges: input.created.length,
				},
				{
					statement: database.prepare(`
						INSERT INTO graphic_asset_revisions (
							id, asset_id, revision_number, content_digest,
							compatibility_profile, technical_facts, created_at
						)
						SELECT json_extract(value, '$.revisionId'), json_extract(value, '$.assetId'), 1,
							json_extract(value, '$.sourceDigest'),
							json_extract(value, '$.compatibilityProfile'),
							json_extract(value, '$.facts'), ?
						FROM json_each(?)
						WHERE ${guard}
					`).bind(publishedAt, created, ...guardBindings),
					expectedChanges: input.created.length,
				},
				{
					// Graphic Asset Origin is written exactly once, on the revision
					// this installation created. It is never rewritten: a package
					// claiming an origin already recorded with different content was
					// rejected at preflight rather than allowed to update one here.
					// The ignore is the backstop, and the expected count is what
					// proves it never had to fire.
					statement: database.prepare(`
						INSERT OR IGNORE INTO graphic_asset_origins (
							revision_id, asset_id, source_asset_id, source_revision_id,
							source_revision_number, digest, created_at
						)
						SELECT json_extract(value, '$.revisionId'), json_extract(value, '$.assetId'),
							json_extract(value, '$.sourceAssetId'), json_extract(value, '$.sourceRevisionId'),
							json_extract(value, '$.sourceRevisionNumber'), json_extract(value, '$.originDigest'), ?
						FROM json_each(?)
						WHERE ${guard}
					`).bind(publishedAt, created, ...guardBindings),
					expectedChanges: input.created.length,
				},
				{
					statement: database.prepare(`
						INSERT INTO graphics_derivatives (
							id, source_revision_id, kind, content_digest, created_at
						)
						SELECT json_extract(value, '$.derivativeId'), json_extract(value, '$.revisionId'),
							json_extract(value, '$.derivativeKind'), json_extract(value, '$.thumbnailDigest'), ?
						FROM json_each(?)
						WHERE ${guard}
					`).bind(publishedAt, created, ...guardBindings),
					expectedChanges: input.created.length,
				},
				...(input.operation.defaultEventId === undefined
					? []
					// An installation run inside an Event associates everything it
					// touched with that Event. The association organises discovery and
					// adds nothing to a reused asset's own metadata.
					: [{
							statement: database.prepare(`
								INSERT OR IGNORE INTO graphic_asset_event_associations (asset_id, event_id, created_at)
								SELECT value, ?, ?
								FROM json_each(?)
								WHERE ${guard}
							`).bind(
								input.operation.defaultEventId,
								publishedAt,
								associatedAssetIds,
								...guardBindings,
							),
						}]),
				{
					// The rewritten references pin exactly the revisions this
					// transaction created or proved, so the join is the proof that no
					// reference can name a revision that does not resolve — and the
					// expected count is the proof that every one of them did.
					//
					// They carry no Event context, unlike a Screen's. An Installed
					// Graphics Template belongs to the installation-wide library rather
					// than to the Event whose workflow happened to install it, and
					// deleting an Event removes the references scoped to it — which
					// would quietly strip a library Template of the pins its own
					// document depends on. Which Event the installation ran inside is
					// recorded on the Template instead.
					statement: database.prepare(`
						INSERT INTO graphic_asset_references (
							id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
							event_id, created_at, updated_at
						)
						SELECT json_extract(reference.value, '$.id'),
							json_extract(reference.value, '$.assetId'),
							json_extract(reference.value, '$.revisionId'),
							'installed-graphics-template', ?,
							json_extract(reference.value, '$.ownerSlot'), NULL, ?, ?
						FROM json_each(?) AS reference
						JOIN graphic_asset_revisions revision
							ON revision.id = json_extract(reference.value, '$.revisionId')
							AND revision.asset_id = json_extract(reference.value, '$.assetId')
						WHERE ${guard}
					`).bind(
						input.template.id,
						publishedAt,
						publishedAt,
						references,
						...guardBindings,
					),
					expectedChanges: input.references.length,
				},
				{
					statement: database.prepare(`
						INSERT INTO installed_graphics_templates (
							id, kind, name, revision_number, document, source_template_identity,
							source_template_revision, installed_by_operation_id, event_id,
							created_at, updated_at
						)
						SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
						WHERE ${guard}
					`).bind(
						input.template.id,
						input.template.kind,
						input.template.name,
						INSTALLED_GRAPHICS_TEMPLATE_FIRST_REVISION,
						JSON.stringify(input.template.document),
						input.template.sourceTemplateIdentity,
						input.template.sourceTemplateRevision ?? null,
						input.operation.id,
						input.operation.defaultEventId ?? null,
						publishedAt,
						publishedAt,
						...guardBindings,
					),
					expectedChanges: 1,
				},
				// Both of these reclaim state only a publication that actually
				// happened has the right to reclaim, so both carry the guard. A failed
				// publication that cleared its own write candidates would hand its
				// unreachable bytes to the generic sweep instead of the candidate
				// machinery built to collect them, and one that released a quarantine
				// would restart a seven-day clock on content still unreachable.
				{
					statement: releaseContentQuarantineStatement(database, quarantineDigests, {
						guard,
						bindings: guardBindings,
					}),
				},
				{
					statement: database.prepare(`
						DELETE FROM graphics_canonical_write_candidates
						WHERE operation_id = ? AND ${guard}
					`).bind(input.operation.id, ...guardBindings),
				},
				{
					statement: updateOperationStatement(
						database,
						completed,
						input.operation.updatedAt,
						`AND ${guard}`,
						guardBindings,
					),
					expectedChanges: 1,
				},
			];

			const results = await database.batch(
				planned.map(entry => entry.statement) as [D1PreparedStatement, ...D1PreparedStatement[]],
			);
			if (results.some(result => !result.success))
				throw new Error('Template Package installation transaction failed');
			// The terminal transition is last, so its count is the one that answers
			// whether the guard held at all. Losing it means nothing committed.
			if (results.at(-1)?.meta.changes !== 1)
				throw new Error('Template Package installation lost its claim before publishing');
			const shortfall = planned.findIndex((entry, index) =>
				entry.expectedChanges !== undefined
				&& results[index]?.meta.changes !== entry.expectedChanges,
			);
			if (shortfall !== -1) {
				throw new Error(
					`Template Package installation wrote ${
						results[shortfall]?.meta.changes
					} of ${planned[shortfall]?.expectedChanges} expected rows`,
				);
			}
			const authoritative = await firstOperation(
				database,
				'id = ? AND initiated_by = ?',
				input.operation.id,
				input.operation.initiatedBy,
			);
			if (!authoritative || authoritative.stage !== 'completed')
				throw new Error('Template Package installation was not durable');
			return authoritative;
		},
		async findInstalledGraphicsTemplate(templateId) {
			const row = await database.prepare(`
				SELECT template.id, template.kind, template.name, template.revision_number,
					template.document, template.source_template_identity,
					template.source_template_revision,
					template.installed_by_operation_id, template.event_id, template.created_at,
					COALESCE((
						SELECT json_group_array(json_object(
							'ownerSlot', reference.owner_slot,
							'assetId', reference.asset_id,
							'revisionId', reference.revision_id
						))
						FROM (
							SELECT owner_slot, asset_id, revision_id
							FROM graphic_asset_references
							WHERE owner_kind = 'installed-graphics-template'
								AND owner_id = template.id
							ORDER BY owner_slot
						) reference
					), '[]') AS template_references
				FROM installed_graphics_templates template
				WHERE template.id = ?
			`).bind(templateId).first<{
				id: string;
				kind: InstalledGraphicsTemplateKind;
				name: string;
				revision_number: number;
				document: string;
				source_template_identity: string;
				source_template_revision: number | null;
				installed_by_operation_id: string;
				event_id: number | null;
				created_at: number;
				template_references: string;
			}>();
			if (!row)
				return undefined;
			return {
				id: row.id as InstalledGraphicsTemplateId,
				kind: row.kind,
				name: row.name,
				revisionNumber: row.revision_number,
				document: JSON.parse(row.document),
				sourceTemplateIdentity: row.source_template_identity,
				sourceTemplateRevision: row.source_template_revision ?? undefined,
				installedByOperationId: row.installed_by_operation_id as GraphicsIngestionOperationId,
				eventId: row.event_id ?? undefined,
				references: (JSON.parse(row.template_references) as {
					ownerSlot: string;
					assetId: GraphicAssetId;
					revisionId: GraphicAssetRevisionId;
				}[]).map(reference => ({
					ownerSlot: reference.ownerSlot,
					reference: {
						assetId: reference.assetId,
						revisionId: reference.revisionId,
					},
				})),
				installedAt: new Date(row.created_at).toISOString(),
			};
		},
		async listInstalledGraphicsTemplates(kind) {
			const { results } = await database.prepare(`
				SELECT id, kind, name, revision_number, document, source_template_identity,
					source_template_revision, installed_by_operation_id, event_id, created_at
				FROM installed_graphics_templates
				WHERE kind = ?
				ORDER BY name, id
			`).bind(kind).all<{
				id: string;
				kind: InstalledGraphicsTemplateKind;
				name: string;
				revision_number: number;
				document: string;
				source_template_identity: string;
				source_template_revision: number | null;
				installed_by_operation_id: string;
				event_id: number | null;
				created_at: number;
			}>();
			return results.map(row => ({
				id: row.id as InstalledGraphicsTemplateId,
				kind: row.kind,
				name: row.name,
				revisionNumber: row.revision_number,
				document: JSON.parse(row.document),
				sourceTemplateIdentity: row.source_template_identity,
				sourceTemplateRevision: row.source_template_revision ?? undefined,
				installedByOperationId: row.installed_by_operation_id as GraphicsIngestionOperationId,
				eventId: row.event_id ?? undefined,
				installedAt: new Date(row.created_at).toISOString(),
			}));
		},
		async getIngestionOperation(operationId, initiatedBy) {
			return await firstOperation(database, 'id = ? AND initiated_by = ?', operationId, initiatedBy);
		},
		async getGraphicAssetMultipartState(operationId, initiatedBy) {
			const row = await database.prepare(`
				SELECT multipart_state
				FROM graphics_ingestion_operations
				WHERE id = ? AND initiated_by = ?
			`).bind(operationId, initiatedBy).first<{ multipart_state: string | null }>();
			return row?.multipart_state
				? JSON.parse(row.multipart_state) as GraphicsAssetMultipartState
				: undefined;
		},
		async updateGraphicAssetMultipartState(input) {
			if (input.state.version !== input.expectedVersion + 1)
				return false;
			const completedByteLength = graphicsMultipartCompletedByteLength(input.state);
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET multipart_state = ?, stage = 'transferring',
					transferred_byte_length = ?, updated_at = ?
				WHERE id = ? AND initiated_by = ?
					AND stage IN ('created', 'transferring')
					AND COALESCE(
						CAST(json_extract(multipart_state, '$.version') AS INTEGER),
						0
					) = ?
			`).bind(
				JSON.stringify(input.state),
				completedByteLength,
				new Date(input.updatedAt).getTime(),
				input.operationId,
				input.initiatedBy,
				input.expectedVersion,
			).run();
			return result.success && result.meta.changes === 1;
		},
		async checkpointRemoteCopyMultipartUpload(input) {
			// A remote copy has no client parts to record, so the checkpoint carries
			// the uploadId alone. Taking one is confined to a running copy; clearing
			// one stays legal from any stage, because by then the upload it named is
			// already completed or aborted.
			const state: GraphicsAssetMultipartState | null = input.uploadId
				? { version: 1, uploadId: input.uploadId, cleanupPending: false, parts: [] }
				: null;
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET multipart_state = ?
				WHERE id = ? AND initiated_by = ?
					AND source = 'remote-copy'
					AND (? IS NULL OR stage IN ('created', 'transferring'))
			`).bind(
				state && JSON.stringify(state),
				input.operationId,
				input.initiatedBy,
				input.uploadId ?? null,
			).run();
			// An unwritten checkpoint would strand the upload it was meant to name,
			// so the copy must not continue past a failed write.
			if (!result.success)
				throw new Error('Remote Graphic Asset copy multipart checkpoint could not be recorded');
		},
		async getTemplatePackagePreflight(operationId, initiatedBy) {
			const row = await database.prepare(`
				SELECT package_preflight
				FROM graphics_ingestion_operations
				WHERE id = ? AND initiated_by = ? AND source = 'template-package'
			`).bind(operationId, initiatedBy).first<{ package_preflight: string | null }>();
			return parseJson<TemplatePackagePreflightState>(row?.package_preflight ?? null);
		},
		async updateTemplatePackagePreflight(input) {
			// A terminal operation keeps whatever proposal it ended with: writing a
			// fresh report onto a cancelled or completed package would resurrect a
			// proposal its author already disposed of.
			//
			// The operation's own `updated_at` is deliberately untouched. It is the
			// claim the following stage transition is made against, and the
			// transition is what publishes this checkpoint; moving it here would
			// invalidate that claim and strand the operation mid-preflight.
			// `awaiting-installation` is excluded for the same reason: a retry that
			// finishes after the author confirmed must not overwrite the proposal
			// they accepted with a freshly derived one.
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET package_preflight = ?
				WHERE id = ? AND initiated_by = ? AND source = 'template-package'
					AND stage NOT IN ('completed', 'cancelled', 'awaiting-installation')
			`).bind(
				JSON.stringify(input.state),
				input.operationId,
				input.initiatedBy,
			).run();
			if (!result.success)
				throw new Error('Template Package preflight checkpoint could not be recorded');
			return result.meta.changes === 1;
		},
		async confirmTemplatePackagePreflight(input) {
			// One statement records the confirmation and readies the operation,
			// conditional on the exact report still being the paused one. A retry
			// that replaced the report, or that is still mid-flight, fails this
			// compare-and-set rather than being silently overwritten.
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET package_preflight = json_set(
						json_set(package_preflight, '$.confirmedFingerprint', ?),
						'$.confirmedAt', ?
					),
					stage = 'awaiting-installation',
					failure = NULL,
					updated_at = ?
				WHERE id = ? AND initiated_by = ? AND source = 'template-package'
					AND stage = 'awaiting-confirmation'
					AND json_extract(package_preflight, '$.report.fingerprint') = ?
			`).bind(
				input.fingerprint,
				input.confirmedAt,
				new Date(input.updatedAt).getTime(),
				input.operationId,
				input.initiatedBy,
				input.fingerprint,
			).run();
			if (!result.success)
				throw new Error('Template Package confirmation could not be recorded');
			return result.meta.changes === 1;
		},
		async findTemplatePackageOriginCandidates(input) {
			// A package can name a source this installation already holds in two
			// ways: it was exported from here, so the source identity is a local
			// identity; or it was imported here before, so a local revision records
			// that source as its Graphic Asset Origin. Both are the same exact
			// provenance and both reuse the same local revision.
			const exact = await database.prepare(`
				SELECT r.id AS revision_id, r.asset_id, r.content_digest, a.name,
					a.lifecycle_state
				FROM graphic_asset_revisions r
				JOIN graphic_assets a ON a.id = r.asset_id
				WHERE r.id = ? AND r.asset_id = ?
				UNION ALL
				SELECT r.id AS revision_id, r.asset_id, r.content_digest, a.name,
					a.lifecycle_state
				FROM graphic_asset_origins o
				JOIN graphic_asset_revisions r ON r.id = o.revision_id
				JOIN graphic_assets a ON a.id = r.asset_id
				WHERE o.source_asset_id = ? AND o.source_revision_id = ?
				LIMIT 1
			`).bind(
				input.sourceRevisionId,
				input.sourceAssetId,
				input.sourceAssetId,
				input.sourceRevisionId,
			).first<{
				revision_id: string;
				asset_id: string;
				content_digest: string;
				name: string;
				lifecycle_state: GraphicAssetLifecycleState;
			}>();
			// A related revision is the same source identity at another source
			// revision. It never reuses a local revision, but it does mean this
			// package is a further revision of something already known here.
			const related = await database.prepare(`
				SELECT 1 AS present
				FROM graphic_asset_revisions r
				WHERE r.asset_id = ? AND r.id <> ?
				UNION ALL
				SELECT 1 AS present
				FROM graphic_asset_origins o
				WHERE o.source_asset_id = ? AND o.source_revision_id <> ?
				LIMIT 1
			`).bind(
				input.sourceAssetId,
				input.sourceRevisionId,
				input.sourceAssetId,
				input.sourceRevisionId,
			).first<{ present: number }>();
			return {
				exact: exact
					? {
							reference: {
								assetId: exact.asset_id as GraphicAssetId,
								revisionId: exact.revision_id as GraphicAssetRevisionId,
							},
							digest: exact.content_digest,
							name: exact.name,
							lifecycleState: exact.lifecycle_state,
						}
					: undefined,
				relatedRevisionExists: related !== null,
			};
		},
		async findGraphicAssetByContentDigest(digest) {
			const row = await database.prepare(`
				SELECT a.id AS asset_id, r.id AS revision_id, a.name
				FROM graphic_assets a
				JOIN graphic_asset_revisions r ON r.asset_id = a.id
				WHERE r.content_digest = ?
				ORDER BY a.created_at, a.id, r.revision_number DESC
				LIMIT 1
			`).bind(digest).first<{ asset_id: string; revision_id: string; name: string }>();
			return row
				? {
						assetId: row.asset_id as GraphicAssetId,
						revisionId: row.revision_id as GraphicAssetRevisionId,
						name: row.name,
					}
				: undefined;
		},
		async recordGraphicAssetMultipartCleanupComplete(operationId, initiatedBy) {
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET multipart_state = json_set(
					multipart_state,
					'$.cleanupPending',
					json('false')
				)
				WHERE id = ? AND initiated_by = ? AND stage = 'cancelled'
					AND multipart_state IS NOT NULL
			`).bind(operationId, initiatedBy).run();
			if (!result.success)
				throw new Error('Graphics multipart cleanup checkpoint could not be recorded');
		},
		async updateIngestionOperation(operation, expectedUpdatedAt) {
			const result = await updateOperationStatement(database, operation, expectedUpdatedAt).run();
			if (!result.success)
				throw new Error('Graphics Ingestion Operation update failed');
			const authoritative = await firstOperation(
				database,
				'id = ? AND initiated_by = ?',
				operation.id,
				operation.initiatedBy,
			);
			if (!authoritative)
				throw new Error('Graphics Ingestion Operation update was not durable');
			if (
				result.meta.changes !== 1
				&& authoritative.stage !== 'cancelled'
				&& authoritative.stage !== 'completed'
			) {
				throw new Error('Graphics Ingestion Operation update lost its durable transition');
			}
			return authoritative;
		},
		async claimGraphicsIngestion(input) {
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET stage = 'hashing', updated_at = ?
				WHERE id = ? AND initiated_by = ? AND updated_at = ?
					AND (
						(stage = 'failed' AND json_extract(failure, '$.retryable') = 1)
						-- A confirmed Template Package proposal is resting rather than
						-- running, so claiming it needs no staleness proof: the
						-- compare-and-set above already settles which caller has it.
						OR stage = 'awaiting-installation'
						OR (
							stage IN (
								'transferring', 'hashing', 'validating',
								'generating-derivatives', 'awaiting-confirmation', 'publishing'
							)
							AND updated_at <= ?
						)
					)
			`).bind(
				new Date(input.claimedAt).getTime(),
				input.operation.id,
				input.operation.initiatedBy,
				new Date(input.operation.updatedAt).getTime(),
				new Date(input.staleBefore).getTime(),
			).run();
			if (!result.success || result.meta.changes !== 1)
				return undefined;
			return await firstOperation(
				database,
				'id = ? AND initiated_by = ?',
				input.operation.id,
				input.operation.initiatedBy,
			);
		},
		async findReusableGraphicAsset(sourceDigest) {
			const row = await database.prepare(`
				SELECT a.id AS asset_id, r.id AS revision_id
				FROM graphic_assets a
				JOIN graphic_asset_revisions r ON r.asset_id = a.id
				WHERE a.lifecycle_state = 'active' AND r.content_digest = ?
				ORDER BY a.created_at, a.id, r.revision_number DESC
				LIMIT 1
			`).bind(sourceDigest).first<{ asset_id: string; revision_id: string }>();
			return row
				? {
						assetId: row.asset_id as GraphicAssetId,
						revisionId: row.revision_id as GraphicAsset['revisionId'],
					}
				: undefined;
		},
		async findCurrentGraphicAsset(assetId) {
			const row = await database.prepare(`
				SELECT a.id AS asset_id, r.id AS revision_id, r.content_digest
				FROM graphic_assets a
				JOIN graphic_asset_revisions r ON r.asset_id = a.id
				WHERE a.id = ? AND a.lifecycle_state = 'active'
				ORDER BY r.revision_number DESC
				LIMIT 1
			`).bind(assetId).first<{
				asset_id: string;
				revision_id: string;
				content_digest: string;
			}>();
			return row
				? {
						assetId: row.asset_id as GraphicAssetId,
						revisionId: row.revision_id as GraphicAssetRevisionId,
						sourceDigest: row.content_digest,
					}
				: undefined;
		},
		async reuseGraphicAsset(input) {
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
			const updateOperation = updateOperationStatement(
				database,
				completed,
				input.operation.updatedAt,
			);
			const clearWriteCandidates = database.prepare(`
				DELETE FROM graphics_canonical_write_candidates WHERE operation_id = ?
			`).bind(input.operation.id);
			const statements: [D1PreparedStatement, ...D1PreparedStatement[]]
				= input.operation.defaultEventId === undefined
					? [clearWriteCandidates, updateOperation]
					: [database.prepare(`
							INSERT OR IGNORE INTO graphic_asset_event_associations (asset_id, event_id, created_at)
							SELECT ?, ?, ?
							WHERE EXISTS (
								SELECT 1 FROM graphics_ingestion_operations
								WHERE id = ? AND initiated_by = ? AND stage = 'publishing'
									AND updated_at = ?
							)
						`).bind(
							input.reusable.assetId,
							input.operation.defaultEventId,
							new Date(input.publishedAt).getTime(),
							input.operation.id,
							input.operation.initiatedBy,
							new Date(input.operation.updatedAt).getTime(),
						), clearWriteCandidates, updateOperation];
			const results = await database.batch(statements);
			if (results.some(result => !result.success))
				throw new Error('Graphic Asset reuse transaction failed');
			const authoritative = await firstOperation(
				database,
				'id = ? AND initiated_by = ?',
				input.operation.id,
				input.operation.initiatedBy,
			);
			if (!authoritative || authoritative.stage !== 'completed')
				throw new Error('Graphic Asset reuse was not durable');
			return authoritative;
		},
		async completeGraphicAssetReplacementNoop(input) {
			const completed = completedGraphicAssetReplacementOperation({
				operation: input.operation,
				outcome: 'replacement-noop',
				assetId: input.current.assetId,
				revisionId: input.current.revisionId,
				completedAt: input.completedAt,
			});
			const results = await database.batch([
				database.prepare(`
					DELETE FROM graphics_canonical_write_candidates WHERE operation_id = ?
				`).bind(input.operation.id),
				updateOperationStatement(
					database,
					completed,
					input.operation.updatedAt,
					`AND EXISTS (
						SELECT 1
						FROM graphic_assets target
						JOIN graphic_asset_revisions current_revision
							ON current_revision.asset_id = target.id
						WHERE target.id = ? AND target.lifecycle_state = 'active'
							AND current_revision.revision_number = (
								SELECT MAX(latest.revision_number)
								FROM graphic_asset_revisions latest
								WHERE latest.asset_id = target.id
							)
							AND current_revision.content_digest = ?
					)`,
					[input.current.assetId, input.current.sourceDigest],
				),
			]);
			if (results.some(result => !result.success) || results[1]?.meta.changes !== 1)
				throw new Error('Graphic Asset replacement no-op transaction failed');
			const authoritative = await firstOperation(
				database,
				'id = ? AND initiated_by = ?',
				input.operation.id,
				input.operation.initiatedBy,
			);
			if (!authoritative)
				throw new Error('Graphic Asset replacement no-op was not durable');
			return authoritative;
		},
		async publishGraphicAssetReplacement(input) {
			await Promise.all([
				assertContentCompatible(database, {
					digest: input.sourceDigest,
					byteLength: input.report.facts.byteLength,
					canonicalMime: input.report.facts.canonicalMime,
				}),
				assertContentCompatible(database, {
					digest: input.thumbnailDigest,
					byteLength: input.thumbnailByteLength,
					canonicalMime: 'image/png',
				}),
			]);
			const publishedAt = new Date(input.publishedAt).getTime();

			/**
			 * What it means for this replacement to have happened at all.
			 *
			 * The statements that write a revision, its derivative, and the pruning
			 * deadline of the revision it supersedes each carry their own condition,
			 * because a replacement whose bytes match the current revision is a
			 * legitimate no-op rather than a failure. This is the condition underneath
			 * all of them: the operation still holds its claim on this target, and the
			 * target is still an asset a revision may be published for.
			 */
			const guard = `
				EXISTS (
					SELECT 1 FROM graphics_ingestion_operations
					WHERE id = ? AND initiated_by = ? AND stage = 'publishing'
						AND updated_at = ? AND target_asset_id = ?
				)
				AND EXISTS (
					SELECT 1 FROM graphic_assets
					WHERE id = ? AND lifecycle_state = 'active'
				)
			`;
			const guardBindings = [
				input.operation.id,
				input.operation.initiatedBy,
				new Date(input.operation.updatedAt).getTime(),
				input.targetAssetId,
				input.targetAssetId,
			];

			const results = await database.batch([
				database.prepare(`
					INSERT OR IGNORE INTO graphic_asset_contents (
						digest, byte_length, canonical_mime, availability, created_at
					)
					SELECT ?, ?, ?, 'available', ?
					WHERE ${guard}
				`).bind(
					input.sourceDigest,
					input.report.facts.byteLength,
					input.report.facts.canonicalMime,
					publishedAt,
					...guardBindings,
				),
				database.prepare(`
					INSERT OR IGNORE INTO graphic_asset_contents (
						digest, byte_length, canonical_mime, availability, created_at
					)
					SELECT ?, ?, 'image/png', 'available', ?
					WHERE ${guard}
				`).bind(
					input.thumbnailDigest,
					input.thumbnailByteLength,
					publishedAt,
					...guardBindings,
				),
				database.prepare(`
					INSERT INTO graphic_asset_revisions (
						id, asset_id, revision_number, content_digest,
						compatibility_profile, technical_facts, created_at
					)
					SELECT ?, target.id, (
						SELECT COALESCE(MAX(revision_number), 0) + 1
						FROM graphic_asset_revisions
						WHERE asset_id = target.id
					), ?, ?, ?, ?
					FROM graphic_assets target
					WHERE target.id = ? AND target.lifecycle_state = 'active'
						AND NOT EXISTS (
							SELECT 1
							FROM graphic_asset_revisions current_revision
							WHERE current_revision.asset_id = target.id
								AND current_revision.revision_number = (
									SELECT MAX(latest.revision_number)
									FROM graphic_asset_revisions latest
									WHERE latest.asset_id = target.id
								)
								AND current_revision.content_digest = ?
						)
						AND EXISTS (
							SELECT 1 FROM graphics_ingestion_operations
							WHERE id = ? AND initiated_by = ? AND stage = 'publishing'
								AND updated_at = ? AND target_asset_id = target.id
						)
				`).bind(
					input.revisionId,
					input.sourceDigest,
					input.report.compatibilityProfile,
					JSON.stringify(input.report.facts),
					publishedAt,
					input.targetAssetId,
					input.sourceDigest,
					input.operation.id,
					input.operation.initiatedBy,
					new Date(input.operation.updatedAt).getTime(),
				),
				database.prepare(`
					INSERT INTO graphics_derivatives (
						id, source_revision_id, kind, content_digest, created_at
					)
					SELECT ?, revision.id, ?, ?, ?
					FROM graphic_asset_revisions revision
					WHERE revision.id = ?
				`).bind(
					input.derivativeId,
					input.report.facts.kind === 'silent-video' ? 'video-poster' : 'thumbnail',
					input.thumbnailDigest,
					publishedAt,
					input.revisionId,
				),
				database.prepare(`
					UPDATE graphic_assets SET kind = ?, updated_at = ?
					WHERE id = ? AND EXISTS (
						SELECT 1 FROM graphic_asset_revisions WHERE id = ?
					)
				`).bind(
					input.report.facts.kind,
					publishedAt,
					input.targetAssetId,
					input.revisionId,
				),
				// Supersession is the exact instant an unreferenced revision's
				// 90-day recovery window starts, so the deadline is authored here
				// rather than drifting to whenever a sweep first observes it.
				database.prepare(`
					INSERT OR IGNORE INTO graphic_asset_revision_retention (
						revision_id, unreferenced_since, prune_after,
						frozen_at, frozen_remaining_milliseconds, created_at
					)
					SELECT superseded.id, ?, ?, NULL, NULL, ?
					FROM graphic_asset_revisions superseded
					WHERE superseded.asset_id = ?
						AND EXISTS (
							SELECT 1 FROM graphic_asset_revisions created WHERE created.id = ?
						)
						AND superseded.revision_number < (
							SELECT MAX(latest.revision_number)
							FROM graphic_asset_revisions latest
							WHERE latest.asset_id = superseded.asset_id
						)
						AND NOT EXISTS (
							SELECT 1 FROM graphic_asset_references reference
							WHERE reference.revision_id = superseded.id
						)
				`).bind(
					publishedAt,
					publishedAt + GRAPHICS_RETENTION_GUARANTEES.supersededRevisionMilliseconds,
					publishedAt,
					input.targetAssetId,
					input.revisionId,
				),
				// Both of these reclaim state only a replacement that actually happened
				// has the right to reclaim, so both carry the guard. A failed publication
				// that cleared its own write candidates would hand its unreachable bytes to
				// the generic sweep instead of the candidate machinery built to collect
				// them, and one that released a quarantine would restart a seven-day clock
				// on content still unreachable.
				releaseContentQuarantineStatement(
					database,
					[input.sourceDigest, input.thumbnailDigest],
					{ guard, bindings: guardBindings },
				),
				database.prepare(`
					DELETE FROM graphics_canonical_write_candidates
					WHERE operation_id = ? AND ${guard}
				`).bind(input.operation.id, ...guardBindings),
				database.prepare(`
					UPDATE graphics_ingestion_operations
					SET stage = 'completed',
						result = json_object(
							'outcome', CASE
								WHEN EXISTS (
									SELECT 1 FROM graphic_asset_revisions WHERE id = ?
								) THEN 'revision-created'
								ELSE 'replacement-noop'
							END,
							'assetId', ?,
							'revisionId', COALESCE(
								(
									SELECT id
									FROM graphic_asset_revisions
									WHERE id = ?
								),
								(
									SELECT current_revision.id
									FROM graphic_asset_revisions current_revision
									WHERE current_revision.asset_id = ?
									ORDER BY current_revision.revision_number DESC
									LIMIT 1
								)
							)
						),
						failure = NULL,
						staging_reserved_byte_length = 0,
						staging_used_byte_length = 0,
						canonical_reserved_byte_length = 0,
						updated_at = ?
					WHERE id = ? AND ${guard}
				`).bind(
					input.revisionId,
					input.targetAssetId,
					input.revisionId,
					input.targetAssetId,
					publishedAt,
					input.operation.id,
					...guardBindings,
				),
			]);
			if (
				results.some(result => !result.success)
				|| results.at(-1)?.meta.changes !== 1
			) {
				throw new Error('Graphic Asset replacement publication transaction failed');
			}
			const authoritative = await firstOperation(
				database,
				'id = ? AND initiated_by = ?',
				input.operation.id,
				input.operation.initiatedBy,
			);
			if (!authoritative)
				throw new Error('Graphic Asset replacement publication was not durable');
			return authoritative;
		},
		async publishGraphicAsset(input: PublishGraphicAssetCatalogueInput) {
			await Promise.all([
				assertContentCompatible(database, {
					digest: input.sourceDigest,
					byteLength: input.report.facts.byteLength,
					canonicalMime: input.report.facts.canonicalMime,
				}),
				assertContentCompatible(database, {
					digest: input.thumbnailDigest,
					byteLength: input.thumbnailByteLength,
					canonicalMime: 'image/png',
				}),
			]);

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

			/**
			 * The one condition every statement in this batch commits against.
			 *
			 * D1 runs a batch as one transaction, but a statement whose own condition
			 * is false simply writes nothing rather than aborting the rest, so sharing
			 * one condition is what makes the publication all-or-nothing: either every
			 * statement sees it hold, or none does.
			 *
			 * It covers the operation's claim, the tombstone of a purged identity the
			 * generated one could collide with, and — for an author who asked to reuse
			 * matching content — whether another attempt has already made an active
			 * asset out of these bytes. The asset this batch is creating is excluded
			 * from that last check, because every statement after the insert would
			 * otherwise read the publication in progress as the duplicate to refuse.
			 */
			const guard = `
				EXISTS (
					SELECT 1 FROM graphics_ingestion_operations
					WHERE id = ? AND initiated_by = ? AND stage = 'publishing'
						AND updated_at = ?
				)
				AND NOT EXISTS (
					SELECT 1 FROM graphic_asset_tombstones WHERE asset_id = ?
				)
				AND (
					? = 'create-separate'
					OR NOT EXISTS (
						SELECT 1
						FROM graphic_assets existing_asset
						JOIN graphic_asset_revisions existing_revision
							ON existing_revision.asset_id = existing_asset.id
						WHERE existing_asset.id <> ?
							AND existing_asset.lifecycle_state = 'active'
							AND existing_revision.content_digest = ?
					)
				)
			`;
			const guardBindings = [
				input.operation.id,
				input.operation.initiatedBy,
				new Date(input.operation.updatedAt).getTime(),
				input.assetId,
				input.operation.duplicateContentPolicy,
				input.assetId,
				input.sourceDigest,
			];

			const statements = [
				database.prepare(`
					INSERT OR IGNORE INTO graphic_asset_contents (
						digest, byte_length, canonical_mime, availability, created_at
					)
					SELECT ?, ?, ?, 'available', ?
					WHERE ${guard}
				`).bind(
					input.sourceDigest,
					input.report.facts.byteLength,
					input.report.facts.canonicalMime,
					new Date(input.publishedAt).getTime(),
					...guardBindings,
				),
				database.prepare(`
					INSERT OR IGNORE INTO graphic_asset_contents (
						digest, byte_length, canonical_mime, availability, created_at
					)
					SELECT ?, ?, 'image/png', 'available', ?
					WHERE ${guard}
				`).bind(
					input.thumbnailDigest,
					input.thumbnailByteLength,
					new Date(input.publishedAt).getTime(),
					...guardBindings,
				),
				database.prepare(`
					INSERT INTO graphic_assets (id, name, kind, lifecycle_state, created_at, updated_at)
					SELECT ?, ?, ?, 'active', ?, ?
					WHERE ${guard}
				`).bind(
					input.assetId,
					input.operation.name,
					input.report.facts.kind,
					new Date(input.publishedAt).getTime(),
					new Date(input.publishedAt).getTime(),
					...guardBindings,
				),
				database.prepare(`
					INSERT INTO graphic_asset_revisions (
						id, asset_id, revision_number, content_digest,
						compatibility_profile, technical_facts, created_at
					)
					SELECT ?, ?, 1, ?, ?, ?, ?
					WHERE ${guard}
				`).bind(
					input.revisionId,
					input.assetId,
					input.sourceDigest,
					input.report.compatibilityProfile,
					JSON.stringify(input.report.facts),
					new Date(input.publishedAt).getTime(),
					...guardBindings,
				),
				database.prepare(`
					INSERT INTO graphics_derivatives (
						id, source_revision_id, kind, content_digest, created_at
					)
					SELECT ?, ?, ?, ?, ?
					WHERE ${guard}
				`).bind(
					input.derivativeId,
					input.revisionId,
					input.report.facts.kind === 'font'
						? 'font-specimen'
						: input.report.facts.kind === 'silent-video'
							? 'video-poster'
							: 'thumbnail',
					input.thumbnailDigest,
					new Date(input.publishedAt).getTime(),
					...guardBindings,
				),
				...(input.operation.defaultEventId === undefined
					? []
					: [database.prepare(`
							INSERT INTO graphic_asset_event_associations (asset_id, event_id, created_at)
							SELECT ?, ?, ?
							WHERE ${guard}
						`).bind(
							input.assetId,
							input.operation.defaultEventId,
							new Date(input.publishedAt).getTime(),
							...guardBindings,
						)]),
				// Both of these reclaim state only a publication that actually happened
				// has the right to reclaim, so both carry the guard. A failed publication
				// that cleared its own write candidates would hand its unreachable bytes to
				// the generic sweep instead of the candidate machinery built to collect
				// them, and one that released a quarantine would restart a seven-day clock
				// on content still unreachable.
				releaseContentQuarantineStatement(
					database,
					[input.sourceDigest, input.thumbnailDigest],
					{ guard, bindings: guardBindings },
				),
				database.prepare(`
					DELETE FROM graphics_canonical_write_candidates
					WHERE operation_id = ? AND ${guard}
				`).bind(input.operation.id, ...guardBindings),
				updateOperationStatement(
					database,
					completed,
					input.operation.updatedAt,
					`AND ${guard}`,
					guardBindings,
				),
			] as [D1PreparedStatement, ...D1PreparedStatement[]];
			const results = await database.batch(statements);
			if (results.some(result => !result.success))
				throw new Error('Graphic Asset publication transaction failed');
			// The terminal transition is last, so its count is the one that answers
			// whether the guard held at all. Losing it means nothing committed.
			if (results.at(-1)?.meta.changes !== 1)
				throw new Error('Graphic Asset publication lost its claim before publishing');
			return completed;
		},
		async listGraphicAssets(search, lifecycleStates) {
			const normalizedSearch = `%${search.trim().toLocaleLowerCase()}%`;
			const result = await database.prepare(`
				SELECT
					a.id, a.name, a.kind, a.lifecycle_state, a.trash_prior_state,
					a.trashed_at, a.trash_recoverable_until,
					r.id AS revision_id, r.revision_number,
					r.technical_facts,
					COALESCE((
						SELECT json_group_array(json_object(
							'id', revision_history.id,
							'revisionNumber', revision_history.revision_number,
							'facts', json(revision_history.technical_facts)
						))
						FROM (
							SELECT history.id, history.revision_number,
								history.technical_facts
							FROM graphic_asset_revisions history
							WHERE history.asset_id = a.id
							ORDER BY history.revision_number
						) revision_history
					), '[]') AS revision_history,
					COALESCE((
						SELECT json_group_array(event_id)
						FROM (
							SELECT event_id
							FROM graphic_asset_event_associations
							WHERE asset_id = a.id
							ORDER BY event_id
						)
					), '[]') AS event_ids,
						o.id AS operation_id, o.idempotency_key, o.source, o.initiated_by,
						o.proposed_name, o.source_file_name, o.declared_mime,
						o.browser_decode_evidence, o.target_asset_id,
					o.duplicate_content_policy,
					o.default_event_id, o.declared_byte_length,
					o.transferred_byte_length, o.stage, o.report, o.result,
					o.package_installation, o.failure,
					o.capacity_outcome,
					o.created_at AS operation_created_at,
					o.updated_at AS operation_updated_at
				FROM graphic_assets a
				JOIN graphic_asset_revisions r
					ON r.asset_id = a.id
					AND r.revision_number = (
						SELECT MAX(latest.revision_number)
						FROM graphic_asset_revisions latest
						WHERE latest.asset_id = a.id
					)
				JOIN graphics_ingestion_operations o
					ON o.id = (
						SELECT latest_operation.id
						FROM graphics_ingestion_operations latest_operation
						WHERE latest_operation.stage = 'completed'
							AND (
								json_extract(latest_operation.result, '$.assetId') = a.id
								-- One Template Package installation publishes every
								-- asset its Template needs, so its result names them
								-- all rather than one.
								--
								-- Only the ones it created. An installation that
								-- merely reused an exact origin published no asset,
								-- and letting it answer for one would re-attribute an
								-- upload's provenance to the package that happened to
								-- reference it: the asset would start describing
								-- itself by the archive's filename, with no validation
								-- report behind it. Reuse leaves library metadata
								-- alone, and this is the metadata an author reads.
								OR EXISTS (
									SELECT 1
									FROM json_each(COALESCE(
										json_extract(latest_operation.package_installation, '$.assets'), '[]'
									)) installed
									WHERE json_extract(installed.value, '$.assetId') = a.id
										AND json_extract(installed.value, '$.outcome') = 'created'
								)
							)
						ORDER BY latest_operation.updated_at DESC, latest_operation.id DESC
						LIMIT 1
					)
				WHERE a.lifecycle_state IN (${lifecycleStates.map(() => '?').join(', ')})
					AND lower(a.name) LIKE ?
				ORDER BY lower(a.name), a.id
			`).bind(...lifecycleStates, normalizedSearch).all<AssetRow>();
			if (!result.success)
				throw new Error('Graphic Asset discovery failed');
			return result.results.map(assetFromRow);
		},
		async retireGraphicAsset(input) {
			const result = await database.prepare(`
				UPDATE graphic_assets
				SET lifecycle_state = 'retired', trash_prior_state = NULL,
					trashed_at = NULL, trash_recoverable_until = NULL, updated_at = ?
				WHERE id = ? AND lifecycle_state = 'active'
			`).bind(new Date(input.updatedAt).getTime(), input.assetId).run();
			if (!result.success)
				throw new Error('Graphic Asset retirement failed');
			if (result.meta.changes === 1) {
				const asset = await readLifecycleTransitionAsset(
					this,
					input.assetId,
					'Retired Graphic Asset could not be read',
				);
				return { outcome: 'updated', asset };
			}
			return await classifyLifecycleTransitionMiss(database, input.assetId);
		},
		async trashGraphicAsset(input) {
			const [transition, , usage] = await database.batch([
				database.prepare(`
					UPDATE graphic_assets
					SET trash_prior_state = lifecycle_state, lifecycle_state = 'trashed',
						trashed_at = ?, trash_recoverable_until = ?, updated_at = ?
					WHERE id = ? AND lifecycle_state IN ('active', 'retired')
						AND NOT EXISTS (
							SELECT 1
							FROM graphic_asset_references asset_reference
							WHERE asset_reference.asset_id = graphic_assets.id
						)
				`).bind(
					new Date(input.trashedAt).getTime(),
					new Date(input.recoverableUntil).getTime(),
					new Date(input.trashedAt).getTime(),
					input.assetId,
				),
				// Trash freezes revision pruning for the complete recovery window by
				// banking the remaining time instead of letting the deadline run.
				database.prepare(`
					UPDATE graphic_asset_revision_retention
					SET frozen_at = ?, frozen_remaining_milliseconds = MAX(0, prune_after - ?)
					WHERE frozen_at IS NULL
						AND revision_id IN (
							SELECT id FROM graphic_asset_revisions WHERE asset_id = ?
						)
						AND EXISTS (
							SELECT 1 FROM graphic_assets
							WHERE id = ? AND lifecycle_state = 'trashed' AND trashed_at = ?
						)
				`).bind(
					new Date(input.trashedAt).getTime(),
					new Date(input.trashedAt).getTime(),
					input.assetId,
					input.assetId,
					new Date(input.trashedAt).getTime(),
				),
				database.prepare(usageSelect()).bind(input.assetId),
			]);
			if (!transition?.success || !usage?.success)
				throw new Error('Graphic Asset Trash transaction failed');
			if (transition.meta.changes === 1) {
				const asset = await readLifecycleTransitionAsset(
					this,
					input.assetId,
					'Trashed Graphic Asset could not be read',
				);
				return { outcome: 'updated', asset };
			}
			const currentUsage = (usage.results as unknown as UsageRow[]).map(usageFromRow);
			if (currentUsage.length > 0)
				return { outcome: 'in-use', usage: currentUsage };
			return await classifyLifecycleTransitionMiss(database, input.assetId);
		},
		async restoreGraphicAsset(input) {
			const restoredAt = new Date(input.restoredAt).getTime();
			const [result] = await database.batch([
				database.prepare(`
					UPDATE graphic_assets
					SET lifecycle_state = CASE
							WHEN lifecycle_state = 'retired' THEN 'active'
							ELSE trash_prior_state
						END,
						trash_prior_state = NULL, trashed_at = NULL,
						trash_recoverable_until = NULL, updated_at = ?
					WHERE id = ?
						AND (
							lifecycle_state = 'retired'
							OR (
								lifecycle_state = 'trashed'
								AND trash_prior_state IN ('active', 'retired')
								AND trash_recoverable_until >= ?
							)
						)
				`).bind(restoredAt, input.assetId, restoredAt),
				// Restoration resumes the banked recovery time rather than
				// restarting the guarantee from scratch.
				database.prepare(`
					UPDATE graphic_asset_revision_retention
					SET prune_after = ? + COALESCE(frozen_remaining_milliseconds, 0),
						frozen_at = NULL, frozen_remaining_milliseconds = NULL
					WHERE frozen_at IS NOT NULL
						AND revision_id IN (
							SELECT id FROM graphic_asset_revisions WHERE asset_id = ?
						)
						AND EXISTS (
							SELECT 1 FROM graphic_assets
							WHERE id = ? AND lifecycle_state <> 'trashed' AND updated_at = ?
						)
				`).bind(restoredAt, input.assetId, input.assetId, restoredAt),
			]);
			if (!result?.success)
				throw new Error('Graphic Asset restoration failed');
			if (result.meta.changes === 1) {
				const asset = await readLifecycleTransitionAsset(
					this,
					input.assetId,
					'Restored Graphic Asset could not be read',
				);
				return { outcome: 'updated', asset };
			}
			return await classifyLifecycleTransitionMiss(database, input.assetId);
		},
		async updateGraphicAsset(input) {
			const updatedAt = new Date(input.updatedAt).getTime();
			const statements: [D1PreparedStatement, ...D1PreparedStatement[]] = [
				database.prepare(`
					UPDATE graphic_assets
					SET name = ?, updated_at = ?
					WHERE id = ? AND lifecycle_state = 'active'
				`).bind(input.name, updatedAt, input.assetId),
				database.prepare(`
					DELETE FROM graphic_asset_event_associations
					WHERE asset_id = ? AND EXISTS (
						SELECT 1 FROM graphic_assets
						WHERE id = ? AND updated_at = ?
					)
				`).bind(input.assetId, input.assetId, updatedAt),
				...input.eventIds.map(eventId => database.prepare(`
					INSERT INTO graphic_asset_event_associations (asset_id, event_id, created_at)
					SELECT ?, ?, ?
					WHERE EXISTS (
						SELECT 1 FROM graphic_assets
						WHERE id = ? AND updated_at = ?
					)
				`).bind(input.assetId, eventId, updatedAt, input.assetId, updatedAt)),
			];
			const results = await database.batch(statements);
			if (results.some(result => !result.success))
				throw new Error('Graphic Asset metadata transaction failed');
			if (results[0]?.meta.changes !== 1)
				return undefined;
			return (await this.listGraphicAssets('', ['active']))
				.find(asset => asset.id === input.assetId);
		},
		async findRevisionContent(input) {
			const row = await database.prepare(`
				SELECT
					c.digest, c.byte_length, c.canonical_mime, a.kind, a.lifecycle_state,
					a.name, r.revision_number, r.compatibility_profile, r.technical_facts
				FROM graphic_asset_revisions r
				JOIN graphic_asset_contents c ON c.digest = r.content_digest
				JOIN graphic_assets a ON a.id = r.asset_id
				WHERE r.asset_id = ? AND r.id = ?
			`).bind(input.assetId, input.revisionId).first<{
				digest: string;
				byte_length: number;
				canonical_mime: GraphicAssetCanonicalMime;
				kind: GraphicAsset['kind'];
				lifecycle_state: 'active' | 'retired' | 'trashed';
				name: string;
				revision_number: number;
				compatibility_profile: string;
				technical_facts: string;
			}>();
			return row
				? {
						digest: row.digest,
						byteLength: row.byte_length,
						canonicalMime: row.canonical_mime,
						kind: row.kind,
						lifecycleState: row.lifecycle_state,
						name: row.name,
						revisionNumber: row.revision_number,
						compatibilityProfile: row.compatibility_profile,
						facts: JSON.parse(row.technical_facts) as GraphicAsset['facts'],
					}
				: undefined;
		},
		async listGraphicAssetUsage(assetId) {
			const result = await database.prepare(usageSelect()).bind(assetId).all<UsageRow>();
			if (!result.success)
				throw new Error('Graphic Asset usage lookup failed');
			return result.results.map(usageFromRow);
		},
		async findThumbnailContent(assetId) {
			const row = await database.prepare(`
				SELECT d.content_digest, c.byte_length, c.canonical_mime
				FROM graphics_derivatives d
				JOIN graphic_asset_revisions r ON r.id = d.source_revision_id
				JOIN graphic_assets a ON a.id = r.asset_id
				JOIN graphic_asset_contents c ON c.digest = d.content_digest
				WHERE a.id = ?
					AND d.kind IN ('thumbnail', 'video-poster', 'font-specimen')
				ORDER BY r.revision_number DESC
				LIMIT 1
			`).bind(assetId).first<{
				content_digest: string;
				byte_length: number;
				canonical_mime: string;
			}>();
			return row
				? {
						digest: row.content_digest,
						byteLength: row.byte_length,
						canonicalMime: row.canonical_mime as GraphicAssetCanonicalMime,
					}
				: undefined;
		},
	};
}

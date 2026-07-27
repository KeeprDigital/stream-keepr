import type {
	GraphicAsset,
	GraphicAssetId,
	GraphicAssetImageFacts,
	GraphicAssetRevisionId,
	GraphicAssetUsage,
	GraphicsAssetLibraryCapacity,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsAssetCatalogue,
	PublishPngCatalogueInput,
} from '.';
import { GraphicsAssetLibraryError } from './errors';

interface OperationRow {
	id: string;
	idempotency_key: string;
	initiated_by: string;
	proposed_name: string;
	duplicate_content_policy: GraphicsIngestionOperation['duplicateContentPolicy'];
	default_event_id: number | null;
	declared_byte_length: number;
	transferred_byte_length: number;
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
	revision_id: string;
	revision_number: number;
	technical_facts: string;
	event_ids: string;
	operation_id: string;
	idempotency_key: string;
	initiated_by: string;
	proposed_name: string;
	duplicate_content_policy: GraphicsIngestionOperation['duplicateContentPolicy'];
	default_event_id: number | null;
	declared_byte_length: number;
	transferred_byte_length: number;
	stage: GraphicsIngestionOperation['stage'];
	capacity_outcome: string | null;
	report: string | null;
	result: string | null;
	failure: string | null;
	operation_created_at: number;
	operation_updated_at: number;
}

function parseJson<T>(value: string | null): T | undefined {
	return value === null ? undefined : JSON.parse(value) as T;
}

function operationFromRow(row: OperationRow): GraphicsIngestionOperation {
	return {
		id: row.id as GraphicsIngestionOperationId,
		idempotencyKey: row.idempotency_key,
		initiatedBy: row.initiated_by,
		name: row.proposed_name,
		duplicateContentPolicy: row.duplicate_content_policy,
		defaultEventId: row.default_event_id ?? undefined,
		declaredByteLength: row.declared_byte_length,
		transferredByteLength: row.transferred_byte_length,
		stage: row.stage,
		capacity: parseJson(row.capacity_outcome),
		report: parseJson(row.report),
		result: parseJson(row.result),
		failure: parseJson(row.failure),
		createdAt: new Date(row.created_at).toISOString(),
		updatedAt: new Date(row.updated_at).toISOString(),
	};
}

function operationRowFromAsset(row: AssetRow): OperationRow {
	return {
		id: row.operation_id,
		idempotency_key: row.idempotency_key,
		initiated_by: row.initiated_by,
		proposed_name: row.proposed_name,
		duplicate_content_policy: row.duplicate_content_policy,
		default_event_id: row.default_event_id,
		declared_byte_length: row.declared_byte_length,
		transferred_byte_length: row.transferred_byte_length,
		stage: row.stage,
		capacity_outcome: row.capacity_outcome,
		report: row.report,
		result: row.result,
		failure: row.failure,
		created_at: row.operation_created_at,
		updated_at: row.operation_updated_at,
	};
}

function operationSelect(where: string) {
	return `
		SELECT id, idempotency_key, initiated_by, proposed_name,
			duplicate_content_policy, default_event_id,
			declared_byte_length, transferred_byte_length, stage, report, result,
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

function updateOperationStatement(
	database: D1Database,
	operation: GraphicsIngestionOperation,
	expectedUpdatedAt: string,
) {
	return database.prepare(`
		UPDATE graphics_ingestion_operations
		SET stage = ?, transferred_byte_length = ?, report = ?, result = ?,
			failure = ?, capacity_outcome = ?, updated_at = ?,
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
	`).bind(
		operation.stage,
		operation.transferredByteLength,
		operation.report === undefined ? null : JSON.stringify(operation.report),
		operation.result === undefined ? null : JSON.stringify(operation.result),
		operation.failure === undefined ? null : JSON.stringify(operation.failure),
		operation.capacity === undefined ? null : JSON.stringify(operation.capacity),
		new Date(operation.updatedAt).getTime(),
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
	);
}

function capacityPressure(usedBytes: number, limitBytes: number): GraphicsAssetLibraryCapacity['canonical']['pressure'] {
	const ratio = usedBytes / limitBytes;
	if (ratio >= 1)
		return 'full';
	if (ratio >= 0.95)
		return 'critical';
	if (ratio >= 0.8)
		return 'warning';
	return 'normal';
}

export function createD1GraphicsAssetCatalogue(database: D1Database): GraphicsAssetCatalogue {
	return {
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
					), 0) AS staging_reserved_bytes
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
					pressure: capacityPressure(usedBytes, row.canonical_limit_bytes),
					breakdown: {
						retainedSourceBytes: row.retained_source_bytes,
						retainedDerivativeBytes: row.retained_derivative_bytes,
						metadataBytes: 0,
						providerCacheBytes: 0,
						unreachableQuarantineBytes: 0,
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
		async initiatePngIngestion(operation) {
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
					duplicate_content_policy, default_event_id,
					declared_byte_length, transferred_byte_length,
					staging_reserved_byte_length,
					created_at, updated_at
				)
				SELECT ?, ?, 'local-upload', 'created', ?, ?, ?, ?, ?, 0, ?, ?, ?
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
				operation.initiatedBy,
				operation.name,
				operation.duplicateContentPolicy,
				operation.defaultEventId ?? null,
				operation.declaredByteLength,
				operation.declaredByteLength,
				new Date(operation.createdAt).getTime(),
				new Date(operation.updatedAt).getTime(),
				operation.declaredByteLength,
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
							requestedBytes: operation.declaredByteLength,
							availableBytes: capacity.staging.availableBytes,
						},
					},
				);
			}
			return authoritative;
		},
		async recordStagedBytes(input) {
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET staging_used_byte_length = ?,
					staging_reserved_byte_length = declared_byte_length - ?
				WHERE id = ? AND initiated_by = ?
					AND stage NOT IN ('completed', 'cancelled')
					AND ? BETWEEN 0 AND declared_byte_length
			`).bind(
				input.usedBytes,
				input.usedBytes,
				input.operation.id,
				input.operation.initiatedBy,
				input.usedBytes,
			).run();
			if (!result.success || result.meta.changes !== 1)
				throw new Error('Graphics staging progress could not be recorded');
		},
		async reservePngPublication(input) {
			const proposed = new Map<string, number>([
				[input.sourceDigest, input.sourceByteLength],
				[input.thumbnailDigest, input.thumbnailByteLength],
			]);
			const existing = await Promise.all(
				[...proposed].map(async ([digest, byteLength]) => ({
					digest,
					byteLength,
					exists: Boolean(await database.prepare(`
						SELECT 1 FROM graphic_asset_contents WHERE digest = ?
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
			if (result.meta.changes === 1) {
				const operation = await firstOperation(
					database,
					'id = ? AND initiated_by = ?',
					input.operation.id,
					input.operation.initiatedBy,
				);
				if (!operation)
					throw new Error('Graphics canonical reservation was not durable');
				return { outcome: 'reserved' as const, operation };
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
		async getIngestionOperation(operationId, initiatedBy) {
			return await firstOperation(database, 'id = ? AND initiated_by = ?', operationId, initiatedBy);
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
		async claimPngIngestion(input) {
			const result = await database.prepare(`
				UPDATE graphics_ingestion_operations
				SET stage = 'hashing', updated_at = ?
				WHERE id = ? AND initiated_by = ? AND updated_at = ?
					AND (
						(stage = 'failed' AND json_extract(failure, '$.retryable') = 1)
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
		async findReusablePng(sourceDigest) {
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
		async reusePng(input) {
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
			const statements: [D1PreparedStatement, ...D1PreparedStatement[]]
				= input.operation.defaultEventId === undefined
					? [updateOperation]
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
						), updateOperation];
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
		async publishPng(input: PublishPngCatalogueInput) {
			await Promise.all([
				assertContentCompatible(database, {
					digest: input.sourceDigest,
					byteLength: input.report.facts.byteLength,
					canonicalMime: 'image/png',
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
			const statements = [
				database.prepare(`
					INSERT OR IGNORE INTO graphic_asset_contents (
						digest, byte_length, canonical_mime, availability, created_at
					) VALUES (?, ?, 'image/png', 'available', ?)
				`).bind(input.sourceDigest, input.report.facts.byteLength, new Date(input.publishedAt).getTime()),
				database.prepare(`
					INSERT OR IGNORE INTO graphic_asset_contents (
						digest, byte_length, canonical_mime, availability, created_at
					) VALUES (?, ?, 'image/png', 'available', ?)
				`).bind(input.thumbnailDigest, input.thumbnailByteLength, new Date(input.publishedAt).getTime()),
				database.prepare(`
					INSERT INTO graphic_assets (id, name, kind, lifecycle_state, created_at, updated_at)
					SELECT ?, ?, 'image', 'active', ?, ?
					WHERE EXISTS (
						SELECT 1 FROM graphics_ingestion_operations
						WHERE id = ? AND initiated_by = ? AND stage = 'publishing'
							AND updated_at = ?
					)
						AND (
							? = 'create-separate'
							OR NOT EXISTS (
								SELECT 1
								FROM graphic_assets existing_asset
								JOIN graphic_asset_revisions existing_revision
									ON existing_revision.asset_id = existing_asset.id
								WHERE existing_asset.lifecycle_state = 'active'
									AND existing_revision.content_digest = ?
							)
						)
				`).bind(
					input.assetId,
					input.operation.name,
					new Date(input.publishedAt).getTime(),
					new Date(input.publishedAt).getTime(),
					input.operation.id,
					input.operation.initiatedBy,
					new Date(input.operation.updatedAt).getTime(),
					input.operation.duplicateContentPolicy,
					input.sourceDigest,
				),
				database.prepare(`
					INSERT INTO graphic_asset_revisions (
						id, asset_id, revision_number, content_digest,
						compatibility_profile, technical_facts, created_at
					) VALUES (?, ?, 1, ?, 'png-v1', ?, ?)
				`).bind(
					input.revisionId,
					input.assetId,
					input.sourceDigest,
					JSON.stringify(input.report.facts),
					new Date(input.publishedAt).getTime(),
				),
				database.prepare(`
					INSERT INTO graphics_derivatives (
						id, source_revision_id, kind, content_digest, created_at
					) VALUES (?, ?, 'thumbnail', ?, ?)
				`).bind(
					input.derivativeId,
					input.revisionId,
					input.thumbnailDigest,
					new Date(input.publishedAt).getTime(),
				),
				...(input.operation.defaultEventId === undefined
					? []
					: [database.prepare(`
							INSERT INTO graphic_asset_event_associations (asset_id, event_id, created_at)
							VALUES (?, ?, ?)
						`).bind(
							input.assetId,
							input.operation.defaultEventId,
							new Date(input.publishedAt).getTime(),
						)]),
				updateOperationStatement(database, completed, input.operation.updatedAt),
			] as [D1PreparedStatement, ...D1PreparedStatement[]];
			const results = await database.batch(statements);
			if (results.some(result => !result.success))
				throw new Error('Graphic Asset publication transaction failed');
			return completed;
		},
		async listGraphicAssets(search) {
			const normalizedSearch = `%${search.trim().toLocaleLowerCase()}%`;
			const result = await database.prepare(`
				SELECT
					a.id, a.name, r.id AS revision_id, r.revision_number,
					r.technical_facts,
					COALESCE((
						SELECT json_group_array(event_id)
						FROM (
							SELECT event_id
							FROM graphic_asset_event_associations
							WHERE asset_id = a.id
							ORDER BY event_id
						)
					), '[]') AS event_ids,
					o.id AS operation_id, o.idempotency_key, o.initiated_by,
					o.proposed_name, o.duplicate_content_policy,
					o.default_event_id, o.declared_byte_length,
					o.transferred_byte_length, o.stage, o.report, o.result, o.failure,
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
						WHERE json_extract(latest_operation.result, '$.assetId') = a.id
							AND latest_operation.stage = 'completed'
						ORDER BY latest_operation.updated_at DESC, latest_operation.id DESC
						LIMIT 1
					)
				WHERE a.lifecycle_state = 'active'
					AND lower(a.name) LIKE ?
				ORDER BY lower(a.name), a.id
			`).bind(normalizedSearch).all<AssetRow>();
			if (!result.success)
				throw new Error('Graphic Asset discovery failed');
			return result.results.map((row): GraphicAsset => ({
				id: row.id as GraphicAssetId,
				name: row.name,
				kind: 'image',
				revisionId: row.revision_id as GraphicAsset['revisionId'],
				revisionNumber: row.revision_number,
				facts: JSON.parse(row.technical_facts) as GraphicAssetImageFacts,
				eventIds: JSON.parse(row.event_ids) as number[],
				operation: operationFromRow(operationRowFromAsset(row)),
			}));
		},
		async findRevisionContent(input) {
			const row = await database.prepare(`
				SELECT c.digest, c.byte_length, c.canonical_mime, a.lifecycle_state
				FROM graphic_asset_revisions r
				JOIN graphic_asset_contents c ON c.digest = r.content_digest
				JOIN graphic_assets a ON a.id = r.asset_id
				WHERE r.asset_id = ? AND r.id = ?
			`).bind(input.assetId, input.revisionId).first<{
				digest: string;
				byte_length: number;
				canonical_mime: 'image/png';
				lifecycle_state: 'active' | 'retired' | 'trashed';
			}>();
			return row
				? {
						digest: row.digest,
						byteLength: row.byte_length,
						canonicalMime: row.canonical_mime,
						lifecycleState: row.lifecycle_state,
					}
				: undefined;
		},
		async listGraphicAssetUsage(assetId) {
			const result = await database.prepare(`
				SELECT id, asset_id, revision_id, owner_kind, owner_id, owner_slot, event_id
				FROM graphic_asset_references
				WHERE asset_id = ?
				ORDER BY owner_kind, owner_id, owner_slot, id
			`).bind(assetId).all<{
				id: string;
				asset_id: string;
				revision_id: string;
				owner_kind: string;
				owner_id: string;
				owner_slot: string;
				event_id: number | null;
			}>();
			if (!result.success)
				throw new Error('Graphic Asset usage lookup failed');
			return result.results.map((row): GraphicAssetUsage => ({
				id: row.id,
				reference: {
					assetId: row.asset_id as GraphicAssetId,
					revisionId: row.revision_id as GraphicAssetRevisionId,
				},
				owner: {
					kind: row.owner_kind,
					id: row.owner_id,
					slot: row.owner_slot,
					eventId: row.event_id ?? undefined,
				},
			}));
		},
		async findThumbnailDigest(assetId) {
			const row = await database.prepare(`
				SELECT d.content_digest
				FROM graphics_derivatives d
				JOIN graphic_asset_revisions r ON r.id = d.source_revision_id
				JOIN graphic_assets a ON a.id = r.asset_id
				WHERE a.id = ? AND a.lifecycle_state = 'active' AND d.kind = 'thumbnail'
				ORDER BY r.revision_number DESC
				LIMIT 1
			`).bind(assetId).first<{ content_digest: string }>();
			return row?.content_digest;
		},
	};
}

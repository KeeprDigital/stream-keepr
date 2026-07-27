import type {
	GraphicAsset,
	GraphicAssetId,
	GraphicAssetImageFacts,
	GraphicsIngestionOperation,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsAssetCatalogue,
	PublishPngCatalogueInput,
} from '.';

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
			failure, created_at, updated_at
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
			failure = ?, updated_at = ?
		WHERE id = ? AND initiated_by = ?
			AND stage NOT IN ('cancelled', 'completed')
			AND updated_at = ?
	`).bind(
		operation.stage,
		operation.transferredByteLength,
		operation.report === undefined ? null : JSON.stringify(operation.report),
		operation.result === undefined ? null : JSON.stringify(operation.result),
		operation.failure === undefined ? null : JSON.stringify(operation.failure),
		new Date(operation.updatedAt).getTime(),
		operation.id,
		operation.initiatedBy,
		new Date(expectedUpdatedAt).getTime(),
	);
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
		async initiatePngIngestion(operation) {
			await database.prepare(`
				INSERT OR IGNORE INTO graphics_ingestion_operations (
					id, idempotency_key, source, stage, initiated_by, proposed_name,
					duplicate_content_policy, default_event_id,
					declared_byte_length, transferred_byte_length,
					created_at, updated_at
				) VALUES (?, ?, 'local-upload', 'created', ?, ?, ?, ?, ?, 0, ?, ?)
			`).bind(
				operation.id,
				operation.idempotencyKey,
				operation.initiatedBy,
				operation.name,
				operation.duplicateContentPolicy,
				operation.defaultEventId ?? null,
				operation.declaredByteLength,
				new Date(operation.createdAt).getTime(),
				new Date(operation.updatedAt).getTime(),
			).run();
			const authoritative = await firstOperation(
				database,
				'initiated_by = ? AND idempotency_key = ?',
				operation.initiatedBy,
				operation.idempotencyKey,
			);
			if (!authoritative)
				throw new Error('Graphics Ingestion Operation initiation failed');
			return authoritative;
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

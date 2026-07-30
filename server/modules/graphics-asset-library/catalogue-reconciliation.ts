import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsDerivativeId,
	GraphicsDiscrepancy,
	GraphicsDiscrepancyKind,
	GraphicsDiscrepancyReasonCode,
	GraphicsDiscrepancyResolution,
	GraphicsDiscrepancyState,
	GraphicsDiscrepancyUsage,
} from '~~/shared/types/graphicsAsset';
import type {
	ExpectedGraphicAssetContent,
	GraphicsAssetReconciliationCatalogue,
	GraphicsDiscrepancyRecord,
} from './reconciliation';
import { GRAPHICS_DISCREPANCY_KINDS } from '~~/shared/utils/graphicsAssetReconciliation';

interface ExpectedContentRow {
	digest: string;
	byte_length: number;
	canonical_mime: string;
	availability: 'available' | 'unavailable';
	revision_reach: number;
	derivative_reach: number;
	source_kind: 'image' | 'silent-video' | 'font' | null;
	source_facts: string | null;
	derivative_id: string | null;
	derivative_kind: 'thumbnail' | 'video-poster' | 'font-specimen' | null;
	derivative_source_asset_id: string | null;
	derivative_source_revision_id: string | null;
	derivative_source_digest: string | null;
	derivative_source_byte_length: number | null;
	derivative_source_mime: string | null;
	derivative_source_kind: 'image' | 'silent-video' | 'font' | null;
	derivative_source_facts: string | null;
	quarantined: number;
}

/**
 * One expectation and everything acting on it needs: how many retained
 * revisions and derivatives reach these bytes, the validated facts a revision
 * recorded for them, and — when the bytes are a Graphics Derivative — the exact
 * source revision they can be reproduced from.
 *
 * The two `LEFT JOIN` picks are deterministic rather than arbitrary: revisions
 * sharing one digest recorded identical facts because the facts come from the
 * bytes, and a derivative's source is what regeneration needs regardless of
 * which of several identical derivatives is named.
 */
const EXPECTED_CONTENT_SELECT = `
	SELECT contents.digest, contents.byte_length, contents.canonical_mime, contents.availability,
		(
			SELECT COUNT(*) FROM graphic_asset_revisions revision
			WHERE revision.content_digest = contents.digest
		) AS revision_reach,
		(
			SELECT COUNT(*) FROM graphics_derivatives derivative
			WHERE derivative.content_digest = contents.digest
		) AS derivative_reach,
		source_asset.kind AS source_kind,
		source_revision.technical_facts AS source_facts,
		derivative.id AS derivative_id,
		derivative.kind AS derivative_kind,
		derivative_revision.asset_id AS derivative_source_asset_id,
		derivative_revision.id AS derivative_source_revision_id,
		derivative_revision.content_digest AS derivative_source_digest,
		derivative_source_content.byte_length AS derivative_source_byte_length,
		derivative_source_content.canonical_mime AS derivative_source_mime,
		derivative_asset.kind AS derivative_source_kind,
		derivative_revision.technical_facts AS derivative_source_facts,
		CASE WHEN EXISTS (
			SELECT 1 FROM graphics_content_quarantine quarantine
			WHERE quarantine.digest = contents.digest
		) THEN 1 ELSE 0 END AS quarantined
	FROM graphic_asset_contents contents
	LEFT JOIN graphic_asset_revisions source_revision ON source_revision.id = (
		SELECT revision.id FROM graphic_asset_revisions revision
		WHERE revision.content_digest = contents.digest
		ORDER BY revision.id LIMIT 1
	)
	LEFT JOIN graphic_assets source_asset ON source_asset.id = source_revision.asset_id
	LEFT JOIN graphics_derivatives derivative ON derivative.id = (
		SELECT candidate.id FROM graphics_derivatives candidate
		WHERE candidate.content_digest = contents.digest
		ORDER BY candidate.id LIMIT 1
	)
	LEFT JOIN graphic_asset_revisions derivative_revision
		ON derivative_revision.id = derivative.source_revision_id
	LEFT JOIN graphic_assets derivative_asset ON derivative_asset.id = derivative_revision.asset_id
	LEFT JOIN graphic_asset_contents derivative_source_content
		ON derivative_source_content.digest = derivative_revision.content_digest
`;

function parseFacts(value: string | null): Record<string, unknown> {
	if (!value)
		return {};
	try {
		return JSON.parse(value) as Record<string, unknown>;
	}
	catch {
		return {};
	}
}

function expectedContentFromRow(row: ExpectedContentRow): ExpectedGraphicAssetContent {
	return {
		digest: row.digest,
		byteLength: row.byte_length,
		canonicalMime: row.canonical_mime,
		availability: row.availability,
		revisionReach: row.revision_reach,
		derivativeReach: row.derivative_reach,
		quarantined: row.quarantined === 1,
		...(row.source_kind
			? {
					source: {
						kind: row.source_kind,
						facts: parseFacts(row.source_facts),
					},
				}
			: {}),
		...(row.derivative_id
			&& row.derivative_kind
			&& row.derivative_source_asset_id
			&& row.derivative_source_revision_id
			&& row.derivative_source_digest
			&& row.derivative_source_mime
			&& row.derivative_source_kind
			&& row.derivative_source_byte_length !== null
			? {
					derivative: {
						id: row.derivative_id as GraphicsDerivativeId,
						kind: row.derivative_kind,
						sourceAssetId: row.derivative_source_asset_id as GraphicAssetId,
						sourceRevisionId: row.derivative_source_revision_id as GraphicAssetRevisionId,
						sourceDigest: row.derivative_source_digest,
						sourceByteLength: row.derivative_source_byte_length,
						sourceCanonicalMime: row.derivative_source_mime,
						sourceKind: row.derivative_source_kind,
						sourceFacts: parseFacts(row.derivative_source_facts),
					},
				}
			: {}),
	};
}

interface UsageRow {
	asset_id: string;
	name: string;
	revision_id: string;
	revision_number: number;
	kind: 'image' | 'silent-video' | 'font';
	lifecycle_state: 'active' | 'retired' | 'trashed';
	reference_count: number;
}

function usageFromRow(row: UsageRow): GraphicsDiscrepancyUsage {
	return {
		assetId: row.asset_id as GraphicAssetId,
		assetName: row.name,
		revisionId: row.revision_id as GraphicAssetRevisionId,
		revisionNumber: row.revision_number,
		kind: row.kind,
		lifecycleState: row.lifecycle_state,
		referenceCount: row.reference_count,
	};
}

interface DiscrepancyRow {
	id: string;
	kind: GraphicsDiscrepancyKind;
	subject_key: string;
	digest: string | null;
	object_key: string | null;
	derivative_id: string | null;
	state: GraphicsDiscrepancyState;
	reason_code: GraphicsDiscrepancyReasonCode;
	isolated: number;
	expected: string;
	observed: string;
	detected_at: number;
	last_checked_at: number;
	resolved_at: number | null;
	resolution: GraphicsDiscrepancyResolution | null;
	working_copy_key: string | null;
	working_copy_since: number | null;
	correlation_id: string;
}

function discrepancyFromRow(row: DiscrepancyRow): GraphicsDiscrepancyRecord {
	return {
		id: row.id,
		kind: row.kind,
		subjectKey: row.subject_key,
		...(row.digest ? { digest: row.digest } : {}),
		...(row.object_key ? { objectKey: row.object_key } : {}),
		...(row.derivative_id ? { derivativeId: row.derivative_id as GraphicsDerivativeId } : {}),
		state: row.state,
		reasonCode: row.reason_code,
		isolated: row.isolated === 1,
		expected: JSON.parse(row.expected) as GraphicsDiscrepancy['expected'],
		observed: JSON.parse(row.observed) as GraphicsDiscrepancy['observed'],
		detectedAt: new Date(row.detected_at).toISOString(),
		lastCheckedAt: new Date(row.last_checked_at).toISOString(),
		...(row.resolved_at === null ? {} : { resolvedAt: new Date(row.resolved_at).toISOString() }),
		...(row.resolution ? { resolution: row.resolution } : {}),
		...(row.working_copy_key ? { workingCopyKey: row.working_copy_key } : {}),
		...(row.working_copy_since === null
			? {}
			: { workingCopySince: new Date(row.working_copy_since).toISOString() }),
		correlationId: row.correlation_id,
	};
}

const DISCREPANCY_COLUMNS = `
	id, kind, subject_key, digest, object_key, derivative_id, state, reason_code,
	isolated, expected, observed, detected_at, last_checked_at, resolved_at,
	resolution, working_copy_key, working_copy_since, correlation_id
`;

/**
 * Evidence recording and the unavailable-content marker are shared with the
 * retention path and provided once by the composed catalogue, so this factory
 * deliberately does not reimplement them.
 */
export function createD1GraphicsAssetReconciliationCatalogue(
	database: D1Database,
): Omit<GraphicsAssetReconciliationCatalogue, 'recordGraphicsAssetEvidence' | 'markContentUnavailable'> {
	async function findOpenDiscrepancy(kind: GraphicsDiscrepancyKind, subjectKey: string) {
		const row = await database.prepare(`
			SELECT ${DISCREPANCY_COLUMNS} FROM graphics_discrepancies
			WHERE kind = ? AND subject_key = ? AND state = 'open'
		`).bind(kind, subjectKey).first<DiscrepancyRow>();
		return row ? discrepancyFromRow(row) : undefined;
	}

	return {
		async listExpectedContent(input) {
			// Least recently compared first, and never compared at all before that,
			// so one bounded sweep eventually covers every expectation instead of
			// re-checking the same head of the table.
			const result = await database.prepare(`
				${EXPECTED_CONTENT_SELECT}
				ORDER BY contents.reconciled_at IS NOT NULL, contents.reconciled_at, contents.digest
				LIMIT ?
			`).bind(input.limit).all<ExpectedContentRow>();
			if (!result.success)
				throw new Error('Expected Graphic Asset Content could not be read');
			return result.results.map(expectedContentFromRow);
		},
		async findExpectedContent(input) {
			const row = await database.prepare(`
				${EXPECTED_CONTENT_SELECT}
				WHERE contents.digest = ?
			`).bind(input.digest).first<ExpectedContentRow>();
			return row ? expectedContentFromRow(row) : undefined;
		},
		async findExpectedContents(input) {
			if (input.digests.length === 0)
				return new Map();
			const result = await database.prepare(`
				${EXPECTED_CONTENT_SELECT}
				WHERE contents.digest IN (${input.digests.map(() => '?').join(', ')})
			`).bind(...input.digests).all<ExpectedContentRow>();
			if (!result.success)
				throw new Error('Expected Graphic Asset Content could not be read');
			return new Map(result.results.map(row => [row.digest, expectedContentFromRow(row)]));
		},
		async listContentUsageForDigests(input) {
			if (input.digests.length === 0)
				return new Map();
			const placeholders = input.digests.map(() => '?').join(', ');
			const result = await database.prepare(`
				SELECT revision.content_digest AS digest, revision.asset_id, asset.name,
					revision.id AS revision_id, revision.revision_number, asset.kind,
					asset.lifecycle_state,
					(
						SELECT COUNT(*) FROM graphic_asset_references reference
						WHERE reference.revision_id = revision.id
					) AS reference_count
				FROM graphic_asset_revisions revision
				JOIN graphic_assets asset ON asset.id = revision.asset_id
				WHERE revision.content_digest IN (${placeholders})
				UNION
				SELECT derivative.content_digest AS digest, source.asset_id, asset.name,
					source.id AS revision_id, source.revision_number, asset.kind,
					asset.lifecycle_state,
					(
						SELECT COUNT(*) FROM graphic_asset_references reference
						WHERE reference.revision_id = source.id
					) AS reference_count
				FROM graphics_derivatives derivative
				JOIN graphic_asset_revisions source ON source.id = derivative.source_revision_id
				JOIN graphic_assets asset ON asset.id = source.asset_id
				WHERE derivative.content_digest IN (${placeholders})
				ORDER BY name, revision_number
			`).bind(...input.digests, ...input.digests).all<UsageRow & { digest: string }>();
			if (!result.success)
				throw new Error('Graphic Asset Content usage could not be read');
			const usage = new Map<string, GraphicsDiscrepancyUsage[]>();
			for (const row of result.results) {
				const existing = usage.get(row.digest) ?? [];
				existing.push(usageFromRow(row));
				usage.set(row.digest, existing);
			}
			return usage;
		},
		async findQuarantinedDigests(input) {
			if (input.digests.length === 0)
				return new Map();
			const result = await database.prepare(`
				SELECT digest, quarantined_at, delete_after FROM graphics_content_quarantine
				WHERE digest IN (${input.digests.map(() => '?').join(', ')})
			`).bind(...input.digests).all<{
				digest: string;
				quarantined_at: number;
				delete_after: number;
			}>();
			if (!result.success)
				throw new Error('Quarantined Graphic Asset Content could not be read');
			return new Map(result.results.map(row => [row.digest, {
				quarantinedAt: new Date(row.quarantined_at).toISOString(),
				deleteAfter: new Date(row.delete_after).toISOString(),
			}]));
		},
		async hasOpenIsolatedIncident(input) {
			return Boolean(await database.prepare(`
				SELECT 1 FROM graphics_discrepancies
				WHERE digest = ? AND state = 'open' AND isolated = 1
				LIMIT 1
			`).bind(input.digest).first());
		},
		async findRevisionContentDigest(input) {
			const row = await database.prepare(`
				SELECT content_digest FROM graphic_asset_revisions
				WHERE id = ? AND asset_id = ?
			`).bind(input.revisionId, input.assetId).first<{ content_digest: string }>();
			return row?.content_digest;
		},
		async recordContentReconciled(input) {
			const result = await database.prepare(`
				UPDATE graphic_asset_contents SET reconciled_at = ? WHERE digest = ?
			`).bind(new Date(input.checkedAt).getTime(), input.digest).run();
			if (!result.success)
				throw new Error('Graphic Asset Content reconciliation progress could not be recorded');
		},
		async markContentAvailable(input) {
			// An open isolated incident is the one state a byte-level agreement may
			// not clear: only deep verification can settle a digest conflict, so the
			// flag stays closed until an administrator resolves the incident.
			const result = await database.prepare(`
				UPDATE graphic_asset_contents
				SET availability = 'available',
					unavailable_reason_code = NULL,
					unavailable_since = NULL,
					reconciled_at = ?
				WHERE digest = ?
					AND NOT EXISTS (
						SELECT 1 FROM graphics_discrepancies incident
						WHERE incident.digest = graphic_asset_contents.digest
							AND incident.state = 'open'
							AND incident.isolated = 1
					)
			`).bind(new Date(input.restoredAt).getTime(), input.digest).run();
			if (!result.success)
				throw new Error('Graphic Asset Content availability could not be restored');
			return result.meta.changes === 1;
		},
		async filterAccountedDigests(input) {
			if (input.digests.length === 0)
				return new Set();
			const placeholders = input.digests.map(() => '?').join(', ');
			// A digest is accounted for when the catalogue records it, an ingestion
			// operation has claimed it, or it is already quarantined. Anything else
			// in the byte store is bytes the library never asked for.
			const result = await database.prepare(`
				SELECT digest FROM graphic_asset_contents WHERE digest IN (${placeholders})
				UNION
				SELECT digest FROM graphics_canonical_write_candidates WHERE digest IN (${placeholders})
				UNION
				SELECT digest FROM graphics_content_quarantine WHERE digest IN (${placeholders})
			`).bind(...input.digests, ...input.digests, ...input.digests).all<{ digest: string }>();
			if (!result.success)
				throw new Error('Accounted Graphic Asset Content digests could not be read');
			return new Set(result.results.map(row => row.digest));
		},
		async quarantineUnexpectedObject(input) {
			// The insert predicate re-proves, at write time, that nothing in the
			// catalogue accounts for this digest. Publication records its write
			// candidate before it puts any bytes, so a publication in flight is
			// already accounted for by the time its object can be listed and this
			// predicate refuses to quarantine it.
			//
			// The predicate is a proof about this instant, not a lock: a digest
			// claimed after it runs is caught instead by publication, which deletes
			// the quarantine record for everything it publishes in the same atomic
			// transaction.
			const result = await database.prepare(`
				INSERT INTO graphics_content_quarantine (
					id, digest, byte_length, origin, quarantined_at, delete_after, created_at
				)
				SELECT ?, ?, ?, 'unexpected-object', ?, ?, ?
				WHERE NOT EXISTS (
						SELECT 1 FROM graphic_asset_contents contents WHERE contents.digest = ?
					)
					AND NOT EXISTS (
						SELECT 1 FROM graphics_canonical_write_candidates candidate WHERE candidate.digest = ?
					)
					AND NOT EXISTS (
						SELECT 1 FROM graphics_content_quarantine quarantine WHERE quarantine.digest = ?
					)
			`).bind(
				input.id,
				input.digest,
				input.byteLength,
				new Date(input.quarantinedAt).getTime(),
				new Date(input.deleteAfter).getTime(),
				new Date(input.quarantinedAt).getTime(),
				input.digest,
				input.digest,
				input.digest,
			).run();
			if (!result.success)
				throw new Error('Unexpected canonical object could not be quarantined');
			return result.meta.changes === 1;
		},
		async findContentQuarantine(input) {
			const row = await database.prepare(`
				SELECT id, quarantined_at, delete_after FROM graphics_content_quarantine
				WHERE digest = ?
			`).bind(input.digest).first<{
				id: string;
				quarantined_at: number;
				delete_after: number;
			}>();
			return row
				? {
						id: row.id,
						quarantinedAt: new Date(row.quarantined_at).toISOString(),
						deleteAfter: new Date(row.delete_after).toISOString(),
					}
				: undefined;
		},
		async releaseContentQuarantine(input) {
			const result = await database.prepare(`
				DELETE FROM graphics_content_quarantine WHERE digest = ? AND deleting_since IS NULL
			`).bind(input.digest).run();
			if (!result.success)
				throw new Error('Quarantined Graphic Asset Content could not be released');
			return result.meta.changes === 1;
		},
		async listContentUsage(input) {
			return (await this.listContentUsageForDigests({ digests: [input.digest] }))
				.get(input.digest) ?? [];
		},
		async openDiscrepancy(input) {
			const observedAt = new Date(input.observedAt).getTime();
			// The partial unique index on open rows makes this the whole race proof:
			// a repeating sweep re-observes the incident it already opened instead of
			// stacking duplicates, while a recurrence after resolution opens a new
			// record of its own.
			const results = await database.batch([
				database.prepare(`
					INSERT OR IGNORE INTO graphics_discrepancies (
						id, kind, subject_key, digest, object_key, derivative_id, state,
						reason_code, isolated, expected, observed, detected_at,
						last_checked_at, correlation_id, created_at
					) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)
				`).bind(
					input.id,
					input.kind,
					input.subjectKey,
					input.digest ?? null,
					input.objectKey ?? null,
					input.derivativeId ?? null,
					input.reasonCode,
					input.isolated ? 1 : 0,
					JSON.stringify(input.expected),
					JSON.stringify(input.observed),
					observedAt,
					observedAt,
					input.correlationId,
					observedAt,
				),
				database.prepare(`
					UPDATE graphics_discrepancies
					SET last_checked_at = ?,
						observed = ?,
						reason_code = ?,
						isolated = CASE WHEN isolated = 1 OR ? = 1 THEN 1 ELSE 0 END
					WHERE kind = ? AND subject_key = ? AND state = 'open'
				`).bind(
					observedAt,
					JSON.stringify(input.observed),
					input.reasonCode,
					input.isolated ? 1 : 0,
					input.kind,
					input.subjectKey,
				),
			]);
			if (results.some(result => !result.success))
				throw new Error('Graphics discrepancy could not be recorded');
			const record = await findOpenDiscrepancy(input.kind, input.subjectKey);
			if (!record)
				throw new Error('Graphics discrepancy could not be read back');
			return record;
		},
		async findDiscrepancy(input) {
			const row = await database.prepare(`
				SELECT ${DISCREPANCY_COLUMNS} FROM graphics_discrepancies WHERE id = ?
			`).bind(input.id).first<DiscrepancyRow>();
			return row ? discrepancyFromRow(row) : undefined;
		},
		async listDiscrepancies(input) {
			const states = input.states ?? [];
			const kinds = input.kinds ?? [];
			const predicates = [
				...(states.length > 0 ? [`state IN (${states.map(() => '?').join(', ')})`] : []),
				...(kinds.length > 0 ? [`kind IN (${kinds.map(() => '?').join(', ')})`] : []),
			];
			const result = await database.prepare(`
				SELECT ${DISCREPANCY_COLUMNS} FROM graphics_discrepancies
				${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''}
				ORDER BY isolated DESC, detected_at DESC, id DESC
				LIMIT ?
			`).bind(...states, ...kinds, input.limit).all<DiscrepancyRow>();
			if (!result.success)
				throw new Error('Graphics discrepancies could not be read');
			return result.results.map(discrepancyFromRow);
		},
		async countOpenDiscrepancies() {
			const result = await database.prepare(`
				SELECT kind, COUNT(*) AS total FROM graphics_discrepancies
				WHERE state = 'open'
				GROUP BY kind
			`).all<{ kind: GraphicsDiscrepancyKind; total: number }>();
			if (!result.success)
				throw new Error('Open graphics discrepancies could not be counted');
			const counts = Object.fromEntries(
				GRAPHICS_DISCREPANCY_KINDS.map(kind => [kind, 0]),
			) as Record<GraphicsDiscrepancyKind, number>;
			for (const row of result.results)
				counts[row.kind] = row.total;
			return counts;
		},
		async recordDiscrepancyObservation(input) {
			const result = await database.prepare(`
				UPDATE graphics_discrepancies
				SET last_checked_at = ?, observed = ?
				WHERE id = ? AND state = 'open'
			`).bind(
				new Date(input.observedAt).getTime(),
				JSON.stringify(input.observed),
				input.id,
			).run();
			if (!result.success)
				throw new Error('Graphics discrepancy observation could not be recorded');
		},
		async resolveDiscrepancy(input) {
			const result = await database.prepare(`
				UPDATE graphics_discrepancies
				SET state = 'resolved', resolved_at = ?, resolution = ?,
					last_checked_at = ?, working_copy_key = NULL, working_copy_since = NULL
				WHERE id = ? AND state = 'open'
			`).bind(
				new Date(input.resolvedAt).getTime(),
				input.resolution,
				new Date(input.resolvedAt).getTime(),
				input.id,
			).run();
			if (!result.success)
				throw new Error('Graphics discrepancy could not be resolved');
			return result.meta.changes === 1;
		},
		async resolveDiscrepanciesForDigest(input) {
			// An isolated incident is deliberately excluded: an object whose size and
			// media type agree proves nothing about a byte-level digest conflict.
			const open = await database.prepare(`
				SELECT id FROM graphics_discrepancies
				WHERE digest = ? AND state = 'open' AND isolated = 0
			`).bind(input.digest).all<{ id: string }>();
			if (!open.success)
				throw new Error('Open graphics discrepancies could not be read');
			if (open.results.length === 0)
				return [];
			const result = await database.prepare(`
				UPDATE graphics_discrepancies
				SET state = 'resolved', resolved_at = ?, resolution = ?,
					last_checked_at = ?, working_copy_key = NULL, working_copy_since = NULL
				WHERE digest = ? AND state = 'open' AND isolated = 0
			`).bind(
				new Date(input.resolvedAt).getTime(),
				input.resolution,
				new Date(input.resolvedAt).getTime(),
				input.digest,
			).run();
			if (!result.success)
				throw new Error('Graphics discrepancies could not be resolved');
			return open.results.map(row => row.id);
		},
		async claimDiscrepancyWorkingCopy(input) {
			const result = await database.prepare(`
				UPDATE graphics_discrepancies
				SET working_copy_key = ?, working_copy_since = ?
				WHERE id = ? AND state = 'open'
					AND (working_copy_since IS NULL OR working_copy_since <= ?)
			`).bind(
				input.workingCopyKey,
				new Date(input.claimedAt).getTime(),
				input.id,
				new Date(input.staleClaimsBefore).getTime(),
			).run();
			if (!result.success)
				throw new Error('Graphics discrepancy working copy could not be claimed');
			return result.meta.changes === 1;
		},
		async releaseDiscrepancyWorkingCopy(input) {
			const result = await database.prepare(`
				UPDATE graphics_discrepancies
				SET working_copy_key = NULL, working_copy_since = NULL
				WHERE id = ?
			`).bind(input.id).run();
			if (!result.success)
				throw new Error('Graphics discrepancy working copy could not be released');
		},
		async listStaleDiscrepancyWorkingCopies(input) {
			const result = await database.prepare(`
				SELECT id, working_copy_key FROM graphics_discrepancies
				WHERE working_copy_since IS NOT NULL
					AND working_copy_since <= ?
					AND working_copy_key IS NOT NULL
				ORDER BY working_copy_since, id
				LIMIT ?
			`).bind(new Date(input.staleClaimsBefore).getTime(), input.limit).all<{
				id: string;
				working_copy_key: string;
			}>();
			if (!result.success)
				throw new Error('Stale graphics discrepancy working copies could not be read');
			return result.results.map(row => ({
				id: row.id,
				workingCopyKey: row.working_copy_key,
			}));
		},
		async getReconciliationState() {
			const row = await database.prepare(`
				SELECT canonical_scan_cursor, canonical_scan_started_at,
					last_sweep_correlation_id, last_sweep_started_at, last_sweep_completed_at
				FROM graphics_reconciliation_state WHERE id = 1
			`).first<{
				canonical_scan_cursor: string | null;
				canonical_scan_started_at: number | null;
				last_sweep_correlation_id: string | null;
				last_sweep_started_at: number | null;
				last_sweep_completed_at: number | null;
			}>();
			if (!row)
				return {};
			return {
				...(row.canonical_scan_cursor ? { canonicalScanCursor: row.canonical_scan_cursor } : {}),
				...(row.canonical_scan_started_at === null
					? {}
					: { canonicalScanStartedAt: new Date(row.canonical_scan_started_at).toISOString() }),
				...(row.last_sweep_correlation_id
					? { lastSweepCorrelationId: row.last_sweep_correlation_id }
					: {}),
				...(row.last_sweep_started_at === null
					? {}
					: { lastSweepStartedAt: new Date(row.last_sweep_started_at).toISOString() }),
				...(row.last_sweep_completed_at === null
					? {}
					: { lastSweepCompletedAt: new Date(row.last_sweep_completed_at).toISOString() }),
			};
		},
		async recordCanonicalScanProgress(input) {
			const results = await database.batch([
				database.prepare(`
					INSERT OR IGNORE INTO graphics_reconciliation_state (id) VALUES (1)
				`),
				database.prepare(`
					UPDATE graphics_reconciliation_state
					SET canonical_scan_cursor = ?, canonical_scan_started_at = ?
					WHERE id = 1
				`).bind(
					input.cursor ?? null,
					input.startedAt === undefined ? null : new Date(input.startedAt).getTime(),
				),
			]);
			if (results.some(result => !result.success))
				throw new Error('Canonical byte-store scan progress could not be recorded');
		},
		async recordReconciliationSweep(input) {
			const results = await database.batch([
				database.prepare(`
					INSERT OR IGNORE INTO graphics_reconciliation_state (id) VALUES (1)
				`),
				database.prepare(`
					UPDATE graphics_reconciliation_state
					SET last_sweep_correlation_id = ?,
						last_sweep_started_at = ?,
						last_sweep_completed_at = ?
					WHERE id = 1
				`).bind(
					input.correlationId,
					new Date(input.startedAt).getTime(),
					new Date(input.completedAt).getTime(),
				),
			]);
			if (results.some(result => !result.success))
				throw new Error('Graphics reconciliation sweep could not be recorded');
		},
	};
}

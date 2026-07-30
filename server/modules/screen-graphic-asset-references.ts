import type { DbScreen } from '~~/server/db/schema';
import type { GraphicAssetReferencingScreenMode } from '~~/shared/utils/graphicsAssetReferences';
import { and, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { screens } from '~~/server/db/schema';
import { StateConflictError } from '~~/server/utils/errors';
import { mergeScreenModeConfig } from '~~/shared/types/screenConfig';
import {
	graphicAssetReferenceSlotPrefix,
	sameGraphicAssetReference,
	screenGraphicAssetReferenceTargetCompatibility,
	screenModeGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';

const GRAPHIC_ASSET_REFERENCE_SQL_PREDICATE = `
	AND (asset.lifecycle_state = 'active' OR ? = 1)
	AND asset.kind = ?
	AND (
		? != 'silent-video'
		OR json_extract(revision.technical_facts, '$.targetCompatibility') = ?
	)
	AND (
		COALESCE(?, '') != 'chromium-transparency'
		OR ? = 'chromium'
	)
`;

function graphicAssetReferencePredicateBindings(input: {
	allowRetired: boolean;
	kind: 'image' | 'silent-video' | 'font';
	videoCompatibility?: 'all-supported' | 'chromium-transparency';
	videoTarget?: 'chromium' | 'safari';
}) {
	return [
		input.allowRetired ? 1 : 0,
		input.kind,
		input.kind,
		input.videoCompatibility ?? null,
		input.videoCompatibility ?? null,
		input.videoTarget ?? null,
	] as const;
}

async function findScreen(id: number, eventId: number): Promise<DbScreen | undefined> {
	return await db.query.screens.findFirst({
		where: and(
			eq(screens.id, id),
			eq(screens.eventId, eventId),
		),
	});
}

export async function deleteScreenWithGraphicAssetReferences(
	id: number,
	eventId: number,
): Promise<boolean> {
	const referenceVersion = crypto.randomUUID();
	const client = db.$client;
	const results = await client.batch([
		client.prepare(`
			UPDATE screens
			SET graphic_asset_reference_version = ?
			WHERE id = ? AND event_id = ?
		`).bind(referenceVersion, id, eventId),
		client.prepare(`
			DELETE FROM graphic_asset_references
			WHERE owner_kind = 'screen' AND owner_id = ?
				AND EXISTS (
					SELECT 1 FROM screens
					WHERE id = ? AND event_id = ?
						AND graphic_asset_reference_version = ?
				)
		`).bind(String(id), id, eventId, referenceVersion),
		client.prepare(`
			DELETE FROM screens
			WHERE id = ? AND event_id = ?
				AND graphic_asset_reference_version = ?
		`).bind(id, eventId, referenceVersion),
	]);
	return results[2]?.meta.changes === 1;
}

/**
 * Write one graphics Screen Mode's configuration and its Graphic Asset Reference
 * index in a single atomic operation.
 *
 * Every mode that publishes references shares this one write, because the
 * guarantees are the mode-independent part: the configuration and its index move
 * together or not at all, each reference's exact revision must resolve for the
 * write to commit, and a revision already pinned at the same owner slot keeps
 * resolving even once its asset is retired. Only which references a configuration
 * publishes is mode-specific, and that is one dispatcher away.
 */
export async function updateScreenModeConfigWithGraphicAssetReferences(input: {
	id: number;
	eventId: number;
	mode: GraphicAssetReferencingScreenMode;
	partialConfig: Record<string, unknown>;
	stateVersion?: number;
}): Promise<DbScreen | undefined> {
	const screen = await findScreen(input.id, input.eventId);
	if (!screen)
		return undefined;

	const mergedConfigs = mergeScreenModeConfig(
		screen.modeConfigs ?? {},
		input.mode,
		input.partialConfig,
	);
	if (!mergedConfigs[input.mode])
		throw new Error(`${input.mode} configuration is missing`);

	const expectedVersion = input.stateVersion ?? screen.stateVersion;
	const referenceVersion = crypto.randomUUID();
	const now = Date.now();
	const references = screenModeGraphicAssetReferences(input.mode, mergedConfigs);
	if (references.some(reference =>
		screenGraphicAssetReferenceTargetCompatibility(reference).outcome === 'blocked')) {
		throw new StateConflictError('Screen Output target compatibility', input.id);
	}
	const previousReferences = new Map(
		screenModeGraphicAssetReferences(input.mode, screen.modeConfigs)
			.map(item => [item.ownerSlot, item.reference] as const),
	);
	const indexedReferences = references.map((item) => {
		const previous = previousReferences.get(item.ownerSlot);
		return {
			...item,
			allowRetired: sameGraphicAssetReference(previous, item.reference),
		};
	});
	const referencePreconditions = indexedReferences.map(() => `
		AND EXISTS (
			SELECT 1
			FROM graphic_asset_revisions revision
			JOIN graphic_assets asset ON asset.id = revision.asset_id
				WHERE revision.id = ? AND revision.asset_id = ?
					${GRAPHIC_ASSET_REFERENCE_SQL_PREDICATE}
			)
		`).join('');
	const referencePreconditionBindings = indexedReferences.flatMap(({
		reference,
		allowRetired,
		kind,
		videoCompatibility,
		videoTarget,
	}) => [
		reference.revisionId,
		reference.assetId,
		...graphicAssetReferencePredicateBindings({
			allowRetired,
			kind,
			videoCompatibility,
			videoTarget,
		}),
	]);
	const client = db.$client;
	const statements: D1PreparedStatement[] = [
		client.prepare(`
			UPDATE screens
			SET mode_configs = ?, state_version = state_version + 1,
				graphic_asset_reference_version = ?, updated_at = ?
			WHERE id = ? AND event_id = ? AND state_version = ?
				${referencePreconditions}
		`).bind(
			JSON.stringify(mergedConfigs),
			referenceVersion,
			now,
			input.id,
			input.eventId,
			expectedVersion,
			...referencePreconditionBindings,
		),
		// Scoped to this mode's own owner-slot namespace. A Screen may hold a
		// configuration for every mode at once, so an unscoped delete would clear
		// another mode's rows and leave its outputs unable to resolve content the
		// Screen still publishes — silently, because the revisions still exist.
		client.prepare(`
			DELETE FROM graphic_asset_references
			WHERE owner_kind = 'screen' AND owner_id = ?
				AND owner_slot LIKE ?
				AND EXISTS (
					SELECT 1 FROM screens
					WHERE id = ? AND event_id = ?
						AND graphic_asset_reference_version = ?
				)
		`).bind(
			String(input.id),
			`${graphicAssetReferenceSlotPrefix(input.mode)}%`,
			input.id,
			input.eventId,
			referenceVersion,
		),
		...indexedReferences.map(({
			reference,
			ownerSlot,
			allowRetired,
			kind,
			videoCompatibility,
			videoTarget,
		}) => client.prepare(`
			INSERT INTO graphic_asset_references (
				id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
				event_id, created_at, updated_at
			)
			SELECT ?, ?, ?, 'screen', ?, ?, ?, ?, ?
			FROM graphic_asset_revisions revision
			JOIN graphic_assets asset ON asset.id = revision.asset_id
				WHERE revision.id = ? AND revision.asset_id = ?
					${GRAPHIC_ASSET_REFERENCE_SQL_PREDICATE}
					AND EXISTS (
					SELECT 1 FROM screens
					WHERE id = ? AND event_id = ?
						AND graphic_asset_reference_version = ?
				)
		`).bind(
			crypto.randomUUID(),
			reference.assetId,
			reference.revisionId,
			String(input.id),
			ownerSlot,
			input.eventId,
			now,
			now,
			reference.revisionId,
			reference.assetId,
			...graphicAssetReferencePredicateBindings({
				allowRetired,
				kind,
				videoCompatibility,
				videoTarget,
			}),
			input.id,
			input.eventId,
			referenceVersion,
		)),
	];
	const [updateResult] = await client.batch(statements);
	if (updateResult?.meta.changes !== 1) {
		const current = await findScreen(input.id, input.eventId);
		if (!current)
			return undefined;
		throw new StateConflictError('Screen', input.id);
	}
	return await findScreen(input.id, input.eventId);
}

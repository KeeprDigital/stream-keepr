import type { DbScreen } from '~~/server/db/schema';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { and, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { screens } from '~~/server/db/schema';
import { StateConflictError } from '~~/server/utils/errors';
import { mergeScreenModeConfig } from '~~/shared/types/screenConfig';
import {
	featureMatchOverlayGraphicAssetReferences,
	sameGraphicAssetReference,
} from '~~/shared/utils/graphicsAssetReferences';

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

export async function updateFeatureMatchOverlayWithGraphicAssetReferences(input: {
	id: number;
	eventId: number;
	partialConfig: Record<string, unknown>;
	stateVersion?: number;
}): Promise<DbScreen | undefined> {
	const screen = await findScreen(input.id, input.eventId);
	if (!screen)
		return undefined;

	const mergedConfigs = mergeScreenModeConfig(
		screen.modeConfigs ?? {},
		'feature-match-overlay',
		input.partialConfig,
	);
	const config = mergedConfigs['feature-match-overlay'] as FeatureMatchOverlayModeConfig | undefined;
	if (!config)
		throw new Error('Feature Match Overlay configuration is missing');

	const expectedVersion = input.stateVersion ?? screen.stateVersion;
	const referenceVersion = crypto.randomUUID();
	const now = Date.now();
	const references = featureMatchOverlayGraphicAssetReferences(config);
	const previousConfig = screen.modeConfigs?.['feature-match-overlay'];
	const previousReferences = new Map(
		previousConfig
			? featureMatchOverlayGraphicAssetReferences(previousConfig)
					.map(item => [item.ownerSlot, item.reference] as const)
			: [],
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
				AND (asset.lifecycle_state = 'active' OR ? = 1)
		)
	`).join('');
	const referencePreconditionBindings = indexedReferences.flatMap(({ reference, allowRetired }) => [
		reference.revisionId,
		reference.assetId,
		allowRetired ? 1 : 0,
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
		client.prepare(`
			DELETE FROM graphic_asset_references
			WHERE owner_kind = 'screen' AND owner_id = ?
				AND EXISTS (
					SELECT 1 FROM screens
					WHERE id = ? AND event_id = ?
						AND graphic_asset_reference_version = ?
				)
		`).bind(String(input.id), input.id, input.eventId, referenceVersion),
		...indexedReferences.map(({ reference, ownerSlot, allowRetired }) => client.prepare(`
			INSERT INTO graphic_asset_references (
				id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
				event_id, created_at, updated_at
			)
			SELECT ?, ?, ?, 'screen', ?, ?, ?, ?, ?
			FROM graphic_asset_revisions revision
			JOIN graphic_assets asset ON asset.id = revision.asset_id
			WHERE revision.id = ? AND revision.asset_id = ?
				AND (asset.lifecycle_state = 'active' OR ? = 1)
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
			allowRetired ? 1 : 0,
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

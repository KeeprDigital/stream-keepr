import type { ScreenOutputAssetAuthorizationInput } from '.';
import { GRAPHIC_ASSET_REFERENCING_SCREEN_MODES } from '~~/shared/utils/graphicsAssetReferences';

/**
 * A Screen Output resolves content only while its Screen is in a mode that
 * publishes Graphic Asset References.
 *
 * The list rather than one mode: a Broadcast Graphics Screen publishes references
 * exactly as a Feature Match Overlay Screen does, and both expose Overlay, Fill,
 * and Key Outputs that have to resolve them. The clause still matters — a Screen
 * switched away from a graphics mode keeps that mode's stored configuration and so
 * its index, and its outputs must stop resolving content the Screen is no longer
 * showing.
 */
const REFERENCING_MODE_PLACEHOLDERS = GRAPHIC_ASSET_REFERENCING_SCREEN_MODES.map(() => '?').join(', ');

export function createD1ScreenOutputAssetAuthorizer(database: D1Database) {
	return {
		async authorizeCapability(input: {
			screenId: number;
			capabilityDigest: string;
			actualVideoTarget?: 'chromium' | 'safari' | 'other';
		}) {
			const row = await database.prepare(`
				SELECT EXISTS (
					SELECT 1
					FROM graphic_asset_references reference
					JOIN graphic_asset_revisions revision
						ON revision.id = reference.revision_id
						AND revision.asset_id = reference.asset_id
					WHERE reference.owner_kind = 'screen'
						AND reference.owner_id = CAST(screen.id AS TEXT)
						AND json_extract(
							revision.technical_facts,
							'$.targetCompatibility'
						) = 'chromium-transparency'
				) AS restricted
				FROM screens screen
				WHERE screen.id = ?
					AND screen.asset_capability_digest = ?
				LIMIT 1
			`).bind(
				input.screenId,
				input.capabilityDigest,
			).first<{ restricted: number }>();
			if (!row)
				return { outcome: 'missing' as const };
			if (row.restricted === 1 && input.actualVideoTarget !== 'chromium') {
				return {
					outcome: 'incompatible' as const,
					code: 'vp9-alpha-chromium-required' as const,
				};
			}
			return { outcome: 'authorized' as const };
		},

		async authorize(input: ScreenOutputAssetAuthorizationInput) {
			const row = await database.prepare(`
				SELECT revision.content_digest AS contentIdentity
				FROM screens screen
				JOIN graphic_asset_references reference
					ON reference.owner_kind = 'screen'
					AND reference.owner_id = CAST(screen.id AS TEXT)
				JOIN graphic_asset_revisions revision
					ON revision.id = reference.revision_id
					AND revision.asset_id = reference.asset_id
				WHERE screen.id = ?
					AND screen.current_mode IN (${REFERENCING_MODE_PLACEHOLDERS})
					AND screen.asset_capability_digest = ?
					AND reference.asset_id = ?
					AND reference.revision_id = ?
				LIMIT 1
			`).bind(
				input.screenId,
				...GRAPHIC_ASSET_REFERENCING_SCREEN_MODES,
				input.capabilityDigest,
				input.assetId,
				input.revisionId,
			).first<{ contentIdentity: string }>();
			return row
				? {
						outcome: 'authorized' as const,
						contentIdentity: row.contentIdentity,
					}
				: { outcome: 'missing' as const };
		},
	};
}

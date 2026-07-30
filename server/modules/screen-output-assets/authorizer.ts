import type { ScreenOutputAssetAuthorizationInput } from '.';

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
					AND screen.current_mode = 'feature-match-overlay'
					AND screen.asset_capability_digest = ?
					AND reference.asset_id = ?
					AND reference.revision_id = ?
				LIMIT 1
			`).bind(
				input.screenId,
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

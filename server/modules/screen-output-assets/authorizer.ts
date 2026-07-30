import type { ScreenOutputAssetAuthorizationInput } from '.';
import {
	GRAPHIC_ASSET_REFERENCE_SLOT_PREFIXES,
	GRAPHIC_ASSET_REFERENCING_SCREEN_MODES,
} from '~~/shared/utils/graphicsAssetReferences';

/**
 * A Screen Output resolves exactly the references its Screen's current mode
 * publishes, and nothing else in the index.
 *
 * Both halves matter, and neither alone is enough. The mode has to be one that
 * publishes references at all — a Screen switched away from a graphics mode keeps
 * that mode's stored configuration and so its index rows, and its outputs must
 * stop resolving content the Screen is no longer showing. And the reference has to
 * belong to *that* mode: a Screen may hold every mode's configuration at once, so
 * its index holds every mode's references at once, and matching the mode alone
 * would let a Feature Match Overlay output resolve a Broadcast Graphics reference.
 *
 * Pairing each mode with its own owner-slot namespace is what states both at once.
 */
const MODE_SLOT_SCOPE = GRAPHIC_ASSET_REFERENCING_SCREEN_MODES
	.map(() => '(screen.current_mode = ? AND reference.owner_slot LIKE ?)')
	.join(' OR ');

const MODE_SLOT_SCOPE_BINDINGS = GRAPHIC_ASSET_REFERENCING_SCREEN_MODES
	.flatMap(mode => [mode, `${GRAPHIC_ASSET_REFERENCE_SLOT_PREFIXES[mode]}%`]);

export function createD1ScreenOutputAssetAuthorizer(database: D1Database) {
	return {
		async authorizeCapability(input: {
			screenId: number;
			capabilityDigest: string;
			actualVideoTarget?: 'chromium' | 'safari' | 'other';
		}) {
			// Scoped to the current mode too: a VP9-alpha video referenced by some
			// other mode's stored configuration is not on this output, so it must not
			// decide whether this output's capability session is refused.
			const row = await database.prepare(`
				SELECT EXISTS (
					SELECT 1
					FROM graphic_asset_references reference
					JOIN graphic_asset_revisions revision
						ON revision.id = reference.revision_id
						AND revision.asset_id = reference.asset_id
					WHERE reference.owner_kind = 'screen'
						AND reference.owner_id = CAST(screen.id AS TEXT)
						AND (${MODE_SLOT_SCOPE})
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
				...MODE_SLOT_SCOPE_BINDINGS,
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
					AND (${MODE_SLOT_SCOPE})
					AND screen.asset_capability_digest = ?
					AND reference.asset_id = ?
					AND reference.revision_id = ?
				LIMIT 1
			`).bind(
				input.screenId,
				...MODE_SLOT_SCOPE_BINDINGS,
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

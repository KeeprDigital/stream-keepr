import type { ScreenOutputAssetAuthorizationInput } from '.';
import {
	GRAPHIC_ASSET_REFERENCING_SCREEN_MODES,
	screenOutputResolvableSlotPrefixes,
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
 * Pairing each mode with its own owner-slot namespaces is what states both at once.
 * Broadcast Graphics has two — authored configuration and its Broadcast Graphics
 * Live Session's accepted media Graphic Input values — because both are on air, and
 * a media value chosen live is otherwise a graphic whose media the output cannot
 * fetch.
 */
const MODE_SLOT_SCOPES = GRAPHIC_ASSET_REFERENCING_SCREEN_MODES.flatMap(mode =>
	screenOutputResolvableSlotPrefixes(mode).map(prefix => [mode, `${prefix}%`] as const),
);

const MODE_SLOT_SCOPE = MODE_SLOT_SCOPES
	.map(() => '(screen.current_mode = ? AND reference.owner_slot LIKE ?)')
	.join(' OR ');

const MODE_SLOT_SCOPE_BINDINGS = MODE_SLOT_SCOPES.flatMap(scope => [...scope]);

export function createD1ScreenOutputAssetAuthorizer(database: D1Database) {
	return {
		/**
		 * Whether this capability may open a session at all.
		 *
		 * Deliberately says nothing about playback compatibility. It used to: a single
		 * `EXISTS` over the Screen's references refused the whole session when any one
		 * of them pinned a chromium-transparency revision and the requesting engine was
		 * not Chromium. That answered the wrong question at the wrong grain — the
		 * output then resolved no content URL for *anything*, so one clip nobody could
		 * play cost the operator every image, video, and font the Screen publishes, and
		 * the per-item diagnostic meant to explain it could never render because its
		 * `src` was empty too (#98).
		 *
		 * Compatibility is now decided per resolution request, in `authorize` below,
		 * against the exact revision being asked for.
		 */
		async authorizeCapability(input: {
			screenId: number;
			capabilityDigest: string;
		}) {
			const row = await database.prepare(`
				SELECT screen.id AS id
				FROM screens screen
				WHERE screen.id = ?
					AND screen.asset_capability_digest = ?
				LIMIT 1
			`).bind(
				input.screenId,
				input.capabilityDigest,
			).first<{ id: number }>();
			return row
				? { outcome: 'authorized' as const }
				: { outcome: 'missing' as const };
		},

		/**
		 * Whether this Screen Output may resolve one exact Graphic Asset Revision now.
		 *
		 * The revision's own recorded technical facts decide compatibility, never the
		 * authored `videoTarget`: what an author declared is a write-time enabling
		 * choice, while what is being answered here is whether the engine on the other
		 * end of *this* request can decode these bytes.
		 *
		 * Refused separately from `missing`, because the two are different facts about
		 * different things and the operator's next action differs. Missing means this
		 * Screen does not publish the revision; incompatible means it does, and this
		 * browser cannot play it.
		 */
		async authorize(input: ScreenOutputAssetAuthorizationInput) {
			const row = await database.prepare(`
				SELECT
					revision.content_digest AS contentIdentity,
					json_extract(revision.technical_facts, '$.targetCompatibility') AS targetCompatibility
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
			).first<{ contentIdentity: string; targetCompatibility: string | null }>();
			if (!row)
				return { outcome: 'missing' as const };
			if (
				row.targetCompatibility === 'chromium-transparency'
				&& input.actualVideoTarget !== 'chromium'
			) {
				return {
					outcome: 'incompatible' as const,
					code: 'vp9-alpha-chromium-required' as const,
				};
			}
			return {
				outcome: 'authorized' as const,
				contentIdentity: row.contentIdentity,
			};
		},
	};
}

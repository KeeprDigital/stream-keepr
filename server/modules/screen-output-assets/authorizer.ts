import type { GraphicsVideoTarget } from '~~/shared/utils/graphicAssetTargetCompatibility';
import type { ScreenOutputAssetAuthorizationInput } from '.';
import { chromiumTransparencyTargetCompatibility } from '~~/shared/utils/graphicAssetTargetCompatibility';
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

/**
 * Whether one revision's recorded facts refuse one engine.
 *
 * One implementation, called by both the refusal and the forecast, because they
 * are the same question asked at two moments — and two implementations of one
 * rule agree only until someone edits one of them. Expressed here rather than in
 * either query so neither can drift: SQL is where it was tempting to put the
 * forecast's half, and a `json_extract(…) = …` comparison is invisible to every
 * test that exercises the other side.
 *
 * The shared vocabulary answers it, with the actual engine standing in for both
 * of its target arguments. A Screen Output has no authored target in play: what
 * an author declared is a write-time enabling choice, and what is being decided
 * here is whether the engine on the other end can decode these bytes.
 */
function revisionRefusal(
	targetCompatibility: string | null,
	actualVideoTarget: GraphicsVideoTarget,
) {
	return chromiumTransparencyTargetCompatibility(
		targetCompatibility === 'chromium-transparency',
		actualVideoTarget,
		actualVideoTarget,
	);
}

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
		 * Which of the Screen's published revisions this engine will be refused.
		 *
		 * A forecast, not a gate. `authorizeCapability` above still says nothing about
		 * playback compatibility and the session still opens for every engine, because
		 * the fault #98 closed was a Screen-wide *refusal* — one clip nobody could play
		 * costing an output every other asset it publishes. Naming the same clips
		 * without refusing anything costs nothing and closes the opposite fault: an
		 * output that renders a `<video>` for bytes it is about to be refused, because
		 * the only thing it had to go on was the compatibility copied into a Media
		 * Graphic Item's configuration — a copy the revision's own technical facts can
		 * outlive (#184).
		 *
		 * Read from those facts rather than from any authored value, and decided by
		 * the same `revisionRefusal` predicate `authorize` decides with, so the
		 * forecast and the refusal are one rule rather than two that happen to agree.
		 * Chromium is asked nothing, because there is nothing it cannot play.
		 *
		 * The query narrows to revisions that record a compatibility at all and then
		 * lets the predicate judge them. That narrowing is safe whatever the predicate
		 * becomes: a revision whose facts record no compatibility has nothing for any
		 * version of this rule to refuse, so the filter can only ever drop rows the
		 * predicate would have cleared.
		 */
		async unplayableRevisions(input: {
			screenId: number;
			capabilityDigest: string;
			actualVideoTarget: GraphicsVideoTarget;
		}) {
			if (input.actualVideoTarget === 'chromium')
				return [];
			const rows = await database.prepare(`
				SELECT DISTINCT
					reference.asset_id AS assetId,
					reference.revision_id AS revisionId,
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
					AND json_extract(revision.technical_facts, '$.targetCompatibility') IS NOT NULL
			`).bind(
				input.screenId,
				...MODE_SLOT_SCOPE_BINDINGS,
				input.capabilityDigest,
			).all<{ assetId: string; revisionId: string; targetCompatibility: string | null }>();
			return (rows.results ?? []).flatMap((row) => {
				const refusal = revisionRefusal(row.targetCompatibility, input.actualVideoTarget);
				return refusal.outcome === 'blocked'
					? [{ assetId: row.assetId, revisionId: row.revisionId, code: refusal.code }]
					: [];
			});
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
			const refusal = revisionRefusal(row.targetCompatibility, input.actualVideoTarget);
			if (refusal.outcome === 'blocked')
				return { outcome: 'incompatible' as const, code: refusal.code };
			return {
				outcome: 'authorized' as const,
				contentIdentity: row.contentIdentity,
			};
		},
	};
}

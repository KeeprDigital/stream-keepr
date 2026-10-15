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
		/** Whether this capability may open a session at all. */
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
		 * Which Screen a capability is for, without being told (#397).
		 *
		 * `authorizeCapability` above answers "is this capability *this* Screen's",
		 * which is the right question for a route that already has a screenId in its
		 * path. The realtime token has none: a Screen Output asks for a token with the
		 * capability it holds and nothing else, and the grant it gets back has to be
		 * narrowed to that Screen's channels — so the capability has to name the
		 * Screen rather than merely confirm one.
		 *
		 * It can, because `screens_asset_capability_digest_idx` is **unique**: a digest
		 * identifies at most one Screen, so this is a lookup rather than a search, and
		 * a rotation cannot leave two Screens answering to the same bearer.
		 *
		 * The Event comes back with it because every channel in the grant is
		 * Event-scoped (`shared/utils/realtimeChannels.ts`), and deriving the Event
		 * from the capability rather than trusting the caller's query is what stops a
		 * bearer for one Event's Screen asking for a grant on another's.
		 */
		async screenForCapability(input: { capabilityDigest: string }) {
			const row = await database.prepare(`
				SELECT screen.id AS id, screen.event_id AS eventId
				FROM screens screen
				WHERE screen.asset_capability_digest = ?
				LIMIT 1
			`).bind(
				input.capabilityDigest,
			).first<{ id: number; eventId: number }>();
			return row ? { screenId: row.id, eventId: row.eventId } : null;
		},

		/**
		 * Whether this Screen Output may resolve one exact Graphic Asset Revision now.
		 *
		 * Every engine is answered alike: Chromium is the only supported engine for
		 * transparent video (ADR-0020), so there is no per-engine refusal to make.
		 */
		async authorize(input: ScreenOutputAssetAuthorizationInput) {
			const row = await database.prepare(`
				SELECT
					revision.content_digest AS contentIdentity
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
			if (!row)
				return { outcome: 'missing' as const };
			return {
				outcome: 'authorized' as const,
				contentIdentity: row.contentIdentity,
			};
		},
	};
}

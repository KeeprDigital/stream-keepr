import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DbScreen } from '~~/server/db/schema';
import type { GraphicsAuthoringLeaseFence } from '~~/server/modules/graphics-authoring-lease';
import type {
	GraphicAssetReferencingScreenMode,
	ScreenGraphicAssetReference,
} from '~~/shared/utils/graphicsAssetReferences';
import { and, eq, like } from 'drizzle-orm';
import { db } from '~~/server/db';
import { screens } from '~~/server/db/schema';
import { graphicAssetReferences } from '~~/server/db/schema/graphicsAsset';
import {
	BOUND_GRAPHIC_ASSET_REFERENCE_RESOLUTION,
	boundGraphicAssetReferenceFacts,
	graphicAssetReferenceBindings,
	jsonElementGraphicAssetRevisionResolution,
	REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE,
} from '~~/server/modules/graphic-asset-reference-resolution';
import {
	graphicsAuthoringLeaseConflict,
	graphicsAuthoringLeaseFenceClause,
	graphicsAuthoringLeaseModule,
} from '~~/server/modules/graphics-authoring-lease';
import { mapDeckSourceConflict, StateConflictError } from '~~/server/utils/errors';
import { mergeScreenModeConfig } from '~~/shared/types/screenConfig';
import {
	BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX,
	graphicAssetReferenceSlotPrefix,
	sameGraphicAssetReference,
	screenModeGraphicAssetReferences,
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

/**
 * Write one referencing Screen Mode's configuration and its Graphic Asset Reference
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
	/** Commit only while no other Session holds the Edit workspace's lease (#607). */
	leaseFence?: GraphicsAuthoringLeaseFence;
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
	const previousReferences = new Map(
		screenModeGraphicAssetReferences(input.mode, screen.modeConfigs)
			.map(item => [item.ownerSlot, item.reference] as const),
	);
	const indexedReferences = references.map((item) => {
		const previous = previousReferences.get(item.ownerSlot);
		return {
			...item,
			id: crypto.randomUUID(),
			allowRetired: sameGraphicAssetReference(previous, item.reference),
		};
	});
	// One encoding binds the precondition and the index insert, so the set the
	// save is refused on and the set it indexes cannot drift apart.
	const boundFacts = boundGraphicAssetReferenceFacts(indexedReferences);
	const fence = input.leaseFence
		? graphicsAuthoringLeaseFenceClause(input.leaseFence, now)
		: undefined;
	const client = db.$client;
	const statements: D1PreparedStatement[] = [
		client.prepare(`
			UPDATE screens
			SET mode_configs = ?, state_version = state_version + 1,
				graphic_asset_reference_version = ?, updated_at = ?
			WHERE id = ? AND event_id = ? AND state_version = ?
				${REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE}
				${fence ? `AND ${fence.sql}` : ''}
		`).bind(
			JSON.stringify(mergedConfigs),
			referenceVersion,
			now,
			input.id,
			input.eventId,
			expectedVersion,
			boundFacts,
			...(fence?.params ?? []),
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
		// The whole index in one statement, derived from the same bound array the
		// precondition reads (#374). One `INSERT` per reference made a maximal
		// authored save a six-hundred-statement batch, and remote D1 prices a batch
		// by its statements' row churn — the #374 series put the cap regime at ~90s
		// and an ordinary sixty-reference show at ~8s. The per-element resolution
		// rule is the same rule the precondition asks, so a reference that must not
		// resolve is absent from the index exactly as it refused the save; the
		// version guard keeps the insert a no-op whenever the `UPDATE` did not
		// commit this write's version.
		...(indexedReferences.length === 0
			? []
			: [client.prepare(`
				INSERT INTO graphic_asset_references (
					id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
					event_id, created_at, updated_at
				)
				SELECT
					json_extract(item.value, '$.id'),
					json_extract(item.value, '$.assetId'),
					json_extract(item.value, '$.revisionId'),
					'screen', ?, json_extract(item.value, '$.ownerSlot'), ?, ?, ?
				FROM json_each(?) AS item
				WHERE EXISTS (
					SELECT 1
					${jsonElementGraphicAssetRevisionResolution('item')}
				)
					AND EXISTS (
						SELECT 1 FROM screens
						WHERE id = ? AND event_id = ?
							AND graphic_asset_reference_version = ?
					)
			`).bind(
					String(input.id),
					input.eventId,
					now,
					now,
					boundFacts,
					input.id,
					input.eventId,
					referenceVersion,
				)]),
	];
	const [updateResult] = await client.batch(statements).catch(mapDeckSourceConflict);
	if (updateResult?.meta.changes !== 1) {
		const current = await findScreen(input.id, input.eventId);
		if (!current)
			return undefined;
		// Which of the guards refused it, told apart so the operator is not pointed
		// at a retry that can never succeed. A version that still stands means the
		// lease fence or a reference refused it: the fence first, because a lease
		// held by somebody else is the answer whatever the references say. Otherwise
		// a reference stopped resolving — a retirement or a purge under the author's
		// read — and that is a different conflict from a concurrent Screen edit,
		// which the client's own reload-and-restate does converge on. All are 409;
		// only the last is worth restating.
		if (current.stateVersion === expectedVersion && input.leaseFence
			&& await graphicsAuthoringLeaseModule().fenceRefused(input.leaseFence, now)) {
			throw graphicsAuthoringLeaseConflict();
		}
		throw current.stateVersion === expectedVersion
			? new StateConflictError('Graphic Asset Reference', input.id)
			: new StateConflictError('Screen', input.id);
	}
	return await findScreen(input.id, input.eventId);
}

/**
 * The Broadcast Graphics Live Session's own owner-slot namespace, as a `LIKE`
 * pattern. Held here so the delete that scopes to it and the prefix the slots are
 * built from can never drift apart.
 */
const LIVE_SESSION_SLOT_PATTERN = `${BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX}%`;

/**
 * Bring a Screen's Broadcast Graphics Live Session reference index in line with the
 * media Graphic Input values its Live Session has accepted.
 *
 * ## Why this exists at all
 *
 * A Screen Output Asset Capability derived from `modeConfigs` alone cannot resolve a
 * media value an operator chose at runtime: it is not in authored configuration. So
 * the Screen publishes from two places, and this is the write for the second one.
 * It is scoped to its own owner-slot namespace, disjoint from the authored write's,
 * because both clear and rewrite their whole namespace and either sharing one would
 * silently delete the other's rows.
 *
 * ## Why it is guarded on the sequence it was derived from
 *
 * Accepted values change on every acceptance, so unlike the authored index this one
 * is rewritten constantly and concurrently. Every statement is conditioned on the
 * Live Session still standing at the sequence the reference set was derived from, so
 * a reconciliation whose state has already been superseded applies nothing at all
 * rather than reinstating an older set of references over a newer one. The command
 * that superseded it reconciles from its own committed state, so the index converges
 * on the latest acceptance rather than on whichever write happened to land last.
 *
 * An ended epoch is not reconciled either: the guard requires an active session, and
 * ending one clears the namespace outright.
 *
 * ## Retirement
 *
 * A revision already published at the same owner slot keeps resolving even once its
 * Graphic Asset is retired, exactly as an authored reference does — a retired asset
 * takes no *new* references, and an operator who chose one before it was retired is
 * still showing it.
 */
export async function updateBroadcastGraphicsLiveSessionGraphicAssetReferences(input: {
	screenId: number;
	eventId: number;
	sessionId: number;
	/** The Live Session sequence `references` was derived from. */
	sequence: number;
	references: readonly ScreenGraphicAssetReference[];
	/** What the same derivation produced before this acceptance, for the retirement rule. */
	previousReferences?: readonly ScreenGraphicAssetReference[];
}): Promise<{ expected: number; indexed: number }> {
	const previousBySlot = new Map(
		(input.previousReferences ?? []).map(item => [item.ownerSlot, item.reference] as const),
	);
	const now = Date.now();
	const client = db.$client;
	const sessionGuard = `
		AND EXISTS (
			SELECT 1 FROM broadcast_graphics_live_sessions
			WHERE id = ? AND screen_id = ? AND sequence = ? AND status = 'active'
		)
	`;
	const sessionGuardBindings = [input.sessionId, input.screenId, input.sequence] as const;

	const results = await client.batch([
		client.prepare(`
			DELETE FROM graphic_asset_references
			WHERE owner_kind = 'screen' AND owner_id = ?
				AND owner_slot LIKE ?
				${sessionGuard}
		`).bind(String(input.screenId), LIVE_SESSION_SLOT_PATTERN, ...sessionGuardBindings),
		...input.references.map(item => client.prepare(`
			INSERT INTO graphic_asset_references (
				id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
				event_id, created_at, updated_at
			)
			SELECT ?, ?, ?, 'screen', ?, ?, ?, ?, ?
			${BOUND_GRAPHIC_ASSET_REFERENCE_RESOLUTION}
				${sessionGuard}
		`).bind(
			crypto.randomUUID(),
			item.reference.assetId,
			item.reference.revisionId,
			String(input.screenId),
			item.ownerSlot,
			input.eventId,
			now,
			now,
			...graphicAssetReferenceBindings({
				reference: item.reference,
				allowRetired: sameGraphicAssetReference(previousBySlot.get(item.ownerSlot), item.reference),
				kind: item.kind,
			}),
			...sessionGuardBindings,
		)),
	]);

	return {
		expected: input.references.length,
		indexed: results.slice(1).reduce((total, result) => total + (result.meta.changes ?? 0), 0),
	};
}

/**
 * The statement dropping everything a Screen's Broadcast Graphics Live Session
 * published.
 *
 * An epoch that has ended has no accepted values, so it publishes nothing. Leaving
 * its rows behind would keep a revision resolvable through a Screen Output long
 * after the show that chose it, and a Screen switched away and back would find media
 * on air that the new epoch never accepted.
 *
 * Returned rather than executed because it belongs in the same commit as the end of
 * the epoch that published them. Run on its own after that commit — as it was — its
 * failure left an ended epoch's media resolvable through the Screen's outputs and
 * skipped the epoch-ended announcement that followed it, so every peer went on
 * rendering a show that had finished. #305.
 *
 * `onlyIf` is for an end riding in the batch of the write that causes it: a batch
 * applies every statement it holds whether or not the ones before it matched
 * anything, so a clear travelling with a mode change that may be refused has to
 * state that condition itself.
 */
export function clearBroadcastGraphicsLiveSessionGraphicAssetReferencesStatement(
	screenId: number,
	onlyIf?: SQL,
): BatchItem<'sqlite'> {
	return db.delete(graphicAssetReferences).where(and(
		eq(graphicAssetReferences.ownerKind, 'screen'),
		eq(graphicAssetReferences.ownerId, String(screenId)),
		like(graphicAssetReferences.ownerSlot, LIVE_SESSION_SLOT_PATTERN),
		onlyIf,
	));
}

/**
 * Drop what a Screen with no running epoch is still publishing, as a write of its
 * own.
 *
 * The repair rather than the end, and the distinction is why this exists alongside
 * the statement above rather than instead of it. Ending an epoch clears what it
 * published in the commit that ends it, because there the clear is a consequence
 * nothing else re-derives. Here there is no epoch and no commit to join: the
 * reconciliation found a Screen with no active session, which publishes nothing by
 * definition, so any surviving row is debris. The write is idempotent and re-driven
 * on every republish, so a failure converges on the next one instead of stranding.
 *
 * Awaiting the statement is what executes it: what the builder above returns is a
 * `BatchItem<'sqlite'>` because that is the type a caller putting it in a batch
 * needs, and a reader who takes it at its word here sees a statement being
 * discarded. Dropping the `await` would leave an ended show's media fetchable
 * through the Screen's outputs and read like tidying, so it is pinned by scenario
 * rather than left to the type — `broadcastGraphicsLiveReferences.sqlite.test.ts`,
 * "drops what a Screen with no epoch is still publishing" (#320).
 */
export async function clearOrphanedBroadcastGraphicsLiveSessionGraphicAssetReferences(
	screenId: number,
): Promise<void> {
	await clearBroadcastGraphicsLiveSessionGraphicAssetReferencesStatement(screenId);
}

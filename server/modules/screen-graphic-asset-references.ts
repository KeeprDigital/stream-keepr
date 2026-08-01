import type { DbScreen } from '~~/server/db/schema';
import type {
	GraphicAssetReferencingScreenMode,
	ScreenGraphicAssetReference,
} from '~~/shared/utils/graphicsAssetReferences';
import { and, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { screens } from '~~/server/db/schema';
import { StateConflictError } from '~~/server/utils/errors';
import { mergeScreenModeConfig } from '~~/shared/types/screenConfig';
import {
	BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX,
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
			FROM graphic_asset_revisions revision
			JOIN graphic_assets asset ON asset.id = revision.asset_id
				WHERE revision.id = ? AND revision.asset_id = ?
					${GRAPHIC_ASSET_REFERENCE_SQL_PREDICATE}
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
			item.reference.revisionId,
			item.reference.assetId,
			...graphicAssetReferencePredicateBindings({
				allowRetired: sameGraphicAssetReference(previousBySlot.get(item.ownerSlot), item.reference),
				kind: item.kind,
				videoCompatibility: item.videoCompatibility,
				videoTarget: item.videoTarget,
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
 * Drop everything a Screen's Broadcast Graphics Live Session published.
 *
 * An epoch that has ended has no accepted values, so it publishes nothing. Leaving
 * its rows behind would keep a revision resolvable through a Screen Output long
 * after the show that chose it, and a Screen switched away and back would find media
 * on air that the new epoch never accepted.
 */
export async function clearBroadcastGraphicsLiveSessionGraphicAssetReferences(
	screenId: number,
): Promise<void> {
	await db.$client.prepare(`
		DELETE FROM graphic_asset_references
		WHERE owner_kind = 'screen' AND owner_id = ? AND owner_slot LIKE ?
	`).bind(String(screenId), LIVE_SESSION_SLOT_PATTERN).run();
}

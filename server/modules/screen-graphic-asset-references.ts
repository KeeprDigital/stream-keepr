import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DbScreen } from '~~/server/db/schema';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type {
	GraphicAssetReferencingScreenMode,
	ScreenGraphicAssetReference,
} from '~~/shared/utils/graphicsAssetReferences';
import { and, eq, like } from 'drizzle-orm';
import { db } from 'hub:db';
import { screens } from '~~/server/db/schema';
import { graphicAssetReferences } from '~~/server/db/schema/graphicsAsset';
import { StateConflictError } from '~~/server/utils/errors';
import { mergeScreenModeConfig } from '~~/shared/types/screenConfig';
import {
	BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX,
	graphicAssetReferenceSlotPrefix,
	sameGraphicAssetReference,
	screenGraphicAssetReferenceTargetCompatibility,
	screenModeGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';

/** Everything the resolution rule below asks about one Graphic Asset Reference. */
interface GraphicAssetReferenceFacts {
	reference: GraphicAssetReference;
	allowRetired: boolean;
	kind: 'image' | 'silent-video' | 'font';
	videoCompatibility?: 'all-supported' | 'chromium-transparency';
	videoTarget?: 'chromium' | 'safari';
}

/**
 * Whether one Graphic Asset Reference resolves, as the `FROM … WHERE` tail of a
 * statement about the revision it names: the revision exists on the asset it
 * claims, the asset is still selectable, its kind is the one the configuration
 * expects, and a silent video's pinned target compatibility is the one the
 * reference was recorded against.
 *
 * Written against expressions rather than placeholders because the same rule is
 * asked in two shapes. Each index insert asks it about one reference with that
 * reference's facts bound as parameters; the configuration write asks it about
 * every reference at once, reading their facts out of a single bound JSON array.
 * Spelling it twice is how a retirement or compatibility rule comes to hold on the
 * insert and not on the precondition that admits it — which would be invisible,
 * because both statements ride in the same batch and only the precondition decides
 * whether the configuration commits.
 */
function resolvedGraphicAssetRevision(fact: {
	revisionId: string;
	assetId: string;
	allowRetired: string;
	kind: string;
	videoCompatibility: string;
	videoTarget: string;
}): string {
	return `
		FROM graphic_asset_revisions revision
		JOIN graphic_assets asset ON asset.id = revision.asset_id
			WHERE revision.id = ${fact.revisionId} AND revision.asset_id = ${fact.assetId}
				AND (asset.lifecycle_state = 'active' OR ${fact.allowRetired} = 1)
				AND asset.kind = ${fact.kind}
				AND (
					${fact.kind} != 'silent-video'
					OR json_extract(revision.technical_facts, '$.targetCompatibility') = ${fact.videoCompatibility}
				)
				AND (
					COALESCE(${fact.videoCompatibility}, '') != 'chromium-transparency'
					OR ${fact.videoTarget} = 'chromium'
				)
	`;
}

/**
 * The rule about one reference whose facts are bound as parameters, in the order
 * `graphicAssetReferenceBindings` produces them.
 *
 * The order is stated in one place and read in the other, so a fact added to the
 * rule cannot silently shift every later placeholder onto the wrong value.
 */
const BOUND_GRAPHIC_ASSET_REFERENCE_RESOLUTION = resolvedGraphicAssetRevision({
	revisionId: '?',
	assetId: '?',
	allowRetired: '?',
	kind: '?',
	videoCompatibility: '?',
	videoTarget: '?',
});

function graphicAssetReferenceBindings(fact: GraphicAssetReferenceFacts) {
	return [
		fact.reference.revisionId,
		fact.reference.assetId,
		fact.allowRetired ? 1 : 0,
		fact.kind,
		fact.kind,
		fact.videoCompatibility ?? null,
		fact.videoCompatibility ?? null,
		fact.videoTarget ?? null,
	] as const;
}

/**
 * The same rule asked of every reference at once, out of one bound JSON array.
 *
 * A configuration's references are as many as the show needs — a Broadcast
 * Graphics Screen may carry hundreds of Graphic Items, each able to pin media and
 * a font — and D1 binds at most a hundred parameters per statement. Bound one
 * placeholder per fact this precondition cost eight parameters per reference and
 * failed the whole save at twelve of them, permanently, until an author removed
 * references (#303). Read out of a single bound array it costs one parameter
 * whatever the configuration holds, so the count decides nothing.
 *
 * Stated as "no required reference fails to resolve" rather than as a count, so a
 * single unresolvable reference among hundreds still refuses the save — which is
 * the compare-and-swap guarantee the encoding exists to keep, not to trade away.
 *
 * `server/modules/graphics-asset-library/catalogue-sql.ts` takes the same escape
 * for lists of scalars and carries the reasoning at length; this one carries a
 * list of records, so it reads fields out of each element rather than the element
 * itself.
 */
const REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE = `
	AND NOT EXISTS (
		SELECT 1 FROM json_each(?) AS required
		WHERE NOT EXISTS (
			SELECT 1
			${resolvedGraphicAssetRevision({
				revisionId: `json_extract(required.value, '$.revisionId')`,
				assetId: `json_extract(required.value, '$.assetId')`,
				allowRetired: `json_extract(required.value, '$.allowRetired')`,
				kind: `json_extract(required.value, '$.kind')`,
				videoCompatibility: `json_extract(required.value, '$.videoCompatibility')`,
				videoTarget: `json_extract(required.value, '$.videoTarget')`,
			})}
		)
	)
`;

/** The bind value for `REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE`. */
function boundGraphicAssetReferenceFacts(facts: readonly GraphicAssetReferenceFacts[]): string {
	return JSON.stringify(facts.map(fact => ({
		revisionId: fact.reference.revisionId,
		assetId: fact.reference.assetId,
		allowRetired: fact.allowRetired ? 1 : 0,
		kind: fact.kind,
		videoCompatibility: fact.videoCompatibility ?? null,
		videoTarget: fact.videoTarget ?? null,
	})));
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
	const client = db.$client;
	const statements: D1PreparedStatement[] = [
		client.prepare(`
			UPDATE screens
			SET mode_configs = ?, state_version = state_version + 1,
				graphic_asset_reference_version = ?, updated_at = ?
			WHERE id = ? AND event_id = ? AND state_version = ?
				${REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE}
		`).bind(
			JSON.stringify(mergedConfigs),
			referenceVersion,
			now,
			input.id,
			input.eventId,
			expectedVersion,
			boundGraphicAssetReferenceFacts(indexedReferences),
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
		...indexedReferences.map(fact => client.prepare(`
			INSERT INTO graphic_asset_references (
				id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
				event_id, created_at, updated_at
			)
			SELECT ?, ?, ?, 'screen', ?, ?, ?, ?, ?
			${BOUND_GRAPHIC_ASSET_REFERENCE_RESOLUTION}
				AND EXISTS (
					SELECT 1 FROM screens
					WHERE id = ? AND event_id = ?
						AND graphic_asset_reference_version = ?
				)
		`).bind(
			crypto.randomUUID(),
			fact.reference.assetId,
			fact.reference.revisionId,
			String(input.id),
			fact.ownerSlot,
			input.eventId,
			now,
			now,
			...graphicAssetReferenceBindings(fact),
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
		// Which of the two guards refused it, told apart so the operator is not
		// pointed at a retry that can never succeed. The version guard is the only
		// other clause in the statement, so a version that still stands means a
		// reference stopped resolving — a retirement or a purge under the author's
		// read — and that is a different conflict from a concurrent Screen edit,
		// which the client's own reload-and-restate does converge on. Both are 409;
		// only one of them is worth restating.
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
 */
export async function clearOrphanedBroadcastGraphicsLiveSessionGraphicAssetReferences(
	screenId: number,
): Promise<void> {
	await clearBroadcastGraphicsLiveSessionGraphicAssetReferencesStatement(screenId);
}

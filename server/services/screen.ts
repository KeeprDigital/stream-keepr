import type { DbScreen, ScreenMode } from '~~/server/db/schema';
import type { CreateScreenInput, UpdateScreenInput } from '~~/shared/api';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import { and, eq, ne } from 'drizzle-orm';
import { db } from 'hub:db';
import { screens } from '~~/server/db/schema';
import { featureMatchOverlayGraphicAssetReferences } from '~~/server/modules/screen-graphic-asset-references';
import { StateConflictError } from '~~/server/utils/errors';
import { mergeScreenConfig, mergeScreenModeConfig } from '~~/shared/types/screenConfig';

export function screenService() {
	const findById = async (id: number, eventId: number): Promise<DbScreen | undefined> => {
		return await db.query.screens.findFirst({
			where: and(
				eq(screens.id, id),
				eq(screens.eventId, eventId),
			),
		});
	};

	const findBySlug = async (eventId: number, slug: string): Promise<DbScreen | undefined> => {
		return await db.query.screens.findFirst({
			where: and(eq(screens.eventId, eventId), eq(screens.slug, slug)),
		});
	};

	const findByEventId = async (eventId: number): Promise<DbScreen[]> => {
		return await db
			.select()
			.from(screens)
			.where(eq(screens.eventId, eventId))
			.orderBy(screens.name);
	};

	const findIdsByEventId = async (eventId: number): Promise<Array<{ id: number }>> => {
		return await db
			.select({ id: screens.id })
			.from(screens)
			.where(eq(screens.eventId, eventId));
	};

	const create = async (
		eventId: number,
		data: CreateScreenInput,
	): Promise<DbScreen> => {
		const [newScreen] = await db
			.insert(screens)
			.values({
				...data,
				eventId,
			})
			.returning();

		if (!newScreen) {
			throw new Error('Failed to create screen');
		}

		return newScreen;
	};

	/**
	 * Versioned write helper. Uses optimistic locking: the update only succeeds
	 * if `stateVersion` still matches the version we read. On conflict, throws
	 * `StateConflictError` (409).
	 */
	const versionedWrite = async (
		id: number,
		eventId: number,
		data: Partial<typeof screens.$inferInsert>,
		currentVersion: number,
	): Promise<DbScreen | undefined> => {
		const [result] = await db
			.update(screens)
			.set({ ...data, stateVersion: currentVersion + 1 })
			.where(and(
				eq(screens.id, id),
				eq(screens.eventId, eventId),
				eq(screens.stateVersion, currentVersion),
			))
			.returning();

		if (result)
			return result;

		const screen = await findById(id, eventId);
		if (!screen)
			return undefined;

		throw new StateConflictError('Screen', id);
	};

	const update = async (
		id: number,
		eventId: number,
		data: Omit<UpdateScreenInput, 'stateVersion'>,
		stateVersion: number,
	): Promise<DbScreen | undefined> => {
		return versionedWrite(id, eventId, data, stateVersion);
	};

	const remove = async (id: number, eventId: number): Promise<boolean> => {
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
	};

	const updateModeConfig = async (
		id: number,
		eventId: number,
		mode: ScreenMode,
		partialConfig: Record<string, unknown>,
		stateVersion?: number,
	): Promise<DbScreen | undefined> => {
		const screen = await findById(id, eventId);
		if (!screen)
			return undefined;

		const mergedConfigs = mergeScreenModeConfig(screen.modeConfigs ?? {}, mode, partialConfig);

		if (mode === 'feature-match-overlay') {
			const config = mergedConfigs[mode];
			if (!config)
				throw new Error('Feature Match Overlay configuration is missing');
			const expectedVersion = stateVersion ?? screen.stateVersion;
			const referenceVersion = crypto.randomUUID();
			const now = Date.now();
			const references = featureMatchOverlayGraphicAssetReferences(config);
			const client = db.$client;
			const previousConfig = screen.modeConfigs?.[mode];
			const previousReferences = new Map(
				previousConfig
					? featureMatchOverlayGraphicAssetReferences(previousConfig)
							.map(item => [item.ownerSlot, item.reference] as const)
					: [],
			);
			const indexedReferences = references.map((item) => {
				const previous = previousReferences.get(item.ownerSlot);
				const unchanged = previous?.assetId === item.reference.assetId
					&& previous.revisionId === item.reference.revisionId;
				return { ...item, allowRetired: unchanged };
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
					id,
					eventId,
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
				`).bind(String(id), id, eventId, referenceVersion),
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
					String(id),
					ownerSlot,
					eventId,
					now,
					now,
					reference.revisionId,
					reference.assetId,
					allowRetired ? 1 : 0,
					id,
					eventId,
					referenceVersion,
				)),
			];
			const [updateResult] = await client.batch(statements);
			if (updateResult?.meta.changes !== 1) {
				const current = await findById(id, eventId);
				if (!current)
					return undefined;
				throw new StateConflictError('Screen', id);
			}
			return await findById(id, eventId);
		}

		return versionedWrite(id, eventId, { modeConfigs: mergedConfigs }, stateVersion ?? screen.stateVersion);
	};

	const updateScreenConfig = async (
		id: number,
		eventId: number,
		partialConfig: Record<string, unknown>,
		stateVersion?: number,
	): Promise<DbScreen | undefined> => {
		const screen = await findById(id, eventId);
		if (!screen)
			return undefined;

		const currentConfig = (screen.screenConfig ?? {}) as ScreenConfig;
		const mergedConfig = mergeScreenConfig(currentConfig, partialConfig);

		return versionedWrite(id, eventId, { screenConfig: mergedConfig }, stateVersion ?? screen.stateVersion);
	};

	const slugExists = async (eventId: number, slug: string, excludeId?: number): Promise<boolean> => {
		const conditions = [
			eq(screens.eventId, eventId),
			eq(screens.slug, slug),
		];

		if (excludeId) {
			conditions.push(ne(screens.id, excludeId));
		}

		const screen = await db.query.screens.findFirst({
			where: and(...conditions),
			columns: { id: true },
		});

		return !!screen;
	};

	return {
		findById,
		findBySlug,
		findByEventId,
		findIdsByEventId,
		create,
		update,
		updateModeConfig,
		updateScreenConfig,
		remove,
		slugExists,
	};
}

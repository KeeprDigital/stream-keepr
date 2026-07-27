import type { DbScreen, ScreenMode } from '~~/server/db/schema';
import type { CreateScreenInput, UpdateScreenInput } from '~~/shared/api';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import { and, eq, ne } from 'drizzle-orm';
import { db } from 'hub:db';
import { screens } from '~~/server/db/schema';
import {
	deleteScreenWithGraphicAssetReferences,
	updateFeatureMatchOverlayWithGraphicAssetReferences,
} from '~~/server/modules/screen-graphic-asset-references';
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
		return await deleteScreenWithGraphicAssetReferences(id, eventId);
	};

	const updateModeConfig = async (
		id: number,
		eventId: number,
		mode: ScreenMode,
		partialConfig: Record<string, unknown>,
		stateVersion?: number,
	): Promise<DbScreen | undefined> => {
		if (mode === 'feature-match-overlay') {
			return await updateFeatureMatchOverlayWithGraphicAssetReferences({
				id,
				eventId,
				partialConfig,
				stateVersion,
			});
		}

		const screen = await findById(id, eventId);
		if (!screen)
			return undefined;

		const mergedConfigs = mergeScreenModeConfig(screen.modeConfigs ?? {}, mode, partialConfig);

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

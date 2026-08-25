import type { BatchItem } from 'drizzle-orm/batch';
import type { DbScreen, ScreenMode } from '~~/server/db/schema';
import type { PersistedScreenOutputAssetCapability } from '~~/server/modules/screen-output-assets/manager';
import type { CreateScreenInput, UpdateScreenInput } from '~~/shared/api';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import { and, eq, ne } from 'drizzle-orm';
import { db } from 'hub:db';
import { screens } from '~~/server/db/schema';
import {
	deleteScreenWithGraphicAssetReferences,
	updateScreenModeConfigWithGraphicAssetReferences,
} from '~~/server/modules/screen-graphic-asset-references';
import { ScreenDeckSourceConflictError, StateConflictError } from '~~/server/utils/errors';
import { mergeScreenConfig, mergeScreenModeConfig } from '~~/shared/types/screenConfig';
import { isGraphicAssetReferencingScreenMode } from '~~/shared/utils/graphicsAssetReferences';

export function screenService() {
	function mapDeckSourceConflict(error: unknown): never {
		let failure: unknown = error;
		while (failure && typeof failure === 'object') {
			if (String((failure as { message?: unknown }).message).includes('SCREEN_DECK_SOURCE_CONFLICT'))
				throw new ScreenDeckSourceConflictError();
			failure = (failure as { cause?: unknown }).cause;
		}
		throw error;
	}
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
		capability: PersistedScreenOutputAssetCapability,
	): Promise<DbScreen> => {
		let newScreen: DbScreen | undefined;
		try {
			[newScreen] = await db
				.insert(screens)
				.values({
					...data,
					eventId,
					...capability,
				})
				.returning();
		}
		catch (error) {
			mapDeckSourceConflict(error);
		}

		if (!newScreen) {
			throw new Error('Failed to create screen');
		}

		return newScreen;
	};

	const replaceAssetCapability = async (
		id: number,
		eventId: number,
		replacement: PersistedScreenOutputAssetCapability,
		expectedVersion: number,
	): Promise<DbScreen | undefined> => {
		const [updated] = await db
			.update(screens)
			.set(replacement)
			.where(and(
				eq(screens.id, id),
				eq(screens.eventId, eventId),
				eq(screens.assetCapabilityVersion, expectedVersion),
			))
			.returning();
		if (updated)
			return updated;
		const screen = await findById(id, eventId);
		if (!screen)
			return undefined;
		throw new StateConflictError('Screen Output Asset Capability', id);
	};

	/**
	 * Versioned write helper. Uses optimistic locking: the update only succeeds
	 * if `stateVersion` still matches the version we read. On conflict, throws
	 * `StateConflictError` (409).
	 *
	 * Always a batch, even for the write on its own, so there is one execution path
	 * rather than two that can drift — and so a caller with a consequence that must
	 * not be separable from the write has somewhere to put it.
	 */
	const versionedWrite = async (
		id: number,
		eventId: number,
		data: Partial<typeof screens.$inferInsert>,
		currentVersion: number,
		companions: readonly BatchItem<'sqlite'>[] = [],
	): Promise<DbScreen | undefined> => {
		let written;
		try {
			[written] = await db.batch([
				db
					.update(screens)
					.set({ ...data, stateVersion: currentVersion + 1 })
					.where(and(
						eq(screens.id, id),
						eq(screens.eventId, eventId),
						eq(screens.stateVersion, currentVersion),
					))
					.returning(),
				...companions,
			] as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
		}
		catch (error) {
			mapDeckSourceConflict(error);
		}
		const [result] = written as DbScreen[];

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
		/**
		 * Statements that commit with this write or not at all.
		 *
		 * A Screen write can have a consequence elsewhere that a second write issued
		 * afterwards cannot be trusted to deliver: leaving Broadcast Graphics mode ends
		 * the Screen's playout epoch, and an end that failed once the mode change had
		 * committed left a running epoch for the next activation to resurrect (#305).
		 * They travel here rather than being executed by the caller, so no failure has
		 * an instant between the two to happen in.
		 *
		 * Each is responsible for its own condition. A batch applies every statement it
		 * holds whether or not the ones before it matched anything, so a companion that
		 * must not apply when this write is refused has to say so itself.
		 */
		companions?: readonly BatchItem<'sqlite'>[],
	): Promise<DbScreen | undefined> => {
		return versionedWrite(id, eventId, data, stateVersion, companions);
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
		// A graphics mode's configuration and its Graphic Asset Reference index are
		// one write, so a Screen Output can never resolve a revision the Screen no
		// longer publishes, or fail to resolve one it does.
		if (isGraphicAssetReferencingScreenMode(mode)) {
			return await updateScreenModeConfigWithGraphicAssetReferences({
				id,
				eventId,
				mode,
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
		replaceAssetCapability,
		update,
		updateModeConfig,
		updateScreenConfig,
		remove,
		slugExists,
	};
}

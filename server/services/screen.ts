import type { SQLWrapper } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DbScreen, ScreenMode } from '~~/server/db/schema';
import type { GraphicsAuthoringLeaseFence } from '~~/server/modules/graphics-authoring-lease';
import type { PersistedScreenOutputAssetCapability } from '~~/server/modules/screen-output-assets/manager';
import type { CreateScreenInput, UpdateScreenInput } from '~~/shared/api';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { screens } from '~~/server/db/schema';
import {
	graphicsAuthoringLeaseConflict,
	graphicsAuthoringLeaseFenceCondition,
} from '~~/server/modules/graphics-authoring-lease';
import {
	deleteScreenWithGraphicAssetReferences,
	updateScreenModeConfigWithGraphicAssetReferences,
	updateScreenThemeOverridesWithGraphicAssetReferences,
} from '~~/server/modules/screen-graphic-asset-references';
import { mapDeckSourceConflict, StateConflictError } from '~~/server/utils/errors';
import { mergeScreenModeConfig } from '~~/shared/types/screenConfig';
import { isGraphicAssetReferencingScreenMode } from '~~/shared/utils/graphicsAssetReferences';

/**
 * Clears every Deck Source in the Event naming one of `playerIds` to no Player,
 * as a new Screen version (ADR-0032). Batch it ahead of the delete of those
 * Players: the Screen guard triggers prove a Deck Source's Player exists, so a
 * Screen left naming a deleted Player could never be written again (#651).
 */
export function buildClearDeckSourcePlayersQuery(eventId: number, playerIds: number[] | SQLWrapper) {
	return db
		.update(screens)
		.set({
			modeConfigs: sql`json_set(${screens.modeConfigs}, '$.deck.deckSource.playerId', json('null'))`,
			stateVersion: sql`${screens.stateVersion} + 1`,
		})
		.where(and(
			eq(screens.eventId, eventId),
			sql`json_extract(${screens.modeConfigs}, '$.deck.deckSource.type') = 'player'`,
			inArray(sql`json_extract(${screens.modeConfigs}, '$.deck.deckSource.playerId')`, playerIds),
		))
		.returning();
}

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
	 *
	 * A `leaseFence` adds the Graphics Authoring Lease to the same condition, so a
	 * write admitted before a takeover cannot commit after it (#607). Refused by the
	 * fence, it answers the lease's own 409 rather than a Screen conflict.
	 */
	const versionedWrite = async (
		id: number,
		eventId: number,
		data: Partial<typeof screens.$inferInsert>,
		currentVersion: number,
		companions: readonly BatchItem<'sqlite'>[] = [],
		leaseFence?: GraphicsAuthoringLeaseFence,
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
						leaseFence
							? graphicsAuthoringLeaseFenceCondition(leaseFence, Date.now())
							: undefined,
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

		// With the version still standing, the fence is the only other condition
		// the statement had.
		if (leaseFence && screen.stateVersion === currentVersion)
			throw graphicsAuthoringLeaseConflict();
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
		leaseFence?: GraphicsAuthoringLeaseFence,
	): Promise<DbScreen | undefined> => {
		return versionedWrite(id, eventId, data, stateVersion, companions, leaseFence);
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
		leaseFence?: GraphicsAuthoringLeaseFence,
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
				leaseFence,
			});
		}

		const screen = await findById(id, eventId);
		if (!screen)
			return undefined;

		const mergedConfigs = mergeScreenModeConfig(screen.modeConfigs ?? {}, mode, partialConfig);

		return versionedWrite(id, eventId, { modeConfigs: mergedConfigs }, stateVersion ?? screen.stateVersion, [], leaseFence);
	};

	/**
	 * Replace a Screen's Screen Theme Overrides, as a new Screen version, with
	 * the Graphic Asset References they hold indexed in the same commit.
	 */
	const updateThemeOverrides = async (
		id: number,
		eventId: number,
		themeOverrides: StoredThemeTokens,
		previousOverrides: StoredThemeTokens,
		stateVersion: number,
	): Promise<DbScreen | undefined> => {
		return await updateScreenThemeOverridesWithGraphicAssetReferences({
			id,
			eventId,
			themeOverrides,
			previousOverrides,
			stateVersion,
		});
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
		updateThemeOverrides,
		remove,
		slugExists,
	};
}

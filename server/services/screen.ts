import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DbScreen, ScreenMode } from '~~/server/db/schema';
import type { GraphicsAuthoringLeaseFence } from '~~/server/modules/graphics-authoring-lease';
import type { PersistedScreenOutputAssetCapability } from '~~/server/modules/screen-output-assets/manager';
import type { CreateScreenInput, UpdateScreenInput } from '~~/shared/api';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, eventTalents, phases, rounds, screens } from '~~/server/db/schema';
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
import { SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
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

/**
 * Clears every Feature Match Slot side Deck Source in the Event naming one of
 * `slotIds` to no Slot, as a new Screen version, keeping its side. Batch it
 * ahead of the delete of those Slots, as a Player delete does (ADR-0032).
 */
export function buildClearDeckSourceSlotsQuery(eventId: number, slotIds: number[]) {
	return db
		.update(screens)
		.set({
			modeConfigs: sql`json_set(${screens.modeConfigs}, '$.deck.deckSource.slotId', json('null'))`,
			stateVersion: sql`${screens.stateVersion} + 1`,
		})
		.where(and(
			eq(screens.eventId, eventId),
			sql`json_extract(${screens.modeConfigs}, '$.deck.deckSource.type') = 'featureMatchSlot'`,
			inArray(sql`json_extract(${screens.modeConfigs}, '$.deck.deckSource.slotId')`, slotIds),
		))
		.returning();
}

/** The Event References a delete releases from its Screens (ADR-0060), and the table each names a row of. */
const RELEASED_EVENT_REFERENCE_TABLES = {
	phase: phases,
	round: rounds,
	archetype: archetypes,
	talent: eventTalents,
	talentLineup: eventTalents,
};

/** The released kinds whose field holds a list of ids: a release drops the missing ids and keeps the rest in order. */
const RELEASED_EVENT_REFERENCE_LISTS: ReadonlySet<ReleasedEventReferenceKind> = new Set(['talentLineup']);

export type ReleasedEventReferenceKind = keyof typeof RELEASED_EVENT_REFERENCE_TABLES;

/**
 * Removes every declared Event Reference of `kinds` (`eventReferences` in
 * `shared/screenModes.ts`) naming a record the Event no longer holds, from each
 * Screen in the Event, as a new Screen version (ADR-0060). Batch it after the
 * delete, so it also releases what the delete cascaded away and what an
 * imported structure removal decided to delete as it ran. A list of ids, such
 * as a Talent lineup, loses only the missing ids, the rest in order (ADR-0070).
 */
export function buildReleaseScreenEventReferencesQuery(eventId: number, kinds: readonly ReleasedEventReferenceKind[]) {
	const released = SCREEN_MODE_VALUES.flatMap(mode =>
		Object.entries(SCREEN_MODES[mode].eventReferences).flatMap(([field, kind]) => {
			const releasedKind = kinds.find(candidate => candidate === kind);
			if (!releasedKind)
				return [];
			const table = RELEASED_EVENT_REFERENCE_TABLES[releasedKind];
			const path = `$."${mode}".${field}`;
			const held = sql`(select ${table.id} from ${table} where ${table.eventId} = ${eventId})`;
			if (RELEASED_EVENT_REFERENCE_LISTS.has(releasedKind)) {
				const kept = sql`(select json_group_array(value) from (
					select item.value from json_each(${screens.modeConfigs}, ${path}) as item
					where item.value in ${held} order by item.key
				))`;
				return [
					{
						missing: sql`exists (select 1 from json_each(${screens.modeConfigs}, ${path}) as item where item.value not in ${held})`,
						// A merge patch replaces an array whole.
						removal: sql`json_object(${mode}, json_object(${field}, json(${kept})))`,
					},
				];
			}
			const value = sql`json_extract(${screens.modeConfigs}, ${path})`;
			return [
				{
				// Unset is not missing: `NULL NOT IN` an empty set is true.
					missing: sql`(${value} is not null and ${value} not in ${held})`,
					// A merge patch's null removes the field, leaving it unset as an optional field is.
					removal: sql`${JSON.stringify({
						[mode]: { [field]: null },
					})}`,
				},
			];
		}));
	if (released.length === 0)
		throw new Error(`No Screen Mode declares an Event Reference of ${kinds.join(', ')}`);

	return db
		.update(screens)
		.set({
			modeConfigs: released.reduce<SQL>(
				(configs, { missing, removal }) => sql`json_patch(${configs}, case when ${missing} then ${removal} else '{}' end)`,
				sql`${screens.modeConfigs}`,
			),
			stateVersion: sql`${screens.stateVersion} + 1`,
		})
		.where(and(
			eq(screens.eventId, eventId),
			or(...released.map(({ missing }) => missing)),
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

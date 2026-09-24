import type { SQL } from 'drizzle-orm';
import type { DbEvent, DbEventInsert, DbEventTalent } from '~~/server/db/schema';
import type { CreateEventInput, MeleeConfigInput, UpdateEventInput } from '~~/shared/api';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { eventCardNameOverrides, events, eventTalents, matches, phases, players, screens } from '~~/server/db/schema';
import { buildClearImportedMatchDataQueries } from '~~/server/services/featureMatch';
import { protectMeleeClientSecret } from '~~/server/services/meleeCredentials';
import { BroadcastDeckListsInUseError } from '~~/server/utils/errors';
import { getGameDefaults } from '~~/shared/config/games';
import { fromFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';

type EventWithTalents = DbEvent & { talents: DbEventTalent[] };

type SyncMetadataUpdate = Partial<Pick<DbEvent,	| 'initialSetupCompletedAt'
	| 'lastEventSyncedAt'
	| 'lastPlayersSyncedAt'
	| 'lastDecklistsSyncedAt'
	| 'lastSyncError'>>;

interface FindAllParams {
	game?: 'mtg' | 'op';
}

interface MeleeSyncLeaseInput {
	eventId: number;
	token: string;
	command: string;
	now: Date;
	expiresAt: Date;
}

export interface ActiveMeleeSyncLease {
	token: string;
	command: string;
	expiresAt: Date;
}

export type MeleeSyncLeaseAcquisition
	= | { acquired: true; lease: ActiveMeleeSyncLease }
		| { acquired: false; activeLease: Omit<ActiveMeleeSyncLease, 'token'> | null };

export function eventService() {
	const buildResetMeleeImportedDataQueries = async (eventId: number) => {
		const featureReset = await buildClearImportedMatchDataQueries(eventId);

		return [
			db
				.delete(eventCardNameOverrides)
				.where(eq(eventCardNameOverrides.eventId, eventId)),
			db
				.delete(matches)
				.where(and(
					eq(matches.eventId, eventId),
					eq(matches.externalSource, 'melee'),
				)),
			db
				.delete(phases)
				.where(and(
					eq(phases.eventId, eventId),
					eq(phases.externalSource, 'melee'),
				)),
			db
				.delete(players)
				.where(and(
					eq(players.eventId, eventId),
					eq(players.externalSource, 'melee'),
				)),
			...featureReset.queries,
		];
	};

	const buildWhereClause = (params: FindAllParams) => {
		const conditions: SQL[] = [];

		if (params.game) {
			conditions.push(eq(events.game, params.game));
		}

		return conditions.length > 0 ? and(...conditions) : undefined;
	};

	const findById = async (id: number): Promise<EventWithTalents | undefined> => {
		return (await db.query.events.findFirst({
			where: eq(events.id, id),
			with: {
				talents: true,
			},
		})) as EventWithTalents | undefined;
	};

	const findAll = async (params: FindAllParams = {}) => {
		const whereClause = buildWhereClause(params);

		return await db
			.select()
			.from(events)
			.where(whereClause);
	};

	const create = async (data: CreateEventInput): Promise<EventWithTalents> => {
		// Database defaults describe the legacy MTG policy. Materialise the
		// selected game's complete policy at this boundary so sparse creates do
		// not accidentally persist MTG settings for another game. Explicit
		// caller overrides still win.
		const insertData: DbEventInsert = {
			featureMatchOrientation: 'horizontal',
			...fromFeatureMatchDefaults(getGameDefaults(data.game)),
			...data,
		};
		const [newEvent] = await db.insert(events).values(insertData).returning();

		if (!newEvent) {
			throw new Error('Failed to create event');
		}

		return {
			...newEvent,
			talents: [],
		};
	};

	const update = async (id: number, data: UpdateEventInput): Promise<EventWithTalents | undefined> => {
		const currentEvent = await db.query.events.findFirst({
			where: eq(events.id, id),
		});

		if (!currentEvent) {
			return undefined;
		}

		const shouldResetDecklistSync = data.pointsSystem !== undefined
			&& data.pointsSystem !== (currentEvent as DbEvent).pointsSystem
			&& data.pointsSystem !== null;

		const updateQuery = db
			.update(events)
			.set({
				...data,
				...(shouldResetDecklistSync ? { lastDecklistsSyncedAt: null } : {}),
			})
			.where(and(
				eq(events.id, id),
				...(data.broadcastDeckListsEnabled === false
					? [sql`NOT EXISTS (
						SELECT 1 FROM ${screens}
						WHERE ${screens.eventId} = ${id}
							AND json_extract(${screens.modeConfigs}, '$.deck.deckSource.type') = 'broadcast'
					)`]
					: []),
			))
			.returning();

		let updatedEvent: DbEvent | undefined;
		if (data.broadcastDeckListsEnabled === false) {
			const [updatedRows, affectedScreens] = await db.batch([
				updateQuery,
				db
					.select({ id: screens.id, name: screens.name })
					.from(screens)
					.where(and(
						eq(screens.eventId, id),
						sql`json_extract(${screens.modeConfigs}, '$.deck.deckSource.type') = 'broadcast'`,
					))
					.orderBy(sql`${screens.name} COLLATE NOCASE`, asc(screens.id)),
			]);
			[updatedEvent] = updatedRows;
			if (!updatedEvent && affectedScreens.length > 0)
				throw new BroadcastDeckListsInUseError(affectedScreens);
		}
		else {
			[updatedEvent] = await updateQuery;
		}

		if (!updatedEvent) {
			return undefined;
		}

		// Use .returning() result for event data, only query talents separately
		const talents = await db
			.select()
			.from(eventTalents)
			.where(eq(eventTalents.eventId, updatedEvent.id));

		return { ...updatedEvent, talents };
	};

	const updateMeleeConfig = async (id: number, data: MeleeConfigInput): Promise<boolean> => {
		// Check if event exists and get current meleeEventId
		const currentEvent = await db.query.events.findFirst({
			where: eq(events.id, id),
			columns: { meleeEventId: true },
		});

		if (!currentEvent) {
			return false;
		}

		const shouldResetImportedData = !data.meleeEnabled || currentEvent.meleeEventId !== data.meleeEventId;

		const resetSyncFields = shouldResetImportedData
			? {
					initialSetupCompletedAt: null,
					lastEventSyncedAt: null,
					lastPlayersSyncedAt: null,
					lastDecklistsSyncedAt: null,
					lastSyncError: null,
				}
			: {};
		const protectedClientSecret = data.meleeClientSecret === undefined
			? undefined
			: data.meleeClientSecret === null
				? null
				: await protectMeleeClientSecret(data.meleeClientSecret);

		// Build explicit field set — never spread `data` to avoid mass assignment.
		// Only update meleeClientSecret when the caller explicitly provides a new value,
		// and never let plaintext cross this persistence boundary.
		const setFields = {
			meleeEnabled: data.meleeEnabled,
			meleeEventId: data.meleeEventId,
			meleeClientId: data.meleeClientId,
			updatedAt: new Date(),
			...resetSyncFields,
			...(protectedClientSecret !== undefined && { meleeClientSecret: protectedClientSecret }),
		};

		const updateEventQuery = db
			.update(events)
			.set(setFields)
			.where(eq(events.id, id));

		if (shouldResetImportedData) {
			const resetQueries = await buildResetMeleeImportedDataQueries(id);
			const queries = [...resetQueries, updateEventQuery];
			await db.batch(queries as [typeof queries[number], ...Array<typeof queries[number]>]);
		}
		else {
			await updateEventQuery;
		}

		return true;
	};

	const updateSyncMetadata = async (
		id: number,
		data: SyncMetadataUpdate,
		leaseToken?: string,
	): Promise<boolean> => {
		const conditions = [eq(events.id, id)];
		if (leaseToken !== undefined)
			conditions.push(eq(events.meleeSyncLeaseToken, leaseToken));

		const [updatedEvent] = await db
			.update(events)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(and(...conditions))
			.returning({ id: events.id });

		return !!updatedEvent;
	};

	/**
	 * Atomically acquires the per-event Melee sync lease.
	 *
	 * The conditional UPDATE is the compare-and-set operation: only an empty or
	 * expired lease can be replaced. A conditional release uses the opaque token,
	 * so an expired command can never clear a newer command's lease.
	 */
	const tryAcquireMeleeSyncLease = async (input: MeleeSyncLeaseInput): Promise<MeleeSyncLeaseAcquisition> => {
		const attemptAcquire = async () => {
			return await db
				.update(events)
				.set({
					meleeSyncLeaseToken: input.token,
					meleeSyncLeaseCommand: input.command,
					meleeSyncLeaseExpiresAt: input.expiresAt,
				})
				.where(and(
					eq(events.id, input.eventId),
					or(
						isNull(events.meleeSyncLeaseToken),
						isNull(events.meleeSyncLeaseExpiresAt),
						lte(events.meleeSyncLeaseExpiresAt, input.now),
					),
				))
				.returning({ id: events.id });
		};

		let [acquiredEvent] = await attemptAcquire();
		if (acquiredEvent) {
			return {
				acquired: true,
				lease: { token: input.token, command: input.command, expiresAt: input.expiresAt },
			};
		}

		let current = await db.query.events.findFirst({
			where: eq(events.id, input.eventId),
			columns: {
				meleeSyncLeaseToken: true,
				meleeSyncLeaseCommand: true,
				meleeSyncLeaseExpiresAt: true,
			},
		});

		// If a command released between the failed CAS and the read, retry once
		// instead of returning a spurious conflict.
		const currentLeaseIsAvailable = current
			&& (!current.meleeSyncLeaseToken
				|| !current.meleeSyncLeaseExpiresAt
				|| current.meleeSyncLeaseExpiresAt.getTime() <= input.now.getTime());
		if (currentLeaseIsAvailable) {
			[acquiredEvent] = await attemptAcquire();
			if (acquiredEvent) {
				return {
					acquired: true,
					lease: { token: input.token, command: input.command, expiresAt: input.expiresAt },
				};
			}

			current = await db.query.events.findFirst({
				where: eq(events.id, input.eventId),
				columns: {
					meleeSyncLeaseToken: true,
					meleeSyncLeaseCommand: true,
					meleeSyncLeaseExpiresAt: true,
				},
			});
		}

		return {
			acquired: false,
			activeLease: current?.meleeSyncLeaseToken && current.meleeSyncLeaseCommand && current.meleeSyncLeaseExpiresAt
				? {
						command: current.meleeSyncLeaseCommand,
						expiresAt: current.meleeSyncLeaseExpiresAt,
					}
				: null,
		};
	};

	const releaseMeleeSyncLease = async (eventId: number, token: string): Promise<boolean> => {
		const [releasedEvent] = await db
			.update(events)
			.set({
				meleeSyncLeaseToken: null,
				meleeSyncLeaseCommand: null,
				meleeSyncLeaseExpiresAt: null,
			})
			.where(and(
				eq(events.id, eventId),
				eq(events.meleeSyncLeaseToken, token),
			))
			.returning({ id: events.id });

		return !!releasedEvent;
	};

	const renewMeleeSyncLease = async (eventId: number, token: string, expiresAt: Date): Promise<boolean> => {
		const [renewedEvent] = await db
			.update(events)
			.set({ meleeSyncLeaseExpiresAt: expiresAt })
			.where(and(
				eq(events.id, eventId),
				eq(events.meleeSyncLeaseToken, token),
			))
			.returning({ id: events.id });

		return !!renewedEvent;
	};

	const remove = async (id: number): Promise<boolean> => {
		const result = await db
			.delete(events)
			.where(eq(events.id, id))
			.returning();

		return result.length > 0;
	};

	const exists = async (id: number): Promise<boolean> => {
		const event = await db.query.events.findFirst({
			where: eq(events.id, id),
			columns: { id: true },
		});

		return !!event;
	};

	return {
		findById,
		findAll,
		create,
		update,
		updateMeleeConfig,
		updateSyncMetadata,
		tryAcquireMeleeSyncLease,
		renewMeleeSyncLease,
		releaseMeleeSyncLease,
		remove,
		exists,
	};
}

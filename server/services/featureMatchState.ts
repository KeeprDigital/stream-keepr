import type { SQL } from 'drizzle-orm';
import type { DbFeatureMatch, DbFeatureMatchSession, DbPlayer } from '~~/server/db/schema';
import type { SequencedLiveEpochTransition, SequencedLiveStateExecuteOptions } from '~~/server/modules/live-state';
import type { FeatureMatchSessionEventPayload, FeatureMatchSessionReducerResult } from '~~/shared/modules/feature-match-session';
import type { Game } from '~~/shared/types/enums';
import type { FeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import type {
	FeatureMatchSessionCommand,
	FeatureMatchSessionCommandResult,
	FeatureMatchSessionEventAppliedPayload,
	FeatureMatchSnapshotPlayerData,
	FeatureMatchSourceSnapshot,
} from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { events, featureMatches, featureMatchSessions, players } from '~~/server/db/schema';
import { mapFeatureMatchSessionToResponse, mapFeatureMatchSessionToStarted } from '~~/server/mappers/featureMatch';
import { refreshBroadcastGraphicsBindings } from '~~/server/modules/broadcast-graphics-live-session';
import { createSequencedLiveEpochs, createSequencedLiveState } from '~~/server/modules/live-state';
import { publishMessage } from '~~/server/utils/ably';
import { chunkJsonRows, inJsonArray, selectForInsert } from '~~/server/utils/db';
import {
	applyFeatureMatchSessionEvent,
	createInitialFeatureMatchSessionStateFromSnapshot,
	normalizeFeatureMatchSessionCommandPayload,
} from '~~/shared/modules/feature-match-session';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { isMergeableFeatureMatchCommand } from '~~/shared/types/featureMatchSession';

export { applyFeatureMatchSessionEvent } from '~~/shared/modules/feature-match-session';

/** Namespaces Feature Match Session receipts in the shared live-state receipt store. */
export const FEATURE_MATCH_SESSION_AGGREGATE_KIND = 'featureMatchSession';

/** How a Feature Match Session is addressed for load and command execution. */
interface FeatureMatchSessionRef {
	sessionId: number;
	eventId: number;
}

type EventDefaults = FeatureMatchDefaults & {
	game: Game;
};

/** The Slots of one Event whose Sessions an epoch transition replaces. */
interface FeatureMatchSessionScope {
	eventId: number;
	slotIds: readonly number[];
	/** A predicate over `feature_match_slots` each Slot must still satisfy when the batch runs. */
	slotCondition?: SQL;
}

/** The first state of a Slot's new Session. */
interface FeatureMatchSessionOpening {
	slotId: number;
	sourceSnapshot: FeatureMatchSourceSnapshot;
	currentState: FeatureMatchState;
}

const AUTHORITATIVE_DECK_SNAPSHOT_FIELDS = new Set<keyof FeatureMatchSnapshotPlayerData>([
	'deckId',
	'archetypeId',
	'gameData',
]);

export function featureMatchStateService() {
	const loadEventDefaults = async (eventId: number): Promise<EventDefaults | undefined> => {
		const row = await db.query.events.findFirst({
			where: eq(events.id, eventId),
			columns: {
				game: true,
				featureMatchDefaultBestOf: true,
				featureMatchDefaultStartingLife: true,
				featureMatchDefaultClockType: true,
				featureMatchDefaultClockDuration: true,
				featureMatchDefaultCountUpAfterCountdown: true,
				featureMatchDefaultTurnTrackingEnabled: true,
				featureMatchDefaultActivePlayerTrackingEnabled: true,
				featureMatchDefaultExtraTurnsEnabled: true,
				featureMatchDefaultExtraTurns: true,
				featureMatchDefaultExtraTurnsLabel: true,
				featureMatchDefaultMulliganTrackingEnabled: true,
			},
		});
		if (!row)
			return undefined;
		return {
			...toFeatureMatchDefaults(row),
			game: row.game,
		};
	};

	function playerToSnapshotData(player: NonNullable<Awaited<ReturnType<typeof db.query.players.findFirst>>>): FeatureMatchSnapshotPlayerData {
		return {
			name: player.name,
			pronouns: player.pronouns,
			externalId: player.externalId,
			externalSource: player.externalSource,
			wins: player.wins,
			losses: player.losses,
			draws: player.draws,
			position: player.position,
			points: player.points,
			archetypeId: player.archetypeId,
			lgs: player.lgs,
			gameData: player.gameData,
		};
	}

	function hasMeaningfulSnapshotValue(value: unknown): boolean {
		if (value === undefined || value === null)
			return false;
		if (typeof value === 'string')
			return value.trim().length > 0;
		if (typeof value === 'object') {
			if (Array.isArray(value))
				return value.some(hasMeaningfulSnapshotValue);
			return Object.entries(value).some(([key, entry]) => key !== 'type' && hasMeaningfulSnapshotValue(entry));
		}
		return true;
	}

	function compactSnapshotOverrides(data: FeatureMatchSnapshotPlayerData): Partial<FeatureMatchSnapshotPlayerData> {
		// These fields are match/deck identity, not optional display enrichment.
		// Explicit null/empty values mean that no deck was selected for this match
		// and must not fall back to the player's current primary deck.
		return Object.fromEntries(
			Object.entries(data).filter(([key, value]) =>
				value !== undefined
				&& (AUTHORITATIVE_DECK_SNAPSHOT_FIELDS.has(key as keyof FeatureMatchSnapshotPlayerData)
					|| hasMeaningfulSnapshotValue(value))),
		) as Partial<FeatureMatchSnapshotPlayerData>;
	}

	function hasAuthoritativeDeckSnapshotValue(data: FeatureMatchSnapshotPlayerData): boolean {
		return [...AUTHORITATIVE_DECK_SNAPSHOT_FIELDS].some(field =>
			Object.hasOwn(data, field) && data[field] !== undefined,
		);
	}

	const resolveSnapshotPlayer = async (
		eventId: number,
		playerId: number | null,
		data: FeatureMatchSnapshotPlayerData | null,
		preloadedPlayers?: ReadonlyMap<number, DbPlayer>,
	): Promise<{ playerId: number | null; data: FeatureMatchSnapshotPlayerData | null }> => {
		const hasSlotData = data
			? hasMeaningfulSnapshotValue(data) || hasAuthoritativeDeckSnapshotValue(data)
			: false;

		if (!playerId) {
			return {
				playerId: null,
				data: hasSlotData ? data : null,
			};
		}

		const player = preloadedPlayers
			? preloadedPlayers.get(playerId)
			: await db.query.players.findFirst({
					where: and(eq(players.id, playerId), eq(players.eventId, eventId)),
				});

		if (!player) {
			return {
				playerId,
				data: hasSlotData ? data : null,
			};
		}

		const playerData = playerToSnapshotData(player);
		const overrides = data
			? compactSnapshotOverrides(data)
			: {};

		return {
			playerId,
			data: hasSlotData
				? {
						...playerData,
						...overrides,
					}
				: playerData,
		};
	};

	const buildSourceSnapshot = async (
		slot: DbFeatureMatch,
		preloadedDefaults?: EventDefaults,
		preloadedPlayers?: ReadonlyMap<number, DbPlayer>,
	): Promise<FeatureMatchSourceSnapshot> => {
		const defaults = preloadedDefaults ?? await loadEventDefaults(slot.eventId);
		const eventDefaults = defaults ?? {
			...toFeatureMatchDefaults(null),
			game: 'mtg',
		};

		return {
			eventId: slot.eventId,
			slotId: slot.id,
			matchId: slot.matchId,
			externalId: slot.externalId,
			externalSource: slot.externalSource,
			tableNumber: slot.tableNumber,
			roundName: slot.roundName,
			formatName: slot.formatName,
			bestOf: slot.bestOf,
			playerDisplayMode: slot.playerDisplayMode,
			game: eventDefaults.game,
			defaults: eventDefaults,
			player1: await resolveSnapshotPlayer(slot.eventId, slot.player1Id, slot.player1Data, preloadedPlayers),
			player2: await resolveSnapshotPlayer(slot.eventId, slot.player2Id, slot.player2Data, preloadedPlayers),
			// The build time, which is the right answer only for the builds that open a
			// Session. A rebuild for a `SnapshotCorrected` has this discarded in favour
			// of the stamp the Session is already holding — the field means first taken,
			// and the reducer is where that is enforced for every caller (#332).
			createdAt: Date.now(),
		};
	};

	const findSessionById = async (sessionId: number, eventId: number): Promise<DbFeatureMatchSession | undefined> => {
		return await db.query.featureMatchSessions.findFirst({
			where: and(eq(featureMatchSessions.id, sessionId), eq(featureMatchSessions.eventId, eventId)),
		});
	};

	const findActiveSessionBySlot = async (slotId: number, eventId: number): Promise<DbFeatureMatchSession | undefined> => {
		return await db.query.featureMatchSessions.findFirst({
			where: and(
				eq(featureMatchSessions.slotId, slotId),
				eq(featureMatchSessions.eventId, eventId),
				eq(featureMatchSessions.status, 'active'),
			),
		});
	};

	const getActiveSession = async (slotId: number, eventId: number): Promise<DbFeatureMatchSession | undefined> => {
		const slot = await db.query.featureMatches.findFirst({
			where: and(eq(featureMatches.id, slotId), eq(featureMatches.eventId, eventId)),
			columns: { activeSessionId: true },
		});
		if (slot?.activeSessionId) {
			const linkedSession = await findSessionById(slot.activeSessionId, eventId);
			if (linkedSession?.status === 'active')
				return linkedSession;
		}

		return await findActiveSessionBySlot(slotId, eventId);
	};

	const findActiveSessions = async ({ eventId, slotIds }: FeatureMatchSessionScope): Promise<DbFeatureMatchSession[]> => {
		if (slotIds.length === 0)
			return [];
		return await db.query.featureMatchSessions.findMany({
			where: and(
				eq(featureMatchSessions.eventId, eventId),
				inJsonArray(featureMatchSessions.slotId, slotIds),
				eq(featureMatchSessions.status, 'active'),
			),
			// Announcements follow this order, so it is Slot order by contract
			// rather than whichever plan the lookup happens to get.
			orderBy: [
				asc(featureMatchSessions.slotId),
			],
		});
	};

	/**
	 * The Slots a scope's statements apply to: those named, in the Event, that still
	 * satisfy the scope's condition when the batch runs. Every statement of one
	 * transition selects through this, so a condition that skips a Slot's close
	 * also skips its open and relink.
	 */
	const scopedSlotIds = ({ eventId, slotIds, slotCondition }: FeatureMatchSessionScope) => sql`
		select ${featureMatches.id}
		from ${featureMatches}
		where ${featureMatches.eventId} = ${eventId}
			and ${inJsonArray(featureMatches.id, slotIds)}
			and ${slotCondition ?? sql`1`}
	`;

	/**
	 * The Feature Match Session half of the shared epoch lifecycle: which Sessions a
	 * set of Slots owns, and how one is closed, opened and announced. Ordering,
	 * receipt forgetting and the decision to announce are the module's.
	 *
	 * Only `replace` and `open` are used here, never `close` alone: a Slot that has
	 * held a Session always holds one. Clients rely on that to order Slot reads,
	 * refusing a Slot read without a Session over one they hold (ADR-0026, #658).
	 */
	const sessionEpochs = createSequencedLiveEpochs<FeatureMatchSessionScope, FeatureMatchSessionOpening[], DbFeatureMatchSession>({
		aggregateKind: FEATURE_MATCH_SESSION_AGGREGATE_KIND,
		idOf: session => session.id,
		findActive: findActiveSessions,

		close: (scope) => {
			const now = new Date();
			return [
				db.update(featureMatchSessions)
					.set({ status: 'closed', closedAt: now, updatedAt: now })
					.where(and(
						eq(featureMatchSessions.eventId, scope.eventId),
						eq(featureMatchSessions.status, 'active'),
						sql`${featureMatchSessions.slotId} in (${scopedSlotIds(scope)})`,
					)),
			];
		},

		closedIds: scope => sql`
			select ${featureMatchSessions.id}
			from ${featureMatchSessions}
			where ${featureMatchSessions.eventId} = ${scope.eventId}
				and ${featureMatchSessions.status} = 'closed'
				and ${featureMatchSessions.slotId} in (${scopedSlotIds(scope)})
		`,

		open: (scope, openings) => {
			const now = Date.now();
			// Chunked so a whole Event's Slots open in a handful of statements rather
			// than one per Slot, within D1's per-statement payload bound.
			const inserts = chunkJsonRows(openings).map(payload => db
				.insert(featureMatchSessions)
				.select(selectForInsert(featureMatchSessions, {
					id: sql`null`,
					eventId: sql`${scope.eventId}`,
					slotId: sql`cast(json_extract(input.value, '$.slotId') as integer)`,
					status: sql`'active'`,
					sourceSnapshot: sql`json_extract(input.value, '$.sourceSnapshot')`,
					currentState: sql`json_extract(input.value, '$.currentState')`,
					sequence: sql`1`,
					closedAt: sql`null`,
					createdAt: sql`${now}`,
					updatedAt: sql`${now}`,
				}, sql`from json_each(${payload}) as input
					where cast(json_extract(input.value, '$.slotId') as integer) in (${scopedSlotIds(scope)})`)));

			return [
				...inserts,
				db.update(featureMatches)
					.set({
						activeSessionId: sql<number>`(
							select ${featureMatchSessions.id}
							from ${featureMatchSessions}
							where ${featureMatchSessions.eventId} = ${featureMatches.eventId}
								and ${featureMatchSessions.slotId} = ${featureMatches.id}
								and ${featureMatchSessions.status} = 'active'
							order by ${featureMatchSessions.id} desc
							limit 1
						)`,
						updatedAt: new Date(now),
					})
					.where(and(
						eq(featureMatches.eventId, scope.eventId),
						sql`${featureMatches.id} in (${scopedSlotIds(scope)})`,
					)),
			];
		},

		/**
		 * Each new Session is announced as its own `SessionStarted`, carrying its whole
		 * snapshot, so a follower holds it as a newer epoch without a reload (ADR-0026).
		 * An ended Session needs no message of its own: its successor's supersedes it.
		 * Bindings re-resolve once for the whole change, as for any Event Data write.
		 */
		announce: async ({ opened }, { originConnectionId }) => {
			for (const session of opened)
				await publishMessage(session.eventId, 'featureMatchSession:eventApplied', mapFeatureMatchSessionToStarted(session), originConnectionId);
			const eventId = opened[0]?.eventId;
			if (eventId !== undefined)
				await refreshBroadcastGraphicsBindings(eventId);
		},
	});

	/**
	 * The transition closing every active Session of the given Slots and opening a
	 * fresh one for each, built but not committed so a caller can carry it inside a
	 * larger atomic batch (Feature Match Slot Promotion, a Melee reset). Settle it
	 * once that batch has committed: that is what announces the new Sessions.
	 *
	 * Each Slot is passed in the state it should reflect: promotion feeds the
	 * post-write Slot (promoted / cleared) so the snapshot is built off the values
	 * the same batch is about to persist rather than a stale read.
	 *
	 * `slotCondition` is a predicate over `feature_match_slots` every statement
	 * applies under, so a Slot that no longer satisfies it when the batch runs keeps
	 * its Session and is not announced.
	 */
	const buildSessionReplacement = async (
		eventId: number,
		slots: readonly DbFeatureMatch[],
		options: {
			slotCondition?: SQL;
			defaults?: EventDefaults;
			players?: ReadonlyMap<number, DbPlayer>;
		} = {},
	): Promise<SequencedLiveEpochTransition<DbFeatureMatchSession>> => {
		const defaults = options.defaults ?? await loadEventDefaults(eventId);
		const openings = await Promise.all(slots.map(async (slot) => {
			const sourceSnapshot = await buildSourceSnapshot(slot, defaults, options.players);
			return {
				slotId: slot.id,
				sourceSnapshot,
				currentState: createInitialFeatureMatchSessionStateFromSnapshot(sourceSnapshot),
			};
		}));
		return await sessionEpochs.replace(
			{
				eventId,
				slotIds: slots.map(slot => slot.id),
				slotCondition: options.slotCondition,
			},
			openings,
		);
	};

	/**
	 * Open a Session for each Slot, announce them, and answer with whichever
	 * Session each Slot owns afterwards — not necessarily the one this call
	 * inserted.
	 *
	 * Two callers that both find no active Session both open one, and because
	 * opening closes any active Session first, the second strands the first: it is
	 * inserted and closed within milliseconds. Re-reading each Slot's active Session
	 * collapses both callers onto the winner, so the loser adopts the Session the
	 * Slot actually owns instead of commanding a corpse — and the announcement,
	 * decided from a re-read too, names the winner.
	 *
	 * The loser is not refused. An operator's open closes whatever was there, so a
	 * `409` would tell them to retry something that has already happened to the
	 * Slot; adopting the winner is what the Slot's own state says happened.
	 */
	const openSessionsForSlots = async (
		eventId: number,
		slotIds: readonly number[],
		options: { defaults?: EventDefaults; originConnectionId?: string } = {},
	): Promise<Map<number, DbFeatureMatchSession>> => {
		if (slotIds.length === 0)
			return new Map();
		const slots = await db.query.featureMatches.findMany({
			where: and(eq(featureMatches.eventId, eventId), inJsonArray(featureMatches.id, slotIds)),
		});
		if (slots.length === 0)
			return new Map();

		const replacement = await buildSessionReplacement(eventId, slots, { defaults: options.defaults });
		await sessionEpochs.commit(replacement, { originConnectionId: options.originConnectionId });

		const active = await findActiveSessions({
			eventId,
			slotIds: slots.map(slot => slot.id),
		});
		if (active.length < slots.length)
			throw new Error('Failed to create feature match session');
		return new Map(active.map(session => [session.slotId, session]));
	};

	const createSessionForSlot = async (
		slotId: number,
		eventId: number,
		options: { defaults?: EventDefaults; originConnectionId?: string } = {},
	): Promise<DbFeatureMatchSession | null> => {
		return (await openSessionsForSlots(eventId, [slotId], options)).get(slotId) ?? null;
	};

	function toEventAppliedPayload(result: FeatureMatchSessionCommandResult): FeatureMatchSessionEventAppliedPayload {
		return {
			slotId: result.slotId,
			sessionId: result.sessionId,
			sequence: result.sequence,
			eventType: result.eventType,
			sourceSnapshot: result.sourceSnapshot,
			currentState: result.currentState,
		};
	}

	/**
	 * The Feature Match Session half of the shared sequenced live-state module:
	 * what its commands mean and how its projection is stored. Sequencing,
	 * receipts, and conflict protection are the module's, not this file's.
	 */
	const liveState = createSequencedLiveState<
		FeatureMatchSessionRef,
		DbFeatureMatchSession,
		FeatureMatchSessionCommand,
		FeatureMatchSessionReducerResult,
		FeatureMatchSessionCommandResult
	>({
		aggregateKind: FEATURE_MATCH_SESSION_AGGREGATE_KIND,
		aggregateLabel: 'Feature match session',

		aggregateIdOf: ref => ref.sessionId,
		eventIdOf: ref => ref.eventId,
		load: ref => findSessionById(ref.sessionId, ref.eventId),
		sequenceOf: session => session.sequence,

		admit: (session, command) => {
			if (session.status !== 'active')
				throw createError({ statusCode: 409, message: 'Feature match session is closed' });

			if (command.type === 'SnapshotCorrected'
				&& (command.payload.sourceSnapshot.eventId !== session.eventId
					|| command.payload.sourceSnapshot.slotId !== session.slotId)) {
				throw createError({
					statusCode: 400,
					message: 'Snapshot correction does not belong to this session',
				});
			}

			// Field Ownership discipline: an absolute command claims the state it saw,
			// so a session that has moved on invalidates it. Mergeable commands are
			// relative and survive.
			if (!isMergeableFeatureMatchCommand(command.type) && command.baseSequence !== session.sequence) {
				throw createError({
					statusCode: 409,
					message: 'Feature match session has advanced',
					data: {
						session: mapFeatureMatchSessionToResponse(session),
					},
				});
			}
		},

		isMergeable: command => isMergeableFeatureMatchCommand(command.type),

		reduce: (session, command) => applyFeatureMatchSessionEvent(
			session.currentState,
			session.sourceSnapshot,
			command.type,
			normalizeFeatureMatchSessionCommandPayload(command.type, command.payload as FeatureMatchSessionEventPayload),
		),

		casGuard: session => sql`
			from ${featureMatchSessions}
			where ${featureMatchSessions.id} = ${session.id}
				and ${featureMatchSessions.eventId} = ${session.eventId}
				and ${featureMatchSessions.sequence} = ${session.sequence}
				and ${featureMatchSessions.status} = 'active'
		`,

		projection: ({ aggregate, reduction, nextSequence }) => db
			.update(featureMatchSessions)
			.set({
				currentState: reduction.currentState,
				sourceSnapshot: reduction.sourceSnapshot,
				sequence: nextSequence,
				updatedAt: new Date(),
			})
			.where(and(
				eq(featureMatchSessions.id, aggregate.id),
				eq(featureMatchSessions.eventId, aggregate.eventId),
				eq(featureMatchSessions.sequence, aggregate.sequence),
				eq(featureMatchSessions.status, 'active'),
			))
			.returning(),

		toResult: (session, commandType) => ({
			slotId: session.slotId,
			sessionId: session.id,
			sequence: session.sequence,
			eventType: commandType as FeatureMatchSessionCommandResult['eventType'],
			sourceSnapshot: session.sourceSnapshot,
			currentState: session.currentState,
			session: mapFeatureMatchSessionToResponse(session),
		}),

		publish: async (result, { originConnectionId }) => {
			await publishMessage(result.sourceSnapshot.eventId, 'featureMatchSession:eventApplied', toEventAppliedPayload(result), originConnectionId);
		},
	});

	const applyCommand = async (
		sessionId: number,
		eventId: number,
		command: FeatureMatchSessionCommand,
		originConnectionId?: string,
		options: Omit<SequencedLiveStateExecuteOptions, 'originConnectionId'> = {},
	): Promise<FeatureMatchSessionCommandResult> => {
		return await liveState.execute({ sessionId, eventId }, command, { ...options, originConnectionId });
	};

	/**
	 * Reverse-sync writes onto whichever Session the Slot currently owns. These
	 * accompany a Slot change that publishes its own notification, so they do not
	 * announce themselves. A Session this has to open first is announced like any
	 * other new epoch.
	 */
	const applyCommandToActiveSession = async (
		slotId: number,
		eventId: number,
		createCommand: (session: DbFeatureMatchSession) => FeatureMatchSessionCommand,
		originConnectionId?: string,
	): Promise<FeatureMatchSessionCommandResult | null> => {
		const session = await getActiveSession(slotId, eventId) ?? await createSessionForSlot(slotId, eventId);
		if (!session)
			return null;

		return await applyCommand(session.id, eventId, createCommand(session), originConnectionId);
	};

	return {
		loadEventDefaults,
		buildSourceSnapshot,
		buildSessionReplacement,
		openSessionsForSlots,
		createSessionForSlot,
		applyCommand,
		applyCommandToActiveSession,
	};
}

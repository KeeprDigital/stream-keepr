import type { BatchItem } from 'drizzle-orm/batch';
import type { DbFeatureMatch, DbFeatureMatchSession, DbPlayer } from '~~/server/db/schema';
import type { SequencedLiveStateExecuteOptions } from '~~/server/modules/live-state';
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
import { and, eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { events, featureMatches, featureMatchSessions, players } from '~~/server/db/schema';
import { mapFeatureMatchSessionToResponse } from '~~/server/mappers/featureMatch';
import { createSequencedLiveState, forgetAggregateReceipts } from '~~/server/modules/live-state';
import { publishMessage } from '~~/server/utils/ably';
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
			return { playerId: null, data: hasSlotData ? data : null };
		}

		const player = preloadedPlayers
			? preloadedPlayers.get(playerId)
			: await db.query.players.findFirst({
					where: and(eq(players.id, playerId), eq(players.eventId, eventId)),
				});

		if (!player) {
			return { playerId, data: hasSlotData ? data : null };
		}

		const playerData = playerToSnapshotData(player);
		const overrides = data ? compactSnapshotOverrides(data) : {};

		return {
			playerId,
			data: hasSlotData
				? { ...playerData, ...overrides }
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

	/**
	 * Build the statements that close any active Session for the Slot, open a
	 * fresh one, discard the closed Sessions' command receipts and relink the
	 * Slot — without executing them. The receipt/link statements resolve the
	 * newly inserted active Session in SQL, so no generated ID has to escape the
	 * transaction boundary and these statements can be composed into a larger
	 * atomic D1 batch (e.g. Feature Match Slot promotion).
	 *
	 * The caller passes the Slot in the state it should reflect: promotion feeds
	 * the post-write Slot (promoted / cleared) so the snapshot is built off the
	 * values the same batch is about to persist rather than a stale read.
	 */
	const buildCreateSessionForSlotQueries = async (
		slot: DbFeatureMatch,
		eventId: number,
		preloadedDefaults?: EventDefaults,
		preloadedPlayers?: ReadonlyMap<number, DbPlayer>,
	): Promise<{ queries: BatchItem<'sqlite'>[]; sourceSnapshot: FeatureMatchSourceSnapshot; currentState: FeatureMatchState }> => {
		const slotId = slot.id;
		const sourceSnapshot = await buildSourceSnapshot(slot, preloadedDefaults, preloadedPlayers);
		const currentState = createInitialFeatureMatchSessionStateFromSnapshot(sourceSnapshot);
		const now = new Date();

		const queries: BatchItem<'sqlite'>[] = [
			db.update(featureMatchSessions)
				.set({ status: 'closed', closedAt: now, updatedAt: now })
				.where(and(
					eq(featureMatchSessions.slotId, slotId),
					eq(featureMatchSessions.eventId, eventId),
					eq(featureMatchSessions.status, 'active'),
				)),
			db.insert(featureMatchSessions)
				.values({
					eventId,
					slotId,
					status: 'active',
					sourceSnapshot,
					currentState,
					sequence: 1,
				})
				.returning(),
			// A closed Session can never accept another command, so its receipts have
			// nothing left to protect against.
			forgetAggregateReceipts({
				aggregateKind: FEATURE_MATCH_SESSION_AGGREGATE_KIND,
				aggregateIds: sql`
					select ${featureMatchSessions.id}
					from ${featureMatchSessions}
					where ${featureMatchSessions.slotId} = ${slotId}
						and ${featureMatchSessions.eventId} = ${eventId}
						and ${featureMatchSessions.status} = 'closed'
				`,
			}),
			db.update(featureMatches)
				.set({
					activeSessionId: sql<number>`(
						select ${featureMatchSessions.id}
						from ${featureMatchSessions}
						where ${featureMatchSessions.eventId} = ${eventId}
							and ${featureMatchSessions.slotId} = ${slotId}
							and ${featureMatchSessions.status} = 'active'
						order by ${featureMatchSessions.id} desc
						limit 1
					)`,
					updatedAt: now,
				})
				.where(and(eq(featureMatches.id, slotId), eq(featureMatches.eventId, eventId))),
		];

		return { queries, sourceSnapshot, currentState };
	};

	/**
	 * Open a Session for the Slot and answer with whichever Session is active
	 * afterwards — not necessarily the one this call inserted.
	 *
	 * Two callers that both find no active Session both open one, and because
	 * opening closes any active Session first, the second strands the first: it is
	 * inserted and closed within milliseconds, and a caller holding it can only be
	 * told the Session is closed, while its `SessionStarted` announces a Session
	 * peers will project as live. Re-reading the Slot's active Session collapses
	 * both callers onto the winner, so the loser adopts the Session the Slot
	 * actually owns instead of announcing and commanding a corpse.
	 *
	 * The loser is not refused. An operator's open closes whatever was there, so a
	 * `409` would tell them to retry something that has already happened to the
	 * Slot; adopting the winner is what the Slot's own state says happened.
	 */
	const createSessionForSlot = async (
		slotId: number,
		eventId: number,
		preloadedDefaults?: EventDefaults,
	): Promise<DbFeatureMatchSession | null> => {
		const slot = await db.query.featureMatches.findFirst({
			where: and(eq(featureMatches.id, slotId), eq(featureMatches.eventId, eventId)),
		});
		if (!slot)
			return null;

		// Close, create, discard stale receipts and link the Slot in one D1 batch.
		const { queries } = await buildCreateSessionForSlotQueries(slot, eventId, preloadedDefaults);
		const [, insertedRows] = await db.batch(queries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

		const session = insertedRows?.[0] as DbFeatureMatchSession | undefined;
		if (!session)
			throw new Error('Failed to create feature match session');
		return await getActiveSession(slotId, eventId) ?? session;
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
					data: { session: mapFeatureMatchSessionToResponse(session) },
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
	 * announce themselves.
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
		buildCreateSessionForSlotQueries,
		createSessionForSlot,
		applyCommand,
		applyCommandToActiveSession,
	};
}

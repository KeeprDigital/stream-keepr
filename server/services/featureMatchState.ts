import type { BatchItem } from 'drizzle-orm/batch';
import type { DbFeatureMatch, DbFeatureMatchSession, DbPlayer } from '~~/server/db/schema';
import type { FeatureMatchSessionEventPayload } from '~~/shared/modules/feature-match-session';
import type { Game } from '~~/shared/types/enums';
import type { FeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import type {
	FeatureMatchCommandType,
	FeatureMatchSessionCommand,
	FeatureMatchSessionCommandResult,
	FeatureMatchSessionEventAppliedPayload,
	FeatureMatchSnapshotPlayerData,
	FeatureMatchSourceSnapshot,
} from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { and, eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { events, featureMatches, featureMatchSessionEvents, featureMatchSessions, players } from '~~/server/db/schema';
import { mapFeatureMatchSessionToResponse } from '~~/server/mappers/featureMatch';
import { StateConflictError } from '~~/server/utils/errors';
import {
	applyFeatureMatchSessionEvent,
	createInitialFeatureMatchSessionStateFromSnapshot,
	normalizeFeatureMatchSessionCommandPayload,
} from '~~/shared/modules/feature-match-session';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { isMergeableFeatureMatchCommand } from '~~/shared/types/featureMatchSession';
import { randomCommandId } from '~~/shared/utils/uuid';

export { applyFeatureMatchSessionEvent } from '~~/shared/modules/feature-match-session';

type EventDefaults = FeatureMatchDefaults & {
	game: Game;
};

const AUTHORITATIVE_DECK_SNAPSHOT_FIELDS = new Set<keyof FeatureMatchSnapshotPlayerData>([
	'deckId',
	'archetypeId',
	'gameData',
]);

function canonicalJson(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value)
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'undefined';
}

function persistedPayloadForComparison(type: FeatureMatchCommandType, payload: unknown): unknown {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload))
		return payload;
	if (!['AdjustClock', 'SetClock', 'StartClock', 'PauseClock', 'RestartClock'].includes(type))
		return payload;

	const { at: _persistedTimestamp, ...commandPayload } = payload as Record<string, unknown>;
	return commandPayload;
}

function assertIdempotentCommandMatches(
	existing: { type: FeatureMatchCommandType | 'SessionStarted'; payload: unknown },
	command: { type: FeatureMatchCommandType; payload: unknown },
): void {
	const sameType = existing.type === command.type;
	const samePayload = canonicalJson(persistedPayloadForComparison(command.type, existing.payload))
		=== canonicalJson(command.payload);
	if (!sameType || !samePayload) {
		throw createError({
			statusCode: 409,
			message: 'commandId has already been used for a different command',
		});
	}
}

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
	 * fresh one, seed its SessionStarted event and relink the Slot — without
	 * executing them. The event/link statements resolve the newly inserted
	 * active Session in SQL, so no generated ID has to escape the transaction
	 * boundary and these statements can be composed into a larger atomic D1
	 * batch (e.g. Feature Match Slot promotion).
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
		originConnectionId?: string,
	): Promise<{ queries: BatchItem<'sqlite'>[]; sourceSnapshot: FeatureMatchSourceSnapshot; currentState: FeatureMatchState }> => {
		const slotId = slot.id;
		const sourceSnapshot = await buildSourceSnapshot(slot, preloadedDefaults, preloadedPlayers);
		const currentState = createInitialFeatureMatchSessionStateFromSnapshot(sourceSnapshot);
		const eventPayload = { sourceSnapshot, currentState };
		const startedCommandId = randomCommandId('SessionStarted');
		const now = new Date();
		const nowMs = now.getTime();

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
			db.insert(featureMatchSessionEvents).select(sql`
				select
					null,
					${eventId},
					${slotId},
					${featureMatchSessions.id},
					1,
					'SessionStarted',
					json(${JSON.stringify(eventPayload)}),
					${startedCommandId},
					${originConnectionId ?? null},
					${nowMs}
				from ${featureMatchSessions}
				where ${featureMatchSessions.eventId} = ${eventId}
					and ${featureMatchSessions.slotId} = ${slotId}
					and ${featureMatchSessions.status} = 'active'
				order by ${featureMatchSessions.id} desc
				limit 1
			`),
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

	const createSessionForSlot = async (
		slotId: number,
		eventId: number,
		preloadedDefaults?: EventDefaults,
		originConnectionId?: string,
	): Promise<DbFeatureMatchSession | null> => {
		const slot = await db.query.featureMatches.findFirst({
			where: and(eq(featureMatches.id, slotId), eq(featureMatches.eventId, eventId)),
		});
		if (!slot)
			return null;

		// Close, create, seed the event stream and link the Slot in one D1 batch.
		const { queries } = await buildCreateSessionForSlotQueries(slot, eventId, preloadedDefaults, undefined, originConnectionId);
		const [, insertedRows] = await db.batch(queries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

		const session = insertedRows?.[0] as DbFeatureMatchSession | undefined;
		if (!session)
			throw new Error('Failed to create feature match session');
		return session;
	};

	async function appendSessionEvent(
		session: DbFeatureMatchSession,
		type: FeatureMatchCommandType,
		payload: FeatureMatchSessionEventPayload,
		commandId: string,
		originConnectionId?: string,
	): Promise<FeatureMatchSessionCommandResult> {
		const eventPayload = normalizeFeatureMatchSessionCommandPayload(type, payload);
		const nextSequence = session.sequence + 1;
		const reduced = applyFeatureMatchSessionEvent(session.currentState, session.sourceSnapshot, type, eventPayload);

		try {
			const nowMs = Date.now();
			const [, updatedRows] = await db.batch([
				// Make the event insert conditional on the same active sequence as
				// the projection update. A zero-row CAS can no longer commit an
				// orphan event before we report the conflict.
				db.insert(featureMatchSessionEvents).select(sql`
					select
						null,
						${session.eventId},
						${session.slotId},
						${session.id},
						${nextSequence},
						${type},
						json(${JSON.stringify(eventPayload)}),
						${commandId},
						${originConnectionId ?? null},
						${nowMs}
					from ${featureMatchSessions}
					where ${featureMatchSessions.id} = ${session.id}
						and ${featureMatchSessions.eventId} = ${session.eventId}
						and ${featureMatchSessions.sequence} = ${session.sequence}
						and ${featureMatchSessions.status} = 'active'
				`),
				db.update(featureMatchSessions)
					.set({
						currentState: reduced.currentState,
						sourceSnapshot: reduced.sourceSnapshot,
						sequence: nextSequence,
						updatedAt: new Date(),
					})
					.where(and(
						eq(featureMatchSessions.id, session.id),
						eq(featureMatchSessions.eventId, session.eventId),
						eq(featureMatchSessions.sequence, session.sequence),
						eq(featureMatchSessions.status, 'active'),
					))
					.returning(),
			]);

			const updatedSession = updatedRows?.[0];
			if (!updatedSession)
				throw new StateConflictError('Feature match session', session.id);

			return {
				slotId: updatedSession.slotId,
				sessionId: updatedSession.id,
				sequence: updatedSession.sequence,
				eventType: type,
				sourceSnapshot: updatedSession.sourceSnapshot,
				currentState: updatedSession.currentState,
				session: mapFeatureMatchSessionToResponse(updatedSession),
			};
		}
		catch (error) {
			const duplicate = await db.query.featureMatchSessionEvents.findFirst({
				where: and(
					eq(featureMatchSessionEvents.sessionId, session.id),
					eq(featureMatchSessionEvents.commandId, commandId),
				),
			});
			if (duplicate) {
				assertIdempotentCommandMatches(duplicate, {
					type,
					payload,
				});
				const latest = await findSessionById(session.id, session.eventId);
				if (latest) {
					return {
						slotId: latest.slotId,
						sessionId: latest.id,
						sequence: latest.sequence,
						eventType: duplicate.type,
						sourceSnapshot: latest.sourceSnapshot,
						currentState: latest.currentState,
						session: mapFeatureMatchSessionToResponse(latest),
					};
				}
			}
			throw error;
		}
	}

	const applyCommand = async (
		sessionId: number,
		eventId: number,
		command: FeatureMatchSessionCommand,
		originConnectionId?: string,
	): Promise<FeatureMatchSessionCommandResult> => {
		const duplicate = await db.query.featureMatchSessionEvents.findFirst({
			where: and(
				eq(featureMatchSessionEvents.sessionId, sessionId),
				eq(featureMatchSessionEvents.commandId, command.commandId),
			),
		});
		if (duplicate) {
			assertIdempotentCommandMatches(duplicate, command);
			const latest = await findSessionById(sessionId, eventId);
			if (!latest)
				throw createError({ statusCode: 404, message: 'Feature match session not found' });
			return {
				slotId: latest.slotId,
				sessionId: latest.id,
				sequence: latest.sequence,
				eventType: duplicate.type,
				sourceSnapshot: latest.sourceSnapshot,
				currentState: latest.currentState,
				session: mapFeatureMatchSessionToResponse(latest),
			};
		}

		const session = await findSessionById(sessionId, eventId);
		if (!session) {
			throw createError({ statusCode: 404, message: 'Feature match session not found' });
		}
		if (session.status !== 'active') {
			throw createError({ statusCode: 409, message: 'Feature match session is closed' });
		}
		if (command.type === 'SnapshotCorrected'
			&& (command.payload.sourceSnapshot.eventId !== eventId
				|| command.payload.sourceSnapshot.slotId !== session.slotId)) {
			throw createError({
				statusCode: 400,
				message: 'Snapshot correction does not belong to this session',
			});
		}

		if (!isMergeableFeatureMatchCommand(command.type) && command.baseSequence !== session.sequence) {
			throw createError({
				statusCode: 409,
				message: 'Feature match session has advanced',
				data: { session: mapFeatureMatchSessionToResponse(session) },
			});
		}

		try {
			return await appendSessionEvent(session, command.type, command.payload as FeatureMatchSessionEventPayload, command.commandId, originConnectionId);
		}
		catch (error) {
			if (!isMergeableFeatureMatchCommand(command.type))
				throw error;

			const latest = await findSessionById(sessionId, eventId);
			if (!latest || latest.sequence === session.sequence)
				throw error;

			return await appendSessionEvent(latest, command.type, command.payload as FeatureMatchSessionEventPayload, command.commandId, originConnectionId);
		}
	};

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

	return {
		loadEventDefaults,
		buildSourceSnapshot,
		buildCreateSessionForSlotQueries,
		createSessionForSlot,
		applyCommand,
		applyCommandToActiveSession,
		toEventAppliedPayload,
	};
}

import type { BatchItem } from 'drizzle-orm/batch';
import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type { SequencedLiveStateExecuteOptions } from '~~/server/modules/live-state';
import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandAppliedPayload,
	BroadcastGraphicsCommandResult,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import { and, eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { broadcastGraphicsLiveSessions } from '~~/server/db/schema';
import { mapBroadcastGraphicsLiveSessionToResponse } from '~~/server/mappers/broadcastGraphicsLiveSession';
import { createSequencedLiveState, forgetAggregateReceipts } from '~~/server/modules/live-state';
import { publishMessage } from '~~/server/utils/ably';
import {
	applyBroadcastGraphicsPlayoutCommand,
	createInitialBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';

/** Namespaces Broadcast Graphics Live Session receipts in the shared receipt store. */
export const BROADCAST_GRAPHICS_LIVE_SESSION_AGGREGATE_KIND = 'broadcastGraphicsLiveSession';

/** How a Broadcast Graphics Live Session is addressed for load and command execution. */
interface BroadcastGraphicsLiveSessionRef {
	sessionId: number;
	eventId: number;
}

export function broadcastGraphicsStateService() {
	const findSessionById = async (
		sessionId: number,
		eventId: number,
	): Promise<DbBroadcastGraphicsLiveSession | undefined> => {
		return await db.query.broadcastGraphicsLiveSessions.findFirst({
			where: and(
				eq(broadcastGraphicsLiveSessions.id, sessionId),
				eq(broadcastGraphicsLiveSessions.eventId, eventId),
			),
		});
	};

	const findActiveSessionByScreen = async (
		screenId: number,
		eventId: number,
	): Promise<DbBroadcastGraphicsLiveSession | undefined> => {
		return await db.query.broadcastGraphicsLiveSessions.findFirst({
			where: and(
				eq(broadcastGraphicsLiveSessions.screenId, screenId),
				eq(broadcastGraphicsLiveSessions.eventId, eventId),
				eq(broadcastGraphicsLiveSessions.status, 'active'),
			),
		});
	};

	/**
	 * End whichever epoch a Screen currently owns and discard its receipts.
	 *
	 * A Broadcast Graphics Live Session ends when the Screen leaves Broadcast
	 * Graphics mode, and an ended epoch can never accept another command — so its
	 * receipts have nothing left to protect. The row itself is kept: a stale retry
	 * addressed to it must be recognisably rejected rather than silently opening a
	 * fresh epoch.
	 *
	 * Both writes go in one batch so an epoch can never be ended without its
	 * receipts being discarded, or vice versa.
	 */
	const endSessionsForScreen = async (screenId: number, eventId: number): Promise<void> => {
		const now = new Date();
		const queries: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
			db.update(broadcastGraphicsLiveSessions)
				.set({ status: 'ended', endedAt: now, updatedAt: now })
				.where(and(
					eq(broadcastGraphicsLiveSessions.screenId, screenId),
					eq(broadcastGraphicsLiveSessions.eventId, eventId),
					eq(broadcastGraphicsLiveSessions.status, 'active'),
				)),
			forgetAggregateReceipts({
				aggregateKind: BROADCAST_GRAPHICS_LIVE_SESSION_AGGREGATE_KIND,
				aggregateIds: sql`
					select ${broadcastGraphicsLiveSessions.id}
					from ${broadcastGraphicsLiveSessions}
					where ${broadcastGraphicsLiveSessions.screenId} = ${screenId}
						and ${broadcastGraphicsLiveSessions.eventId} = ${eventId}
						and ${broadcastGraphicsLiveSessions.status} = 'ended'
				`,
			}),
		];

		await db.batch(queries);
	};

	/**
	 * The Screen's current playout epoch, opened if it does not have one.
	 *
	 * A Screen in Broadcast Graphics mode always has exactly one active epoch, so
	 * the first operator or Screen Output to ask for the authoritative snapshot
	 * opens it. A fresh epoch starts with nothing on air.
	 */
	const ensureActiveSession = async (
		screenId: number,
		eventId: number,
	): Promise<DbBroadcastGraphicsLiveSession> => {
		const existing = await findActiveSessionByScreen(screenId, eventId);
		if (existing)
			return existing;

		try {
			const [created] = await db.insert(broadcastGraphicsLiveSessions)
				.values({
					eventId,
					screenId,
					status: 'active',
					currentState: createInitialBroadcastGraphicsLiveState(),
					sequence: 1,
				})
				.returning();
			if (created)
				return created;
		}
		catch (error) {
			// Another writer opened the epoch first; the partial unique index on the
			// active status is what turned that race into a failure here.
			const raced = await findActiveSessionByScreen(screenId, eventId);
			if (!raced)
				throw error;
			return raced;
		}

		throw new Error('Failed to open broadcast graphics live session');
	};

	function toCommandAppliedPayload(
		result: BroadcastGraphicsCommandResult,
	): BroadcastGraphicsCommandAppliedPayload {
		return {
			screenId: result.screenId,
			sessionId: result.sessionId,
			sequence: result.sequence,
			commandType: result.commandType,
			currentState: result.currentState,
		};
	}

	/**
	 * The Broadcast Graphics half of the shared sequenced live-state module: what
	 * its playout commands mean and how its projection is stored. Sequencing,
	 * receipts, duplicate suppression, and conflict protection are the module's.
	 */
	const liveState = createSequencedLiveState<
		BroadcastGraphicsLiveSessionRef,
		DbBroadcastGraphicsLiveSession,
		BroadcastGraphicsCommand,
		BroadcastGraphicsLiveState,
		BroadcastGraphicsCommandResult
	>({
		aggregateKind: BROADCAST_GRAPHICS_LIVE_SESSION_AGGREGATE_KIND,
		aggregateLabel: 'Broadcast graphics live session',

		aggregateIdOf: ref => ref.sessionId,
		eventIdOf: ref => ref.eventId,
		load: ref => findSessionById(ref.sessionId, ref.eventId),
		sequenceOf: session => session.sequence,

		/**
		 * Epoch admission, and nothing else. A playout action states the latest
		 * desired on-air state of one Broadcast Graphic, so — unlike an absolute
		 * Feature Match Session command — a session that has advanced since the
		 * operator looked never invalidates it. There is deliberately no base
		 * sequence to check.
		 */
		admit: (session) => {
			if (session.status !== 'active') {
				throw createError({
					statusCode: 409,
					message: 'Broadcast graphics live session has ended',
				});
			}
		},

		/**
		 * Every playout command is safe to re-reduce onto a newer state: each owns
		 * exactly one Broadcast Graphic's on-air intent, so a writer that got in
		 * first with a different graphic — or with an older intent for the same one —
		 * does not invalidate this one.
		 */
		isMergeable: () => true,

		reduce: (session, command) => applyBroadcastGraphicsPlayoutCommand(
			session.currentState,
			command.type,
			command.payload,
		),

		casGuard: session => sql`
			from ${broadcastGraphicsLiveSessions}
			where ${broadcastGraphicsLiveSessions.id} = ${session.id}
				and ${broadcastGraphicsLiveSessions.eventId} = ${session.eventId}
				and ${broadcastGraphicsLiveSessions.sequence} = ${session.sequence}
				and ${broadcastGraphicsLiveSessions.status} = 'active'
		`,

		projection: ({ aggregate, reduction, nextSequence }) => db
			.update(broadcastGraphicsLiveSessions)
			.set({
				currentState: reduction,
				sequence: nextSequence,
				updatedAt: new Date(),
			})
			.where(and(
				eq(broadcastGraphicsLiveSessions.id, aggregate.id),
				eq(broadcastGraphicsLiveSessions.eventId, aggregate.eventId),
				eq(broadcastGraphicsLiveSessions.sequence, aggregate.sequence),
				eq(broadcastGraphicsLiveSessions.status, 'active'),
			))
			.returning(),

		toResult: (session, commandType) => ({
			screenId: session.screenId,
			sessionId: session.id,
			sequence: session.sequence,
			commandType: commandType as BroadcastGraphicsCommandResult['commandType'],
			currentState: session.currentState,
			session: mapBroadcastGraphicsLiveSessionToResponse(session),
		}),

		publish: async (result, originConnectionId) => {
			await publishMessage(
				result.session.eventId,
				'broadcastGraphicsLiveSession:commandApplied',
				toCommandAppliedPayload(result),
				originConnectionId,
			);
		},
	});

	const applyCommand = async (
		sessionId: number,
		eventId: number,
		command: BroadcastGraphicsCommand,
		originConnectionId?: string,
		options: Omit<SequencedLiveStateExecuteOptions, 'originConnectionId'> = {},
	): Promise<BroadcastGraphicsCommandResult> => {
		return await liveState.execute({ sessionId, eventId }, command, { ...options, originConnectionId });
	};

	return {
		findSessionById,
		ensureActiveSession,
		endSessionsForScreen,
		applyCommand,
	};
}

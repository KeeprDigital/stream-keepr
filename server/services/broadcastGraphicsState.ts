import type { BatchItem } from 'drizzle-orm/batch';
import type { DbBroadcastGraphicsSession } from '~~/server/db/schema';
import type { SequencedLiveStateExecuteOptions } from '~~/server/modules/live-state';
import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-session';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandAppliedPayload,
	BroadcastGraphicsCommandResult,
} from '~~/shared/types/broadcastGraphicsSession';
import { and, eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { broadcastGraphicsSessions } from '~~/server/db/schema';
import { mapBroadcastGraphicsSessionToResponse } from '~~/server/mappers/broadcastGraphicsSession';
import { createSequencedLiveState, forgetAggregateReceipts } from '~~/server/modules/live-state';
import { publishMessage } from '~~/server/utils/ably';
import {
	applyBroadcastGraphicsPlayoutCommand,
	createInitialBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-session';

/** Namespaces Broadcast Graphics Live Session receipts in the shared receipt store. */
export const BROADCAST_GRAPHICS_SESSION_AGGREGATE_KIND = 'broadcastGraphicsSession';

/** How a Broadcast Graphics Live Session is addressed for load and command execution. */
interface BroadcastGraphicsSessionRef {
	sessionId: number;
	eventId: number;
}

export function broadcastGraphicsStateService() {
	const findSessionById = async (
		sessionId: number,
		eventId: number,
	): Promise<DbBroadcastGraphicsSession | undefined> => {
		return await db.query.broadcastGraphicsSessions.findFirst({
			where: and(
				eq(broadcastGraphicsSessions.id, sessionId),
				eq(broadcastGraphicsSessions.eventId, eventId),
			),
		});
	};

	const findActiveSessionByScreen = async (
		screenId: number,
		eventId: number,
	): Promise<DbBroadcastGraphicsSession | undefined> => {
		return await db.query.broadcastGraphicsSessions.findFirst({
			where: and(
				eq(broadcastGraphicsSessions.screenId, screenId),
				eq(broadcastGraphicsSessions.eventId, eventId),
				eq(broadcastGraphicsSessions.status, 'active'),
			),
		});
	};

	/**
	 * Statements that end whichever epoch a Screen currently owns and discard its
	 * receipts, without executing them.
	 *
	 * A Broadcast Graphics Live Session ends when the Screen leaves Broadcast
	 * Graphics mode, and an ended epoch can never accept another command — so its
	 * receipts have nothing left to protect. The row itself is kept: a stale retry
	 * addressed to it must be recognisably rejected rather than silently opening a
	 * fresh epoch. Returning statements rather than running them lets a caller
	 * compose the ending into its own atomic batch.
	 */
	const buildEndSessionsForScreenQueries = (screenId: number, eventId: number): BatchItem<'sqlite'>[] => {
		const now = new Date();

		return [
			db.update(broadcastGraphicsSessions)
				.set({ status: 'ended', endedAt: now, updatedAt: now })
				.where(and(
					eq(broadcastGraphicsSessions.screenId, screenId),
					eq(broadcastGraphicsSessions.eventId, eventId),
					eq(broadcastGraphicsSessions.status, 'active'),
				)),
			forgetAggregateReceipts({
				aggregateKind: BROADCAST_GRAPHICS_SESSION_AGGREGATE_KIND,
				aggregateIds: sql`
					select ${broadcastGraphicsSessions.id}
					from ${broadcastGraphicsSessions}
					where ${broadcastGraphicsSessions.screenId} = ${screenId}
						and ${broadcastGraphicsSessions.eventId} = ${eventId}
						and ${broadcastGraphicsSessions.status} = 'ended'
				`,
			}),
		];
	};

	const endSessionsForScreen = async (screenId: number, eventId: number): Promise<void> => {
		const queries = buildEndSessionsForScreenQueries(screenId, eventId);
		await db.batch(queries as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
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
	): Promise<DbBroadcastGraphicsSession> => {
		const existing = await findActiveSessionByScreen(screenId, eventId);
		if (existing)
			return existing;

		try {
			const [created] = await db.insert(broadcastGraphicsSessions)
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
		BroadcastGraphicsSessionRef,
		DbBroadcastGraphicsSession,
		BroadcastGraphicsCommand,
		BroadcastGraphicsLiveState,
		BroadcastGraphicsCommandResult
	>({
		aggregateKind: BROADCAST_GRAPHICS_SESSION_AGGREGATE_KIND,
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
			from ${broadcastGraphicsSessions}
			where ${broadcastGraphicsSessions.id} = ${session.id}
				and ${broadcastGraphicsSessions.eventId} = ${session.eventId}
				and ${broadcastGraphicsSessions.sequence} = ${session.sequence}
				and ${broadcastGraphicsSessions.status} = 'active'
		`,

		projection: ({ aggregate, reduction, nextSequence }) => db
			.update(broadcastGraphicsSessions)
			.set({
				currentState: reduction,
				sequence: nextSequence,
				updatedAt: new Date(),
			})
			.where(and(
				eq(broadcastGraphicsSessions.id, aggregate.id),
				eq(broadcastGraphicsSessions.eventId, aggregate.eventId),
				eq(broadcastGraphicsSessions.sequence, aggregate.sequence),
				eq(broadcastGraphicsSessions.status, 'active'),
			))
			.returning(),

		toResult: (session, commandType) => ({
			screenId: session.screenId,
			sessionId: session.id,
			sequence: session.sequence,
			commandType: commandType as BroadcastGraphicsCommandResult['commandType'],
			currentState: session.currentState,
			session: mapBroadcastGraphicsSessionToResponse(session),
		}),

		publish: async (result, originConnectionId) => {
			await publishMessage(
				result.session.eventId,
				'broadcastGraphicsSession:commandApplied',
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
		findActiveSessionByScreen,
		ensureActiveSession,
		buildEndSessionsForScreenQueries,
		endSessionsForScreen,
		applyCommand,
	};
}

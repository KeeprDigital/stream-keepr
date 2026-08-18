import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DbBroadcastGraphicsLiveSession } from '~~/server/db/schema';
import type { SequencedLiveStateExecuteOptions } from '~~/server/modules/live-state';
import type { BroadcastGraphicsLiveState, BroadcastGraphicsReductionContext } from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { broadcastGraphicsLiveSessions, screens } from '~~/server/db/schema';
import {
	broadcastGraphicsCommandAppliedPayload,
	mapBroadcastGraphicsCommandResult,
} from '~~/server/mappers/broadcastGraphicsLiveSession';
import { createSequencedLiveState, forgetAggregateReceipts } from '~~/server/modules/live-state';
import { clearBroadcastGraphicsLiveSessionGraphicAssetReferencesStatement } from '~~/server/modules/screen-graphic-asset-references';
import { publishMessage } from '~~/server/utils/ably';
import {
	applyBroadcastGraphicsCommand,
	BroadcastGraphicsCommandRejection,
	carriedForwardBroadcastGraphicsLiveState,
	createInitialBroadcastGraphicsLiveState,
	recoveredBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * How a domain refusal reaches the operator.
 *
 * A stale acceptance, an Update Graphic on a graphic that is off, and a required
 * Graphic Input with no available value are all refusals about the current state
 * of the show, so they are conflicts. Naming a Graphic Input the Broadcast Graphic
 * does not declare addresses something that is not there.
 *
 * A revision that does not resolve is a conflict too rather than a not-found: the
 * command addresses a Graphic Input that exists, and what has gone is the content it
 * named — which is a fact about the state of the library, and may be temporary.
 */
const REJECTION_STATUS: Record<BroadcastGraphicsCommandRejection['code'], number> = {
	'stale-input-acceptance': 409,
	'stale-input-edit': 409,
	'required-input-unavailable': 409,
	'update-unavailable': 409,
	'unknown-input': 404,
	'unknown-source': 404,
	'override-unbound': 409,
	'missing-asset-reference': 409,
	'unavailable-asset-content': 409,
	'unknown-social-profile-projection': 404,
	'social-profile-unavailable': 409,
};

/**
 * One domain refusal as the error its transport carries.
 *
 * The single place a refusal becomes an HTTP failure, because the code is the part a
 * client acts on: without it a 409 is indistinguishable from the epoch conflict this
 * client's store reloads and restates on (#203). Refusals raised outside the reducer —
 * admission the module performs before reduction ever sees the command — reach the
 * wire through here rather than building their own error, so there is one answer to
 * "what does a refused command look like".
 */
export function broadcastGraphicsRejectionError(rejection: BroadcastGraphicsCommandRejection) {
	return createError({
		statusCode: REJECTION_STATUS[rejection.code],
		message: rejection.message,
		data: { code: rejection.code, inputKeys: rejection.inputKeys },
	});
}

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
	 * Every playout epoch currently running anywhere in one Event.
	 *
	 * The set an Event Data change has to be offered to. It is asked by Event rather
	 * than by Screen because that is the scope the change itself has: a renamed Player
	 * may be bound by a Broadcast Graphic on any Screen, and the one thing the
	 * authoritative side must not do is decide which Screens matter by asking whichever
	 * of them happens to have a browser pointed at it.
	 */
	const findActiveSessionsByEvent = async (
		eventId: number,
	): Promise<DbBroadcastGraphicsLiveSession[]> => {
		return await db.query.broadcastGraphicsLiveSessions.findMany({
			where: and(
				eq(broadcastGraphicsLiveSessions.eventId, eventId),
				eq(broadcastGraphicsLiveSessions.status, 'active'),
			),
		});
	};

	/**
	 * The epoch a Screen ended most recently, whose prepared work the next one
	 * inherits.
	 *
	 * Ordered by identity rather than by `endedAt`, because a mode change flipped in
	 * and out inside one millisecond gives two rows the same timestamp and the later
	 * identity is the one that was actually running.
	 */
	const findLatestEndedSessionByScreen = async (
		screenId: number,
		eventId: number,
	): Promise<DbBroadcastGraphicsLiveSession | undefined> => {
		return await db.query.broadcastGraphicsLiveSessions.findFirst({
			where: and(
				eq(broadcastGraphicsLiveSessions.screenId, screenId),
				eq(broadcastGraphicsLiveSessions.eventId, eventId),
				eq(broadcastGraphicsLiveSessions.status, 'ended'),
			),
			orderBy: desc(broadcastGraphicsLiveSessions.id),
		});
	};

	/**
	 * The three writes that end whichever epoch a Screen currently owns.
	 *
	 * A Broadcast Graphics Live Session ends when the Screen leaves Broadcast
	 * Graphics mode or an operator explicitly resets live state. An ended epoch can
	 * never accept another command, so its receipts have nothing left to protect;
	 * and it has accepted nothing, so the media Graphic Input values it published
	 * stop being published in the same instant. The session row itself is kept: a
	 * stale retry addressed to it must be recognisably rejected rather than silently
	 * opening a fresh epoch.
	 *
	 * All three together or none, because each of the other two is a consequence of
	 * the first that nothing downstream re-derives. The reference clear used to be a
	 * separate write issued after this batch, and its failure left an ended epoch's
	 * media resolvable through the Screen's outputs while skipping the announcement
	 * that would have told anyone (#305).
	 *
	 * Returned as statements rather than executed so a caller can commit them
	 * together with the write that causes the end — the successor epoch a reset
	 * opens, or the mode change a Screen leaving Broadcast Graphics commits.
	 */
	const endSessionStatements = (
		screenId: number,
		eventId: number,
		/**
		 * An extra condition every statement is subject to.
		 *
		 * An end committed on its own needs none: the caller has already decided.
		 * An end riding in the batch of the write that causes it does, because a
		 * batch applies every statement it holds whether or not the ones before it
		 * matched anything — so an end travelling with a mode change that may be
		 * refused has to state that mode change's postcondition itself, or a
		 * refused write would blank a show nobody asked to stop.
		 */
		onlyIf?: SQL,
	): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] => {
		const now = new Date();
		return [
			db.update(broadcastGraphicsLiveSessions)
				.set({ status: 'ended', endedAt: now, updatedAt: now })
				.where(and(
					eq(broadcastGraphicsLiveSessions.screenId, screenId),
					eq(broadcastGraphicsLiveSessions.eventId, eventId),
					eq(broadcastGraphicsLiveSessions.status, 'active'),
					onlyIf,
				)),
			// Not subject to `onlyIf`, unlike the two statements it rides between, and
			// that asymmetry is safe because of what its own subquery selects: sessions
			// that have *already* ended. On a refused write the update above did not end
			// anything, so this matches only epochs some earlier end already purged the
			// receipts of, and deletes nothing. It is stated rather than left to be
			// re-derived because the reading that would make it a defect — a refused
			// write forgetting a running epoch's receipts, so a stale retry replays
			// against a show still on air — is exactly the one `onlyIf` exists to
			// prevent everywhere else in this batch.
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
			clearBroadcastGraphicsLiveSessionGraphicAssetReferencesStatement(screenId, onlyIf),
		];
	};

	/**
	 * True once the Screen is no longer in Broadcast Graphics mode.
	 *
	 * The postcondition of the mode change an atomic epoch end travels with, and so
	 * the condition that end applies under. Stated as the invariant rather than as
	 * the transaction — *a Screen outside Broadcast Graphics mode owns no running
	 * epoch* — because that is true of whichever writer took the Screen out of the
	 * mode, not only of the one this end was built for.
	 */
	const screenHasLeftBroadcastGraphics = (screenId: number, eventId: number): SQL => sql`exists (
		select 1 from ${screens}
		where ${screens.id} = ${screenId}
			and ${screens.eventId} = ${eventId}
			and ${screens.currentMode} != 'broadcast-graphics'
	)`;

	const openSessionStatement = (
		screenId: number,
		eventId: number,
		currentState: BroadcastGraphicsLiveState,
	): BatchItem<'sqlite'> => db.insert(broadcastGraphicsLiveSessions)
		.values({ eventId, screenId, status: 'active', currentState, sequence: 1 })
		.returning();

	/**
	 * The statements ending the epoch of a Screen that is leaving Broadcast Graphics
	 * mode, for a caller committing them with the mode change itself.
	 *
	 * The end used to be a second write issued once the mode change had committed —
	 * that ordering was chosen so a failed update could not blank a running show, and
	 * it bought that at the cost of the opposite failure: an end that failed left the
	 * Screen out of the mode with its epoch still active, which the next activation
	 * found and returned with the previous show's graphics still on air. Committed
	 * together, neither failure has an instant to happen in, and the condition below
	 * is what keeps the guarantee the old ordering was protecting.
	 */
	const endSessionStatementsOnLeavingBroadcastGraphics = (
		screenId: number,
		eventId: number,
	): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] => endSessionStatements(
		screenId,
		eventId,
		screenHasLeftBroadcastGraphics(screenId, eventId),
	);

	/** Ends the Screen's epoch, answering which one it was so it can be announced. */
	const endSessionsForScreen = async (
		screenId: number,
		eventId: number,
	): Promise<DbBroadcastGraphicsLiveSession | undefined> => {
		const ended = await findActiveSessionByScreen(screenId, eventId);
		await db.batch(endSessionStatements(screenId, eventId));
		return ended;
	};

	/**
	 * End the Screen's epoch and open its successor in one commit, carrying nothing
	 * forward.
	 *
	 * This is what an explicit live-state reset means: every Broadcast Graphic off,
	 * a new epoch that stale retries from the old one cannot reach, and — unlike a
	 * mode change — no prepared Graphic Input values either. A mode change is
	 * incidental to the show and the operator's staged work should survive it; a
	 * reset is the operator asking for a clean slate, and silently keeping their
	 * previous values would make it the one action that cannot deliver one.
	 *
	 * One batch, so there is no instant at which the Screen has no epoch — a
	 * concurrent snapshot request would otherwise open one and carry forward exactly
	 * the values this is discarding.
	 */
	const resetSessionForScreen = async (
		screenId: number,
		eventId: number,
	): Promise<{ ended?: DbBroadcastGraphicsLiveSession; opened: DbBroadcastGraphicsLiveSession }> => {
		const ended = await findActiveSessionByScreen(screenId, eventId);
		const [first, ...rest] = endSessionStatements(screenId, eventId);
		const results = await db.batch([
			first,
			...rest,
			openSessionStatement(screenId, eventId, createInitialBroadcastGraphicsLiveState()),
		]);
		const opened = (results.at(-1) as DbBroadcastGraphicsLiveSession[] | undefined)?.[0];
		if (!opened)
			throw new Error('Failed to open broadcast graphics live session');

		return { ended, opened };
	};

	/**
	 * The Screen's current playout epoch, opened if it does not have one.
	 *
	 * A Screen in Broadcast Graphics mode always has exactly one active epoch, so
	 * the first operator or Screen Output to ask for the authoritative snapshot
	 * opens it. A fresh epoch has nothing on air, and inherits the previous epoch's
	 * prepared Graphic Input values: a Screen flipped out of and back into Broadcast
	 * Graphics mode is one show continuing, so the values an operator staged for
	 * their next take are not theirs to retype.
	 */
	const ensureActiveSession = async (
		screenId: number,
		eventId: number,
	): Promise<DbBroadcastGraphicsLiveSession> => {
		const existing = await findActiveSessionByScreen(screenId, eventId);
		if (existing)
			return existing;

		const previous = await findLatestEndedSessionByScreen(screenId, eventId);

		try {
			const [created] = await db.insert(broadcastGraphicsLiveSessions)
				.values({
					eventId,
					screenId,
					status: 'active',
					currentState: previous
						? carriedForwardBroadcastGraphicsLiveState(previous.currentState)
						: createInitialBroadcastGraphicsLiveState(),
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

	/**
	 * The Broadcast Graphics half of the shared sequenced live-state module: what
	 * its commands mean and how its projection is stored. Sequencing, receipts,
	 * duplicate suppression, and conflict protection are the module's.
	 *
	 * It is built per command because reduction needs the addressed Broadcast
	 * Graphic's declared Graphic Inputs, Graphic Source Selections, and Graphic Input
	 * Bindings — plus the Event Data those bindings resolve against — and the port's
	 * reduction sees only the sequenced aggregate and the command. Declarations are
	 * authored Screen configuration and Event Data belongs to the Event; an author or
	 * a tournament can change either under a running show, so denormalizing them into
	 * live state to bring them within the port's reach would be storing a copy that
	 * can go stale. Closing over them for the one command that needs them keeps both
	 * authoritative where they live.
	 */
	const liveStateFor = (context: Omit<BroadcastGraphicsReductionContext, 'acceptedAt'>) => createSequencedLiveState<
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
		 * Every command here is safe to re-reduce onto a newer state: each owns one
		 * Broadcast Graphic's on-air intent or one of its Graphic Inputs, so a writer
		 * that got in first with a different graphic — or with an older intent for the
		 * same one — does not invalidate this one.
		 *
		 * Update Graphic is mergeable for the same reason, and its own guard is what
		 * makes that safe: re-reducing it onto the newer state re-checks the acceptance
		 * revision, so a merge retry cannot slip a stale acceptance past the guard the
		 * first attempt satisfied. Answering `false` here instead would turn an
		 * unrelated Take on another graphic into a spurious conflict for the operator
		 * accepting inputs.
		 */
		isMergeable: () => true,

		/**
		 * A domain refusal is raised from the shared reducer, which is deliberately
		 * ignorant of HTTP; this is the one place that maps it. Reduction happens
		 * before the compare-and-swap write, so a refusal never leaves a receipt.
		 *
		 * Reduction starts from the *recovered* state, which is what makes an explicit
		 * Take the way out of a recovery fault: the command is reduced onto a state
		 * with nothing on air rather than onto the unreadable one, so the write that
		 * commits it also replaces the state nobody could read. Reducing onto the raw
		 * state instead would either throw or persist the corruption forward.
		 */
		reduce: (session, command) => {
			try {
				return applyBroadcastGraphicsCommand(
					recoveredBroadcastGraphicsLiveState(session.currentState),
					command,
					// The server's clock is the authoritative effective start time of the
					// phase this command begins. It is read here, at acceptance, rather than
					// sent by a client: every output projects animation from this instant, so
					// it has to come from the one place that decides the authoritative order.
					//
					// The addressed graphic's phase durations travel with it, because two of
					// the reducer's decisions are about a schedule rather than a target — was
					// the phase this intent interrupts still running, and when is a coalesced
					// update due — and both have to be settled once, here, rather than by
					// each output against its own clock.
					{ ...context, acceptedAt: Date.now() },
				);
			}
			catch (error) {
				if (error instanceof BroadcastGraphicsCommandRejection)
					throw broadcastGraphicsRejectionError(error);
				throw error;
			}
		},

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

		// One mapped snapshot feeds both the result and the notification derived from
		// it, so a client cannot be handed a recovered `session` alongside a raw
		// `currentState` that disagrees with it. The invariant lives with the mapper
		// that owns recovery, and is pinned there.
		toResult: (session, commandType) => mapBroadcastGraphicsCommandResult(
			session,
			commandType as BroadcastGraphicsCommandResult['commandType'],
		),

		/**
		 * The notification announces what the command *changed*, measured against the
		 * live state it was reduced onto.
		 *
		 * Reading the previous state through the module rather than remembering it here
		 * is what keeps the two halves honest: the merge retry reduces onto a reloaded
		 * aggregate and a recognised replay onto nothing at all, and a difference
		 * measured from the wrong one would leave every peer holding a state the server
		 * does not have — silently, since nothing downstream re-checks it.
		 */
		publish: async (result, { originConnectionId, previous }) => {
			await publishMessage(
				result.session.eventId,
				'broadcastGraphicsLiveSession:commandApplied',
				broadcastGraphicsCommandAppliedPayload(
					result,
					previous && recoveredBroadcastGraphicsLiveState(previous.currentState),
					originConnectionId,
				),
				originConnectionId,
			);
		},
	});

	const applyCommand = async (
		sessionId: number,
		eventId: number,
		command: BroadcastGraphicsCommand,
		/**
		 * The addressed Broadcast Graphic's declarations, and how its bindings resolve.
		 *
		 * Everything the reducer needs except the acceptance instant, which is read from
		 * the server's own clock at acceptance rather than passed in — every output
		 * projects animation from it, so it has to come from the one place that decides
		 * the authoritative order.
		 */
		context: Omit<BroadcastGraphicsReductionContext, 'acceptedAt'>,
		originConnectionId?: string,
		options: Omit<SequencedLiveStateExecuteOptions, 'originConnectionId'> = {},
	): Promise<BroadcastGraphicsCommandResult> => {
		return await liveStateFor(context)
			.execute({ sessionId, eventId }, command, { ...options, originConnectionId });
	};

	return {
		findSessionById,
		findActiveSessionByScreen,
		findActiveSessionsByEvent,
		ensureActiveSession,
		endSessionsForScreen,
		endSessionStatementsOnLeavingBroadcastGraphics,
		resetSessionForScreen,
		applyCommand,
	};
}

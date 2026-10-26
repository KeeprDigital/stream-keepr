import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { db } from '~~/server/db';
import { forgetAggregateReceipts } from './receipts';

/**
 * The feature-specific half of a live aggregate's epoch lifecycle.
 *
 * A scope is whatever the feature opens epochs within — a Feature Match Slot, a
 * set of them, a Broadcast Graphics Screen — and carries any condition the
 * feature's statements must hold under. The module never interprets it: it only
 * hands it back, so a condition that guards the close also guards the open.
 */
export interface SequencedLiveEpochPort<TScope, TOpening, TAggregate> {
	/** Namespaces this family of aggregates within the shared receipt store. */
	readonly aggregateKind: string;
	idOf: (aggregate: TAggregate) => number;
	/** Every epoch active within the scope right now. */
	findActive: (scope: TScope) => Promise<TAggregate[]>;
	/** Statements ending every epoch active within the scope. */
	close: (scope: TScope) => BatchItem<'sqlite'>[];
	/**
	 * A select yielding the id of every ended epoch within the scope, whose
	 * receipts are forgotten in the same commit that ends them.
	 */
	closedIds: (scope: TScope) => SQL;
	/** Statements opening the scope's successor epochs, and pointing whatever owns them at them. */
	open: (scope: TScope, opening: TOpening) => BatchItem<'sqlite'>[];
	/**
	 * Tell peers about epochs that ended or opened. Called only when the commit
	 * changed something and the caller did not opt out.
	 */
	announce?: (change: SequencedLiveEpochChange<TAggregate>, options: { originConnectionId?: string }) => Promise<void>;
}

/** What a committed transition changed, compared with what was active before it. */
export interface SequencedLiveEpochChange<TAggregate> {
	/** Epochs active before the commit and not after, as they were last seen active. */
	ended: TAggregate[];
	/** Epochs active after the commit and not before. */
	opened: TAggregate[];
}

export interface SequencedLiveEpochSettleOptions {
	/** Realtime connection that caused the transition, for origin echo suppression. */
	originConnectionId?: string;
	/**
	 * Announce what changed. On by default: a new epoch is learned from its own
	 * announcement, whichever path opened it. Only an end nobody may be told about —
	 * a Screen on its way to deletion, or an epoch opened by the read that is about to
	 * return it — opts out, or a caller that announces the returned change itself as
	 * part of one larger publication (a Feature Match Slot Promotion, ADR-0033).
	 */
	announce?: boolean;
}

/**
 * One epoch transition, built but not committed, so a caller can commit its
 * statements inside a larger batch.
 */
export interface SequencedLiveEpochTransition<TAggregate> {
	statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];
	/**
	 * Run once the batch carrying `statements` has committed. Reads what the commit
	 * actually changed and announces it. Never run for a batch that failed: an
	 * announcement is a claim that an epoch changed.
	 */
	settle: (options?: SequencedLiveEpochSettleOptions) => Promise<SequencedLiveEpochChange<TAggregate>>;
}

export interface SequencedLiveEpochs<TScope, TOpening, TAggregate> {
	/** End the scope's active epochs and forget their receipts. */
	close: (scope: TScope) => Promise<SequencedLiveEpochTransition<TAggregate>>;
	/** End the scope's active epochs, open their successors, and forget the ended epochs' receipts. */
	replace: (scope: TScope, opening: TOpening) => Promise<SequencedLiveEpochTransition<TAggregate>>;
	/**
	 * Open epochs in a scope believed to have none, ending nothing. A racing opener
	 * surfaces as the feature's one-active-epoch index refusing the batch, rather
	 * than as one opener silently ending the other's epoch.
	 */
	open: (scope: TScope, opening: TOpening) => Promise<SequencedLiveEpochTransition<TAggregate>>;
	/** Commit a transition on its own and settle it. */
	commit: (
		transition: SequencedLiveEpochTransition<TAggregate>,
		options?: SequencedLiveEpochSettleOptions,
	) => Promise<SequencedLiveEpochChange<TAggregate>>;
}

/**
 * The epoch lifecycle of one family of live aggregates: opening a new epoch,
 * closing the active one, forgetting its Command Receipts in the same commit, and
 * deciding whether the change is announced.
 *
 * Receipts are keyed by aggregate id and epochs never reuse one (ADR-0026), so a
 * receipt from an ended epoch can never answer a command addressed to its
 * successor. Forgetting them in the commit that ends the epoch is what keeps that
 * true without anyone having to reason about it, and bounds the receipt store.
 *
 * Whether to announce is decided from what the commit did, not from what the
 * caller asked for: the active epochs are read before the transition is built and
 * again once it has committed, and only a difference is announced. A transition
 * whose conditions turned it into a no-op therefore announces nothing.
 */
export function createSequencedLiveEpochs<TScope, TOpening, TAggregate>(
	port: SequencedLiveEpochPort<TScope, TOpening, TAggregate>,
): SequencedLiveEpochs<TScope, TOpening, TAggregate> {
	function forgetClosedReceipts(scope: TScope): BatchItem<'sqlite'> {
		return forgetAggregateReceipts({
			aggregateKind: port.aggregateKind,
			aggregateIds: port.closedIds(scope),
		});
	}

	async function transition(
		scope: TScope,
		statements: BatchItem<'sqlite'>[],
	): Promise<SequencedLiveEpochTransition<TAggregate>> {
		const [first, ...rest] = statements;
		if (!first)
			throw new Error('An epoch transition has no statements');

		const before = await port.findActive(scope);

		return {
			statements: [first, ...rest],
			settle: async ({ originConnectionId, announce = true } = {}) => {
				const after = await port.findActive(scope);
				const afterIds = new Set(after.map(port.idOf));
				const beforeIds = new Set(before.map(port.idOf));
				const change: SequencedLiveEpochChange<TAggregate> = {
					ended: before.filter(epoch => !afterIds.has(port.idOf(epoch))),
					opened: after.filter(epoch => !beforeIds.has(port.idOf(epoch))),
				};

				if (announce && port.announce && (change.ended.length > 0 || change.opened.length > 0))
					await port.announce(change, { originConnectionId });
				return change;
			},
		};
	}

	return {
		close: async scope => await transition(scope, [
			...port.close(scope),
			forgetClosedReceipts(scope),
		]),
		replace: async (scope, opening) => await transition(scope, [
			...port.close(scope),
			forgetClosedReceipts(scope),
			...port.open(scope, opening),
		]),
		open: async (scope, opening) => await transition(scope, port.open(scope, opening)),
		commit: async (pending, options) => {
			await db.batch(pending.statements);
			return await pending.settle(options);
		},
	};
}

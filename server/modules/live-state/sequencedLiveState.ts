import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { CommandReceipt } from './receipts';
import { db } from 'hub:db';
import { StateConflictError } from '~~/server/utils/errors';
import { commandContentKey, commandReceiptStatements, findCommandReceipt } from './receipts';

/** The minimum a command must state to be sequenced. */
export interface SequencedCommand {
	commandId: string;
	type: string;
	payload: unknown;
}

export interface SequencedLiveStateExecuteOptions {
	/** Realtime connection that issued the command, for origin echo suppression. */
	originConnectionId?: string;
	/**
	 * Announce the result over realtime. Internal reverse-sync writes that already
	 * publish their own change notification opt out.
	 */
	publish?: boolean;
}

export interface SequencedLiveStateProjectionInput<TAggregate, TReduction> {
	aggregate: TAggregate;
	reduction: TReduction;
	nextSequence: number;
}

/**
 * The feature-specific half of a sequenced live-state aggregate.
 *
 * Everything here is domain knowledge the shared module deliberately refuses to
 * hold: how to find the aggregate, what its commands mean, which of them may be
 * merged onto a newer state, and how its projection is written. The sequencing
 * protocol built on top of it lives entirely in `createSequencedLiveState`.
 */
export interface SequencedLiveStatePort<TRef, TAggregate, TCommand extends SequencedCommand, TReduction, TResult> {
	/** Namespaces this family of aggregates within the shared receipt store. */
	readonly aggregateKind: string;
	/** How the aggregate is named in conflict and not-found errors. */
	readonly aggregateLabel: string;
	/** Which stored aggregate a reference addresses — known before loading it. */
	aggregateIdOf: (ref: TRef) => number;
	/** The Event that owns the aggregate; its receipts are removed with it. */
	eventIdOf: (ref: TRef) => number;
	load: (ref: TRef) => Promise<TAggregate | undefined>;
	sequenceOf: (aggregate: TAggregate) => number;
	/**
	 * Feature-specific admission: lifecycle status, ownership, and base-sequence
	 * policy. Throws to reject the command before anything is written.
	 *
	 * Runs once per commit attempt: before the first, and again against the
	 * reloaded aggregate before the merge retry. So it must be safe to call more
	 * than once for one command — it decides admissibility against the state it is
	 * handed and accumulates nothing of its own. In exchange, an admission rule may
	 * depend on state that changes between the two attempts without having to be
	 * mirrored into `casGuard` or hidden inside `reduce` to stay enforced.
	 *
	 * It sees the sequenced aggregate and nothing else — `TAggregate` is exactly
	 * the row `projection` returns, so it cannot be widened into a composite.
	 * Admission that needs a second entity belongs in the feature's own module,
	 * checked before it calls `execute`, rather than being denormalized into live
	 * state to bring it within reach here. Broadcast Graphics playout is the worked
	 * example: whether a Take names a Broadcast Graphic the Screen actually places
	 * is a question about the Screen's authored configuration, so its module
	 * resolves the Screen and rejects an unplaced graphic before executing.
	 */
	admit: (aggregate: TAggregate, command: TCommand) => void;
	/**
	 * Whether a losing command is safe to re-reduce onto a newer aggregate.
	 *
	 * The question is only that — not whether the command is relative. Relative
	 * intents (adjust by, step by) qualify because they compose with whatever got
	 * in first, and field-scoped absolute intents qualify too: a command that
	 * claims one field's latest value is not invalidated by a concurrent writer
	 * claiming a different field. Answering `false` for the latter turns ordinary
	 * concurrent editing of disjoint fields into spurious conflicts.
	 */
	isMergeable: (command: TCommand) => boolean;
	/** Pure domain reduction of the command onto the aggregate. */
	reduce: (aggregate: TAggregate, command: TCommand) => TReduction;
	/**
	 * The `from … where …` tail of a select yielding exactly one row while the
	 * aggregate still sits at the sequence its reduction was computed from. The
	 * module writes the command receipt through this condition so a receipt can
	 * never outlive a lost compare-and-swap race.
	 */
	casGuard: (aggregate: TAggregate) => SQL;
	/**
	 * The single statement writing the reduction at `nextSequence`, guarded on the
	 * same compare-and-swap condition and ending in `.returning()` so the module
	 * can read back the committed aggregate — and detect a lost race from the
	 * absence of a row. The module composes this with the command receipt into one
	 * atomic batch; the feature never gets to write the projection on its own.
	 */
	projection: (input: SequencedLiveStateProjectionInput<TAggregate, TReduction>) => BatchItem<'sqlite'>;
	toResult: (aggregate: TAggregate, commandType: string) => TResult;
	/** Post-commit realtime notification. */
	publish?: (result: TResult, originConnectionId?: string) => Promise<void>;
}

/**
 * The whole interface a caller needs: load the aggregate, or execute a command
 * against it.
 */
export interface SequencedLiveState<TRef, TAggregate, TCommand, TResult> {
	load: (ref: TRef) => Promise<TAggregate | undefined>;
	execute: (ref: TRef, command: TCommand, options?: SequencedLiveStateExecuteOptions) => Promise<TResult>;
}

/**
 * Durable sequenced live state for one family of aggregates.
 *
 * Behind `load` and `execute` this owns the whole write protocol every
 * live-state feature needs: idempotent replay of an already-committed command
 * ID, rejection of a reused ID carrying different content, monotonic
 * authoritative sequencing, compare-and-swap protection against concurrent
 * writers, atomic reduction committed together with its compact command
 * receipt, one merge retry for commands the feature declares mergeable, and
 * post-commit publication. Domain reducers, admission rules, and merge policy
 * stay with the feature that supplied the port.
 */
export function createSequencedLiveState<TRef, TAggregate, TCommand extends SequencedCommand, TReduction, TResult>(
	port: SequencedLiveStatePort<TRef, TAggregate, TCommand, TReduction, TResult>,
): SequencedLiveState<TRef, TAggregate, TCommand, TResult> {
	function rejectMismatchedReplay(
		receipt: { commandType: string; contentKey: string },
		command: TCommand,
	): void {
		if (receipt.commandType === command.type
			&& receipt.contentKey === commandContentKey(command.type, command.payload)) {
			return;
		}
		throw createError({
			statusCode: 409,
			message: 'commandId has already been used for a different command',
		});
	}

	function notFound(): never {
		throw createError({ statusCode: 404, message: `${port.aggregateLabel} not found` });
	}

	/**
	 * The authoritative answer to an already-committed command: whatever the
	 * aggregate looks like now, not what it looked like when the command landed.
	 */
	async function currentSnapshot(ref: TRef, commandType: string): Promise<TResult | undefined> {
		const latest = await port.load(ref);
		return latest ? port.toResult(latest, commandType) : undefined;
	}

	/**
	 * Write the reduction and its receipt as one indivisible batch.
	 *
	 * Assembling the batch here rather than handing statements to the feature is
	 * what makes the atomicity an enforced invariant instead of a documented one:
	 * a receipt can never be committed without its projection, nor survive a lost
	 * compare-and-swap race.
	 */
	async function commitOnce(ref: TRef, aggregate: TAggregate, command: TCommand): Promise<TResult> {
		const nextSequence = port.sequenceOf(aggregate) + 1;
		const reduction = port.reduce(aggregate, command);
		const receipt: CommandReceipt = {
			commandId: command.commandId,
			commandType: command.type,
			contentKey: commandContentKey(command.type, command.payload),
			sequence: nextSequence,
		};

		try {
			const statements: BatchItem<'sqlite'>[] = [
				...commandReceiptStatements({
					aggregateKind: port.aggregateKind,
					aggregateId: port.aggregateIdOf(ref),
					eventId: port.eventIdOf(ref),
					receipt,
					guard: port.casGuard(aggregate),
				}),
				port.projection({ aggregate, reduction, nextSequence }),
			];
			const results = await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

			// The projection is the last statement; no returned row means the guard
			// did not hold and another writer won.
			const committed = (results.at(-1) as TAggregate[] | undefined)?.[0];
			if (!committed)
				throw new StateConflictError(port.aggregateLabel, port.aggregateIdOf(ref));

			return port.toResult(committed, command.type);
		}
		catch (error) {
			// A concurrent writer may have committed this very command ID between the
			// pre-flight receipt check and this write; the unique receipt index is
			// what turned that race into a failure here. Honour it as a replay.
			const raced = await findCommandReceipt(port.aggregateKind, port.aggregateIdOf(ref), command.commandId);
			if (raced) {
				rejectMismatchedReplay(raced, command);
				const replayed = await currentSnapshot(ref, raced.commandType);
				if (replayed)
					return replayed;
			}
			throw error;
		}
	}

	async function execute(
		ref: TRef,
		command: TCommand,
		options: SequencedLiveStateExecuteOptions = {},
	): Promise<TResult> {
		const receipt = await findCommandReceipt(port.aggregateKind, port.aggregateIdOf(ref), command.commandId);
		if (receipt) {
			rejectMismatchedReplay(receipt, command);
			const replayed = await currentSnapshot(ref, receipt.commandType);
			if (!replayed)
				notFound();
			return await announce(replayed, options);
		}

		const aggregate = await port.load(ref);
		if (!aggregate)
			notFound();

		port.admit(aggregate, command);

		let result: TResult;
		try {
			result = await commitOnce(ref, aggregate, command);
		}
		catch (error) {
			if (!port.isMergeable(command))
				throw error;

			// A mergeable command is one a writer who got in first does not
			// invalidate — a relative intent, or an absolute one scoped to its own
			// field. Re-reduce it onto the newer aggregate exactly once.
			const latest = await port.load(ref);
			if (!latest || port.sequenceOf(latest) === port.sequenceOf(aggregate))
				throw error;

			// Admission is asked again, against the state this attempt will actually
			// commit onto. Asking only once would enforce a state-dependent rule on the
			// first attempt alone, and a command could commit against a state its own
			// admission rejects — silently, because nothing else re-checks it.
			port.admit(latest, command);

			result = await commitOnce(ref, latest, command);
		}

		return await announce(result, options);
	}

	async function announce(result: TResult, options: SequencedLiveStateExecuteOptions): Promise<TResult> {
		if (options.publish && port.publish)
			await port.publish(result, options.originConnectionId);
		return result;
	}

	return {
		load: port.load,
		execute,
	};
}

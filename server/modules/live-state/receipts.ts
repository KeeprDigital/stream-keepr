import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DbLiveStateCommandReceipt } from '~~/server/db/schema';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { liveStateCommandReceipts } from '~~/server/db/schema';
import { selectForInsert } from '~~/server/utils/db';

/**
 * How many of an aggregate's most recent commands keep a receipt.
 *
 * Receipts exist to make a client's own retry safe, not to record history, so
 * retention only has to outlive a realistic retry window. Bounding it here is
 * what stops live-state write volume from accumulating without limit.
 */
export const RETAINED_COMMAND_RECEIPTS = 200;

/** A committed command's identity and canonical content. */
export interface CommandReceipt {
	commandId: string;
	commandType: string;
	contentKey: string;
	sequence: number;
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value)
			.toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'undefined';
}

/**
 * A command's content rendered as one canonical, comparable string: its type
 * plus its payload, object keys ordered by codepoint at every depth.
 *
 * This is the content itself, not a digest of it — deliberately. A hash would
 * be smaller, but a collision would silently accept a *different* command as a
 * retry of this one, corrupting live state. An exact canonical string cannot
 * collide. Key ordering is by codepoint rather than locale because the result is
 * persisted and compared across processes.
 *
 * Taken from the command as the caller stated it, before any server-side
 * normalization, so a retry of the identical command still matches even when
 * reduction would have stamped it with a fresh timestamp.
 */
export function commandContentKey(type: string, payload: unknown): string {
	return canonicalJson({ type, payload });
}

export async function findCommandReceipt(
	aggregateKind: string,
	aggregateId: number,
	commandId: string,
): Promise<DbLiveStateCommandReceipt | undefined> {
	return await db.query.liveStateCommandReceipts.findFirst({
		where: and(
			eq(liveStateCommandReceipts.aggregateKind, aggregateKind),
			eq(liveStateCommandReceipts.aggregateId, aggregateId),
			eq(liveStateCommandReceipts.commandId, commandId),
		),
	});
}

/**
 * Statements recording a receipt and pruning the aggregate's expired ones.
 *
 * `guard` is the owning feature's compare-and-swap condition, expressed as the
 * `from … where …` tail of a select that yields a row only while the aggregate
 * still sits at the sequence the reduction was computed against. Writing the
 * receipt through that guard is what keeps it from surviving a lost CAS race:
 * these statements are only ever meaningful inside the same atomic batch as the
 * projection update they accompany.
 */
export function commandReceiptStatements(input: {
	aggregateKind: string;
	aggregateId: number;
	eventId: number;
	receipt: CommandReceipt;
	guard: SQL;
}): BatchItem<'sqlite'>[] {
	const { aggregateKind, aggregateId, eventId, receipt, guard } = input;

	return [
		db.insert(liveStateCommandReceipts).select(selectForInsert(liveStateCommandReceipts, {
			id: sql`null`,
			eventId: sql`${eventId}`,
			aggregateKind: sql`${aggregateKind}`,
			aggregateId: sql`${aggregateId}`,
			commandId: sql`${receipt.commandId}`,
			commandType: sql`${receipt.commandType}`,
			contentKey: sql`${receipt.contentKey}`,
			sequence: sql`${receipt.sequence}`,
			createdAt: sql`${Date.now()}`,
		}, guard)),
		db.delete(liveStateCommandReceipts).where(and(
			eq(liveStateCommandReceipts.aggregateKind, aggregateKind),
			eq(liveStateCommandReceipts.aggregateId, aggregateId),
			lte(liveStateCommandReceipts.sequence, receipt.sequence - RETAINED_COMMAND_RECEIPTS),
		)),
	];
}

/**
 * Forget every receipt belonging to the given aggregates.
 *
 * Callers reach for this when an aggregate stops accepting commands: a receipt
 * only exists to make a retry safe, so once nothing can be retried there is
 * nothing left to protect. `aggregateIds` is either an explicit list or a select
 * yielding ids, letting the statement compose into a caller's atomic batch
 * without the caller touching the receipt table itself.
 */
export function forgetAggregateReceipts(input: {
	aggregateKind: string;
	aggregateIds: number[] | SQL;
}): BatchItem<'sqlite'> {
	const { aggregateKind, aggregateIds } = input;

	return db.delete(liveStateCommandReceipts).where(and(
		eq(liveStateCommandReceipts.aggregateKind, aggregateKind),
		Array.isArray(aggregateIds)
			? inArray(liveStateCommandReceipts.aggregateId, aggregateIds)
			: sql`${liveStateCommandReceipts.aggregateId} in (${aggregateIds})`,
	));
}

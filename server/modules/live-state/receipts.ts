import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DbLiveStateCommandReceipt } from '~~/server/db/schema';
import { and, eq, lte, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { liveStateCommandReceipts } from '~~/server/db/schema';

/**
 * How many of an aggregate's most recent commands keep a receipt.
 *
 * Receipts exist to make a client's own retry safe, not to record history, so
 * retention only has to outlive a realistic retry window. Bounding it here is
 * what stops live-state write volume from accumulating without limit.
 */
export const RETAINED_COMMAND_RECEIPTS = 200;

/** A committed command's identity and content digest. */
export interface CommandReceipt {
	commandId: string;
	commandType: string;
	fingerprint: string;
	sequence: number;
}

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

/**
 * Digest identifying a command's content independently of when it was sent.
 *
 * Fingerprints are taken from the command as the caller stated it, before any
 * server-side normalization, so a retry of the identical command always matches
 * even when reduction would have stamped it with a fresh timestamp.
 */
export function commandFingerprint(type: string, payload: unknown): string {
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
		db.insert(liveStateCommandReceipts).select(sql`
			select
				null,
				${eventId},
				${aggregateKind},
				${aggregateId},
				${receipt.commandId},
				${receipt.commandType},
				${receipt.fingerprint},
				${receipt.sequence},
				${Date.now()}
			${guard}
		`),
		db.delete(liveStateCommandReceipts).where(and(
			eq(liveStateCommandReceipts.aggregateKind, aggregateKind),
			eq(liveStateCommandReceipts.aggregateId, aggregateId),
			lte(liveStateCommandReceipts.sequence, receipt.sequence - RETAINED_COMMAND_RECEIPTS),
		)),
	];
}

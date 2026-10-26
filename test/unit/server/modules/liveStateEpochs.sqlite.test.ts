import type { SequencedLiveEpochPort, SequencedLiveStatePort } from '~~/server/modules/live-state';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * An epoch's Command Receipts exist to make a retry *within* that epoch safe.
 * Opening a successor must leave nothing from the old epoch that can answer a
 * command addressed to the new one, and the close, open and forgetting are one
 * commit. Run against real SQLite because that atomicity is in the SQL.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const { createSequencedLiveEpochs, createSequencedLiveState } = await import('~~/server/modules/live-state');

afterAll(async () => {
	await harness.close();
});

/** A stand-in live aggregate: one active counter per lane, ids never reused. */
const counters = sqliteTable('test_counters', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	lane: integer('lane').notNull(),
	status: text('status').notNull(),
	sequence: integer('sequence').notNull(),
	total: integer('total').notNull(),
});
type Counter = typeof counters.$inferSelect;

interface Lane {
	lane: number;
	/** Opens or closes nothing unless this holds. */
	onlyIf?: ReturnType<typeof sql>;
}

interface CounterCommand {
	commandId: string;
	type: 'Add';
	payload: { amount: number };
}

const EVENT_ID = 1;

beforeAll(async () => {
	await harness.client.execute(`insert into events (id, name, game, feature_match_orientation) values (${EVENT_ID}, 'Epochs', 'mtg', 'horizontal')`);
	await harness.client.execute(`create table test_counters (
		id integer primary key autoincrement, lane integer not null, status text not null,
		sequence integer not null, total integer not null
	)`);
	await harness.client.execute(`create unique index test_counters_active_lane on test_counters(lane) where status = 'active'`);
});

beforeEach(async () => {
	await harness.client.execute('delete from test_counters');
	await harness.client.execute('delete from live_state_command_receipts');
});

const announce = vi.fn(async () => {});

const epochPort: SequencedLiveEpochPort<Lane, number, Counter> = {
	aggregateKind: 'testCounter',
	idOf: counter => counter.id,
	findActive: async ({ lane }) => await db.select().from(counters).where(and(eq(counters.lane, lane), eq(counters.status, 'active'))),
	close: ({ lane, onlyIf }) => [
		db.update(counters).set({ status: 'closed' }).where(and(eq(counters.lane, lane), eq(counters.status, 'active'), onlyIf)),
	],
	closedIds: ({ lane }) => sql`select ${counters.id} from ${counters} where ${counters.lane} = ${lane} and ${counters.status} = 'closed'`,
	open: ({ lane, onlyIf }, total) => [
		db.insert(counters).select(sql`select null, ${lane}, 'active', 1, ${total} where ${onlyIf ?? sql`1`}`),
	],
	announce,
};

const epochs = createSequencedLiveEpochs(epochPort);

const commandPort: SequencedLiveStatePort<{ id: number }, Counter, CounterCommand, number, Counter> = {
	aggregateKind: 'testCounter',
	aggregateLabel: 'Counter',
	aggregateIdOf: ref => ref.id,
	eventIdOf: () => EVENT_ID,
	load: async ref => (await db.select().from(counters).where(eq(counters.id, ref.id)))[0],
	sequenceOf: counter => counter.sequence,
	admit: (counter) => {
		if (counter.status !== 'active')
			throw createError({ statusCode: 409, message: 'Counter is closed' });
	},
	isMergeable: () => true,
	reduce: (counter, command) => counter.total + command.payload.amount,
	casGuard: counter => sql`from ${counters} where ${counters.id} = ${counter.id} and ${counters.sequence} = ${counter.sequence}`,
	projection: ({ aggregate, reduction, nextSequence }) => db.update(counters)
		.set({ total: reduction, sequence: nextSequence })
		.where(and(eq(counters.id, aggregate.id), eq(counters.sequence, aggregate.sequence)))
		.returning(),
	toResult: counter => counter,
};

const liveState = createSequencedLiveState(commandPort);

function add(commandId: string, amount: number): CounterCommand {
	return {
		commandId,
		type: 'Add',
		payload: { amount },
	};
}

async function openFirst(lane: number, total = 0): Promise<Counter> {
	const { opened } = await epochs.commit(await epochs.open({ lane }, total), { announce: false });
	return opened[0]!;
}

async function receiptCount(aggregateId: number): Promise<number> {
	const { rows } = await harness.client.execute({
		sql: `select count(*) as count from live_state_command_receipts where aggregate_kind = 'testCounter' and aggregate_id = ?`,
		args: [aggregateId],
	});
	return Number(rows[0]!.count);
}

describe('sequenced live epochs', () => {
	it('answers a command reusing an old epoch\'s command id from the new epoch, not from the old receipt', async () => {
		const first = await openFirst(1);
		await liveState.execute({ id: first.id }, add('cmd-1', 5));

		const { opened, ended } = await epochs.commit(await epochs.replace({ lane: 1 }, 100), { announce: false });
		const second = opened[0]!;

		expect(ended.map(epoch => epoch.id)).toEqual([first.id]);
		expect(second.id).toBeGreaterThan(first.id);
		// Different content under the same id: a surviving receipt would refuse it as
		// a mismatched replay, or answer it with the old epoch's snapshot.
		const result = await liveState.execute({ id: second.id }, add('cmd-1', 7));
		expect(result).toMatchObject({ id: second.id, total: 107, sequence: 2 });
	});

	it('forgets the ended epoch\'s receipts in the same commit, so a retry to it is refused rather than replayed', async () => {
		const first = await openFirst(1);
		await liveState.execute({ id: first.id }, add('cmd-1', 5));
		expect(await receiptCount(first.id)).toBe(1);

		await epochs.commit(await epochs.replace({ lane: 1 }, 0), { announce: false });

		expect(await receiptCount(first.id)).toBe(0);
		await expect(liveState.execute({ id: first.id }, add('cmd-1', 5))).rejects.toMatchObject({ statusCode: 409 });
	});

	it('leaves another scope\'s epoch and its receipts alone', async () => {
		const other = await openFirst(2);
		await liveState.execute({ id: other.id }, add('cmd-1', 5));
		await openFirst(1);

		await epochs.commit(await epochs.replace({ lane: 1 }, 0), { announce: false });

		expect(await receiptCount(other.id)).toBe(1);
		expect((await epochPort.findActive({ lane: 2 }))[0]).toMatchObject({ id: other.id, total: 5 });
	});

	it('commits nothing of a transition whose batch fails', async () => {
		const first = await openFirst(1);
		await liveState.execute({ id: first.id }, add('cmd-1', 5));
		const transition = await epochs.replace({ lane: 1 }, 0);

		await expect(db.batch([
			...transition.statements,
			db.run(sql`select raise(abort, 'caller refused')`),
		] as unknown as Parameters<typeof db.batch>[0])).rejects.toThrow();

		expect(await receiptCount(first.id)).toBe(1);
		expect((await epochPort.findActive({ lane: 1 }))[0]?.id).toBe(first.id);
	});

	it('announces what the commit actually changed', async () => {
		const first = await openFirst(1);
		announce.mockClear();

		const change = await epochs.commit(await epochs.replace({ lane: 1 }, 0), { originConnectionId: 'origin' });

		expect(announce).toHaveBeenCalledTimes(1);
		expect(announce).toHaveBeenCalledWith(
			{
				ended: [
					expect.objectContaining({ id: first.id }),
				],
				opened: change.opened,
			},
			{ originConnectionId: 'origin' },
		);
	});

	it('announces nothing when a conditional transition changed nothing', async () => {
		const first = await openFirst(1);
		announce.mockClear();

		const change = await epochs.commit(await epochs.replace({ lane: 1, onlyIf: sql`0` }, 0));

		expect(change).toEqual({ ended: [], opened: [] });
		expect(announce).not.toHaveBeenCalled();
		expect((await epochPort.findActive({ lane: 1 }))[0]?.id).toBe(first.id);
	});

	it('announces nothing when the caller opts out', async () => {
		await openFirst(1);
		announce.mockClear();

		await epochs.commit(await epochs.close({ lane: 1 }), { announce: false });

		expect(announce).not.toHaveBeenCalled();
		expect(await epochPort.findActive({ lane: 1 })).toEqual([]);
	});
});

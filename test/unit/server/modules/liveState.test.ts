import type { SequencedLiveStatePort } from '~~/server/modules/live-state';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

vi.mock('hub:db', () => ({ db: mockDb }));

vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message) as any;
	err.statusCode = opts.statusCode;
	err.data = opts.data;
	return err;
});

const { commandFingerprint, createSequencedLiveState, RETAINED_COMMAND_RECEIPTS } = await import('~~/server/modules/live-state');

/**
 * A stand-in aggregate carrying the only two facts the module insists on: an
 * identity and a sequence.
 */
interface Counter {
	id: number;
	sequence: number;
	total: number;
}

interface CounterRef {
	id: number;
	eventId: number;
}

interface CounterCommand {
	commandId: string;
	type: 'Add' | 'Set';
	payload: { amount: number };
}

function counter(overrides: Partial<Counter> = {}): Counter {
	return { id: 7, sequence: 3, total: 10, ...overrides };
}

const REF: CounterRef = { id: 7, eventId: 1 };

function createPort(
	overrides: Partial<SequencedLiveStatePort<CounterRef, Counter, CounterCommand, Counter, Counter>> = {},
): SequencedLiveStatePort<CounterRef, Counter, CounterCommand, Counter, Counter> {
	return {
		aggregateKind: 'counter',
		aggregateLabel: 'Counter',
		aggregateIdOf: ref => ref.id,
		eventIdOf: ref => ref.eventId,
		load: vi.fn(async () => counter()),
		sequenceOf: aggregate => aggregate.sequence,
		admit: vi.fn(),
		// `Add` is relative, so it survives a writer that got in first; `Set` claims
		// the state it saw.
		isMergeable: command => command.type === 'Add',
		reduce: (aggregate, command) => ({
			...aggregate,
			total: command.type === 'Add' ? aggregate.total + command.payload.amount : command.payload.amount,
		}),
		casGuard: aggregate => sql`from counters where id = ${aggregate.id} and sequence = ${aggregate.sequence}`,
		commit: vi.fn(async ({ reduction, nextSequence }) => ({ ...reduction, sequence: nextSequence })),
		toResult: aggregate => aggregate,
		publish: vi.fn(async () => {}),
		...overrides,
	};
}

function add(commandId: string, amount: number): CounterCommand {
	return { commandId, type: 'Add', payload: { amount } };
}

function set(commandId: string, amount: number): CounterCommand {
	return { commandId, type: 'Set', payload: { amount } };
}

describe('sequenced live state', () => {
	beforeEach(() => {
		resetDbMocks();
		vi.clearAllMocks();
	});

	it('commits a command at the next authoritative sequence', async () => {
		const liveState = createSequencedLiveState(createPort());

		const result = await liveState.execute(REF, add('cmd-1', 5));

		expect(result).toMatchObject({ sequence: 4, total: 15 });
	});

	it('writes the command receipt inside the same atomic commit as the projection', async () => {
		const port = createPort();
		const liveState = createSequencedLiveState(port);

		await liveState.execute(REF, set('cmd-1', 42));

		const [input] = vi.mocked(port.commit).mock.calls[0]!;
		expect(input.nextSequence).toBe(4);
		expect(input.receiptStatements.length).toBeGreaterThan(0);
		// Nothing about the receipt is written outside the feature's own commit.
		expect(mockDb.batch).not.toHaveBeenCalled();
	});

	it('keeps receipt retention bounded by pruning alongside every commit', async () => {
		expect(RETAINED_COMMAND_RECEIPTS).toBeGreaterThan(0);
		expect(Number.isFinite(RETAINED_COMMAND_RECEIPTS)).toBe(true);

		const port = createPort({ load: vi.fn(async () => counter({ sequence: RETAINED_COMMAND_RECEIPTS + 10 })) });
		const liveState = createSequencedLiveState(port);

		await liveState.execute(REF, set('cmd-1', 1));

		const [input] = vi.mocked(port.commit).mock.calls[0]!;
		expect(input.receiptStatements).toHaveLength(2);
		expect(mockDb.delete).toHaveBeenCalledOnce();
	});

	it('rejects an inadmissible command before anything is written', async () => {
		const port = createPort({
			admit: vi.fn(() => {
				throw createError({ statusCode: 409, message: 'Counter is closed' });
			}),
		});
		const liveState = createSequencedLiveState(port);

		await expect(liveState.execute(REF, set('cmd-1', 1))).rejects.toMatchObject({
			statusCode: 409,
			message: 'Counter is closed',
		});
		expect(port.commit).not.toHaveBeenCalled();
	});

	it('reports a missing aggregate as not found', async () => {
		const port = createPort({ load: vi.fn(async () => undefined) });
		const liveState = createSequencedLiveState(port);

		await expect(liveState.execute(REF, set('cmd-1', 1))).rejects.toMatchObject({
			statusCode: 404,
			message: 'Counter not found',
		});
	});

	it('loads the aggregate through the same seam commands are executed at', async () => {
		const port = createPort();
		const liveState = createSequencedLiveState(port);

		await expect(liveState.load(REF)).resolves.toMatchObject({ id: 7, sequence: 3 });
		expect(port.load).toHaveBeenCalledWith(REF);
	});

	describe('command receipts', () => {
		it('answers a retry of the same command with the current authoritative snapshot', async () => {
			mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
				commandType: 'Add',
				fingerprint: commandFingerprint('Add', { amount: 5 }),
			});
			// The aggregate has moved on since the command committed.
			const port = createPort({ load: vi.fn(async () => counter({ sequence: 9, total: 40 })) });
			const liveState = createSequencedLiveState(port);

			const result = await liveState.execute(REF, add('cmd-1', 5));

			expect(result).toMatchObject({ sequence: 9, total: 40 });
			expect(port.commit).not.toHaveBeenCalled();
		});

		it('rejects a command ID reused with different content', async () => {
			mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
				commandType: 'Set',
				fingerprint: commandFingerprint('Set', { amount: 42 }),
			});
			const port = createPort();
			const liveState = createSequencedLiveState(port);

			await expect(liveState.execute(REF, set('cmd-1', 43))).rejects.toMatchObject({
				statusCode: 409,
				message: 'commandId has already been used for a different command',
			});
			expect(port.commit).not.toHaveBeenCalled();
		});

		it('rejects a command ID reused for a different command type', async () => {
			mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
				commandType: 'Add',
				fingerprint: commandFingerprint('Add', { amount: 5 }),
			});
			const liveState = createSequencedLiveState(createPort());

			await expect(liveState.execute(REF, set('cmd-1', 5))).rejects.toMatchObject({
				statusCode: 409,
				message: 'commandId has already been used for a different command',
			});
		});

		it('reports a retry against a vanished aggregate as not found', async () => {
			mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
				commandType: 'Add',
				fingerprint: commandFingerprint('Add', { amount: 5 }),
			});
			const port = createPort({ load: vi.fn(async () => undefined) });
			const liveState = createSequencedLiveState(port);

			await expect(liveState.execute(REF, add('cmd-1', 5))).rejects.toMatchObject({ statusCode: 404 });
		});

		it('resolves a command ID that lands concurrently as a retry rather than an error', async () => {
			const port = createPort({
				commit: vi.fn(async () => {
					// The receipt's unique index is what turns the race into a failure.
					mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
						commandType: 'Set',
						fingerprint: commandFingerprint('Set', { amount: 42 }),
					});
					throw new Error('UNIQUE constraint failed');
				}),
				load: vi.fn(async () => counter({ sequence: 4, total: 42 })),
			});
			const liveState = createSequencedLiveState(port);

			const result = await liveState.execute(REF, set('cmd-1', 42));

			expect(result).toMatchObject({ sequence: 4, total: 42 });
		});
	});

	describe('compare-and-swap conflicts', () => {
		it('rejects an absolute command that lost the race', async () => {
			const port = createPort({ commit: vi.fn(async () => undefined) });
			const liveState = createSequencedLiveState(port);

			await expect(liveState.execute(REF, set('cmd-1', 1))).rejects.toMatchObject({
				statusCode: 409,
				message: 'Counter 7 state was modified concurrently',
			});
			expect(port.commit).toHaveBeenCalledOnce();
		});

		it('re-reduces a mergeable command onto the aggregate that won', async () => {
			const load = vi.fn()
				.mockResolvedValueOnce(counter({ sequence: 3, total: 10 }))
				.mockResolvedValueOnce(counter({ sequence: 4, total: 100 }));
			const commit = vi.fn()
				.mockResolvedValueOnce(undefined)
				.mockImplementationOnce(async ({ reduction, nextSequence }: any) => ({ ...reduction, sequence: nextSequence }));
			const liveState = createSequencedLiveState(createPort({ load, commit }));

			const result = await liveState.execute(REF, add('cmd-1', 5));

			// The relative intent is preserved: +5 onto the newer total, not the older.
			expect(result).toMatchObject({ sequence: 5, total: 105 });
			expect(commit).toHaveBeenCalledTimes(2);
		});

		it('retries a mergeable command only once', async () => {
			const load = vi.fn()
				.mockResolvedValueOnce(counter({ sequence: 3 }))
				.mockResolvedValueOnce(counter({ sequence: 4 }));
			const commit = vi.fn(async () => undefined);
			const liveState = createSequencedLiveState(createPort({ load, commit }));

			await expect(liveState.execute(REF, add('cmd-1', 5))).rejects.toMatchObject({ statusCode: 409 });
			expect(commit).toHaveBeenCalledTimes(2);
		});

		it('reports the conflict when a mergeable command finds the aggregate unchanged', async () => {
			const commit = vi.fn(async () => undefined);
			const liveState = createSequencedLiveState(createPort({ commit }));

			await expect(liveState.execute(REF, add('cmd-1', 5))).rejects.toMatchObject({ statusCode: 409 });
			expect(commit).toHaveBeenCalledOnce();
		});
	});

	describe('post-commit publication', () => {
		it('announces the result when the caller asks for it', async () => {
			const port = createPort();
			const liveState = createSequencedLiveState(port);

			await liveState.execute(REF, set('cmd-1', 1), { publish: true, originConnectionId: 'origin-1' });

			expect(port.publish).toHaveBeenCalledWith(expect.objectContaining({ sequence: 4 }), 'origin-1');
		});

		it('stays silent for writes that accompany their own notification', async () => {
			const port = createPort();
			const liveState = createSequencedLiveState(port);

			await liveState.execute(REF, set('cmd-1', 1));

			expect(port.publish).not.toHaveBeenCalled();
		});

		it('does not announce a command it refused to commit', async () => {
			const port = createPort({ commit: vi.fn(async () => undefined) });
			const liveState = createSequencedLiveState(port);

			await expect(liveState.execute(REF, set('cmd-1', 1), { publish: true })).rejects.toMatchObject({ statusCode: 409 });
			expect(port.publish).not.toHaveBeenCalled();
		});
	});

	describe('command fingerprints', () => {
		it('ignores key order so a re-serialized retry still matches', () => {
			expect(commandFingerprint('Set', { a: 1, b: 2 })).toBe(commandFingerprint('Set', { b: 2, a: 1 }));
		});

		it('separates commands that differ only by type', () => {
			expect(commandFingerprint('Set', { amount: 1 })).not.toBe(commandFingerprint('Add', { amount: 1 }));
		});

		it('separates commands that differ only by value', () => {
			expect(commandFingerprint('Set', { amount: 1 })).not.toBe(commandFingerprint('Set', { amount: 2 }));
		});
	});
});

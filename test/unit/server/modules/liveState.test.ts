import type { BatchItem } from 'drizzle-orm/batch';
import type { SequencedLiveStatePort } from '~~/server/modules/live-state';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { lastCallTo } from '~~/test/helpers/lastCallTo';

vi.mock('hub:db', () => ({ db: mockDb }));

vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message) as any;
	err.statusCode = opts.statusCode;
	err.data = opts.data;
	return err;
});

const { commandContentKey, createSequencedLiveState } = await import('~~/server/modules/live-state');
// Retention is the module's own tuning, not part of the interface it presents.
const { RETAINED_COMMAND_RECEIPTS } = await import('~~/server/modules/live-state/receipts');

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

type CounterPort = SequencedLiveStatePort<CounterRef, Counter, CounterCommand, Counter, Counter>;

function counter(overrides: Partial<Counter> = {}): Counter {
	return { id: 7, sequence: 3, total: 10, ...overrides };
}

const REF: CounterRef = { id: 7, eventId: 1 };

/** Stands in for the feature's projection write. */
const PROJECTION = { projection: true } as unknown as BatchItem<'sqlite'>;

function createPort(overrides: Partial<CounterPort> = {}): CounterPort {
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
		projection: vi.fn(() => PROJECTION),
		toResult: aggregate => aggregate,
		publish: vi.fn(async () => {}),
		...overrides,
	};
}

/**
 * Make the batch behave like a store that honours the compare-and-swap: it
 * persists exactly what the projection was asked to write, so assertions about
 * the committed result are assertions about the port's reduction rather than
 * about a value the test invented.
 */
function stageSuccessfulCommit(port: CounterPort): void {
	mockDb.batch.mockImplementation(async () => {
		// Unselected because the projection mock has exactly one caller — the module
		// under test. What it buys is the named error: read inside a callback, an
		// empty call list used to surface as a TypeError with no subject in it (#280).
		const [input] = lastCallTo(vi.mocked(port.projection));
		return [[], [], [{ ...input.reduction, sequence: input.nextSequence }]];
	});
}

/** The guard did not hold: the projection returns no row. */
function stageLostRace(): void {
	mockDb.batch.mockResolvedValue([[], [], []]);
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
		const port = createPort();
		stageSuccessfulCommit(port);
		const liveState = createSequencedLiveState(port);

		const result = await liveState.execute(REF, add('cmd-1', 5));

		expect(result).toMatchObject({ sequence: 4, total: 15 });
	});

	it('writes the command receipt and the projection as one indivisible batch', async () => {
		const port = createPort();
		stageSuccessfulCommit(port);
		const liveState = createSequencedLiveState(port);

		await liveState.execute(REF, set('cmd-1', 42));

		// One batch, receipt statements ahead of the projection — the feature never
		// gets an opportunity to commit one without the other.
		expect(mockDb.batch).toHaveBeenCalledOnce();
		const statements = mockDb.batch.mock.calls[0]![0] as unknown[];
		expect(statements.length).toBeGreaterThan(1);
		expect(statements.at(-1)).toBe(PROJECTION);
		expect(statements.slice(0, -1)).not.toContain(PROJECTION);
	});

	it('keeps receipt retention bounded by pruning alongside every commit', async () => {
		expect(RETAINED_COMMAND_RECEIPTS).toBeGreaterThan(0);
		expect(Number.isFinite(RETAINED_COMMAND_RECEIPTS)).toBe(true);

		const port = createPort({ load: vi.fn(async () => counter({ sequence: RETAINED_COMMAND_RECEIPTS + 10 })) });
		stageSuccessfulCommit(port);
		const liveState = createSequencedLiveState(port);

		await liveState.execute(REF, set('cmd-1', 1));

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
		expect(mockDb.batch).not.toHaveBeenCalled();
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
				contentKey: commandContentKey('Add', { amount: 5 }),
			});
			// The aggregate has moved on since the command committed.
			const port = createPort({ load: vi.fn(async () => counter({ sequence: 9, total: 40 })) });
			const liveState = createSequencedLiveState(port);

			const result = await liveState.execute(REF, add('cmd-1', 5));

			expect(result).toMatchObject({ sequence: 9, total: 40 });
			expect(mockDb.batch).not.toHaveBeenCalled();
		});

		it('rejects a command ID reused with different content', async () => {
			mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
				commandType: 'Set',
				contentKey: commandContentKey('Set', { amount: 42 }),
			});
			const liveState = createSequencedLiveState(createPort());

			await expect(liveState.execute(REF, set('cmd-1', 43))).rejects.toMatchObject({
				statusCode: 409,
				message: 'commandId has already been used for a different command',
			});
			expect(mockDb.batch).not.toHaveBeenCalled();
		});

		it('rejects a command ID reused for a different command type', async () => {
			mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
				commandType: 'Add',
				contentKey: commandContentKey('Add', { amount: 5 }),
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
				contentKey: commandContentKey('Add', { amount: 5 }),
			});
			const port = createPort({ load: vi.fn(async () => undefined) });
			const liveState = createSequencedLiveState(port);

			await expect(liveState.execute(REF, add('cmd-1', 5))).rejects.toMatchObject({ statusCode: 404 });
		});

		it('resolves a command ID that lands concurrently as a retry rather than an error', async () => {
			const port = createPort({ load: vi.fn(async () => counter({ sequence: 4, total: 42 })) });
			mockDb.batch.mockImplementation(async () => {
				// The receipt's unique index is what turns the race into a failure.
				mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
					commandType: 'Set',
					contentKey: commandContentKey('Set', { amount: 42 }),
				});
				throw new Error('UNIQUE constraint failed');
			});
			const liveState = createSequencedLiveState(port);

			const result = await liveState.execute(REF, set('cmd-1', 42));

			expect(result).toMatchObject({ sequence: 4, total: 42 });
		});
	});

	describe('compare-and-swap conflicts', () => {
		it('rejects an absolute command that lost the race', async () => {
			stageLostRace();
			const liveState = createSequencedLiveState(createPort());

			await expect(liveState.execute(REF, set('cmd-1', 1))).rejects.toMatchObject({
				statusCode: 409,
				message: 'Counter 7 state was modified concurrently',
			});
			expect(mockDb.batch).toHaveBeenCalledOnce();
		});

		it('re-reduces a mergeable command onto the aggregate that won', async () => {
			const port = createPort({
				load: vi.fn()
					.mockResolvedValueOnce(counter({ sequence: 3, total: 10 }))
					.mockResolvedValueOnce(counter({ sequence: 4, total: 100 })),
			});
			stageSuccessfulCommit(port);
			mockDb.batch.mockResolvedValueOnce([[], [], []]);
			const liveState = createSequencedLiveState(port);

			const result = await liveState.execute(REF, add('cmd-1', 5));

			// The relative intent is preserved: +5 onto the newer total, not the older.
			expect(result).toMatchObject({ sequence: 5, total: 105 });
			expect(mockDb.batch).toHaveBeenCalledTimes(2);
		});

		it('retries a mergeable command only once', async () => {
			const port = createPort({
				load: vi.fn()
					.mockResolvedValueOnce(counter({ sequence: 3 }))
					.mockResolvedValueOnce(counter({ sequence: 4 })),
			});
			stageLostRace();
			const liveState = createSequencedLiveState(port);

			await expect(liveState.execute(REF, add('cmd-1', 5))).rejects.toMatchObject({ statusCode: 409 });
			expect(mockDb.batch).toHaveBeenCalledTimes(2);
		});

		it('reports the conflict when a mergeable command finds the aggregate unchanged', async () => {
			stageLostRace();
			const liveState = createSequencedLiveState(createPort());

			await expect(liveState.execute(REF, add('cmd-1', 5))).rejects.toMatchObject({ statusCode: 409 });
			expect(mockDb.batch).toHaveBeenCalledOnce();
		});

		it('re-runs admission against the newer aggregate before the merge retry', async () => {
			const port = createPort({
				load: vi.fn()
					.mockResolvedValueOnce(counter({ sequence: 3, total: 10 }))
					.mockResolvedValueOnce(counter({ sequence: 4, total: 100 })),
			});
			stageSuccessfulCommit(port);
			mockDb.batch.mockResolvedValueOnce([[], [], []]);
			const liveState = createSequencedLiveState(port);

			await liveState.execute(REF, add('cmd-1', 5));

			// Admission decides against the state the command is about to be reduced
			// onto, so the retry is judged against the aggregate that won.
			expect(port.admit).toHaveBeenCalledTimes(2);
			expect(vi.mocked(port.admit).mock.calls[1]![0]).toMatchObject({ sequence: 4, total: 100 });
		});

		it('rejects a merge retry the newer aggregate no longer admits', async () => {
			const port = createPort({
				load: vi.fn()
					.mockResolvedValueOnce(counter({ sequence: 3, total: 10 }))
					.mockResolvedValueOnce(counter({ sequence: 4, total: 100 })),
				// A state-dependent admission rule the compare-and-swap guard cannot
				// express: the counter closes once it reaches its cap. Enforcing it only
				// on the first attempt would let the retry commit onto a state its own
				// admission rejects.
				admit: vi.fn((aggregate) => {
					if (aggregate.total >= 100)
						throw createError({ statusCode: 409, message: 'Counter is closed' });
				}),
			});
			stageLostRace();
			const liveState = createSequencedLiveState(port);

			await expect(liveState.execute(REF, add('cmd-1', 5))).rejects.toMatchObject({
				statusCode: 409,
				message: 'Counter is closed',
			});
			// The retry never reached the store.
			expect(mockDb.batch).toHaveBeenCalledOnce();
		});
	});

	describe('post-commit publication', () => {
		it('announces the result when the caller asks for it', async () => {
			const port = createPort();
			stageSuccessfulCommit(port);
			const liveState = createSequencedLiveState(port);

			await liveState.execute(REF, set('cmd-1', 1), { publish: true, originConnectionId: 'origin-1' });

			expect(port.publish).toHaveBeenCalledWith(
				expect.objectContaining({ sequence: 4 }),
				expect.objectContaining({ originConnectionId: 'origin-1' }),
			);
		});

		it('tells the notification which aggregate the command was reduced onto', async () => {
			// A notification that announces the difference a command made needs the state
			// it was measured from, and only this module knows which one that was.
			const port = createPort();
			stageSuccessfulCommit(port);
			const liveState = createSequencedLiveState(port);

			await liveState.execute(REF, set('cmd-1', 1), { publish: true });

			expect(port.publish).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ previous: counter({ sequence: 3, total: 10 }) }),
			);
		});

		it('names the aggregate a merge retry re-reduced onto, not the one that lost', async () => {
			// The first attempt's aggregate is not the state the committed reduction was
			// computed from, so a difference measured against it would leave every peer
			// holding a state the store does not have.
			const port = createPort({
				load: vi.fn()
					.mockResolvedValueOnce(counter({ sequence: 3, total: 10 }))
					.mockResolvedValueOnce(counter({ sequence: 4, total: 100 })),
			});
			mockDb.batch
				.mockResolvedValueOnce([[], [], []])
				.mockImplementation(async () => {
					const [input] = lastCallTo(vi.mocked(port.projection));
					return [[], [], [{ ...input.reduction, sequence: input.nextSequence }]];
				});
			const liveState = createSequencedLiveState(port);

			await liveState.execute(REF, add('cmd-1', 5), { publish: true });

			expect(port.publish).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ previous: counter({ sequence: 4, total: 100 }) }),
			);
		});

		it('names no aggregate when a concurrent writer turned the command into a replay', async () => {
			// The unique receipt index turned the race into a failure, and the answer is
			// whatever the aggregate looks like now — which may be several commands past
			// the one this attempt loaded. A difference measured from that stale load
			// would omit an entry changed and changed back in between, and a peer sitting
			// between the two would apply it and keep the value the store no longer has.
			const port = createPort({ load: vi.fn(async () => counter({ sequence: 9, total: 42 })) });
			mockDb.batch.mockImplementation(async () => {
				mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
					commandType: 'Set',
					contentKey: commandContentKey('Set', { amount: 42 }),
				});
				throw new Error('UNIQUE constraint failed');
			});
			const liveState = createSequencedLiveState(port);

			await liveState.execute(REF, set('cmd-1', 42), { publish: true });

			expect(port.publish).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ previous: undefined }),
			);
		});

		it('names no aggregate at all when it is answering a recognised replay', async () => {
			// The snapshot answering a replay may be many commands newer than the command
			// being replayed, so nothing here is the state it was reduced onto.
			mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
				commandType: 'Add',
				contentKey: commandContentKey('Add', { amount: 5 }),
			});
			const port = createPort();
			const liveState = createSequencedLiveState(port);

			await liveState.execute(REF, add('cmd-1', 5), { publish: true });

			expect(port.publish).toHaveBeenCalledWith(expect.anything(), { previous: undefined, originConnectionId: undefined });
		});

		it('stays silent for writes that accompany their own notification', async () => {
			const port = createPort();
			stageSuccessfulCommit(port);
			const liveState = createSequencedLiveState(port);

			await liveState.execute(REF, set('cmd-1', 1));

			expect(port.publish).not.toHaveBeenCalled();
		});

		it('does not announce a command it refused to commit', async () => {
			const port = createPort();
			stageLostRace();
			const liveState = createSequencedLiveState(port);

			await expect(liveState.execute(REF, set('cmd-1', 1), { publish: true })).rejects.toMatchObject({ statusCode: 409 });
			expect(port.publish).not.toHaveBeenCalled();
		});
	});

	describe('command content keys', () => {
		it('ignores key order so a re-serialized retry still matches', () => {
			expect(commandContentKey('Set', { a: 1, b: 2 })).toBe(commandContentKey('Set', { b: 2, a: 1 }));
		});

		it('orders keys by codepoint so the key never depends on the runtime locale', () => {
			// A locale-aware comparator sorts these the other way round. The key is
			// persisted and compared across processes, so the ordering must be fixed.
			expect(commandContentKey('Set', { a: 1, B: 2 })).toBe('{"payload":{"B":2,"a":1},"type":"Set"}');
		});

		it('separates commands that differ only by type', () => {
			expect(commandContentKey('Set', { amount: 1 })).not.toBe(commandContentKey('Add', { amount: 1 }));
		});

		it('separates commands that differ only by value', () => {
			expect(commandContentKey('Set', { amount: 1 })).not.toBe(commandContentKey('Set', { amount: 2 }));
		});
	});
});

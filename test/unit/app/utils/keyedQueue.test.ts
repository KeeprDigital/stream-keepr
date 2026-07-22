import { describe, expect, it } from 'vitest';
import { createKeyedQueue } from '~~/app/utils/keyedQueue';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('createKeyedQueue', () => {
	it('runs actions for the same key in FIFO order', async () => {
		const queue = createKeyedQueue();
		const first = deferred<string>();
		const order: string[] = [];

		const p1 = queue.enqueue('k', async () => {
			order.push('start-1');
			return await first.promise;
		});
		const p2 = queue.enqueue('k', async () => {
			order.push('start-2');
			return 'two';
		});

		expect(order).toEqual(['start-1']);
		first.resolve('one');
		await expect(p1).resolves.toBe('one');
		await expect(p2).resolves.toBe('two');
		expect(order).toEqual(['start-1', 'start-2']);
	});

	it('runs different keys concurrently', async () => {
		const queue = createKeyedQueue();
		const blockA = deferred<string>();
		const order: string[] = [];

		void queue.enqueue('a', async () => {
			order.push('a');
			return await blockA.promise;
		});
		await queue.enqueue('b', async () => {
			order.push('b');
			return 'b';
		});

		expect(order).toEqual(['a', 'b']);
		blockA.resolve('a');
	});

	it('a failed action rejects only its own promise; the chain continues', async () => {
		const queue = createKeyedQueue();
		const failure = new Error('boom');

		const p1 = queue.enqueue('k', () => Promise.reject(failure));
		const p2 = queue.enqueue('k', async () => 'after-failure');

		await expect(p1).rejects.toBe(failure);
		await expect(p2).resolves.toBe('after-failure');
	});

	it('prunes settled chains so a later enqueue starts fresh', async () => {
		const queue = createKeyedQueue();

		await queue.enqueue('k', async () => 'one');
		const result = await queue.enqueue('k', async () => 'two');

		expect(result).toBe('two');
	});
});

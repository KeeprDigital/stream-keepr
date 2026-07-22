import { describe, expect, it } from 'vitest';
import { createGuardedSequence, createKeyedGuardedSequence, unguarded } from '~~/app/utils/guardedSequence';

describe('createGuardedSequence', () => {
	it('begins a current flight', () => {
		const seq = createGuardedSequence();

		const flight = seq.begin();

		expect(flight.stale).toBe(false);
		expect(flight.current).toBe(true);
	});

	it('begin supersedes the prior flight synchronously', () => {
		const seq = createGuardedSequence();
		const first = seq.begin();

		const second = seq.begin();

		expect(first.stale).toBe(true);
		expect(second.stale).toBe(false);
	});

	it('staleness is monotonic — a superseded flight never becomes current again', () => {
		const seq = createGuardedSequence();
		const first = seq.begin();
		seq.begin();
		seq.supersede();

		expect(first.stale).toBe(true);
		seq.begin();
		expect(first.stale).toBe(true);
	});

	it('supersede stales the current flight without starting a new one', () => {
		const seq = createGuardedSequence();
		const flight = seq.begin();

		seq.supersede();

		expect(flight.stale).toBe(true);
	});

	it('supersede is idempotent', () => {
		const seq = createGuardedSequence();
		const flight = seq.begin();

		seq.supersede();
		seq.supersede();

		expect(flight.stale).toBe(true);
	});

	it('a flight can be checked repeatedly across await points', async () => {
		const seq = createGuardedSequence();
		const flight = seq.begin();

		await Promise.resolve();
		expect(flight.stale).toBe(false);
		await Promise.resolve();
		expect(flight.stale).toBe(false);
		seq.begin();
		await Promise.resolve();
		expect(flight.stale).toBe(true);
	});
});

describe('createKeyedGuardedSequence', () => {
	it('supersession is isolated per key', () => {
		const seq = createKeyedGuardedSequence();
		const a1 = seq.begin('a');
		const b1 = seq.begin('b');

		const a2 = seq.begin('a');

		expect(a1.stale).toBe(true);
		expect(a2.stale).toBe(false);
		expect(b1.stale).toBe(false);
	});

	it('supersede(key) stales only that key', () => {
		const seq = createKeyedGuardedSequence();
		const a = seq.begin('a');
		const b = seq.begin('b');

		seq.supersede('a');

		expect(a.stale).toBe(true);
		expect(b.stale).toBe(false);
	});

	it('supersede on an unknown key is a no-op', () => {
		const seq = createKeyedGuardedSequence();
		const a = seq.begin('a');

		seq.supersede('never-begun');

		expect(a.stale).toBe(false);
	});

	it('supersedeAll stales every in-flight key', () => {
		const seq = createKeyedGuardedSequence();
		const a = seq.begin('a');
		const b = seq.begin('b');

		seq.supersedeAll();

		expect(a.stale).toBe(true);
		expect(b.stale).toBe(true);
	});

	it('a key superseded then re-begun issues a fresh current flight', () => {
		const seq = createKeyedGuardedSequence();
		const first = seq.begin('a');
		seq.supersede('a');

		const second = seq.begin('a');

		expect(first.stale).toBe(true);
		expect(second.stale).toBe(false);
	});

	it('supports non-string keys', () => {
		const seq = createKeyedGuardedSequence<symbol>();
		const key = Symbol('k');
		const first = seq.begin(key);

		const second = seq.begin(key);

		expect(first.stale).toBe(true);
		expect(second.stale).toBe(false);
	});
});

describe('unguarded', () => {
	it('is never stale', () => {
		expect(unguarded.stale).toBe(false);
		expect(unguarded.current).toBe(true);
	});
});

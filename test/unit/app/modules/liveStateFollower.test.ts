import type { LiveStateNotification } from '~~/app/modules/live-state/follower';
import { describe, expect, it } from 'vitest';
import { createLiveStateFollower } from '~~/app/modules/live-state/follower';

/**
 * The client half of Sequenced Live State, driven with no store and no transport:
 * a plain Map stands in for whatever the feature keeps, and a difference is a
 * list of words appended to the held state.
 */

interface Snapshot {
	key: string;
	id: number;
	sequence: number;
	words: string[];
	faulted?: boolean;
}

interface Notification extends LiveStateNotification {
	added?: string[];
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return { key: 'screen', id: 1, sequence: 1, words: [], ...overrides };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function harness() {
	const held = new Map<string, Snapshot>();
	const follower = createLiveStateFollower<string, Snapshot, Notification>({
		keyOf: state => state.key,
		held: key => held.get(key),
		applyState: state => held.set(state.key, state),
		withDifference: (state, notification) => notification.added
			? { ...state, sequence: notification.sequence, words: [...state.words, ...notification.added] }
			: undefined,
		forget: key => held.delete(key),
		acceptsDifferences: state => !state.faulted,
	});
	return { held, follower };
}

type Follower = ReturnType<typeof harness>['follower'];

describe('a notification', () => {
	it('continuing the held sequence applies its difference', () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 3, words: ['a'] }));

		const outcome = follower.notify('screen', { sessionId: 1, sequence: 4, added: ['b'] });

		expect(outcome).toBe('applied');
		expect(held.get('screen')).toMatchObject({ sequence: 4, words: ['a', 'b'] });
	});

	it('at the held sequence is a duplicate and is dropped', () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 3, words: ['a'] }));

		const outcome = follower.notify('screen', { sessionId: 1, sequence: 3, added: ['a'] });

		expect(outcome).toBe('ignored');
		expect(held.get('screen')).toMatchObject({ sequence: 3, words: ['a'] });
	});

	it('older than the held sequence is refused', () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 3, words: ['a'] }));

		const outcome = follower.notify('screen', { sessionId: 1, sequence: 2, added: ['stale'] });

		expect(outcome).toBe('ignored');
		expect(held.get('screen')).toMatchObject({ sequence: 3, words: ['a'] });
	});

	it('past the next sequence is a gap, answered by reloading', () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 3, words: ['a'] }));

		const outcome = follower.notify('screen', { sessionId: 1, sequence: 5, added: ['c'] });

		expect(outcome).toBe('reload');
		expect(held.get('screen')).toMatchObject({ sequence: 3, words: ['a'] });
	});

	it('that offers no difference is answered by reloading', () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 3, words: ['a'] }));

		const outcome = follower.notify('screen', { sessionId: 1, sequence: 4 });

		expect(outcome).toBe('reload');
		expect(held.get('screen')).toMatchObject({ sequence: 3, words: ['a'] });
	});

	it('for a key nothing is held for is answered by reloading', () => {
		const { held, follower } = harness();

		const outcome = follower.notify('screen', { sessionId: 1, sequence: 1, added: ['a'] });

		expect(outcome).toBe('reload');
		expect(held.has('screen')).toBe(false);
	});

	it('from a different epoch is answered by reloading', () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ id: 2, sequence: 3, words: ['a'] }));

		const outcome = follower.notify('screen', { sessionId: 1, sequence: 4, added: ['old epoch'] });

		expect(outcome).toBe('reload');
		expect(held.get('screen')).toMatchObject({ id: 2, sequence: 3, words: ['a'] });
	});

	it('to a held state that takes no difference reloads, even when it repeats a sequence', () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 3, faulted: true }));

		expect(follower.notify('screen', { sessionId: 1, sequence: 3, added: ['a'] })).toBe('reload');
		expect(follower.notify('screen', { sessionId: 1, sequence: 4, added: ['a'] })).toBe('reload');
		expect(held.get('screen')).toMatchObject({ sequence: 3, words: [] });
	});
});

describe('a command result', () => {
	it('newer than what is held replaces it and is answered', () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 3, words: ['a'] }));
		const result = snapshot({ sequence: 5, words: ['a', 'b', 'c'] });

		expect(follower.acceptCommandResult(result)).toBe(result);
		expect(held.get('screen')).toBe(result);
	});

	it('for a key nothing is held for is held', () => {
		const { held, follower } = harness();
		const result = snapshot({ sequence: 2, words: ['a'] });

		expect(follower.acceptCommandResult(result)).toBe(result);
		expect(held.get('screen')).toBe(result);
	});

	it('older than what is held is refused, and what is held is answered', () => {
		const { held, follower } = harness();
		const newer = snapshot({ sequence: 5, words: ['a', 'b'] });
		follower.acceptSnapshot(newer);

		expect(follower.acceptCommandResult(snapshot({ sequence: 4, words: ['a'] }))).toBe(newer);
		expect(held.get('screen')).toBe(newer);
	});

	it('from an ended epoch is refused, whatever its sequence', () => {
		const { held, follower } = harness();
		const current = snapshot({ id: 2, sequence: 1, words: [] });
		follower.acceptSnapshot(current);

		expect(follower.acceptCommandResult(snapshot({ id: 1, sequence: 9, words: ['ended'] }))).toBe(current);
		expect(held.get('screen')).toBe(current);
	});
});

describe('a load', () => {
	it('holds the snapshot it read, and answers it', async () => {
		const { held, follower } = harness();
		const read = snapshot({ sequence: 2, words: ['a'] });

		await expect(follower.load('screen', async () => read)).resolves.toBe(read);
		expect(held.get('screen')).toBe(read);
	});

	it('overtaken by a later load is superseded, and answers what the later one held', async () => {
		const { held, follower } = harness();
		const first = deferred<Snapshot>();
		const second = deferred<Snapshot>();
		const earlier = follower.load('screen', () => first.promise);
		const later = follower.load('screen', () => second.promise);
		const newer = snapshot({ sequence: 4, words: ['newer'] });

		second.resolve(newer);
		await later;
		first.resolve(snapshot({ sequence: 3, words: ['older'] }));

		await expect(earlier).resolves.toBe(newer);
		expect(held.get('screen')).toBe(newer);
	});

	it('superseded before anything is held answers nothing', async () => {
		const { held, follower } = harness();
		const read = deferred<Snapshot>();
		const load = follower.load('screen', () => read.promise);

		follower.reset();
		read.resolve(snapshot());

		await expect(load).resolves.toBeNull();
		expect(held.has('screen')).toBe(false);
	});

	it('for one key is not superseded by a load for another', async () => {
		const { held, follower } = harness();
		const read = deferred<Snapshot>();
		const load = follower.load('screen', () => read.promise);
		await follower.load('other', async () => snapshot({ key: 'other' }));

		read.resolve(snapshot({ words: ['mine'] }));

		await expect(load).resolves.toMatchObject({ words: ['mine'] });
		expect(held.get('screen')).toMatchObject({ words: ['mine'] });
	});

	it.each([
		['a command result', (follower: Follower) => {
			follower.acceptCommandResult(snapshot({ sequence: 3, words: ['a', 'b'] }));
		}],
		['an authoritative snapshot', (follower: Follower) => {
			follower.acceptSnapshot(snapshot({ sequence: 3, words: ['a', 'b'] }));
		}],
		['an applied notification', (follower: Follower) => {
			follower.notify('screen', { sessionId: 1, sequence: 3, added: ['b'] });
		}],
	])('is superseded by %s answered while it was in flight', async (_, write) => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 2, words: ['a'] }));
		const read = deferred<Snapshot>();
		const load = follower.load('screen', () => read.promise);

		write(follower);
		read.resolve(snapshot({ sequence: 2, words: ['a'] }));

		await expect(load).resolves.toMatchObject({ sequence: 3, words: ['a', 'b'] });
		expect(held.get('screen')).toMatchObject({ sequence: 3, words: ['a', 'b'] });
	});

	it('is not superseded by a notification that was dropped', async () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 2, words: ['a'] }));
		const read = deferred<Snapshot>();
		const load = follower.load('screen', () => read.promise);

		follower.notify('screen', { sessionId: 1, sequence: 2, added: ['a'] });
		read.resolve(snapshot({ sequence: 5, words: ['a', 'b'] }));

		await expect(load).resolves.toMatchObject({ sequence: 5 });
		expect(held.get('screen')).toMatchObject({ sequence: 5 });
	});
});

describe('an ended epoch', () => {
	it('forgets what is held for its key and asks for a reload', () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ words: ['on air'] }));
		follower.acceptSnapshot(snapshot({ key: 'other' }));

		expect(follower.end('screen')).toBe('reload');
		expect(held.has('screen')).toBe(false);
		expect(held.has('other')).toBe(true);
	});

	it('for a key nothing is held for is ignored', () => {
		const { follower } = harness();

		expect(follower.end('screen')).toBe('ignored');
	});
});

describe('a reconnect', () => {
	it('re-reads without clearing what is held, then holds the authority', async () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 2, words: ['a'] }));
		const read = deferred<Snapshot>();

		const resync = follower.load('screen', () => read.promise);

		expect(held.get('screen')).toMatchObject({ sequence: 2, words: ['a'] });
		read.resolve(snapshot({ sequence: 6, words: ['a', 'missed'] }));
		await expect(resync).resolves.toMatchObject({ sequence: 6 });
		expect(held.get('screen')).toMatchObject({ sequence: 6, words: ['a', 'missed'] });
	});

	it('re-read overtaken by a command result does not put the older read back', async () => {
		const { held, follower } = harness();
		follower.acceptSnapshot(snapshot({ sequence: 2, words: ['a'] }));
		const read = deferred<Snapshot>();
		const resync = follower.load('screen', () => read.promise);

		follower.acceptCommandResult(snapshot({ sequence: 7, words: ['taken'] }));
		read.resolve(snapshot({ sequence: 6, words: ['a', 'missed'] }));

		await expect(resync).resolves.toMatchObject({ sequence: 7 });
		expect(held.get('screen')).toMatchObject({ sequence: 7, words: ['taken'] });
	});
});

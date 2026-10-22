import { describe, expect, it } from 'vitest';
import {
	EDIT_HISTORY_COALESCE_MS,
	EDIT_HISTORY_LIMIT,
	emptyEditHistory,
	recordEdit,
	redoEdit,
	undoEdit,
} from '~~/app/modules/feature-match-overlay/editHistory';

/**
 * The editor's undo history: each record is the state before an edit, and a burst
 * of edits under one key undoes as one step.
 */

describe('edit history', () => {
	it('undoes to the state before the edit, and redoes back to the state after it', () => {
		const history = recordEdit(emptyEditHistory<string>(), 'before', { now: 0 });

		const undone = undoEdit(history, 'after');
		expect(undone?.restore).toBe('before');

		const redone = redoEdit(undone!.history, 'before');
		expect(redone?.restore).toBe('after');
		expect(redone?.history.past).toEqual(['before']);
	});

	it('has nothing to undo or redo when empty', () => {
		expect(undoEdit(emptyEditHistory<string>(), 'now')).toBeNull();
		expect(redoEdit(emptyEditHistory<string>(), 'now')).toBeNull();
	});

	it('records a burst of edits under one key as one step', () => {
		let history = recordEdit(emptyEditHistory<number>(), 0, { now: 0, key: 'drag:1' });
		history = recordEdit(history, 1, { now: 100, key: 'drag:1' });
		history = recordEdit(history, 2, { now: 200, key: 'drag:1' });

		expect(history.past).toEqual([0]);
	});

	it('starts a new step for a different key, or after the coalescing window', () => {
		let history = recordEdit(emptyEditHistory<number>(), 0, { now: 0, key: 'a' });
		history = recordEdit(history, 1, { now: 10, key: 'b' });
		history = recordEdit(history, 2, { now: 10 + EDIT_HISTORY_COALESCE_MS + 1, key: 'b' });
		history = recordEdit(history, 3, { now: 10_000 });
		history = recordEdit(history, 4, { now: 10_001 });

		expect(history.past).toEqual([0, 1, 2, 3, 4]);
	});

	it('forgets what could be redone once a new edit is made', () => {
		const history = recordEdit(emptyEditHistory<number>(), 0, { now: 0 });
		const undone = undoEdit(history, 1)!.history;

		expect(recordEdit(undone, 0, { now: 1 }).future).toEqual([]);
	});

	it('keeps a bounded number of steps', () => {
		let history = emptyEditHistory<number>();
		for (let step = 0; step < EDIT_HISTORY_LIMIT + 5; step += 1)
			history = recordEdit(history, step, { now: step * 10_000 });

		expect(history.past).toHaveLength(EDIT_HISTORY_LIMIT);
		expect(history.past[0]).toBe(5);
	});
});

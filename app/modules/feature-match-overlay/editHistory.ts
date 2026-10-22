/**
 * An editor's undo and redo history: snapshots of what the author has changed,
 * kept in the browser for as long as the editor is open.
 *
 * Pure. Each record is the state *before* an edit, so undoing restores it. Edits
 * arriving close together under one coalescing key — the frames of one drag, the
 * keystrokes of one field — record once, so one undo reverts the whole gesture
 * rather than its last pixel.
 */

export interface EditHistory<T> {
	past: readonly T[];
	future: readonly T[];
	/** The key and time of the last record, for coalescing the next one into it. */
	last?: { key: string; at: number };
}

export const EDIT_HISTORY_LIMIT = 100;

/** How long, in ms, edits under one key keep coalescing into a single undo step. */
export const EDIT_HISTORY_COALESCE_MS = 750;

export function emptyEditHistory<T>(): EditHistory<T> {
	return { past: [], future: [] };
}

export interface RecordOptions {
	now: number;
	/** Edits sharing a key within the coalescing window record once. */
	key?: string;
}

/** Record the state before an edit. A new edit always clears what could be redone. */
export function recordEdit<T>(history: EditHistory<T>, before: T, options: RecordOptions): EditHistory<T> {
	const { now, key } = options;
	const coalesces = key !== undefined
		&& history.last?.key === key
		&& now - history.last.at <= EDIT_HISTORY_COALESCE_MS
		&& history.past.length > 0;
	const last = key === undefined ? undefined : { key, at: now };
	if (coalesces)
		return { past: history.past, future: [], last };
	return {
		past: [...history.past, before].slice(-EDIT_HISTORY_LIMIT),
		future: [],
		last,
	};
}

/** Step back: the state to restore, and the history with `current` redoable. */
export function undoEdit<T>(history: EditHistory<T>, current: T): { history: EditHistory<T>; restore: T } | null {
	const restore = history.past.at(-1);
	if (restore === undefined)
		return null;
	return {
		history: { past: history.past.slice(0, -1), future: [...history.future, current] },
		restore,
	};
}

/** Step forward again: the state to restore, and the history with `current` undoable. */
export function redoEdit<T>(history: EditHistory<T>, current: T): { history: EditHistory<T>; restore: T } | null {
	const restore = history.future.at(-1);
	if (restore === undefined)
		return null;
	return {
		history: { past: [...history.past, current], future: history.future.slice(0, -1) },
		restore,
	};
}

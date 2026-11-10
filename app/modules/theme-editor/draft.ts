import type { ShallowRef } from 'vue';
import { onBeforeUnmount, shallowRef, watch } from 'vue';

/** How long a token's editor waits after the last change before it commits an edit made in steps. */
export const THEME_TOKEN_DRAFT_COMMIT_MS = 400;

export interface ThemeTokenDraft<T> {
	/** What the token's input shows and builds its next edit on. */
	draft: ShallowRef<T>;
	/** Take one step of an edit made in steps, committing once the steps pause. */
	edit: (value: T) => void;
	/** Take a finished edit and commit it now, in place of any step still waiting. */
	commitNow: (value: T) => void;
	/** Drop a step still waiting and show the source again, as a Reset does. */
	cancel: () => void;
}

/**
 * A token's value as its editor holds it between commits. Several inputs emit
 * on every keystroke or step, and each builds a whole value on the one it was
 * given, so the editor edits a draft: a second edit builds on the first before
 * its write answers, and steps commit once, when they pause or the editor
 * unmounts.
 *
 * A new value from the source replaces the draft only while no commit is
 * pending and no write of the token is out (`writing`), so a landing write
 * never undoes an edit in progress. Once the token's writes settle with
 * nothing pending the draft is the source again, which is the value a write
 * stored, or the value still held when a write was refused.
 */
export function useThemeTokenDraft<T>(source: () => T, commit: (value: T) => void, writing: () => boolean = () => false): ThemeTokenDraft<T> {
	const draft = shallowRef(source());
	let pending: ReturnType<typeof setTimeout> | undefined;

	watch(source, (value) => {
		if (pending === undefined && !writing())
			draft.value = value;
	});

	watch(writing, (out) => {
		if (!out && pending === undefined)
			draft.value = source();
	});

	function flush() {
		clearTimeout(pending);
		pending = undefined;
		commit(draft.value);
	}

	function edit(value: T) {
		draft.value = value;
		clearTimeout(pending);
		pending = setTimeout(flush, THEME_TOKEN_DRAFT_COMMIT_MS);
	}

	function commitNow(value: T) {
		draft.value = value;
		flush();
	}

	function cancel() {
		clearTimeout(pending);
		pending = undefined;
		draft.value = source();
	}

	onBeforeUnmount(() => {
		if (pending !== undefined)
			flush();
	});

	return { draft, edit, commitNow, cancel };
}

import type { ShallowRef } from 'vue';
import { onBeforeUnmount, shallowRef, watch } from 'vue';

/** How long a composite token's editor waits after the last change before it commits. */
export const THEME_TOKEN_DRAFT_COMMIT_MS = 400;

/**
 * A composite token's value as its editor holds it between commits. The
 * Screen editors a composite input reuses emit on every keystroke, so the
 * input edits a draft and commits it once the edits pause, or when it
 * unmounts. A new value from the Theme replaces the draft only while no
 * commit is pending, so a landing write never undoes typing in progress.
 */
export function useThemeTokenDraft<T>(source: () => T, commit: (value: T) => void): { draft: ShallowRef<T>; edit: (value: T) => void } {
	const draft = shallowRef(source());
	let pending: ReturnType<typeof setTimeout> | undefined;

	watch(source, (value) => {
		if (pending === undefined)
			draft.value = value;
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

	onBeforeUnmount(() => {
		if (pending !== undefined)
			flush();
	});

	return { draft, edit };
}

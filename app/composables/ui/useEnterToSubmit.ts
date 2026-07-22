/**
 * Calls `callback` when the user presses Enter, unless the event originates
 * from a context where Enter has its own meaning (textarea, focused button,
 * open listbox/menu/combobox, or an element marked with data-enter-submit-ignore).
 *
 * Designed for non-form modals (confirmation dialogs, action modals) where
 * there is no `<UForm>` / `<form>` element to provide native Enter-to-submit.
 *
 * For form modals, prefer wrapping content in `<UForm>` instead -- native
 * form submission already handles Enter.
 *
 * When multiple instances are active (stacked modals), only the most recently
 * mounted instance fires its callback.
 */

interface EnterToSubmitStackEntry {
	id: symbol;
	disabled: () => boolean;
}

/** Global stack of active instance IDs — only the topmost enabled one fires. */
const stack: EnterToSubmitStackEntry[] = [];

function getTopEnabledEntry() {
	for (let i = stack.length - 1; i >= 0; i--) {
		const entry = stack[i]!;
		if (!entry.disabled())
			return entry;
	}
	return null;
}

export function useEnterToSubmit(
	callback: () => void,
	options?: { disabled?: MaybeRefOrGetter<boolean> },
) {
	const scope = getCurrentScope();
	if (!scope) {
		if (import.meta.dev) {
			console.warn('[useEnterToSubmit] Called outside a setup or effect scope — listener will not be registered.');
		}
		return;
	}

	const id = Symbol('useEnterToSubmit');
	const disabled = () => toValue(options?.disabled) === true;
	stack.push({ id, disabled });

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter')
			return;

		// Only the topmost enabled instance should respond.
		if (getTopEnabledEntry()?.id !== id)
			return;

		const target = e.target;
		if (target instanceof Element) {
			// Don't intercept controls where Enter already has native or component meaning.
			if (target.closest('textarea, button, [role="button"], a[href], [contenteditable="true"], [data-enter-submit-ignore], [role="listbox"], [role="menu"], [role="combobox"]'))
				return;
		}

		e.preventDefault();
		callback();
	}

	const doc = typeof document !== 'undefined' ? document : null;
	if (!doc)
		return;

	doc.addEventListener('keydown', onKeydown);

	onScopeDispose(() => {
		doc.removeEventListener('keydown', onKeydown);
		const idx = stack.findIndex(entry => entry.id === id);
		if (idx !== -1)
			stack.splice(idx, 1);
	});
}

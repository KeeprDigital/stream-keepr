/**
 * Whether a key press belongs to something the author is typing into or choosing
 * in, so an editor shortcut leaves it alone.
 *
 * Duck-typed rather than `instanceof HTMLElement`, so it also answers for an
 * element in a same-origin frame's document, whose classes are that frame's own.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
	const element = target as Partial<HTMLElement> | null;
	if (!element || typeof element.closest !== 'function')
		return false;
	if (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? ''))
		return true;
	return element.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}

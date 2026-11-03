/**
 * happy-dom has no pointer capture. A drag handle only asks for it, so a suite
 * that drags one calls this before it does.
 */
export function stubPointerCapture() {
	HTMLElement.prototype.setPointerCapture ??= () => {};
}

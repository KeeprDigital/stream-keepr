/** Whether a value is an object holding named fields: any object but a list. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is an object literal, as parsed JSON holds: one whose
 * prototype is `Object.prototype` or none, so no class instance passes.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!isPlainRecord(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

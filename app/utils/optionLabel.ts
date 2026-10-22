/**
 * A stored vocabulary value as a menu reads it: `space-between` as "Space between",
 * `boxes` as "Boxes". The value itself is still what is stored.
 */
export function optionLabel(value: string): string {
	const words = value.replace(/-/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

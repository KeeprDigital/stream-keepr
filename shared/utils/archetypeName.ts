/** What two Archetype names are compared by: neither case nor surrounding spaces tell them apart. */
function archetypeNameKey(name: string): string {
	return name.trim().toLowerCase();
}

/** Whether two Archetype names clash: an Event holds one Archetype per name, ignoring case and surrounding spaces. */
export function sameArchetypeName(a: string, b: string): boolean {
	return archetypeNameKey(a) === archetypeNameKey(b);
}

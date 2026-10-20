/**
 * A JSON value rendered as one comparable string, object keys ordered by
 * codepoint at every depth.
 *
 * Two values that differ only in key order render identically, which is what
 * comparing a stored document with the same document as a client sent it back
 * needs. Ordered by codepoint rather than locale because Command Receipts persist
 * the result and compare it across processes.
 */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value)
			.toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'undefined';
}

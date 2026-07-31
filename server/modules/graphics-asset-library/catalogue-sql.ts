/**
 * Shared SQL shapes for the Graphics Asset Library's D1 catalogue.
 *
 * D1 binds at most 100 parameters per query; the 101st fails the whole
 * statement with `D1_ERROR: too many SQL variables`. Any query that expands a
 * list into one placeholder per item therefore has a hard ceiling, and that
 * ceiling divides by however many times the list is bound: a list bound three
 * times breaks at 34 items.
 *
 * This is easy to introduce and hard to notice, because the libSQL database the
 * module tests run against accepts several hundred parameters without
 * complaint. A query that passes every test can still fail on the very first
 * production sweep. Building list predicates from a single bound JSON array
 * removes the ceiling entirely — one parameter, whatever the list length — so
 * the failure mode cannot come back through a query written later.
 */

/** D1's hard limit on bound parameters in one query. */
export const D1_MAXIMUM_BOUND_PARAMETERS = 100;

/**
 * A list predicate backed by one bound JSON array rather than one placeholder
 * per item. Pair it with `boundJsonArray` for the matching bind value.
 *
 * Pass a numbered parameter when the same list is needed more than once in a
 * statement, so it stays a single bound value:
 *
 * ```sql
 * WHERE digest IN ${valuesFromJsonArray('?1')}
 *    OR other IN ${valuesFromJsonArray('?1')}
 * ```
 */
export function valuesFromJsonArray(parameter: string = '?'): string {
	return `(SELECT value FROM json_each(${parameter}))`;
}

/** The bind value for `valuesFromJsonArray`. */
export function boundJsonArray(values: readonly (string | number)[]): string {
	return JSON.stringify(values);
}

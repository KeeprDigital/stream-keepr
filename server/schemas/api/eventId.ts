import { z } from 'zod';

/**
 * How an Event id is spelled in a path or query: a strict positive decimal
 * integer. `server/middleware/event-exists.ts` checks existence for exactly
 * this grammar, so a handler must not read an Event out of any other spelling
 * (`9e9`, `0x10`, ` 7`), each of which `Number()` would coerce.
 */
export const EVENT_ID_PATTERN = /^[1-9]\d*$/;

/**
 * One Event id param. A number is admitted as it stands, for a caller that
 * has already resolved one.
 */
export const eventIdParamSchema = z
	.union([
		z.number(),
		z.string().regex(EVENT_ID_PATTERN).transform(Number),
	])
	.pipe(z.number().int().positive());

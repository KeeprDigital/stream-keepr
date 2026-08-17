import { z } from 'zod';

/**
 * The first-admin bootstrap body (#394).
 *
 * Shape only. The password's length is checked against Better Auth's own
 * configured bounds in `server/modules/admin-bootstrap`, rather than restated
 * here as a number that could drift from the one sign-in enforces.
 *
 * `strict()` for the reason every other write schema here has it, with one
 * extra: this body is typed by hand into a terminal under time pressure, and a
 * misspelt key silently ignored would create an admin with a password nobody
 * has.
 */
export const ensureAdminSchema = z.object({
	email: z.email().max(320),
	password: z.string(),
	/**
	 * Optional, and only ever used where the account is created — the email
	 * stands in when it is absent. An existing account's name is left alone.
	 */
	name: z.string().max(200).optional(),
}).strict();

export type EnsureAdminInput = z.infer<typeof ensureAdminSchema>;

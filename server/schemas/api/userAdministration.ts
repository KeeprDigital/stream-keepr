import { z } from 'zod';

/**
 * The user administration request bodies (#399).
 *
 * Shape only. A password's length is checked against Better Auth's own
 * configured bounds in `server/modules/user-administration`, rather than
 * restated here as a number that could drift from the one sign-in enforces.
 *
 * `strict()` throughout, for the reason every other write schema here has it
 * and one more: these bodies create credentials. A misspelt key silently
 * ignored would be an account created with a name nobody meant, or a ban
 * recorded with no reason on a surface whose only record of *why* is that
 * field.
 */

export const createUserAccountSchema = z.object({
	email: z.email().max(320),
	/**
	 * Required, unlike the bootstrap's, where the email stands in when it is
	 * absent. That route is a curl typed under time pressure; this one is a form
	 * with a labelled field, and the name is what the Evidence Ledger resolves an
	 * actor to at read time — an account named after its own email address is a
	 * record nobody can read.
	 */
	name: z.string().min(1).max(200),
}).strict();

export type CreateUserAccountInput = z.infer<typeof createUserAccountSchema>;

export const setUserPasswordSchema = z.object({
	password: z.string(),
}).strict();

export type SetUserPasswordInput = z.infer<typeof setUserPasswordSchema>;

export const banUserAccountSchema = z.object({
	/**
	 * Optional, because a ban is sometimes obvious and typing a reason should
	 * never be what stands between an administrator and ending a compromised
	 * session. Bounded because it is displayed back on the listing.
	 */
	reason: z.string().max(500).optional(),
}).strict();

export type BanUserAccountInput = z.infer<typeof banUserAccountSchema>;

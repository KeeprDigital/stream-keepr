/**
 * The three things every surface that administers a Better Auth account has to
 * get identically right (#399).
 *
 * Extracted the way `sharedSecretSurface.ts` was, and for the same reason it
 * gives: the first-admin bootstrap wrote these once, this surface became the
 * second copy, and the second copy was a transcription of the first — comments
 * included. What differs between the two callers is which accounts they may
 * touch and why; none of it is *how* a credential is written.
 *
 * Each of these is a decision this repo would lose silently in a copy:
 *
 * - **Writing the password** has to create the `credential` account where there
 *   is none, or a reset reports success over an account that still cannot sign
 *   in. Both callers meet that case — the bootstrap on an account created for a
 *   future sign-in method, this surface on every invited account, which by
 *   design has no credential until its link is redeemed.
 * - **The bounds** are Better Auth's own, read from the running configuration.
 *   The check cannot be skipped: the endpoints that enforce it are the ones
 *   these surfaces cannot call, so an out-of-bounds password would hash and
 *   store happily and its owner could never sign in with it.
 * - **The email** is normalized because Better Auth lowercases before it
 *   stores, and because a port interface promises no such courtesy — a decision
 *   resting on one changes when the implementation does.
 */

import type { ServerAuth } from './auth';

/** Better Auth's own configured password bounds, as a decision layer reads them. */
export interface PasswordBounds {
	readonly minPasswordLength: number;
	readonly maxPasswordLength: number;
}

/**
 * The email an account is keyed on, which is not necessarily the one that was
 * typed.
 *
 * Not a lookup fix — `internalAdapter.findUserByEmail` lowercases its own
 * argument, so a Better Auth port finds the account either way, and a mutation
 * run proved as much by leaving that path green. It is here because the port
 * interfaces promise no such thing. It also settles what a response reports:
 * the key, not the caller's capitalisation, and what counts as a duplicate.
 */
export function normalizeAccountEmail(email: string) {
	return email.trim().toLowerCase();
}

/**
 * Refuse a password Better Auth's own sign-in path would then reject.
 *
 * Raised as a 400 with the bound named, because the only reader who can act on
 * it is the person choosing the password.
 */
export function assertPasswordWithinBounds(bounds: PasswordBounds, password: string) {
	if (password.length < bounds.minPasswordLength) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: `Password must be at least ${bounds.minPasswordLength} characters`,
		});
	}
	if (password.length > bounds.maxPasswordLength) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: `Password must be at most ${bounds.maxPasswordLength} characters`,
		});
	}
}

/**
 * Set an account's password through Better Auth's own hasher and adapter —
 * exactly what `setUserPassword` runs once its admin-session check passes,
 * which is the check neither of these surfaces can satisfy.
 *
 * Nothing here writes SQL, invents an id, or spells a hash: the rows stay
 * library-shaped, which is what ADR-0010's "through Better Auth" requirement is
 * protecting.
 */
export async function setCredentialPassword(
	context: Awaited<ServerAuth['$context']>,
	userId: string,
	password: string,
) {
	const hashedPassword = await context.password.hash(password);
	const accounts = await context.internalAdapter.findAccounts(userId);

	if (accounts.some(account => account.providerId === 'credential'))
		await context.internalAdapter.updatePassword(userId, hashedPassword);
	else
		await context.internalAdapter.createAccount({ userId, providerId: 'credential', accountId: userId, password: hashedPassword });
}

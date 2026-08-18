/**
 * Redeeming a password reset link (#399), client-side.
 *
 * Apart from `session.ts` because this is not a session operation: redeeming a
 * link sets a credential and leaves the browser exactly as signed-out as it was.
 * The person then signs in, which is the one path that mints a session, and
 * folding this into that module would put an operation that changes nothing
 * about the current session beside the two that do.
 */

import { authClient } from './client';

/** What a redemption did, and what to say where it did not. */
export type PasswordResetAttempt = { ok: true } | { ok: false; message: string };

/**
 * What a failed redemption says when the failure brought no sentence of its own.
 *
 * A request that never reached the server has only the transport's words —
 * 'Failed to fetch' — which name neither the thing that failed nor anything the
 * person could do next. The advice is deliberately "ask for another link"
 * rather than "try again": these links are single-use and expiring, so the
 * likeliest reason a redemption fails is that this one is spent or stale, and
 * nobody following an invite can tell those apart from a network blip.
 */
export const PASSWORD_RESET_FAILED_MESSAGE
	= 'This link could not be used. It may have expired or already been used — ask your administrator for a new one.';

/**
 * Exchange a reset token for a new password on the account it was minted for.
 *
 * The token is passed through exactly as it was read from the fragment. It is
 * an opaque credential, and trimming or normalizing one would be this function
 * deciding that a token which does not work should be tried as a different one.
 */
export async function redeemPasswordReset(
	token: string,
	newPassword: string,
): Promise<PasswordResetAttempt> {
	try {
		const answer = await authClient.resetPassword({ token, newPassword });

		if (answer.error)
			return { ok: false, message: answer.error.message ?? PASSWORD_RESET_FAILED_MESSAGE };

		return { ok: true };
	}
	catch {
		// Better Auth's client answers a refused request with an `error` rather
		// than a rejection, so reaching here means the request never happened.
		return { ok: false, message: PASSWORD_RESET_FAILED_MESSAGE };
	}
}

import type { BetterAuthOptions } from 'better-auth';
import { admin } from 'better-auth/plugins';

/**
 * The session policy, stated rather than inherited (#393): sessions live seven
 * days from last refresh, and a request more than a day after the previous
 * refresh slides the expiry forward. These are Better Auth's own defaults —
 * written out so the policy survives a library default changing under a bump.
 */
export const AUTH_SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
export const AUTH_SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

/**
 * The static half of this installation's Better Auth configuration: everything
 * except the database adapter and the secret, which only exist inside a running
 * server. Split out so tests can derive the expected table contract from the
 * same object the server configures itself with (see
 * `test/unit/server/db/authSchema.test.ts`), instead of from a copy that could
 * drift.
 *
 * The plugin surface is deliberately exactly this (ADR decided on #386):
 * email/password with sign-up disabled — accounts are admin-created — plus the
 * admin plugin. No SSO/OIDC/SCIM/OAuth plugins.
 */
export const authStaticOptions = {
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
		/**
		 * Redeeming a password reset link ends every session the account holds
		 * (#399).
		 *
		 * On, because otherwise "I have reset my password" does not mean what
		 * everybody assumes it means: an account whose session was stolen gets a
		 * new password while the thief keeps the session, until an administrator
		 * separately remembers to revoke. That second step is the one people
		 * forget, and it is the step that actually evicts anybody.
		 *
		 * The cost this was weighed against — signing an operator out mid-show —
		 * turned out not to exist. A Screen Output holds **no session at all**: it
		 * is authorized by the Screen Output Asset Capability in its URL hash
		 * (ADR-0010), so nothing here can blank program output. What loses access
		 * is an operator control surface, whose user is the person who has this
		 * moment chosen the password they would sign back in with. And whoever
		 * redeems a link is either a new invite with no sessions to lose, or
		 * somebody who could not sign in to begin with.
		 *
		 * **It governs the link path only.** Better Auth reads this in
		 * `/api/auth/reset-password`, so an administrator *setting* a password
		 * directly (`PUT /api/admin/users/:id/password`) still revokes nothing —
		 * that path is for handing somebody back in mid-show, where ending their
		 * sessions is the opposite of the point. The explicit revoke and ban on
		 * the same surface remain the way to end sessions deliberately.
		 */
		revokeSessionsOnPasswordReset: true,
	},
	session: {
		expiresIn: AUTH_SESSION_EXPIRES_IN_SECONDS,
		updateAge: AUTH_SESSION_UPDATE_AGE_SECONDS,
	},
	plugins: [admin()],
	// Off by default at this version; stated so a bump flipping the default
	// cannot quietly start publishing from a deployed Worker.
	telemetry: {
		enabled: false,
	},
} satisfies BetterAuthOptions;

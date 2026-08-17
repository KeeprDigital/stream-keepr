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

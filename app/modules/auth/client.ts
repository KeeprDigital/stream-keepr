import { createAuthClient } from 'better-auth/vue';

/**
 * Better Auth's own browser client, pointed at the handler `server/api/auth/
 * [...all].ts` mounts (#393).
 *
 * An adapter and nothing else: no default is overridden, because the defaults
 * already describe this installation — the app and its API are one origin, so
 * the client's inferred `${origin}/api/auth` is the handler's real mount, and
 * the plugin surface is empty because the surfaces this app has are sign-in,
 * sign-out, and reading the session. Everything with a decision in it lives in
 * `session.ts`, which is why that file has tests and this one does not.
 */
export const authClient = createAuthClient();

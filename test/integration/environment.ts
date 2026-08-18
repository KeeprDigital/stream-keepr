/**
 * The secrets and the identity the integration suite invents for itself.
 *
 * A leaf module, importing nothing, and that is its whole reason for existing
 * separately from `helpers.ts`: the authenticated client (`./client.ts`) needs the
 * bootstrap token to acquire its operator, and `helpers.ts` needs the client for
 * `$fetchRaw` — so holding these in `helpers.ts` would make the two import each
 * other. `helpers.ts` re-exports every name here, so nothing else had to move.
 */

export const INTEGRATION_GRAPHICS_ADMIN_TOKEN = 'integration-graphics-admin-token';
export const INTEGRATION_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
export const INTEGRATION_BETTER_AUTH_SECRET = 'integration-better-auth-secret-0000000000';

/**
 * The suite runs with the first-admin bootstrap armed (#394), which a deployed
 * installation does only for the length of one curl. That is deliberate: it is
 * the only way to exercise the route at all, ADR-0010 asks for dev and preview to
 * arm it as a matter of course, and since #396 it is also how the suite acquires
 * the operator every other route now requires. The disarmed 503 — the state a
 * deployed installation lives in — is covered by the unit suite, which can hold
 * both states in one run where a spawned server cannot.
 */
export const INTEGRATION_ADMIN_BOOTSTRAP_TOKEN = 'integration-admin-bootstrap-token';

/**
 * The operator the suite signs in as (#396).
 *
 * Its own account, distinct from `auth.test.ts`'s SQL-seeded fixture user: that
 * suite is about sign-in itself and asserts that a signed-out token answers
 * nothing, which sharing an account with a client that signs in behind it would
 * make untrue.
 */
export const INTEGRATION_OPERATOR_EMAIL = 'boundary-integration@keepr.digital';
export const INTEGRATION_OPERATOR_PASSWORD = 'boundary-integration-password-396';

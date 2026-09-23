/** The one value that opts a local runtime out of Better Auth. */
export const LOCAL_AUTH_BYPASS_ENABLED_VALUE = 'true';

/**
 * The launcher-supplied name that opts a local runtime out of Better Auth.
 *
 * Deliberately **not** `NUXT_`-prefixed and deliberately absent from
 * `.env.example`: no `runtimeConfig` key answers to it, so the prefix would
 * advertise membership of the family `.env` exists to hold — which is the one
 * file this name must never be in. Activation took a `.env` name and a second
 * launcher-supplied attestation until #519; ADR-0017 records why it is one name
 * now, and what the pair was for.
 */
export const LOCAL_AUTH_BYPASS_NAME = 'STREAM_KEEPR_LOCAL_AUTH_BYPASS';

/** The stable person that owns work while the development bypass is active. */
export const LOCAL_DEVELOPER_USER_ID = 'local-developer-user';
export const LOCAL_DEVELOPER_USER_NAME = 'Local Developer User';
export const LOCAL_DEVELOPER_USER_EMAIL = 'local-developer@stream-keepr.invalid';

/** The browser-only credential and the non-secret identity derived from it. */
export const LOCAL_DEVELOPER_SESSION_COOKIE = 'stream_keepr_local_developer_session';
export const LOCAL_DEVELOPER_SESSION_ID_PREFIX = 'local-developer-session:';

export function isLocalDeveloperUserId(userId: string): boolean {
	return userId === LOCAL_DEVELOPER_USER_ID;
}

export function isLocalDeveloperSessionId(sessionId: string): boolean {
	return sessionId.startsWith(LOCAL_DEVELOPER_SESSION_ID_PREFIX);
}

/**
 * Whether this process may supply the Local Developer Session.
 *
 * Exact string comparison is deliberate: environment variables arrive as
 * strings, and a misspelling must preserve the real authentication boundary. It
 * is deliberately not inferred from Node mode, hostnames, addressing, or the
 * kind of bindings attached to a Worker: none of those facts proves who can
 * reach the process, so none of them may open it.
 *
 * **Explicitly on, or implicitly off, and the name lives in exactly one place**
 * (#519): the `package.json` scripts ending in `:bypass`, which set it on the
 * command line they launch. No file in this repository assigns it —
 * `.env` does not carry it and `.env.example` does not name it — so no file can
 * be copied, staged, or synced into a deployed installation in a state that
 * opens this. That is a structural property rather than a policy, and it is what
 * replaced the two-name scheme of #460: the second name
 * existed to keep a leaked `.env` value inert, and a value that is never written
 * to a file has nothing to leak.
 *
 * One launcher, `dev:local:bypass`, serves the bypass beyond loopback on purpose,
 * for testing from another device; ADR-0018 records that exposure.
 *
 * Setting this name on a deployed Worker does activate the bypass, and no
 * runtime signal guards against it. That is ADR-0017's accepted residual,
 * on this ground: editing Worker vars or secrets
 * takes the same edit permission as deploying code, so whoever can stage it can
 * already ship an arbitrary Worker — and the worker-smoke suite depends on
 * exactly this activation to authenticate its probes against the production
 * artifact.
 */
export function localAuthBypassEnabled(bypassValue: unknown): boolean {
	return bypassValue === LOCAL_AUTH_BYPASS_ENABLED_VALUE;
}

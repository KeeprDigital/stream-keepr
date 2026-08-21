/** The one value that opts a development server out of Better Auth. */
export const LOCAL_AUTH_BYPASS_ENABLED_VALUE = 'true';

/** The non-secret Worker binding that attests this runtime was started locally. */
export const LOCAL_RUNTIME_ATTESTATION_NAME = 'STREAM_KEEPR_LOCAL_RUNTIME';
export const LOCAL_RUNTIME_ATTESTATION_VALUE = 'true';

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
 * strings, and a misspelling must preserve the real authentication boundary.
 * The separate runtime attestation is supplied only by supported local launchers.
 * It is deliberately not inferred from Node mode, hostnames, addressing, or the
 * kind of bindings attached to a Worker: none of those facts proves who can reach
 * the process. A production-shaped Worker therefore stays closed when only the
 * developer's bypass choice leaks into its environment.
 */
export function localAuthBypassEnabled(context: {
	bypassValue: unknown;
	runtimeAttestation: unknown;
}): boolean {
	return context.bypassValue === LOCAL_AUTH_BYPASS_ENABLED_VALUE
		&& context.runtimeAttestation === LOCAL_RUNTIME_ATTESTATION_VALUE;
}

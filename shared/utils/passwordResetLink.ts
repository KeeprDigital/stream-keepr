/**
 * The single-use password reset link an administrator hands over out of band
 * (#399, ADR-0010): where it points, and how the token travels in it.
 *
 * This installation has no email sender, so the link is the whole of the invite
 * and the whole of a reset — an administrator creates the account, copies this
 * URL, and passes it to the person in team chat. Nothing sends it anywhere.
 *
 * Both halves of the encoding live here, the way `screenOutput.ts` owns the
 * Screen Output Asset Capability's fragment: one writer on the server that
 * builds the link and one reader in the browser that redeems it is exactly the
 * pair that stops agreeing when the encoding is written out twice.
 */

/**
 * The page a reset link lands on — public, because the person following it has
 * no session and is about to acquire the password that would get them one.
 * `app/modules/auth/pageGate.ts` exempts this path and names this constant.
 */
export const PASSWORD_RESET_PAGE_PATH = '/reset-password';

/**
 * The fragment key the token travels under.
 *
 * **A fragment rather than a query string**, for the reason the Screen Output
 * Asset Capability uses one: a fragment is never sent to the server as part of
 * the navigation, so the token stays out of every access log between the
 * browser and the Worker. Better Auth's own reset flow puts it in a query, and
 * this installation's first-admin bootstrap already refused that trade for a
 * password (`server/api/bootstrap/ensure-admin.post.ts`: "a query string is
 * logged by every proxy in between"). The token here is a password in every
 * sense that matters — whoever holds it sets the account's credential.
 *
 * The page is client-rendered (`ssr: false`), so it can read the fragment and
 * present the token to `/api/auth/reset-password` itself; nothing about the
 * redemption needs the server to have seen the navigation.
 *
 * **The road not taken, written down because it is one upstream's own docs lead
 * to.** Better Auth mounts `GET /api/auth/reset-password/:token`, a callback
 * that redirects to `<callbackURL>?token=…`. It is still mounted and still
 * public — nothing here can unmount it — and wiring a link through it would put
 * the token back in a query string and undo this whole decision. This
 * installation never generates such a link, and the reset page reads **only**
 * the fragment: it has no query fallback, deliberately, so a token that arrives
 * that way is treated as no token rather than quietly accepted. A fallback
 * would be the helpful-looking change that reintroduces the logging this avoids.
 */
export const PASSWORD_RESET_TOKEN_FRAGMENT_KEY = 'token';

/**
 * The shape a value has to be to be a reset token, defined once for the writer
 * and the reader.
 *
 * Deliberately the same run of characters
 * `SCREEN_OUTPUT_ASSET_CAPABILITY_PATTERN` admits: both are base64url-ish
 * secrets minted by this application, and a second spelling of "an opaque
 * token" would be a second thing to keep in step. A value that cannot be a
 * token is read as no token, so a truncated paste asks for a fresh link rather
 * than being sent to the server to be refused.
 */
export const PASSWORD_RESET_TOKEN_PATTERN = /^[\w-]{20,200}$/;

/**
 * The path half of a reset link, fragment included.
 *
 * Returned as a path rather than a URL because only the server knows the origin
 * the installation is reached on, and only it should be guessing at one.
 */
export function passwordResetLinkPath(token: string): string {
	return `${PASSWORD_RESET_PAGE_PATH}#${PASSWORD_RESET_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
}

/**
 * Read the token back out of a URL fragment — the inverse of the above.
 *
 * **A fragment and nothing else.** `URLSearchParams` parses `?token=…` just as
 * happily as `token=…`, so without the refusal below this would read a *query
 * string* handed to it and call the result a token — which is the one input
 * this encoding exists to reject, and the shape Better Auth's own
 * `/reset-password/:token` callback redirects with. Nothing calls it that way
 * today; it is refused so that nothing can start to.
 */
export function passwordResetTokenFromHash(hash: string): string | null {
	if (hash.startsWith('?'))
		return null;

	const value = new URLSearchParams(hash.replace(/^#/, '')).get(PASSWORD_RESET_TOKEN_FRAGMENT_KEY);
	return value && PASSWORD_RESET_TOKEN_PATTERN.test(value) ? value : null;
}

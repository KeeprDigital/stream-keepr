import type { ThrowawayAuth } from '~~/test/helpers/throwawayAuth';
import { beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_HOST, LOCAL_ORIGIN, throwawayAuth } from '~~/test/helpers/throwawayAuth';

/**
 * The session cookie a built server sets, against a real instance configured
 * exactly as the server configures its own (#451).
 *
 * Better Auth decides `Secure` and the `__Secure-` prefix from
 * `advanced.useSecureCookies` when it is stated, and otherwise, under this
 * installation's `baseURL.protocol: 'auto'`, from `NODE_ENV` read once at module
 * load. Nothing sets `NODE_ENV` in the Worker, so the built Worker set an
 * unprefixed cookie without `Secure` (measured on #621). `authOptions.ts` now
 * states the option: on everywhere except the `nuxt dev` server, which keeps the
 * cookie it always had. This suite runs outside a dev server, so it sees
 * production's cookie, and sees it over `http://` — the scheme no longer has a
 * say.
 */

const EMAIL = 'session-cookie@keepr.digital';
const PASSWORD = 'a-long-enough-password';

const SECURE_NAME = '__Secure-better-auth.session_token';
const UNPREFIXED_NAME = 'better-auth.session_token';

let auth: ThrowawayAuth;

async function signIn(cookie?: string) {
	const response = await auth.handler(new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'host': LOCAL_HOST,
			'origin': LOCAL_ORIGIN,
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
	}));
	expect(response.status).toBe(200);
	return response;
}

/** The session token's Set-Cookie, split into its `name=value` pair and lower-cased attributes. */
function sessionSetCookie(response: Response) {
	const header = response.headers.getSetCookie().find(value => /^(?:__Secure-)?better-auth\.session_token=/.test(value));
	expect(header).toBeDefined();
	const [pair, ...attributes] = header!.split(';').map(part => part.trim());
	const separator = pair!.indexOf('=');
	return {
		name: pair!.slice(0, separator),
		value: pair!.slice(separator + 1),
		attributes: attributes.map(attribute => attribute.toLowerCase()),
	};
}

async function sessionFor(cookie: string) {
	return await auth.api.getSession({ headers: new Headers({ cookie }) });
}

beforeEach(async () => {
	auth = throwawayAuth();
	await auth.api.createUser({ body: { email: EMAIL, password: PASSWORD, name: 'Session Cookie' } });
});

describe('the session cookie outside the dev server', () => {
	it('is __Secure- prefixed and Secure, even when the sign-in arrived over http', async () => {
		const cookie = sessionSetCookie(await signIn());

		expect(cookie.name).toBe(SECURE_NAME);
		expect(cookie.attributes).toEqual(expect.arrayContaining(['secure', 'httponly', 'samesite=lax', 'path=/']));
	});

	it('is the cookie a later request is admitted by', async () => {
		const { name, value } = sessionSetCookie(await signIn());

		expect(await sessionFor(`${name}=${value}`)).not.toBeNull();
	});
});

/**
 * A browser signed in before the option was stated still carries the old,
 * unprefixed cookie, and its Session may still be live in D1. Better Auth reads
 * only the name it is configured with, so that cookie is ignored rather than
 * refused: the person signs in once more, and nothing errors on the way.
 */
describe('a leftover unprefixed session cookie', () => {
	it('admits nothing, even when it carries a live Session\'s token', async () => {
		const { value } = sessionSetCookie(await signIn());

		expect(await sessionFor(`${UNPREFIXED_NAME}=${value}`)).toBeNull();
	});

	it('does not stand in the way of signing in again', async () => {
		const { value: leftover } = sessionSetCookie(await signIn());

		const again = sessionSetCookie(await signIn(`${UNPREFIXED_NAME}=${leftover}`));

		expect(again.name).toBe(SECURE_NAME);
		expect(await sessionFor(`${UNPREFIXED_NAME}=${leftover}; ${again.name}=${again.value}`)).not.toBeNull();
	});
});

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { beforeEach, describe, expect, it } from 'vitest';
import { authStaticOptions } from '~~/server/utils/authOptions';

/**
 * Which client IP a session records, against a real instance configured exactly
 * as the server configures its own (#438).
 *
 * Better Auth resolves the client IP by walking `advanced.ipAddress.ipAddressHeaders`
 * and, when no listed header yields one, answers loopback under `NODE_ENV=test`
 * or `development` (`@better-auth/core/utils/ip.mjs`). The library default is
 * `['x-forwarded-for']`, which on this installation's platform is the wrong
 * header twice over: a caller can prepend to it, and when one does, Cloudflare's
 * append makes it multi-valued — which the library, configured with no
 * `trustedProxies`, refuses to read at all. A refused read is a `null` client
 * IP: the session records none and the production rate limiter loses its key.
 * `cf-connecting-ip` is written by Cloudflare itself, last, unconditionally —
 * stating it takes the resolution away from both the environment and the
 * caller.
 *
 * The header walk runs **before** the environment fallback, which is what makes
 * the stated header observable under vitest at all: a request carrying
 * `cf-connecting-ip` records that address in any environment. The loopback
 * fallback for header-less requests is *not* statable away — it is the
 * `isTest() || isDevelopment()` arm — so the last case pins it as the accepted
 * residual: every header-less caller in the suite is `127.0.0.1`, and anything
 * keyed on client IP collapses to one bucket here. ADR-0012 records why that
 * blindness is accepted rather than worked around.
 */

const EMAIL = 'client-ip@keepr.digital';
const PASSWORD = 'a-long-enough-password';

const LOCAL_HOST = 'localhost:3000';
const LOCAL_ORIGIN = `http://${LOCAL_HOST}`;

/** The address Cloudflare vouches for, distinct from anything a fallback produces. */
const CLOUDFLARE_CLIENT_IP = '203.0.113.7';
/** An address only a caller-controlled header could smuggle in. */
const SPOOFED_IP = '198.51.100.99';

function throwawayAuth() {
	return betterAuth({
		...authStaticOptions,
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		secret: 'a-throwaway-secret-for-the-unit-suite',
	});
}

let auth: ReturnType<typeof throwawayAuth>;

/** Sign in with the given headers and answer the session Better Auth stored for it. */
async function sessionAfterSignIn(headers: Record<string, string>) {
	const response = await auth.handler(new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'host': LOCAL_HOST,
			'origin': LOCAL_ORIGIN,
			...headers,
		},
		body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
	}));
	expect(response.status).toBe(200);

	const cookie = response.headers.get('set-cookie');
	expect(cookie).toBeTruthy();

	const resolved = await auth.api.getSession({
		headers: new Headers({ cookie: cookie! }),
	});
	expect(resolved).not.toBeNull();
	return resolved!.session;
}

beforeEach(async () => {
	auth = throwawayAuth();
	await auth.api.createUser({ body: { email: EMAIL, password: PASSWORD, name: 'Client IP' } });
});

describe('the client IP a session records, under the environment the tests run in', () => {
	it('records the address the platform vouches for', async () => {
		const session = await sessionAfterSignIn({ 'cf-connecting-ip': CLOUDFLARE_CLIENT_IP });
		expect(session.ipAddress).toBe(CLOUDFLARE_CLIENT_IP);
	});

	it('ignores a caller-controlled x-forwarded-for', async () => {
		const session = await sessionAfterSignIn({
			'cf-connecting-ip': CLOUDFLARE_CLIENT_IP,
			'x-forwarded-for': SPOOFED_IP,
		});
		expect(session.ipAddress).toBe(CLOUDFLARE_CLIENT_IP);
	});

	it('answers loopback for a header-less caller — the accepted residual', async () => {
		const session = await sessionAfterSignIn({});
		expect(session.ipAddress).toBe('127.0.0.1');
	});
});

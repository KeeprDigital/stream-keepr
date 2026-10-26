import type { ThrowawayAuth } from '~~/test/helpers/throwawayAuth';
import { beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_HOST, LOCAL_ORIGIN, throwawayAuth, throwawayAuthDatabase } from '~~/test/helpers/throwawayAuth';

/**
 * Better Auth's rate limiter, against a real instance configured exactly as the
 * server configures its own (#697).
 *
 * Unstated, the limiter is `rateLimit.enabled ?? isProduction`, and nothing sets
 * `NODE_ENV` in the Worker: the built artifact admitted every sign-in attempt
 * (reproduced by constructing the pinned library with these options and no
 * `NODE_ENV`, which reported `enabled: false`). `authOptions.ts` now states it,
 * on for every server but `nuxt dev`, so this suite sees production's limiter.
 *
 * The rule under test is the library's own for sign-in: three requests per
 * client per ten seconds. Every case names its client in `cf-connecting-ip`,
 * the header the limiter keys on (`authClientIp.test.ts` pins the resolution).
 */

const EMAIL = 'rate-limit@keepr.digital';
const PASSWORD = 'a-long-enough-password';
const ADMITTED_PER_WINDOW = 3;

/** Addresses from RFC 5737's documentation networks. */
const CLIENT = '203.0.113.7';
const OTHER_CLIENT = '198.51.100.8';

let auth: ThrowawayAuth;

/** One sign-in attempt against `instance`, with a wrong password unless given the right one. */
async function signIn(instance: ThrowawayAuth, headers: Record<string, string>, password = 'not-the-password') {
	return await instance.handler(new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'host': LOCAL_HOST,
			'origin': LOCAL_ORIGIN,
			...headers,
		},
		body: JSON.stringify({ email: EMAIL, password }),
	}));
}

/** Spend `client`'s whole sign-in allowance on wrong passwords. */
async function exhaust(instance: ThrowawayAuth, client: string) {
	for (let attempt = 0; attempt < ADMITTED_PER_WINDOW; attempt++)
		expect((await signIn(instance, { 'cf-connecting-ip': client })).status).toBe(401);
}

async function withAccount(instance: ThrowawayAuth) {
	await instance.api.createUser({
		body: { email: EMAIL, password: PASSWORD, name: 'Rate Limit' },
	});
	return instance;
}

beforeEach(async () => {
	auth = await withAccount(throwawayAuth());
});

describe('the sign-in rate limit outside the dev server', () => {
	it('refuses a client\'s fourth attempt within ten seconds with 429 and a retry delay', async () => {
		await exhaust(auth, CLIENT);

		const refused = await signIn(auth, { 'cf-connecting-ip': CLIENT }, PASSWORD);

		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get('x-retry-after'))).toBeGreaterThan(0);
	});

	it('still signs in an independent client', async () => {
		await exhaust(auth, CLIENT);

		expect((await signIn(auth, { 'cf-connecting-ip': OTHER_CLIENT }, PASSWORD)).status).toBe(200);
	});

	it('is not reset by a caller-written x-forwarded-for', async () => {
		await exhaust(auth, CLIENT);

		const refused = await signIn(auth, { 'cf-connecting-ip': CLIENT, 'x-forwarded-for': OTHER_CLIENT });

		expect(refused.status).toBe(429);
	});
});

/**
 * The count lives in the database, so every Worker isolate over one D1 shares a
 * client's bucket. Better Auth's memory store is a module-level map: per isolate
 * on Workers, and shared by every instance in this process, so the second case
 * fails under it.
 */
describe('where the limiter keeps its count', () => {
	it('is shared by every instance over one database', async () => {
		const database = throwawayAuthDatabase();
		const first = await withAccount(throwawayAuth(database));
		const second = throwawayAuth(database);

		await exhaust(first, CLIENT);

		expect((await signIn(second, { 'cf-connecting-ip': CLIENT }, PASSWORD)).status).toBe(429);
	});

	it('is not shared with an instance over another database', async () => {
		await exhaust(auth, CLIENT);

		const elsewhere = await withAccount(throwawayAuth());

		expect((await signIn(elsewhere, { 'cf-connecting-ip': CLIENT }, PASSWORD)).status).toBe(200);
	});
});

import type { ThrowawayAuth } from '~~/test/helpers/throwawayAuth';
import { admin } from 'better-auth/plugins';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_HOST, LOCAL_ORIGIN, throwawayAuth } from '~~/test/helpers/throwawayAuth';

/*
 * No admin-plugin endpoint answers over HTTP, whatever Session asks (ADR-0010):
 * user administration is the Graphics Administrator's, and an `admin`-role
 * Session is not that credential.
 */

const EMAIL = 'bootstrap-admin@keepr.digital';
const PASSWORD = 'a-long-enough-password';

interface RoutedEndpoint {
	path?: string;
	options?: { method?: string | string[] };
}

/** Every route the installed plugin ships, read from the plugin itself. */
const adminRoutes = Object.values(admin().endpoints as unknown as Record<string, RoutedEndpoint>)
	.filter(endpoint => endpoint.path)
	.flatMap(endpoint => [endpoint.options?.method ?? 'POST'].flat().map(method => [method, endpoint.path!] as const));

let auth: ThrowawayAuth;
let cookie: string;

function request(method: string, path: string, body: unknown = {}) {
	const headers = {
		'content-type': 'application/json',
		'host': LOCAL_HOST,
		'origin': LOCAL_ORIGIN,
		cookie,
	};
	return auth.handler(new Request(`${LOCAL_ORIGIN}/api/auth${path}`, method === 'GET'
		? { method, headers }
		: {
				method,
				headers,
				body: JSON.stringify(body),
			}));
}

beforeAll(async () => {
	auth = throwawayAuth();
	cookie = '';
	// The account the first-admin bootstrap leaves behind: role `admin`.
	await auth.api.createUser({
		body: {
			email: EMAIL,
			password: PASSWORD,
			name: 'Bootstrap Admin',
			role: 'admin',
		},
	});
	const signedIn = await request('POST', '/sign-in/email', { email: EMAIL, password: PASSWORD });
	cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
});

describe('the admin-plugin endpoints of Better Auth', () => {
	it('are found on the plugin, so this cannot pass by asking nothing', () => {
		expect(adminRoutes.length).toBeGreaterThanOrEqual(15);
		expect(adminRoutes.map(([, path]) => path)).toEqual(expect.arrayContaining([
			'/admin/remove-user',
			'/admin/impersonate-user',
			'/admin/set-role',
			'/admin/set-user-password',
		]));
	});

	it('are asked by a Session Better Auth itself admits as an admin', async () => {
		const session = await (await request('GET', '/get-session')).json() as { user?: { role?: string } };

		expect(session.user?.role).toBe('admin');
	});

	it.each(adminRoutes)('%s %s answers an admin-role Session 404', async (method, path) => {
		const response = await request(method, path);

		expect(response.status).toBe(404);
	});

	it('leaves the server-side call user administration makes working', async () => {
		const { user } = await auth.api.createUser({
			body: { email: 'invited@keepr.digital', name: 'Invited Operator' },
		});

		expect(user.email).toBe('invited@keepr.digital');
	});
});

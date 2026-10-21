import type { ScreenResponse } from '~~/shared/api';
import { fetch, url } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	LOCAL_DEVELOPER_SESSION_COOKIE,
	LOCAL_DEVELOPER_SESSION_ID_PREFIX,
	LOCAL_DEVELOPER_USER_ID,
	LOCAL_DEVELOPER_USER_NAME,
} from '~~/shared/utils/localDeveloperAuth';
import { LOGIN_PATH } from '~/modules/auth/pageGate';
import { observeChromiumValue } from '../../scripts/graphics-acceptance/chromium.mjs';

/** Text only the protected page renders, and text only the login page renders. */
const PROTECTED_PAGE_TEXT = 'Graphics Asset Library Operations';
const LOGIN_PAGE_TEXT = 'Accounts and password resets are issued by an administrator.';

/**
 * How long a cold `nuxt dev` may take to show either page. Generous because it
 * is a bound on a compile, not an assertion: the assertion is which page. #687
 * saw the cold load overrun 25 s at load average 17–30.
 */
const PAGE_COLD_START_LIMIT_MS = 120_000;

interface LocalSessionReading {
	user: { id: string; name: string };
	session: { id: string; userId: string };
}

function cookieFrom(response: Response): string {
	const cookies = response.headers.getSetCookie();
	expect(cookies.join(';')).not.toContain('better-auth.session_token');
	const local = cookies.find(cookie => cookie.startsWith(`${LOCAL_DEVELOPER_SESSION_COOKIE}=`));
	expect(local).toBeDefined();
	return local!.split(';', 1)[0]!;
}

async function localSession(cookie?: string) {
	const response = await fetch('/api/auth/get-session', {
		headers: cookie ? { cookie } : undefined,
	});
	expect(response.status).toBe(200);
	return {
		cookie: cookie ?? cookieFrom(response),
		reading: await response.json() as LocalSessionReading,
	};
}

async function request(path: string, options: { cookie?: string; method?: string; body?: unknown } = {}) {
	const headers = new Headers();
	if (options.cookie)
		headers.set('cookie', options.cookie);
	if (options.body !== undefined)
		headers.set('content-type', 'application/json');
	return await fetch(path, {
		method: options.method,
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
}

describe('a dev server with the Local Developer Session enabled', () => {
	let eventId: number;
	let screenId: number;
	let browserA: Awaited<ReturnType<typeof localSession>>;
	let browserB: Awaited<ReturnType<typeof localSession>>;

	beforeAll(async () => {
		browserA = await localSession();
		browserB = await localSession();

		const eventResponse = await request('/api/events', {
			cookie: browserA.cookie,
			method: 'POST',
			body: { name: 'Local Auth Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		expect(eventResponse.status).toBe(201);
		eventId = (await eventResponse.json() as { id: number }).id;

		const screenResponse = await request(`/api/events/${eventId}/screens`, {
			cookie: browserA.cookie,
			method: 'POST',
			body: { name: 'Local Auth Screen', slug: 'local-auth-screen', currentMode: 'broadcast-graphics' },
		});
		expect(screenResponse.status).toBe(201);
		screenId = (await screenResponse.json() as ScreenResponse).id;
	});

	afterAll(async () => {
		if (eventId)
			await request(`/api/events/${eventId}`, { cookie: browserA.cookie, method: 'DELETE' });
	});

	it('enters the protected API boundary without a Better Auth cookie or configured secret', async () => {
		const response = await fetch('/api/events');

		expect(response.status).toBe(200);
		expect(cookieFrom(response)).toContain(`${LOCAL_DEVELOPER_SESSION_COOKIE}=`);
	});

	it('enters a protected page through the real browser gate without seeing login', async () => {
		// The probe settles on whichever page the gate shows first, so a working
		// bypass answers as soon as the protected page renders and a broken one as
		// soon as login does. The deadline only bounds "neither yet": this is a cold
		// `nuxt dev` client load, compiled on demand while `pnpm verify` runs the
		// integration suite and the browser gates beside it, and a fixed 25 s
		// cut-off read that compile as "neither page visible" (#687). It is set
		// in Node and compared against the page's clock, so a redirect that
		// replaces the document cannot restart it.
		const deadline = Date.now() + PAGE_COLD_START_LIMIT_MS;
		const observed = await observeChromiumValue({
			url: url('/admin/graphics-assets'),
			timeoutMs: PAGE_COLD_START_LIMIT_MS + 10_000,
			expression: `(() => {
				const body = document.body?.innerText ?? '';
				const seen = {
					pathname: location.pathname,
					protectedPageVisible: body.includes(${JSON.stringify(PROTECTED_PAGE_TEXT)}),
					loginPageVisible: location.pathname === ${JSON.stringify(LOGIN_PATH)}
						|| body.includes(${JSON.stringify(LOGIN_PAGE_TEXT)}),
				};
				if (!seen.protectedPageVisible && !seen.loginPageVisible && Date.now() < ${deadline})
					return undefined;
				return seen;
			})()`,
		});

		expect(observed, 'the browser gate showed login, or neither page before the cold-start limit').toEqual({
			outcome: 'passed',
			value: {
				pathname: '/admin/graphics-assets',
				protectedPageVisible: true,
				loginPageVisible: false,
			},
		});
	}, PAGE_COLD_START_LIMIT_MS + 30_000);

	it('keeps one User across browsers while giving each browser its own Session', async () => {
		expect(browserA.reading.user).toMatchObject({
			id: LOCAL_DEVELOPER_USER_ID,
			name: LOCAL_DEVELOPER_USER_NAME,
		});
		expect(browserB.reading.user.id).toBe(browserA.reading.user.id);
		expect(browserA.reading.session.userId).toBe(LOCAL_DEVELOPER_USER_ID);
		expect(browserA.reading.session.id).toMatch(new RegExp(`^${LOCAL_DEVELOPER_SESSION_ID_PREFIX}`));
		expect(browserB.reading.session.id).not.toBe(browserA.reading.session.id);

		const repeated = await localSession(browserA.cookie);
		expect(repeated.reading.session.id).toBe(browserA.reading.session.id);
	});

	it('admits the local User on a session-optional route', async () => {
		const response = await request(`/api/screen-output/events/${eventId}/screens/slug/local-auth-screen`, {
			cookie: browserA.cookie,
		});

		expect(response.status).toBe(200);
		expect((await response.json() as ScreenResponse).id).toBe(screenId);
	});

	it('keeps Graphics Authoring Leases scoped to the two browser Sessions', async () => {
		const leasePath = `/api/events/${eventId}/screens/${screenId}/graphics-authoring-lease`;
		const acquired = await request(leasePath, { cookie: browserA.cookie, method: 'POST', body: {} });
		const observed = await request(leasePath, { cookie: browserB.cookie, method: 'POST', body: {} });

		expect(acquired.status).toBe(200);
		expect(await acquired.json()).toMatchObject({ lease: { role: 'holder', writable: true } });
		expect(observed.status).toBe(200);
		expect(await observed.json()).toMatchObject({
			outcome: 'observe',
			lease: {
				role: 'observer',
				writable: false,
				holderName: LOCAL_DEVELOPER_USER_NAME,
			},
		});
	});
});

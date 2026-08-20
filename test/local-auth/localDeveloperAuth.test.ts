import type { ScreenResponse } from '~~/shared/api';
import { fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	LOCAL_DEVELOPER_SESSION_COOKIE,
	LOCAL_DEVELOPER_SESSION_ID_PREFIX,
	LOCAL_DEVELOPER_USER_ID,
	LOCAL_DEVELOPER_USER_NAME,
} from '~~/shared/utils/localDeveloperAuth';

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

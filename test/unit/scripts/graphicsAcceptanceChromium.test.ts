import { describe, expect, it } from 'vitest';
import {
	authorSessionCookie,
	initialTarget,
	openAuthoredPage,
} from '../../../scripts/graphics-acceptance/chromium.mjs';
import { authoredPageRequest } from '../../../scripts/graphics-acceptance/installation.mjs';

/**
 * The name the installation issues its graphics author session under
 * (`server/modules/graphics-author-session.ts:11`).
 */
const COOKIE_NAME = 'stream_keepr_graphics_author_session';
/**
 * Shaped like a real token rather than merely opaque: the installation mints one
 * as two concatenated `crypto.randomUUID()`s (`graphics-author-session.ts:159`),
 * so it is hex and hyphens and carries no `.` or `=` of its own.
 */
const COOKIE_VALUE = '3f9c1a72-5d84-4e21-9b6f-0a7c2e8d41b5'
	+ 'c4e70d92-1f38-4a6b-8c25-7d09e3f1a2b6';
const COOKIE = `${COOKIE_NAME}=${COOKIE_VALUE}`;

/**
 * The `--library` font gate stages an ingestion from Node and then reads it
 * back in a browser. A Graphics Ingestion Operation is owned by the session
 * that created it and is a `404` to any other (ADR-0003), so the browser has to
 * arrive carrying the harness's own session: the run that let the page mint its
 * own could not pass by construction (#276).
 *
 * The live shape of that fact — the browser reading the operation `200` as its
 * initiator — needs a running installation and a local Chromium. What is
 * checkable here is everything below that: the cookie the browser is handed,
 * which has to match the one the installation issued attribute for attribute
 * because a cookie stored under different rules is a different cookie for the
 * requests that matter, and the conversation that installs it.
 */
describe('the author session the acceptance browser is given', () => {
	it('splits the pair the installation issued at its first separator', () => {
		const cookie = authorSessionCookie('http://127.0.0.1:8787/_acceptance/static-font-v1.html', COOKIE);
		expect(cookie.name).toBe(COOKIE_NAME);
		expect(cookie.value).toBe(COOKIE_VALUE);
	});

	/**
	 * This installation's own token carries no `=`, but a cookie value may, and
	 * the harness reads whatever it was handed rather than what it expects — so
	 * the split is at the first separator, not the last.
	 */
	it('keeps a value containing an "=" whole', () => {
		expect(authorSessionCookie('http://127.0.0.1:8787/', 'session=YWJjZA==').value).toBe('YWJjZA==');
	});

	/**
	 * `graphics-author-session.ts` issues it `httpOnly`, path `/`, `SameSite`
	 * strict, and `Secure` exactly when the request arrived over https. A cookie
	 * scoped to the acceptance page's own path would not be sent to the API
	 * routes the page reads, which is this ticket's defect with a different
	 * cause.
	 */
	it('mirrors the attributes the installation issued it with', () => {
		expect(authorSessionCookie('https://stream.example.workers.dev/_acceptance/x.html', COOKIE))
			.toMatchObject({
				url: 'https://stream.example.workers.dev/_acceptance/x.html',
				path: '/',
				httpOnly: true,
				sameSite: 'Strict',
				secure: true,
			});
		expect(authorSessionCookie('http://127.0.0.1:8787/_acceptance/x.html', COOKIE).secure).toBe(false);
	});

	it('refuses something that is not a name=value pair rather than setting a nameless cookie', () => {
		expect(() => authorSessionCookie('http://127.0.0.1:8787/', 'nonsense')).toThrow();
		expect(() => authorSessionCookie('http://127.0.0.1:8787/', '=value')).toThrow();
	});
});

const PAGE_URL = 'http://127.0.0.1:8787/_acceptance/static-font-v1.html?operation=op-1';

/**
 * A page that records what it was asked to do.
 *
 * `openAuthoredPage` takes anything answering `command(method, params)`, which
 * is the whole of what it needs from a CDP connection — so the conversation it
 * holds is checkable without a browser. `Network.setCookie` answers the way
 * Chromium does unless a test says otherwise.
 */
function recordingPage(answers: Record<string, unknown> = {}) {
	const commands: { method: string; params?: object }[] = [];
	return {
		commands,
		methods: () => commands.map(({ method }) => method),
		paramsFor: (method: string) => commands.find(command => command.method === method)?.params,
		async command(method: string, params?: object) {
			commands.push({ method, params });
			if (method in answers)
				return answers[method];
			return method === 'Network.setCookie' ? { success: true } : {};
		},
	};
}

/**
 * The conversation that carries the harness's identity into the browser.
 *
 * The cookie helper above shapes the cookie; this is the part that decides it
 * is installed at all, before anything is navigated. Both halves have to hold —
 * a correctly shaped cookie set after the page has already loaded is the #276
 * defect with an extra step.
 */
describe('opening the acceptance page as the author that staged the ingestion', () => {
	it('creates the target blank when it has a session to install, and at the destination otherwise', () => {
		expect(initialTarget(PAGE_URL, COOKIE)).toBe('about:blank');
		expect(initialTarget(PAGE_URL, undefined)).toBe(PAGE_URL);
	});

	it('installs the cookie before it navigates, and enables the runtime last', async () => {
		const page = recordingPage();

		await openAuthoredPage(page, { url: PAGE_URL, authorCookie: COOKIE });

		expect(page.methods()).toEqual([
			'Network.enable',
			'Network.setCookie',
			'Page.navigate',
			'Runtime.enable',
		]);
		expect(page.paramsFor('Network.setCookie')).toEqual(authorSessionCookie(PAGE_URL, COOKIE));
		expect(page.paramsFor('Page.navigate')).toEqual({ url: PAGE_URL });
	});

	/**
	 * The run without a session is every other browser harness, and it must be
	 * left exactly as it was: no cookie, and no navigation either, because its
	 * target was created at the destination.
	 */
	it('says nothing about cookies when it was given no session', async () => {
		const page = recordingPage();

		await openAuthoredPage(page, { url: PAGE_URL });

		expect(page.methods()).toEqual(['Runtime.enable']);
	});

	/**
	 * `Network.setCookie` reports refusal in its result rather than by failing,
	 * so an unchecked call would hand the page an identity it does not have and
	 * the gate would fail later as a font that would not load.
	 */
	it('fails with a named cause when the browser refuses the cookie', async () => {
		const page = recordingPage({ 'Network.setCookie': { success: false } });

		const opening = openAuthoredPage(page, { url: PAGE_URL, authorCookie: COOKIE });

		await expect(opening).rejects.toMatchObject({ code: 'author-session-cookie-refused' });
		expect(page.methods()).not.toContain('Page.navigate');
		expect(page.methods()).not.toContain('Runtime.enable');
	});

	/**
	 * `run-font-browser-acceptance.mjs` runs its harness at import — the module's
	 * body *is* the run — so importing it in a test would open an installation
	 * and drive a browser, and its own call site is therefore reachable by no
	 * unit runner. The fact that call site has to get right is held here instead:
	 * a page opened for staged work carries the session that staged it, as one
	 * expression rather than two arguments an edit can separate.
	 */
	it('pairs a staged page with the session that staged it', () => {
		const session = { origin: 'http://127.0.0.1:8787', authorCookie: COOKIE };

		expect(authoredPageRequest(session, PAGE_URL)).toEqual({
			url: PAGE_URL,
			authorCookie: COOKIE,
		});
	});
});

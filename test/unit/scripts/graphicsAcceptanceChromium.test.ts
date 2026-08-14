import { describe, expect, it } from 'vitest';
import { authorSessionCookie } from '../../../scripts/graphics-acceptance/chromium.mjs';

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

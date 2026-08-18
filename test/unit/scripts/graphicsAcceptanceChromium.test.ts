import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	browserCookie,
	initialTarget,
	openAuthoredPage,
	verdictFailureCode,
} from '../../../scripts/graphics-acceptance/chromium.mjs';
import { ACCEPTANCE_FAILURE_CODES } from '../../../scripts/graphics-acceptance/evidence.mjs';
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
 * The operator session that travels beside it since #396.
 *
 * Two identities reach the browser now, and they answer different questions: this
 * one gets a request past the API boundary at all, the author cookie says whose
 * operation is being read. A page given only the second is answered 401 by every
 * library route, which no assertion inside the page can tell from a broken one.
 */
const SESSION_COOKIE = 'better-auth.session_token=0f8b1c2d3e4f5a6b.7c8d9e0f1a2b3c4d';

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
		const cookie = browserCookie('http://127.0.0.1:8787/_acceptance/static-font-v1.html', COOKIE);
		expect(cookie.name).toBe(COOKIE_NAME);
		expect(cookie.value).toBe(COOKIE_VALUE);
	});

	/**
	 * This installation's own token carries no `=`, but a cookie value may, and
	 * the harness reads whatever it was handed rather than what it expects — so
	 * the split is at the first separator, not the last.
	 */
	it('keeps a value containing an "=" whole', () => {
		expect(browserCookie('http://127.0.0.1:8787/', 'session=YWJjZA==').value).toBe('YWJjZA==');
	});

	/**
	 * `graphics-author-session.ts` issues it `httpOnly`, path `/`, `SameSite`
	 * strict, and `Secure` exactly when the request arrived over https. A cookie
	 * scoped to the acceptance page's own path would not be sent to the API
	 * routes the page reads, which is this ticket's defect with a different
	 * cause.
	 */
	it('mirrors the attributes the installation issued it with', () => {
		expect(browserCookie('https://stream.example.workers.dev/_acceptance/x.html', COOKIE))
			.toMatchObject({
				url: 'https://stream.example.workers.dev/_acceptance/x.html',
				path: '/',
				httpOnly: true,
				sameSite: 'Strict',
				secure: true,
			});
		expect(browserCookie('http://127.0.0.1:8787/_acceptance/x.html', COOKIE).secure).toBe(false);
	});

	it('refuses something that is not a name=value pair rather than setting a nameless cookie', () => {
		expect(() => browserCookie('http://127.0.0.1:8787/', 'nonsense')).toThrow();
		expect(() => browserCookie('http://127.0.0.1:8787/', '=value')).toThrow();
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
	it('creates the target blank when it has cookies to install, and at the destination otherwise', () => {
		expect(initialTarget(PAGE_URL, [COOKIE])).toBe('about:blank');
		expect(initialTarget(PAGE_URL, undefined)).toBe(PAGE_URL);
		// An empty list is a run with no identity, not a run with one to install.
		expect(initialTarget(PAGE_URL, [])).toBe(PAGE_URL);
	});

	it('installs every cookie before it navigates, and enables the runtime last', async () => {
		const page = recordingPage();

		await openAuthoredPage(page, { url: PAGE_URL, cookies: [SESSION_COOKIE, COOKIE] });

		expect(page.methods()).toEqual([
			'Network.enable',
			'Network.setCookie',
			'Network.setCookie',
			'Page.navigate',
			'Runtime.enable',
		]);
		// Both of them, because a page carrying one of the two is the failure this
		// list exists to prevent — and it is the kind that reads as a working page
		// right up to the request that needs the other.
		expect(page.commands.filter(({ method }) => method === 'Network.setCookie').map(({ params }) => params))
			.toEqual([browserCookie(PAGE_URL, SESSION_COOKIE), browserCookie(PAGE_URL, COOKIE)]);
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

		const opening = openAuthoredPage(page, { url: PAGE_URL, cookies: [COOKIE] });

		await expect(opening).rejects.toMatchObject({ code: 'author-session-cookie-refused' });
		expect(page.methods()).not.toContain('Page.navigate');
		expect(page.methods()).not.toContain('Runtime.enable');
	});

	/**
	 * The helper's own shape: a page opened for staged work carries the session
	 * that staged it, as one expression rather than two arguments an edit can
	 * separate. Its call site in `run-font-browser-acceptance.mjs` used to be
	 * reachable by no unit runner — the module ran its harness at import — and
	 * this test was the stand-in; since #345 the call site is pinned directly in
	 * `runFontBrowserAcceptance.test.ts`, and this holds just the helper.
	 */
	it('pairs a staged page with both identities that staged it', () => {
		const session = {
			origin: 'http://127.0.0.1:8787',
			authorCookie: COOKIE,
			sessionCookies: [SESSION_COOKIE],
		};

		expect(authoredPageRequest(session, PAGE_URL)).toEqual({
			url: PAGE_URL,
			cookies: [SESSION_COOKIE, COOKIE],
		});
	});

	/**
	 * `document.body.dataset.code` is written by the page, so it is untrusted
	 * text on the way into the transcript the deployment gate publishes. The
	 * harness resolves it against the published registry rather than forwarding
	 * it (#340) — the docblock claimed this before the code did.
	 */
	describe('verdictFailureCode', () => {
		it('prints the page\'s own word for the failure when the registry publishes it', () => {
			expect(verdictFailureCode({ outcome: 'failed', code: 'font-glyph-not-rendered' }))
				.toBe('font-glyph-not-rendered');
			expect(verdictFailureCode({ outcome: 'failed', code: 'safari-vp9-alpha-not-blocked' }))
				.toBe('safari-vp9-alpha-not-blocked');
		});

		/**
		 * Every code the shipped pages author has to survive the lookup, or the
		 * mapping silently flattens real evidence into the generic failure. The
		 * pages are read here rather than listed, so a page that starts naming a
		 * code nobody published fails this rather than degrading in a run.
		 *
		 * The residual, stated because it is invisible from the result: the
		 * regex sees single-quoted literals only, so a code written with double
		 * quotes, built as a template literal, or reached through a variable is
		 * missed — and missed quietly, since a smaller enumeration still passes.
		 * Two of the four pages author no code at all (`silent-video-v1` and
		 * `still-image-v1` publish only `dataset.result`), so a mistake in the
		 * pattern would leave a plausible-looking set rather than an empty one.
		 * The control below is what keeps that from reading as a pass.
		 */
		it('publishes every code the acceptance pages actually author', () => {
			const authored = new Set<string>();
			for (const page of ['static-font-v1', 'vp9-alpha-safari-v1', 'silent-video-v1', 'still-image-v1']) {
				const html = readFileSync(
					new URL(`../../../public/_acceptance/${page}.html`, import.meta.url),
					'utf8',
				);
				for (const match of html.matchAll(/\b(?:code: |report\()'([a-z0-9-]+)'/g))
					authored.add(match[1]!);
			}

			// A positive control: an empty enumeration would pass the loop below.
			expect(authored.has('font-glyph-not-rendered')).toBe(true);
			expect(authored.size).toBeGreaterThan(5);

			for (const code of authored)
				expect(verdictFailureCode({ outcome: 'failed', code })).toBe(code);
		});

		/**
		 * A page that names something the registry does not publish is a page
		 * that failed without naming a failure this contract knows — the same
		 * thing as a page that named nothing. It must not reach the formatter,
		 * whose refusal path (`evidence-unknown-code`) exists for a harness that
		 * builds a code itself, not for page text.
		 */
		it('refuses a code the registry does not publish, including the formatter\'s own words', () => {
			for (const code of [
				'totally-made-up',
				'evidence-unknown-code',
				'evidence-secret-leak',
				'acceptance passed',
				'',
			])
				expect(verdictFailureCode({ outcome: 'failed', code })).toBe('browser-acceptance-failed');

			expect(verdictFailureCode({ outcome: 'failed' })).toBe('browser-acceptance-failed');
			expect(ACCEPTANCE_FAILURE_CODES).toContain('browser-acceptance-failed');
		});

		/**
		 * A page-authored code never gets to describe a run in which no page
		 * decided anything: "the driver never ran" and "the page never decided"
		 * keep their own codes whatever the dataset says.
		 */
		it('never lets a page name an outcome it was not present for', () => {
			expect(verdictFailureCode({ outcome: 'unavailable', code: 'font-glyph-not-rendered' }))
				.toBe('browser-driver-unavailable');
			expect(verdictFailureCode({ outcome: 'timed-out', code: 'font-glyph-not-rendered' }))
				.toBe('browser-acceptance-timed-out');
		});
	});
});

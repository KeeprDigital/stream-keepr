import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	browserCookie,
	collectPageDiagnostics,
	initialTarget,
	openAuthoredPage,
	verdictFailureCode,
} from '../../../scripts/graphics-acceptance/chromium.mjs';
import { ACCEPTANCE_FAILURE_CODES } from '../../../scripts/graphics-acceptance/evidence.mjs';
import { authoredPageRequest } from '../../../scripts/graphics-acceptance/installation.mjs';

/** The name Better Auth issues this installation's session under, over http (#398). */
const COOKIE_NAME = 'better-auth.session_token';
/**
 * Shaped like a real token rather than merely opaque: Better Auth signs the
 * token, so the value carries a `.` — which is exactly the separator a naive
 * split would take for the cookie's own.
 */
const COOKIE_VALUE = '0f8b1c2d3e4f5a6b.7c8d9e0f1a2b3c4d';
const COOKIE = `${COOKIE_NAME}=${COOKIE_VALUE}`;
const SESSION_COOKIE = COOKIE;

// A Graphics Ingestion Operation is a 404 to anyone but its initiator (ADR-0010), so the
// browser must carry the harness's own session, cookie attribute for attribute (#276).
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

	/**
	 * A built Worker under `pnpm preview` issues `__Secure-better-auth.session_token`
	 * with `Secure` over plain http (#451). A browser refuses that name without
	 * `Secure`, so the prefix decides it; Chromium accepts a `Secure` cookie on
	 * loopback because it treats loopback as a secure origin.
	 */
	it('installs a __Secure- prefixed cookie as Secure even on loopback http', () => {
		expect(browserCookie('http://127.0.0.1:8787/_acceptance/x.html', `__Secure-${COOKIE}`))
			.toMatchObject({ name: `__Secure-${COOKIE_NAME}`, secure: true });
	});

	it('refuses something that is not a name=value pair rather than setting a nameless cookie', () => {
		expect(() => browserCookie('http://127.0.0.1:8787/', 'nonsense')).toThrow();
		expect(() => browserCookie('http://127.0.0.1:8787/', '=value')).toThrow();
	});
});

const PAGE_URL = 'http://127.0.0.1:8787/_acceptance/static-font-v1.html?operation=op-1';

/** A CDP page that records its commands; `Network.setCookie` answers as Chromium does unless told otherwise. */
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
			return method === 'Network.setCookie'
				? { success: true }
				: {};
		},
	};
}

// The cookie must be installed before anything is navigated.
describe('opening the acceptance page as the author that staged the ingestion', () => {
	it('creates the target blank when it has cookies to install, and at the destination otherwise', () => {
		expect(initialTarget(PAGE_URL, [COOKIE])).toBe('about:blank');
		expect(initialTarget(PAGE_URL, undefined)).toBe(PAGE_URL);
		// An empty list is a run with no identity, not a run with one to install.
		expect(initialTarget(PAGE_URL, [])).toBe(PAGE_URL);
	});

	it('installs every cookie before it navigates, and enables the runtime last', async () => {
		const page = recordingPage();

		await openAuthoredPage(page, {
			url: PAGE_URL,
			cookies: [SESSION_COOKIE, COOKIE],
		});

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
			.toEqual([
				browserCookie(PAGE_URL, SESSION_COOKIE),
				browserCookie(PAGE_URL, COOKIE),
			]);
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
		const page = recordingPage({
			'Network.setCookie': { success: false },
		});

		const opening = openAuthoredPage(page, {
			url: PAGE_URL,
			cookies: [COOKIE],
		});

		await expect(opening).rejects.toMatchObject({ code: 'author-session-cookie-refused' });
		expect(page.methods()).not.toContain('Page.navigate');
		expect(page.methods()).not.toContain('Runtime.enable');
	});

	// A page opened for staged work carries the session that staged it, as one expression.
	it('pairs a staged page with the identity that staged it', () => {
		const session = {
			origin: 'http://127.0.0.1:8787',
			sessionCookies: [SESSION_COOKIE],
		};

		expect(authoredPageRequest(session, PAGE_URL)).toEqual({
			url: PAGE_URL,
			cookies: [SESSION_COOKIE],
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
			expect(verdictFailureCode({ outcome: 'failed', code: 'font-refused-face-loaded' }))
				.toBe('font-refused-face-loaded');
		});

		// Every code a shipped page authors must survive the lookup. The pages are read, not
		// listed; the regex sees single-quoted literals only.
		it('publishes every code the acceptance pages actually author', () => {
			const authored = new Set<string>();
			for (const page of ['static-font-v1', 'silent-video-v1', 'still-image-v1']) {
				const html = readFileSync(
					new URL(`../../../public/_acceptance/${page}.html`, import.meta.url),
					'utf8',
				);
				for (const match of html.matchAll(/\b(?:code: |report\()'([a-z0-9-]+)'/g))
					authored.add(match[1]!);
			}

			// A positive control: an empty enumeration would pass the loop below.
			expect(authored.has('font-glyph-not-rendered')).toBe(true);
			expect(authored.size).toBeGreaterThan(4);

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

/**
 * What a page said while it was observed (#687): its console and anything it
 * threw that nothing caught, kept so a failed run can say why. Fed the CDP
 * events Chromium sends once `Runtime` is enabled.
 */
describe('the page diagnostics a run keeps', () => {
	function eventPage() {
		const handlers = new Map<string, (params: any) => void>();
		return {
			on: (method: string, handler: (params: any) => void) => handlers.set(method, handler),
			emit: (method: string, params: object) => handlers.get(method)?.(params),
		};
	}

	it('keeps console text and uncaught errors, newest last', () => {
		const page = eventPage();
		const diagnostics = collectPageDiagnostics(page);

		page.emit('Runtime.consoleAPICalled', {
			type: 'warning',
			args: [
				{ type: 'string', value: 'THREE.WebGLProgram:' },
				{ type: 'number', value: 3 },
			],
		});
		page.emit('Runtime.consoleAPICalled', {
			type: 'error',
			args: [
				{ type: 'object', description: 'Error: shader failed' },
			],
		});
		page.emit('Runtime.exceptionThrown', {
			exceptionDetails: {
				text: 'Uncaught',
				exception: { description: 'TypeError: x is undefined\n    at y' },
			},
		});

		expect(diagnostics.read()).toEqual({
			console: ['warning: THREE.WebGLProgram: 3', 'error: Error: shader failed'],
			uncaught: ['TypeError: x is undefined\n    at y'],
		});
	});

	it('keeps only the newest few, so a chatty page cannot grow the run without bound', () => {
		const page = eventPage();
		const diagnostics = collectPageDiagnostics(page);

		for (let index = 0; index < 50; index += 1) {
			page.emit('Runtime.consoleAPICalled', {
				type: 'log',
				args: [
					{ type: 'number', value: index },
				],
			});
		}

		expect(diagnostics.read().console).toEqual([
			'log: 45',
			'log: 46',
			'log: 47',
			'log: 48',
			'log: 49',
		]);
	});
});

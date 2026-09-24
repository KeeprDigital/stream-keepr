import { describe, expect, it, vi } from 'vitest';
import { LOCAL_NUXT_NAME_SURFACES } from '~~/build/localConfiguration';
import {
	LOCAL_AUTH_BYPASS_ENABLED_VALUE,
	LOCAL_AUTH_BYPASS_NAME,
	LOCAL_DEVELOPER_SESSION_COOKIE,
	LOCAL_DEVELOPER_SESSION_ID_PREFIX,
	LOCAL_DEVELOPER_USER_ID,
	LOCAL_DEVELOPER_USER_NAME,
} from '~~/shared/utils/localDeveloperAuth';
import { stubH3Event } from '~~/test/helpers/h3Event';

/**
 * The refusal a blank `NUXT_BETTER_AUTH_SECRET` produces, and the one thing about
 * it that lives in two files.
 *
 * `build/localConfiguration.ts` quotes each required name's surface in the notice a dev
 * server prints, in that surface's own words, so a reader can match the notice to
 * the 503 they are looking at. For the two shared-secret surfaces that quotation
 * is held to account by their own unit tests (`graphicsAdministrator.test.ts`
 * pins the clause literally). This is the same pin for the third — #396, the
 * ticket that made the secret a required name and gave its refusal a surface to
 * name in the first place.
 *
 * Read against the shared map rather than a literal: a reword in either place has
 * to be a reword in both, or the boot notice sends an operator looking for a
 * sentence nothing says.
 */

vi.mock('~~/server/db', () => ({ db: {}, schema: {} }));

const { mockGetCookie, mockSetCookie } = vi.hoisted(() => ({
	mockGetCookie: vi.fn(),
	mockSetCookie: vi.fn(),
}));

vi.mock('h3', async (importOriginal) => {
	const original = await importOriginal<typeof import('h3')>();
	return { ...original, getCookie: mockGetCookie, setCookie: mockSetCookie };
});

const mockUseRuntimeConfig = vi.fn();
vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig);
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) => Object.assign(new Error(input.message), input));

const { optionalUserSession, serverAuth } = await import('~~/server/utils/auth');

describe('the Better Auth instance', () => {
	it('refuses a blank secret by naming the setting and the surface the notice quotes', () => {
		mockUseRuntimeConfig.mockReturnValue({ betterAuthSecret: '' });

		expect(() => serverAuth()).toThrow(
			`NUXT_BETTER_AUTH_SECRET is not configured, so ${LOCAL_NUXT_NAME_SURFACES.NUXT_BETTER_AUTH_SECRET} are unavailable`,
		);
	});

	it('classifies it as a configuration fault, so the sentence survives the 5xx sanitizer', () => {
		// `mapPublicNitroError` replaces the message of any 5xx that names no cause
		// it recognises, and 'Internal Server Error' is a wrong answer to a name
		// nobody set. The class is what keeps the words (#233).
		mockUseRuntimeConfig.mockReturnValue({ betterAuthSecret: '' });

		expect(() => serverAuth()).toThrow(expect.objectContaining({
			name: 'ServiceConfigurationError',
			statusCode: 503,
		}));
	});

	it('counts a whitespace-only secret as missing, the way the boot notice counts it', () => {
		// The notice in `build/localConfiguration.ts` treats a name that trims to nothing as
		// absent, and says it does so because that is how the readers count it. It
		// was not how this reader counted it until #396: a space passed the test and
		// every session in the installation was signed with it, rather than the
		// setting being named. `cp .env.example .env` plus one keystroke is how a
		// checkout arrives here.
		mockUseRuntimeConfig.mockReturnValue({ betterAuthSecret: '   ' });

		expect(() => serverAuth()).toThrow(/NUXT_BETTER_AUTH_SECRET/);
	});
});

/**
 * The optional read, and the fail-open half of it (#397).
 *
 * `optionalUserSession` swallows exactly the configuration fault every other reader
 * raises, which is a deliberate trade: the routes that use it have a credential-free
 * arm, and a Screen Output showing program must not go dark because *sign-in* is
 * unconfigured. The cost is that the function fails open, so the invariant is a
 * precondition on its callers — only a route with another way in may ask.
 *
 * Pinned here rather than asserted in a docblock, because the shape of this going
 * wrong is somebody adding a third caller for which the session is the only
 * credential and inheriting the fail-open silently. A test cannot forbid that
 * caller, but it can make the behaviour a fact on record rather than a sentence
 * nobody has to read.
 */
describe('the optional session read', () => {
	it('answers null on a blank secret rather than raising the 503', async () => {
		mockUseRuntimeConfig.mockReturnValue({ betterAuthSecret: '' });

		await expect(optionalUserSession(stubH3Event({ headers: new Headers(), context: {} }))).resolves.toBeNull();
	});

	it('lets every other failure out, so only the configuration fault is absorbed', async () => {
		// A database that cannot be reached is not a missing setting, and answering
		// `null` for it would read as "nobody is signed in" — which on the session arm
		// of a dual-credential route is a refusal wearing the wrong reason.
		//
		// On a **fresh module** rather than the one at the top of this file: `serverAuth`
		// memoises its instance, so configuring a real secret here would leave every
		// blank-secret row above passing or failing on where it sits in the file. That
		// is a test that agrees with itself, which is the thing this suite keeps finding.
		vi.resetModules();
		mockUseRuntimeConfig.mockReturnValue({ betterAuthSecret: 'a-configured-secret-0000000000' });
		const fresh = await import('~~/server/utils/auth');
		const unreachable = new Error('D1 is unreachable');
		vi.spyOn(fresh.serverAuth().api, 'getSession').mockRejectedValue(unreachable);

		await expect(fresh.optionalUserSession(stubH3Event({ headers: new Headers(), context: {} })))
			.rejects
			.toThrow(unreachable);
	});
});

/**
 * The identities a request is asked for once the boundary has admitted it (#398,
 * ADR-0010's credential model).
 *
 * Two granularities, deliberately: the **person** owns Graphics Ingestion
 * Operations, and the **browser** holds a Graphics Authoring Lease. That pair is
 * the whole of what replaced the Graphics Author Session, so the distinction is
 * pinned here rather than left to a hundred call sites to get right one at a time.
 */
describe('the identities a request carries', () => {
	async function freshAuth(session: unknown) {
		// Fresh for the reason the row above gives: `serverAuth` memoises its
		// instance, so a suite that configured a secret in place would leave the
		// blank-secret rows passing on where they sit in the file.
		vi.resetModules();
		mockUseRuntimeConfig.mockReturnValue({ betterAuthSecret: 'a-configured-secret-0000000000' });
		const fresh = await import('~~/server/utils/auth');
		const getSession = vi.spyOn(fresh.serverAuth().api, 'getSession').mockResolvedValue(session as never);
		return { ...fresh, getSession };
	}

	function requestEvent() {
		return stubH3Event({ headers: new Headers(), context: {} });
	}

	const signedIn = { session: { id: 'a-browser-session' }, user: { id: 'a-user' } };

	it('names the person, not the browser, as who a request is acting as', async () => {
		// The widening ADR-0010 pre-committed to: an operation survives the browser
		// that started it, and the same idempotency key sent from a second browser
		// dedupes onto the first operation rather than starting a second.
		const { requireUserId } = await freshAuth(signedIn);

		await expect(requireUserId(requestEvent())).resolves.toBe('a-user');
	});

	it('names the browser for the one thing that is browser-scoped', async () => {
		// A lease guards concurrent editors, and one person in two browsers is two of
		// them. This answering `a-user` would be the silent-corruption shape the lease
		// exists to prevent.
		const { optionalBrowserSessionId } = await freshAuth(signedIn);

		await expect(optionalBrowserSessionId(requestEvent())).resolves.toBe('a-browser-session');
	});

	it('refuses a session-less caller in the boundary\'s own words', async () => {
		// Unreachable through today's callers — every one of them is a private
		// `/api/**` path the middleware has already refused for. It is spelled so a
		// caller that stops being one of those fails closed rather than reading
		// `undefined` as an identity, and it is spelled *identically* so the refusal
		// census gains no entry from it.
		const { requireUserId } = await freshAuth(null);

		await expect(requireUserId(requestEvent())).rejects.toMatchObject({
			statusCode: 401,
			message: 'Authentication is required',
		});
	});

	it('leaves the optional identities empty rather than refusing', async () => {
		const { optionalUserId, optionalBrowserSessionId } = await freshAuth(null);
		const event = requestEvent();

		await expect(optionalUserId(event)).resolves.toBeUndefined();
		await expect(optionalBrowserSessionId(event)).resolves.toBeUndefined();
	});

	it('resolves one request\'s session once, however many identities it asks for', async () => {
		// The middleware has already resolved it before the handler runs, and a
		// leased ingestion write asks twice more. Three D1 reads per part of a
		// resumable transfer is what the memo is for — and the two asked here are
		// asked concurrently, which is the case memoising the value rather than the
		// promise would miss.
		const { requestUserSession, requireUserId, optionalBrowserSessionId, getSession } = await freshAuth(signedIn);
		const event = requestEvent();

		await requestUserSession(event);
		await Promise.all([requireUserId(event), optionalBrowserSessionId(event)]);

		expect(getSession).toHaveBeenCalledTimes(1);
	});

	it('does not memoise a blank secret, so the answer stays the 503 that names it', async () => {
		vi.resetModules();
		mockUseRuntimeConfig.mockReturnValue({ betterAuthSecret: '' });
		const fresh = await import('~~/server/utils/auth');
		const event = requestEvent();

		await expect(fresh.requestUserSession(event)).rejects.toThrow(/NUXT_BETTER_AUTH_SECRET/);
		await expect(fresh.requestUserSession(event)).rejects.toThrow(/NUXT_BETTER_AUTH_SECRET/);
	});
});

describe('the Local Developer Session', () => {
	async function freshLocalAuth(cookie?: string) {
		vi.resetModules();
		vi.stubEnv(LOCAL_AUTH_BYPASS_NAME, LOCAL_AUTH_BYPASS_ENABLED_VALUE);
		mockGetCookie.mockReset();
		mockSetCookie.mockReset();
		mockGetCookie.mockReturnValue(cookie);
		mockUseRuntimeConfig.mockReturnValue({ betterAuthSecret: '' });
		return await import('~~/server/utils/auth');
	}

	function requestEvent() {
		return stubH3Event({ headers: new Headers(), context: {} });
	}

	it('supplies one stable User without a Better Auth secret or session cookie', async () => {
		const auth = await freshLocalAuth();
		const event = requestEvent();

		const session = await auth.requestUserSession(event);

		expect(session?.user).toMatchObject({
			id: LOCAL_DEVELOPER_USER_ID,
			name: LOCAL_DEVELOPER_USER_NAME,
		});
		await expect(auth.requireUserId(event)).resolves.toBe(LOCAL_DEVELOPER_USER_ID);
		expect(mockSetCookie).toHaveBeenCalledWith(
			event,
			LOCAL_DEVELOPER_SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
		);
	});

	it('keeps a browser identity from its local cookie and gives another browser a different one', async () => {
		const firstAuth = await freshLocalAuth();
		const first = await firstAuth.requestUserSession(requestEvent());
		const issuedCookie = mockSetCookie.mock.calls[0]?.[2] as string;

		const repeatAuth = await freshLocalAuth(issuedCookie);
		const repeat = await repeatAuth.requestUserSession(requestEvent());
		const otherAuth = await freshLocalAuth();
		const other = await otherAuth.requestUserSession(requestEvent());

		expect(first?.session.id).toBe(`${LOCAL_DEVELOPER_SESSION_ID_PREFIX}${issuedCookie}`);
		expect(repeat?.session.id).toBe(first?.session.id);
		expect(other?.session.id).not.toBe(first?.session.id);
		expect(repeat?.user.id).toBe(first?.user.id);
		expect(other?.user.id).toBe(first?.user.id);
	});

	/**
	 * The one name is read from `process.env` directly, and nothing else opens
	 * this — not a `runtimeConfig` key of the same meaning, and not a `NUXT_`
	 * spelling of the name, which is the family `.env` supplies and therefore the
	 * shape a checkout could arm by editing a file (#519, ADR-0017).
	 */
	it('cannot be activated through a runtimeConfig key or a NUXT_ spelling of the name', async () => {
		vi.resetModules();
		vi.stubEnv(LOCAL_AUTH_BYPASS_NAME, '');
		vi.stubEnv(`NUXT_${LOCAL_AUTH_BYPASS_NAME}`, LOCAL_AUTH_BYPASS_ENABLED_VALUE);
		mockUseRuntimeConfig.mockReturnValue({ localAuthBypassActive: true, betterAuthSecret: '' });
		const auth = await import('~~/server/utils/auth');

		expect(auth.localAuthBypassIsActive(requestEvent())).toBe(false);
		await expect(auth.requestUserSession(requestEvent())).rejects.toThrow(/NUXT_BETTER_AUTH_SECRET/);
	});

	it('admits an explicitly bypassed production-shaped local Worker', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		const auth = await freshLocalAuth();

		expect(auth.localAuthBypassIsActive(requestEvent())).toBe(true);
		await expect(auth.requestUserSession(requestEvent())).resolves.toMatchObject({
			user: { id: LOCAL_DEVELOPER_USER_ID },
		});
	});
});

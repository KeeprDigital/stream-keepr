import { describe, expect, it, vi } from 'vitest';
import { LOCAL_NUXT_NAME_SURFACES } from '~~/build/devVars';

/**
 * The refusal a blank `NUXT_BETTER_AUTH_SECRET` produces, and the one thing about
 * it that lives in two files.
 *
 * `build/devVars.ts` quotes each required name's surface in the notice a dev
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

vi.mock('hub:db', () => ({ db: {}, schema: {} }));

const mockUseRuntimeConfig = vi.fn();
vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig);

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
		// The notice in `build/devVars.ts` treats a name that trims to nothing as
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

		await expect(optionalUserSession({ headers: new Headers() } as never)).resolves.toBeNull();
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

		await expect(fresh.optionalUserSession({ headers: new Headers() } as never))
			.rejects
			.toThrow(unreachable);
	});
});

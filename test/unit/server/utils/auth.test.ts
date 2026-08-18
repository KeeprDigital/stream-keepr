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

const { serverAuth } = await import('~~/server/utils/auth');

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

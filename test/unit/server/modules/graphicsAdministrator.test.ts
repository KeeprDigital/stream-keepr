import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';

const { mockRuntimeConfig, mockRequestHeader } = vi.hoisted(() => ({
	mockRuntimeConfig: vi.fn(),
	mockRequestHeader: vi.fn(),
}));

vi.stubGlobal('useRuntimeConfig', mockRuntimeConfig);
vi.stubGlobal('getRequestHeader', mockRequestHeader);
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
}) => Object.assign(new Error(input.message), input));

async function requireAdministrator() {
	return (await import('~~/server/modules/graphics-administrator')).requireGraphicsAdministrator;
}

const CONFIGURED_TOKEN = 'a-configured-admin-token';

describe('the Graphics Administrator guard', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRuntimeConfig.mockReset().mockReturnValue({ graphicsAdminToken: CONFIGURED_TOKEN });
		mockRequestHeader.mockReset().mockReturnValue(CONFIGURED_TOKEN);
	});

	it('admits a caller presenting the installation token', async () => {
		await expect((await requireAdministrator())(stubH3Event())).resolves.toBeUndefined();
	});

	it('refuses a caller presenting the wrong token with 403', async () => {
		mockRequestHeader.mockReturnValue('not-the-token');

		await expect((await requireAdministrator())(stubH3Event())).rejects.toMatchObject({
			statusCode: 403,
			message: 'Graphics Administrator authorization is required',
		});
	});

	/**
	 * #321, and #233's defect in a second module.
	 *
	 * An installation that has never set the name answered 503 with a body of 'Internal
	 * Server Error', because the refusal carried no cause for `mapPublicNitroError` to
	 * recognise — so the one reader who could fix it in a line was sent to the logs of a
	 * server behaving exactly as configured. `build/devVars.ts` quotes this sentence in
	 * the notice `nuxt dev` prints for the same missing name, and quoted one nobody could
	 * see until this was classified.
	 *
	 * Asserted after the mapper, which is where the rewrite happens and the only place
	 * the fix is observable.
	 */
	it('names the setting when the installation has no administrator token', async () => {
		mockRuntimeConfig.mockReturnValue({ graphicsAdminToken: '   ' });

		const failure = await refusalFrom((await requireAdministrator())(stubH3Event()));
		// Imported here rather than at the top of the file: `vi.resetModules()` gives the
		// guard a fresh copy of the errors module, and a statically bound class would be a
		// different one — the `instanceof` would then read false for a correctly
		// classified refusal.
		const { ServiceConfigurationError } = await import('~~/server/utils/errors');

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'NUXT_GRAPHICS_ADMIN_TOKEN is not configured, so Graphics Administrator operations are unavailable',
		});
		expect(failure.cause).toBeInstanceOf(ServiceConfigurationError);
	});

	it('names a setting and never a value', async () => {
		// The class's own rule, restated at the site that has a secret to leak: the
		// message is public, and the token it is about must not be in it.
		mockRuntimeConfig.mockReturnValue({ graphicsAdminToken: '' });
		mockRequestHeader.mockReturnValue('a-supplied-token');

		const failure = await refusalFrom((await requireAdministrator())(stubH3Event()));

		expect(failure.message).not.toContain('a-supplied-token');
	});

	it('does not tell a caller to retry something no waiting will fix', async () => {
		// The other six sites #321 classified set `retry-after` beside their sentence,
		// and this one deliberately does not: nothing about an unset name resolves by
		// asking again. The guard sets no response headers at all.
		const setResponseHeader = vi.fn();
		vi.stubGlobal('setResponseHeader', setResponseHeader);
		mockRuntimeConfig.mockReturnValue({ graphicsAdminToken: '' });

		await expect((await requireAdministrator())(stubH3Event())).rejects.toMatchObject({ statusCode: 503 });

		expect(setResponseHeader).not.toHaveBeenCalled();
	});
});

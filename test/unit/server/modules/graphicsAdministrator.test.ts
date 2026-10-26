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

	// Refused 503 naming the setting, classified so the public mapper keeps the sentence (#321),
	// and never echoing a token. Unset, blank, or read by `destr` as another type.
	it.each([
		['unset', ''],
		['blank', '   '],
		['all digits', 482915736104],
		['true', true],
	])('names the setting when the administrator token is %s', async (_label, configured) => {
		mockRuntimeConfig.mockReturnValue({ graphicsAdminToken: configured });
		mockRequestHeader.mockReturnValue('a-supplied-token');

		const failure = await refusalFrom((await requireAdministrator())(stubH3Event()));
		// Imported after `vi.resetModules()`, so `instanceof` compares the guard's own class.
		const { ServiceConfigurationError } = await import('~~/server/utils/errors');

		expect(failure).toMatchObject({ statusCode: 503, statusMessage: 'Service Unavailable' });
		expect(failure.message).toContain('NUXT_GRAPHICS_ADMIN_TOKEN');
		expect(failure.message).not.toContain('a-supplied-token');
		expect(failure.cause).toBeInstanceOf(ServiceConfigurationError);
	});
});

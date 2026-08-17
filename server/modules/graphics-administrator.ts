import type { H3Event } from 'h3';
import { ServiceConfigurationError } from '~~/server/utils/errors';
import { secretTokensMatch } from '~~/server/utils/secretTokenComparison';

/**
 * The environment name, not the runtimeConfig one, because the only reader who can
 * act on this is the one who has to go and set it. `build/devVars.ts` quotes this
 * refusal in the notice a dev server prints when the name is missing.
 */
const ADMIN_TOKEN_ENV_NAME = 'NUXT_GRAPHICS_ADMIN_TOKEN';

export async function requireGraphicsAdministrator(event: H3Event) {
	const configuredToken = useRuntimeConfig(event).graphicsAdminToken.trim();
	if (!configuredToken) {
		// Both the H3 error and its cause: the status is right on its own, and the
		// cause is what carries the message past the 5xx sanitizer in
		// `mapPublicNitroError`. Without it this answered 'Internal Server Error'
		// (#321) — a fresh checkout was told its own Graphics Administrator routes
		// had broken rather than that a name was blank. No `retry-after`: nothing
		// about this resolves by waiting.
		const cause = new ServiceConfigurationError(
			ADMIN_TOKEN_ENV_NAME,
			'is not configured, so Graphics Administrator operations are unavailable',
		);
		throw createError({
			statusCode: cause.statusCode,
			statusMessage: 'Service Unavailable',
			message: cause.message,
			cause,
		});
	}
	const suppliedToken = getRequestHeader(event, 'x-graphics-admin-token')?.trim() ?? '';
	if (!suppliedToken || !(await secretTokensMatch(suppliedToken, configuredToken))) {
		throw createError({
			statusCode: 403,
			statusMessage: 'Forbidden',
			message: 'Graphics Administrator authorization is required',
		});
	}
}

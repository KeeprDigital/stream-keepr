import type { H3Event } from 'h3';
import { requireSharedSecret } from '~~/server/utils/sharedSecretSurface';

/**
 * The environment name, not the runtimeConfig one, because the only reader who can
 * act on this is the one who has to go and set it. `build/localConfiguration.ts`
 * quotes this refusal in the notice a dev server prints when the name is missing.
 */
const ADMIN_TOKEN_ENV_NAME = 'NUXT_GRAPHICS_ADMIN_TOKEN';

/**
 * The refusal shape — the 503's cause, the absent `retry-after`, the 403 — lives
 * in `requireSharedSecret`, which #394 extracted when the first-admin bootstrap
 * became this guard's second copy. The sentences stay here:
 * `build/localConfiguration.ts` quotes the clause below verbatim.
 */
export async function requireGraphicsAdministrator(event: H3Event) {
	await requireSharedSecret(event, {
		configuredToken: useRuntimeConfig(event).graphicsAdminToken,
		settingName: ADMIN_TOKEN_ENV_NAME,
		unavailableClause: 'is not configured, so Graphics Administrator operations are unavailable',
		headerName: 'x-graphics-admin-token',
		forbiddenMessage: 'Graphics Administrator authorization is required',
	});
}

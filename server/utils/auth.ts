import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db, schema } from 'hub:db';
import { authStaticOptions } from './authOptions';
import { ServiceConfigurationError } from './errors';

/** The environment name behind `runtimeConfig.betterAuthSecret`, as the operator sets it. */
const BETTER_AUTH_SECRET_SETTING = 'NUXT_BETTER_AUTH_SECRET';

let auth: ReturnType<typeof createAuth> | null = null;

function createAuth(secret: string) {
	return betterAuth({
		...authStaticOptions,
		// Sessions live in D1 through the Drizzle adapter — deliberately not KV
		// `secondaryStorage` (ADR decided on #386): native sliding expiry with no
		// KV single-key write cap to protect.
		database: drizzleAdapter(db, {
			provider: 'sqlite',
			schema,
		}),
		secret,
	});
}

/**
 * The Better Auth instance, constructed on first use because the secret only
 * exists at runtime. A missing secret is an unfinished deployment, and the
 * classification is what lets the response name the setting instead of a
 * stack-free 500 — same reasoning as `getAblyClient`.
 */
export function serverAuth() {
	if (!auth) {
		const config = useRuntimeConfig();

		if (!config.betterAuthSecret) {
			throw new ServiceConfigurationError(BETTER_AUTH_SECRET_SETTING, 'is not configured');
		}

		auth = createAuth(config.betterAuthSecret);
	}

	return auth;
}
